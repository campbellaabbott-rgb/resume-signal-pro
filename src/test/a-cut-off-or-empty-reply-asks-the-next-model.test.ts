// @vitest-environment node
/**
 * A CUT-OFF OR EMPTY REPLY ASKS THE NEXT MODEL, WITH THE TIME THAT IS LEFT
 * (S10-009, S13-065; the shared half of both).
 *
 * WHAT WAS WRONG. callAIWithModelFallback (_shared/ai-fallback.ts) hands back
 * the first 200 it gets. A reply cut off at its token cap (gemini-2.5-pro's
 * thinking counts against max_tokens, so 14 STAR answers in 9,000 tokens came
 * back half-written), an empty message, or JSON that does not parse all
 * counted as success: the caller failed to parse and answered a 500 after one
 * model, with two more models and most of the budget unused.
 *
 * NOW. callAIForUsableReply walks the same chain and refuses such a reply:
 * finish_reason "length", or a reply the caller's reader cannot deliver, asks
 * the next model with what is left of the same budget. Refusals from the
 * gateway (429 on every model, 402) and timeouts come back exactly as the
 * chain returns or throws them. Also here: the max_completion_tokens body the
 * two private chains always sent, now that they walk this chain, and the
 * log line that describes a reply without printing it (S13-064).
 *
 * The shipped module runs against a fake gateway on fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as shipped from "../../supabase/functions/_shared/ai-fallback";

const PRO = "google/gemini-2.5-pro";
const FLASH = "google/gemini-2.5-flash";
const MINI = "openai/gpt-5-mini";

type Reply =
  | { kind: "hang" }
  | { kind: "status"; status: number; afterMs: number }
  | { kind: "reply"; content: string | null; finish?: string; afterMs: number };
type Call = { model: string; at: number; end?: number; outcome?: string; body: Record<string, unknown> };

let t0 = 0;
const now = () => Date.now() - t0;

function gateway(plan: (model: string, nth: number) => Reply) {
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
        if (step.kind === "status") {
          call.outcome = String(step.status);
          resolve(new Response(JSON.stringify({ error: "upstream" }), { status: step.status }));
          return;
        }
        call.outcome = step.finish ?? "stop";
        resolve(new Response(JSON.stringify({ choices: [{ finish_reason: step.finish ?? "stop", message: { content: step.content } }] }), { status: 200 }));
      }, step.afterMs);
    });
  };
  return { fetch, calls };
}

/** Reads a reply's message as JSON with a non-empty `questions` list; null otherwise. */
const readQuestions = (data: unknown) => {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return null;
  try {
    const parsed = JSON.parse(content) as { questions?: unknown };
    return Array.isArray(parsed.questions) && parsed.questions.length ? parsed : null;
  } catch {
    return null;
  }
};

const GOOD = JSON.stringify({ questions: [{ question: "Tell me about a launch." }] });
const CUT = '{"questions": [{"question": "Tell me about a la';

async function run(plan: (model: string, nth: number) => Reply, opts: Partial<shipped.UsableReplyOptions<unknown>> = {}) {
  const gw = gateway(plan);
  vi.stubGlobal("fetch", gw.fetch);
  t0 = Date.now();
  const settled = shipped.callAIForUsableReply("key", {
    messages: [{ role: "user", content: "hi" }],
    context: "USABLE-TEST",
    models: [PRO, FLASH, MINI],
    read: readQuestions,
    ...opts,
  }).then(
    (r) => ({ result: r, error: null as Error | null, at: now() }),
    (e: Error) => ({ result: null, error: e, at: now() }),
  );
  await vi.advanceTimersByTimeAsync(200_000);
  const out = await settled;
  return { ...out, calls: gw.calls };
}

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

describe("the positive control: the plain chain calls a cut-off reply a success", () => {
  it("callAIWithModelFallback returns pro's truncated 200 and never asks flash", async () => {
    const gw = gateway((m) => (m === PRO ? { kind: "reply", content: CUT, finish: "length", afterMs: 40_000 } : { kind: "reply", content: GOOD, afterMs: 1_000 }));
    vi.stubGlobal("fetch", gw.fetch);
    t0 = Date.now();
    const p = shipped.callAIWithModelFallback("key", { messages: [{ role: "user", content: "hi" }], models: [PRO, FLASH, MINI] });
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await p;
    expect(r.modelUsed).toBe(PRO);
    expect(r.response.ok).toBe(true);
    expect(gw.calls.map((c) => c.model)).toEqual([PRO]);
  });
});

