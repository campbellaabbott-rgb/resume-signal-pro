// @vitest-environment node
/**
 * W4-17 (board .103 rider): SMARTRECRUITERS POSTING READS ARE FOUR AT ONCE AND
 * FIVE A SECOND.
 *
 * The description sweep runs DESC_SWEEP_CONCURRENCY (8) wide whatever the
 * vendor, so one hop of SmartRecruiters rows opened eight posting reads at
 * once, back to back. fetchVendorDetail's SmartRecruiters branch now goes
 * through a cap (rate-cap.ts): at most 4 in flight and at most 5 started in
 * any one second, per isolate, in the order they asked. Both the cap and the
 * branch that uses it are run here on a virtual clock.
 */
import { describe, expect, it } from "vitest";
import { compile, constSource, fnSource } from "./helpers/lift-index";
import { rateCap } from "../../supabase/functions/job-board/rate-cap";

function virtualClock() {
  let now = 0;
  const timers: Array<{ at: number; r: () => void }> = [];
  const sleep = (ms: number) => new Promise<void>((r) => { timers.push({ at: now + ms, r }); });
  const run = async <T>(p: Promise<T>): Promise<T> => {
    let done = false;
    const out = p.finally(() => { done = true; });
    for (let i = 0; i < 100_000 && !done; i++) {
      await new Promise((r) => setImmediate(r));
      if (done) break;
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift();
      if (t) { now = Math.max(now, t.at); t.r(); }
    }
    return out;
  };
  return { now: () => now, sleep, run };
}

/** Starts and finishes on the virtual clock: the most in flight, and the most started inside any one second. */
function meter(clock: { now: () => number }) {
  const starts: number[] = [];
  let inFlight = 0, most = 0;
  return {
    starts,
    enter() { starts.push(clock.now()); most = Math.max(most, ++inFlight); },
    leave() { inFlight--; },
    get most() { return most; },
    get busiestSecond() { return Math.max(0, ...starts.map((t) => starts.filter((u) => u >= t && u < t + 1_000).length)); },
  };
}

describe("the cap (rate-cap.ts)", () => {
  it("twenty 300 ms calls: never more than 4 in flight, never more than 5 started in a second, every one answered in order", async () => {
    const c = virtualClock();
    const cap = rateCap({ concurrent: 4, perSecond: 5 }, c);
    const m = meter(c);
    const order: number[] = [];
    const all = Promise.all(Array.from({ length: 20 }, (_, i) => cap(async () => {
      m.enter(); order.push(i);
      await c.sleep(300);
      m.leave();
      return i;
    })));
    expect(await c.run(all)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(m.most).toBe(4);
    expect(m.busiestSecond).toBe(5);
    expect(order).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(c.now()).toBeGreaterThanOrEqual(3_000); // 20 starts at 5 a second need at least three seconds of waiting
  });

  it("a call that throws gives its slot back", async () => {
    const c = virtualClock();
    const cap = rateCap({ concurrent: 1, perSecond: 100 }, c);
    const a = cap(async () => { throw new Error("boom"); }).catch((e: Error) => e.message);
    const b = cap(async () => "next");
    expect(await c.run(Promise.all([a, b]))).toEqual(["boom", "next"]);
  });
});

describe("fetchVendorDetail's SmartRecruiters branch goes through it", () => {
  it("is declared at the top level as 4 at once and 5 a second", () => {
    expect(constSource("SR_DETAIL_CAP")).toMatch(/= rateCap\(\{ concurrent: 4, perSecond: 5 \}\);$/);
  });

  it("twelve posting reads asked at once start no more than 4 together and 5 in a second, and each reads its own text", async () => {
    const c = virtualClock();
    const m = meter(c);
    const urls: string[] = [];
    const lifted = compile(fnSource("fetchVendorDetail"), "return Promise.all(ids.map((x) => fetchVendorDetail({ source: 'smartrecruiters', token: 'acme', name: 'Acme' }, 'smartrecruiters:acme:' + x, x)));");
    const all = lifted({
      ids: Array.from({ length: 12 }, (_, i) => `p${i}`),
      SR_DETAIL_CAP: rateCap({ concurrent: 4, perSecond: 5 }, c),
      fetchWithTimeout: async (url: string) => {
        urls.push(url);
        m.enter();
        await c.sleep(400);
        m.leave();
        const id = url.split("/").pop();
        return new Response(JSON.stringify({ jobAd: { sections: { jobDescription: { text: `<p>about ${id}</p>` } } } }), { status: 200 });
      },
      htmlToText: (h: string) => h.replace(/<[^>]+>/g, ""),
      DESC_CAP: 5_000,
    }) as Promise<Array<{ text: string | null }>>;
    const out = await c.run(all);
    expect(out.map((r) => r.text)).toEqual(Array.from({ length: 12 }, (_, i) => `about p${i}`));
    expect(urls).toHaveLength(12);
    expect(m.most, "SmartRecruiters reads in flight at once").toBeLessThanOrEqual(4);
    expect(m.busiestSecond, "SmartRecruiters reads started inside one second").toBeLessThanOrEqual(5);
  });
});
