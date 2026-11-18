import { describe, expect, it } from "vitest";
import { compile, eqOf, fnSource, op, stubClient, type Call } from "./helpers/lift-index";

/**
 * BOARD .103 REVIEW (correctness lens): SUP-a COULD START A SECOND CHAIN.
 *
 * A child kicks its own next hop before it records its stats and answers its
 * parent. A child the platform killed (546) in that gap leaves a grandchild
 * that was admitted and is mid-slice: its admission stamp stands for its whole
 * slice (about 25 s), so the parent's re-kick, CAS'd on that stamp, was
 * admitted beside it. Every later hop is a force kick and every pass end now
 * kicks hop 0 (W4-2), so both chains ran on, each rolling back the cursor the
 * other wrote. refresh_progress now names the hop that wrote it (admission and
 * slice end), and the re-kick goes out only while that is the parent (the
 * child was never admitted) or the child (admitted, then killed).
 *
 * The pass end's own hop-0 kick, re-kicked after a death at boot, now names
 * the pass end too, and only the first hop 0 admitted for a pass end stamps
 * pass_chain.hop0At, so P1 reads the recovered chain, not "no hop0At".
 *
 * Everything below RUNS the shipped code, lifted from job-board/index.ts.
 */
const U_PARENT = "2026-11-18T06:00:00.123+00:00";
const U_GRANDCHILD = "2026-11-18T06:00:21.456+00:00";

function world(reads: Array<{ updated_at: string; hop: number | undefined }>) {
  let clock = Date.parse("2026-11-18T06:00:22Z");
  class FakeDate extends Date {
    constructor(...a: unknown[]) { super(...((a.length ? a : [clock]) as [number])); }
    static now() { return clock; }
  }
  const bodies: Array<Record<string, unknown>> = [];
  const stamps: Array<Record<string, unknown>> = [];
  const background: Promise<unknown>[] = [];
  const answers: Array<{ status: number }> = [{ status: 546 }];
  const last = reads[reads.length - 1];
  const client = stubClient((c: Call) => {
    const ups = op(c, "upsert");
    if (ups) { stamps.push((ups[1][0] as { v: Record<string, unknown> }).v); return { error: null }; }
    if (op(c, "select") && eqOf(c, "k") === "refresh_progress") {
      const r = reads.shift() ?? last;
      return { data: { v: { hot: 0, ...(r.hop === undefined ? {} : { hop: r.hop }) }, updated_at: r.updated_at }, error: null };
    }
    return { data: null, error: null };
  });
  const deps: Record<string, unknown> = {
    Deno: { env: { get: () => "https://example.test" } },
    waitUntil: (p: Promise<unknown>) => { background.push(p); },
    isIngestPaused: async () => false,
    chainKey: async () => "k",
    boundBody: (r: Response) => r,
    SELF_RESPONSE_BYTES: 400_000,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Date: FakeDate,
    setTimeout: (cb: () => void, ms: number) => { clock += ms; cb(); return 0; },
    fetch: async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      clock += 1_000;
      const a = answers.shift() ?? { status: 200 };
      return new Response('{"ok":true,"detail":"slice done"}', { status: a.status });
    },
    REKICKS_PER_HOP: 2,
    REKICK_AGE_MS: 120_000,
    ISOLATE_BORN: clock - 30_000,
  };
  const run = async (hop: number, cas?: { after: string; passEnd?: string }) => {
    const chainNextSlice = await compile(fnSource("chainNextSlice"), "return chainNextSlice;")(deps) as (...a: unknown[]) => void;
    chainNextSlice(hop, client, 80, cas);
    await Promise.all(background);
  };
  return { run, bodies, stamps };
}

