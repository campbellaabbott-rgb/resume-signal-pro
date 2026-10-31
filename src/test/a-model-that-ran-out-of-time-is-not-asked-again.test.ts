// @vitest-environment node
/**
 * A MODEL THAT RAN OUT OF TIME IS NOT ASKED AGAIN (S13-001, S10-009).
 *
 * WHAT WAS WRONG. callAIWithModelFallback (_shared/ai-fallback.ts) aborted
 * each attempt at 55 s and then caught the abort like any network error: it
 * asked the SAME model again. A slow gemini-2.5-pro was aborted at 55 s,
 * asked again and aborted at 111 s; flash, the model that would have
 * answered, got the 14 s left of the 125 s budget and was aborted too;
 * gpt-5-mini was never asked; the AbortError reached the caller at 126 s. The
 * $5 Full Analysis made one huge call on that chain and answered a 500.
 *
 * NOW. A timed-out attempt goes to the next model with what is left of the
 * budget. A transient failure (a 5xx, a dropped connection) is retried once
 * on the same model as before, and a 429 still moves on at once. A caller may
 * cap its first model's attempt (attemptTimeoutMs) to leave the next model a
 * real window, and the first model's retry never runs into the last 40 s of a
 * default chain, so the fallback always has a real window when the first
 * model times out.
 *
 * HOW IT IS PROVEN. The shipped module runs against a fake gateway on fake
 * timers: every fetch is recorded with the model it asked, when it started
 * and when it ended (an abort, a status, a dropped connection). The same
 * harness first runs a FROZEN COPY of main's module (fixtures/ai-fallback.
 * before-s13-001.ts) and must reproduce the old 55 / 111 / 126 s timeline: a
 * harness that cannot see the bug proves nothing about its fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as before from "./fixtures/ai-fallback.before-s13-001";
import * as shipped from "../../supabase/functions/_shared/ai-fallback";

type Step =
  | { kind: "hang" }
  | { kind: "status"; status: number; afterMs: number }
  | { kind: "drop"; afterMs: number };
type Call = { model: string; at: number; end?: number; outcome?: string; body: Record<string, unknown> };
type Chain = typeof shipped.callAIWithModelFallback;

const PRO = "google/gemini-2.5-pro";
const FLASH = "google/gemini-2.5-flash";
const MINI = "openai/gpt-5-mini";

let t0 = 0;
const now = () => Date.now() - t0;

/** A gateway that answers each (model, nth ask of that model) as the plan says, on the fake clock. */
function gateway(plan: (model: string, nth: number) => Step) {
  const calls: Call[] = [];
  const asked = new Map<string, number>();
  const fetch = (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const model = String(body.model);
    const nth = (asked.get(model) ?? 0) + 1;
    asked.set(model, nth);
    const call: Call = { model, at: now(), body };
    calls.push(call);
    const step = plan(model, nth);
    return new Promise<Response>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // An abort after the reply (a timer nobody cleared) changes nothing: the fetch is over.
      init.signal?.addEventListener("abort", () => {
        if (call.end !== undefined) return;
        clearTimeout(timer);
        call.end = now();
        call.outcome = "aborted";
        reject(new DOMException("The signal has been aborted", "AbortError"));
      });
      if (step.kind === "hang") return;
      timer = setTimeout(() => {
        call.end = now();
        if (step.kind === "drop") {
          call.outcome = "dropped";
          reject(new TypeError("error sending request for url"));
          return;
        }
        call.outcome = String(step.status);
        resolve(new Response(JSON.stringify(step.status === 200 ? { choices: [{ message: { content: "ok" } }] } : { error: "upstream" }), { status: step.status }));
      }, step.afterMs);
    });
  };
  return { fetch, calls };
}

/** Run one chain call to the end on the fake clock; what it returned or threw, and when. */
async function run(chain: Chain, plan: (model: string, nth: number) => Step, opts: Partial<Parameters<Chain>[1]> = {}) {
  const gw = gateway(plan);
  vi.stubGlobal("fetch", gw.fetch);
  t0 = Date.now();
  const settled = chain("key", { messages: [{ role: "user", content: "hi" }], context: "CHAIN-TEST", ...opts }).then(
    (r) => ({ modelUsed: r.modelUsed, status: r.response.status, error: null as Error | null, at: now() }),
    (e: Error) => ({ modelUsed: null as string | null, status: null as number | null, error: e, at: now() }),
  );
  await vi.advanceTimersByTimeAsync(200_000);
  const out = await settled;
  return { ...out, calls: gw.calls };
}

const hangAll = () => ({ kind: "hang" }) as Step;
/** The time the NEXT model had: from its first ask to the chain's end of its attempt. */
const windowOf = (calls: Call[], model: string) => {
  const c = calls.find((x) => x.model === model);
  return c ? (c.end ?? Infinity) - c.at : 0;
};
const timesAsked = (calls: Call[], model: string) => calls.filter((c) => c.model === model).length;
const timeline = (calls: Call[]) => calls.map((c) => `${c.model}@${c.at / 1000}->${(c.end ?? NaN) / 1000}:${c.outcome}`);