describe("callAIForUsableReply", () => {
  it("a reply cut off at its token cap asks the next model at once, and the next model's reply is delivered", async () => {
    const r = await run((m) => (m === PRO ? { kind: "reply", content: CUT, finish: "length", afterMs: 40_000 } : { kind: "reply", content: GOOD, afterMs: 20_000 }));
    expect(timeline(r.calls)).toEqual([`${PRO}@0->40:length`, `${FLASH}@40->60:stop`]);
    expect(r.result).toEqual({ ok: true, value: JSON.parse(GOOD), modelUsed: FLASH });
  });

  it("a cut-off reply is refused even when what came back happens to parse", async () => {
    const r = await run((m) => (m === PRO ? { kind: "reply", content: GOOD, finish: "length", afterMs: 10_000 } : { kind: "reply", content: GOOD, afterMs: 5_000 }));
    expect(r.result && r.result.ok && r.result.modelUsed).toBe(FLASH);
  });

  for (const [name, content] of [["an empty message", ""], ["no message at all", null], ["JSON that does not parse", "Sure! Here are your questions:"]] as const) {
    it(`${name} asks the next model`, async () => {
      const r = await run((m) => (m === PRO ? { kind: "reply", content, afterMs: 30_000 } : { kind: "reply", content: GOOD, afterMs: 10_000 }));
      expect(r.calls.map((c) => c.model)).toEqual([PRO, FLASH]);
      expect(r.result && r.result.ok && r.result.modelUsed).toBe(FLASH);
    });
  }

  it("every model unusable: each is asked once, then UnusableModelOutput, whose message names no reply text", async () => {
    const r = await run(() => ({ kind: "reply", content: "Jane Doe, jane@example.com, +1 555 0100", afterMs: 10_000 }));
    expect(r.calls.map((c) => c.model)).toEqual([PRO, FLASH, MINI]);
    expect(r.error?.name).toBe("UnusableModelOutput");
    expect(r.error?.message).not.toMatch(/Jane|example\.com|555/);
  });

  it("the budget is the whole walk's: flash cut off at 100 s leaves gpt-5-mini the 25 s that are left, never a fresh 125 s", async () => {
    const r = await run((m) =>
      m === PRO ? { kind: "hang" } : m === FLASH ? { kind: "reply", content: CUT, finish: "length", afterMs: 45_000 } : { kind: "hang" });
    expect(timeline(r.calls)).toEqual([`${PRO}@0->55:aborted`, `${FLASH}@55->100:length`, `${MINI}@100->125:aborted`]);
    expect(shipped.chainRanOutOfTime(r.error)).toBe(true);
    expect(r.at).toBeLessThanOrEqual(125_000);
  });

  it("the caller's longer first attempt is the first model's only; the model asked after a refused reply gets the chain's 55 s", async () => {
    const r = await run(
      (m) => (m === PRO ? { kind: "reply", content: CUT, finish: "length", afterMs: 30_000 } : { kind: "hang" }),
      { attemptTimeoutMs: 80_000 },
    );
    expect(timeline(r.calls).slice(0, 2)).toEqual([`${PRO}@0->30:length`, `${FLASH}@30->85:aborted`]);
  });

  it("a 429 on every model and a 402 come back for the caller's own handling, unread", async () => {
    const busy = await run(() => ({ kind: "status", status: 429, afterMs: 1_000 }));
    expect(busy.result && !busy.result.ok && busy.result.response.status).toBe(429);
    expect(busy.calls.map((c) => c.model)).toEqual([PRO, FLASH, MINI]);
    const broke = await run(() => ({ kind: "status", status: 402, afterMs: 1_000 }));
    expect(broke.result && !broke.result.ok && broke.result.response.status).toBe(402);
    expect(broke.calls.map((c) => c.model)).toEqual([PRO]);
  });

  it("a refused reply followed by 429s on the rest hands back the 429", async () => {
    const r = await run((m) => (m === PRO ? { kind: "reply", content: "", afterMs: 5_000 } : { kind: "status", status: 429, afterMs: 1_000 }));
    expect(r.result && !r.result.ok && r.result.response.status).toBe(429);
  });

  it("a reader that throws is a refused reply, not a crash", async () => {
    const r = await run((m) => ({ kind: "reply", content: m === PRO ? "{}" : GOOD, afterMs: 1_000 }), {
      read: (d) => {
        const v = readQuestions(d);
        if (!v) throw new Error("boom");
        return v;
      },
    });
    expect(r.result && r.result.ok && r.result.modelUsed).toBe(FLASH);
  });
});