describe("SUP-a re-kicks only the hop that died", () => {
  it("declines when the stamp is a grandchild's: the dead child had already handed the chain on", async () => {
    // Hop 12 kicked 13; 13 kicked 14, 14 was admitted, then 13 was killed before it answered.
    const w = world([{ updated_at: U_GRANDCHILD, hop: 14 }, { updated_at: U_GRANDCHILD, hop: 14 }]);
    await w.run(12);
    expect(w.bodies, "SUP-a started a second chain beside the live grandchild").toHaveLength(1);
    expect(w.stamps.at(-1)).toMatchObject({ outcome: "declined", rekicked: 1 });
    expect(String(w.stamps.at(-1)?.detail)).toContain("hop 14");
  });

  it("re-kicks when the stamp is the parent's own (the child was never admitted)", async () => {
    const w = world([{ updated_at: U_PARENT, hop: 12 }, { updated_at: U_PARENT, hop: 12 }]);
    await w.run(12);
    expect(w.bodies).toHaveLength(2);
    expect(w.bodies[1]).toMatchObject({ after: U_PARENT, chain: 13 });
  });

  it("re-kicks when the stamp is the child's (admitted, then killed before it kicked on)", async () => {
    const w = world([{ updated_at: U_GRANDCHILD, hop: 13 }, { updated_at: U_GRANDCHILD, hop: 13 }]);
    await w.run(12);
    expect(w.bodies).toHaveLength(2);
    expect(w.bodies[1]).toMatchObject({ after: U_GRANDCHILD, chain: 13 });
  });

  it("declines a stamp that names no hop (a writer that does not say who it is is never assumed dead)", async () => {
    const w = world([{ updated_at: U_PARENT, hop: undefined }]);
    await w.run(12);
    expect(w.bodies).toHaveLength(1);
    expect(w.stamps.at(-1)).toMatchObject({ outcome: "declined" });
  });

  it("every refresh_progress writer names its hop: the admission and the slice end", () => {
    const rr = fnSource("runRefresh");
    const named = rr.indexOf("next.hop = chainHop;");
    expect(named, "the admitted stamp must name its hop").toBeGreaterThan(0);
    expect(rr.indexOf("await admitSlice(client, next, {"), "the hop is named before the admission writes the stamp").toBeGreaterThan(named);
    expect(rr).toContain('{ k: "refresh_progress", v: { ...progressAfter, hop: chainHop }, updated_at: progAt }');
  });
});

describe("the pass end's hop 0, re-kicked after a death at boot", () => {
  it("names the pass end on the re-kick too, so the recovered hop 0 can stamp hop0At", async () => {
    const P = "2026-11-18T08:00:00.000+00:00";
    const w = world([{ updated_at: P, hop: 171 }, { updated_at: P, hop: 171 }]);
    await w.run(171, { after: P, passEnd: "2026-11-18T08:00:00.500Z" });
    expect(w.bodies).toHaveLength(2);
    expect(w.bodies[0]).toMatchObject({ after: P, chain: 0, passEnd: "2026-11-18T08:00:00.500Z" });
    expect(w.bodies[1]).toMatchObject({ after: P, chain: 0, passEnd: "2026-11-18T08:00:00.500Z" });
  });

  it("only the first hop 0 admitted for a pass end stamps pass_chain; a re-kicked one keeps that stamp", async () => {
    const rr = fnSource("runRefresh");
    const a = rr.indexOf("  if (passEndAt) await (async () => {");
    expect(a, "the pass_chain write moved; re-point this test").toBeGreaterThan(-1);
    const block = rr.slice(a, rr.indexOf("})().catch(() => {});", a) + "})().catch(() => {});".length);
    const runBlock = async (stored: unknown) => {
      const writes: unknown[] = [];
      const client = stubClient((c: Call) => {
        const ups = op(c, "upsert");
        if (ups) { writes.push((ups[1][0] as { v: unknown }).v); return { error: null }; }
        if (op(c, "select") && eqOf(c, "k") === "pass_chain") return { data: stored === null ? null : { v: stored }, error: null };
        return { data: null, error: null };
      });
      await compile(block, "return null;")({ client, passEndAt: "2026-11-18T08:00:00.500Z", Date });
      return writes;
    };
    expect(await runBlock(null), "the first hop 0 of a pass end stamps it").toHaveLength(1);
    expect(await runBlock({ startedAt: "2026-11-18T06:00:00.000Z", hop0At: "x" }), "a new pass end replaces the last one's stamp").toHaveLength(1);
    expect(await runBlock({ startedAt: "2026-11-18T08:00:00.500Z", hop0At: "2026-11-18T08:00:02.000Z" }), "the re-kicked hop 0 keeps the first stamp").toEqual([]);
  });
});