beforeEach(() => {
  vi.useFakeTimers();
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the positive control: main's module (frozen at f8d72a9b) on the same harness", () => {
  it("reproduces S13-001: pro aborted at 55 s, asked AGAIN and aborted at 111 s, flash left 14 s, gpt-5-mini never asked, AbortError at 126 s", async () => {
    const r = await run(before.callAIWithModelFallback, hangAll);
    expect(timeline(r.calls)).toEqual([
      `${PRO}@0->55:aborted`,
      `${PRO}@56->111:aborted`,
      `${FLASH}@111->125:aborted`,
    ]);
    expect(timesAsked(r.calls, MINI)).toBe(0);
    expect(windowOf(r.calls, FLASH)).toBe(14_000);
    expect(r.error?.name).toBe("AbortError");
    expect(r.at).toBe(126_000);
  });

  it("and a slow 5xx on the first model leaves the fallback 19 s", async () => {
    const r = await run(before.callAIWithModelFallback, (m, n) => (m === PRO && n === 1 ? { kind: "status", status: 502, afterMs: 50_000 } : { kind: "hang" }));
    expect(timeline(r.calls).slice(0, 2)).toEqual([`${PRO}@0->50:502`, `${PRO}@51->106:aborted`]);
    expect(windowOf(r.calls, FLASH)).toBe(19_000);
  });
});

describe("the shipped chain: a timed-out model goes to the next model", () => {
  it("with the default chain and budget every model is asked once, and flash has 55 s when pro times out", async () => {
    const r = await run(shipped.callAIWithModelFallback, hangAll);
    expect(timeline(r.calls), "a model that timed out was asked again").toEqual([
      `${PRO}@0->55:aborted`,
      `${FLASH}@55->110:aborted`,
      `${MINI}@110->125:aborted`,
    ]);
    for (const m of [PRO, FLASH, MINI]) expect(timesAsked(r.calls, m), `${m} was asked twice after a timeout`).toBe(1);
    expect(windowOf(r.calls, FLASH)).toBeGreaterThanOrEqual(40_000);
    // Callers recognise a timeout by this name (generate-apply-package, parse-resume-structured, analyze-resume).
    expect(r.error?.name).toBe("AbortError");
    expect(r.at).toBe(125_000);
  });

  it("a slow pro hands over to flash, which answers: the delivery is made, not a 500", async () => {
    const r = await run(shipped.callAIWithModelFallback, (m) => (m === FLASH ? { kind: "status", status: 200, afterMs: 20_000 } : { kind: "hang" }));
    expect(r.error).toBeNull();
    expect(r.modelUsed).toBe(FLASH);
    expect(r.at).toBe(75_000);
    expect(timesAsked(r.calls, PRO)).toBe(1);
  });

  it("attemptTimeoutMs caps the first model's attempt and the next model keeps the rest of the budget", async () => {
    const r = await run(shipped.callAIWithModelFallback, hangAll, { attemptTimeoutMs: 80_000 });
    expect(timeline(r.calls)).toEqual([`${PRO}@0->80:aborted`, `${FLASH}@80->125:aborted`]);
    expect(windowOf(r.calls, FLASH)).toBe(45_000);
  });

  it("the first model's retry after a slow 5xx stops where the fallback's 40 s begin", async () => {
    const r = await run(shipped.callAIWithModelFallback, (m, n) => (m === PRO && n === 1 ? { kind: "status", status: 502, afterMs: 50_000 } : { kind: "hang" }));
    expect(timeline(r.calls).slice(0, 2), "the retry after a 5xx is still made").toEqual([`${PRO}@0->50:502`, `${PRO}@51->85:aborted`]);
    expect(windowOf(r.calls, FLASH)).toBeGreaterThanOrEqual(40_000);
  });

  it("a first model that runs out of room for its retry goes straight to the next model", async () => {
    // An 85 s first attempt leaves exactly 40 s; a 503 at 82 s leaves no room for a retry before them.
    const r = await run(shipped.callAIWithModelFallback, (m, n) => (m === PRO && n === 1 ? { kind: "status", status: 503, afterMs: 82_000 } : { kind: "hang" }), { attemptTimeoutMs: 85_000 });
    expect(timeline(r.calls)).toEqual([`${PRO}@0->82:503`, `${FLASH}@83->125:aborted`]);
    expect(timesAsked(r.calls, PRO)).toBe(1);
  });

  it("a chain of one model (generate-freelance-boost walks its own) gives up after one timeout instead of two", async () => {
    const was = await run(before.callAIWithModelFallback, hangAll, { models: [PRO] });
    const now = await run(shipped.callAIWithModelFallback, hangAll, { models: [PRO] });
    expect(timesAsked(was.calls, PRO)).toBe(2);
    expect(timeline(now.calls)).toEqual([`${PRO}@0->55:aborted`]);
    expect(now.error?.name).toBe("AbortError");
    expect(now.at).toBe(55_000);
  });

  it("a short budget (test-ai-fallback's 40 s) gives the first attempt the same time as before", async () => {
    const was = await run(before.callAIWithModelFallback, hangAll, { deadlineMs: 40_000 });
    const now = await run(shipped.callAIWithModelFallback, hangAll, { deadlineMs: 40_000 });
    expect(timeline(was.calls)[0]).toBe(`${PRO}@0->40:aborted`);
    expect(timeline(now.calls)[0]).toBe(`${PRO}@0->40:aborted`);
  });
});