describe("the private chains' body, kept", () => {
  it("maxCompletionTokens is sent as max_completion_tokens to every model, Google's included, and nothing else is added", async () => {
    const gw = gateway(() => ({ kind: "status", status: 500, afterMs: 10 }));
    vi.stubGlobal("fetch", gw.fetch);
    const p = shipped.callAIWithModelFallback("key", { messages: [{ role: "user", content: "hi" }], maxCompletionTokens: 4000, models: [PRO, MINI] }).catch(() => null);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const msgs = [{ role: "user", content: "hi" }];
    // What generate-cover-letter's own chain sent, for every model.
    expect(gw.calls[0].body).toEqual({ model: PRO, messages: msgs, max_completion_tokens: 4000 });
    expect(gw.calls.at(-1)!.body).toEqual({ model: MINI, messages: msgs, max_completion_tokens: 4000 });
    expect(Object.keys(gw.calls[0].body)).toEqual(["model", "messages", "max_completion_tokens"]);
  });

  it("maxTokens is unchanged: max_tokens to Google, max_completion_tokens to OpenAI", async () => {
    const gw = gateway(() => ({ kind: "status", status: 500, afterMs: 10 }));
    vi.stubGlobal("fetch", gw.fetch);
    const p = shipped.callAIWithModelFallback("key", { messages: [{ role: "user", content: "hi" }], maxTokens: 8000, models: [PRO, MINI] }).catch(() => null);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(gw.calls[0].body.max_tokens).toBe(8000);
    expect(gw.calls[0].body.max_completion_tokens).toBeUndefined();
    expect(gw.calls.at(-1)!.body.max_completion_tokens).toBe(8000);
  });
});

describe("a reply described for the logs (S13-064)", () => {
  it("names its shape and lengths, never its words", () => {
    const secret = "Jane Doe | jane.doe@example.com | +1 (555) 010-0199 | Acme Corp";
    const line = shipped.describeReply({
      id: "x",
      choices: [{ finish_reason: "stop", message: { content: secret, tool_calls: [{ function: { name: "submit_structured_resume", arguments: JSON.stringify({ name: "Jane Doe" }) } }] } }],
    });
    expect(line).toContain("finish_reason=stop");
    expect(line).toContain(`content=${secret.length} chars`);
    expect(line).toContain("submit_structured_resume");
    for (const word of ["Jane", "example.com", "555", "Acme"]) expect(line).not.toContain(word);
    expect(shipped.describeReply({ choices: [{ message: { tool_calls: [{ function: { name: "Jane Doe <jane@example.com>", arguments: 7 } }] } }] })).not.toContain("Jane");
    expect(shipped.describeReply(null)).toBe("reply: null");
    expect(shipped.describeReply({ "Jane Doe": 1 })).not.toContain("Jane");
  });

  it("a timeout reads as one, a stop and a refusal do not", () => {
    expect(shipped.chainRanOutOfTime(new DOMException("The signal has been aborted", "AbortError"))).toBe(true);
    expect(shipped.chainRanOutOfTime(new Error("X: timed out before any model answered"))).toBe(true);
    expect(shipped.chainRanOutOfTime(Object.assign(new Error("X: stopped by the caller"), { name: "ChainStopped" }))).toBe(false);
    expect(shipped.chainRanOutOfTime(new Error("X: all models failed"))).toBe(false);
    expect(shipped.chainRanOutOfTime("timeout")).toBe(false);
  });
});