describe("transient failures are handled exactly as before", () => {
  const same = async (plan: (model: string, nth: number) => Step, opts: Partial<Parameters<Chain>[1]> = {}) => {
    const was = await run(before.callAIWithModelFallback, plan, opts);
    const now = await run(shipped.callAIWithModelFallback, plan, opts);
    return { was, now };
  };

  it("a fast 5xx is retried once on the same model, a second later, with the full 55 s", async () => {
    const plan = (m: string, n: number): Step => (m === PRO && n === 1 ? { kind: "status", status: 503, afterMs: 1_000 } : m === PRO ? { kind: "status", status: 200, afterMs: 30_000 } : { kind: "hang" });
    const { was, now } = await same(plan);
    expect(timeline(now.calls)).toEqual([`${PRO}@0->1:503`, `${PRO}@2->32:200`]);
    expect(timeline(now.calls)).toEqual(timeline(was.calls));
    expect(now.modelUsed).toBe(PRO);
    // The retry's own clock is the full attempt: hung, it is aborted 55 s after it starts.
    const hungRetry = await run(shipped.callAIWithModelFallback, (m, n) => (m === PRO && n === 1 ? { kind: "status", status: 503, afterMs: 1_000 } : { kind: "hang" }));
    expect(timeline(hungRetry.calls)[1]).toBe(`${PRO}@2->57:aborted`);
  });

  it("two 5xx move on to the next model, as before", async () => {
    const plan = (m: string): Step => (m === PRO ? { kind: "status", status: 500, afterMs: 1_000 } : { kind: "status", status: 200, afterMs: 5_000 });
    const { was, now } = await same(plan);
    expect(timeline(now.calls)).toEqual([`${PRO}@0->1:500`, `${PRO}@2->3:500`, `${FLASH}@3->8:200`]);
    expect(timeline(now.calls)).toEqual(timeline(was.calls));
  });

  it("a dropped connection is retried once on the same model, as before", async () => {
    const plan = (m: string, n: number): Step => (m === PRO && n === 1 ? { kind: "drop", afterMs: 2_000 } : { kind: "status", status: 200, afterMs: 3_000 });
    const { was, now } = await same(plan);
    expect(timeline(now.calls)).toEqual([`${PRO}@0->2:dropped`, `${PRO}@3->6:200`]);
    expect(timeline(now.calls)).toEqual(timeline(was.calls));
  });

  it("a 429 moves to the next model at once, and every model busy returns the last 429", async () => {
    const one = await same((m) => (m === PRO ? { kind: "status", status: 429, afterMs: 500 } : { kind: "status", status: 200, afterMs: 1_000 }));
    expect(timeline(one.now.calls)).toEqual([`${PRO}@0->0.5:429`, `${FLASH}@0.5->1.5:200`]);
    expect(timeline(one.now.calls)).toEqual(timeline(one.was.calls));
    const all = await same(() => ({ kind: "status", status: 429, afterMs: 500 }));
    expect(all.now.status).toBe(429);
    expect(all.now.modelUsed).toBe(MINI);
    expect(timeline(all.now.calls)).toEqual(timeline(all.was.calls));
  });

  it("a 402 is returned at once", async () => {
    const { was, now } = await same(() => ({ kind: "status", status: 402, afterMs: 500 }));
    expect(now.status).toBe(402);
    expect(timeline(now.calls)).toEqual([`${PRO}@0->0.5:402`]);
    expect(timeline(now.calls)).toEqual(timeline(was.calls));
  });

  it("every caller's request body is unchanged: the per-provider parameters still ride as before", async () => {
    const plan = (m: string): Step => (m === PRO ? { kind: "status", status: 400, afterMs: 100 } : m === FLASH ? { kind: "status", status: 400, afterMs: 100 } : { kind: "status", status: 200, afterMs: 100 });
    const opts = { maxTokens: 1234, temperature: 0.3, jsonResponse: true, tools: [{ type: "function" }], toolChoice: { type: "function" } };
    const { was, now } = await same(plan, opts);
    expect(now.calls.map((c) => c.body)).toEqual(was.calls.map((c) => c.body));
    // attemptTimeoutMs is the chain's own clock, never sent to the gateway.
    const capped = await run(shipped.callAIWithModelFallback, plan, { ...opts, attemptTimeoutMs: 70_000 });
    expect(capped.calls.map((c) => c.body)).toEqual(was.calls.map((c) => c.body));
  });
});
