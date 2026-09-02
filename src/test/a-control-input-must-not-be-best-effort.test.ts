import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A THROTTLE THAT COULD NOT BE LIFTED, BECAUSE THE EVIDENCE FOR LIFTING IT
 * WAS WRITTEN ON A PATH THE RUNTIME MAY DISCARD.
 *
 * `slice_stats` looks like instrumentation and is not. `shedSignal` reads it,
 * and a row untouched for 30 minutes returns `stale`, which floors the whole
 * fleet at shed level 1 — cold slice 80 -> 48, concurrency 8 -> 5, deep lane
 * 8 -> 4, bootstrap 25 -> 10, hot slice 10 -> 5. Yet the only writer sat
 * inside waitUntil, i.e. explicitly after the response, where the isolate can
 * be reclaimed before the write lands.
 *
 * MEASURED LIVE 2026-09-02 on .24: the row sat at 11:47:35Z for over two hours
 * while the fleet ran at L1 the entire time. `drained: 10` and a cold cursor
 * advancing by exactly 48 are that level's fingerprints, and freshness p50 was
 * 1312 min against a 480 bound. Every write that landed in that window was an
 * early awaited one — the optimistic cursor, the bootstrap drain. The one
 * deferred write did not land, so the throttle could never lift itself.
 *
 * The lever was not the constraint, which is the trap this pins. At L1
 * `effBootstrapPerSlice` is a hardcoded 10 rather than a fraction of
 * BOOTSTRAP_PER_SLICE, so raising that constant moves nothing while L1 holds —
 * and because the bootstrap drain is optimistic, a faster drain under dying
 * slices burns boards out of the queue without filling them.
 *
 * WHAT MUST NOT BE "FIXED" BACK. A slice that dies before its terminal return
 * still records nothing, so a genuinely dying rotation still goes stale and
 * still sheds. That survivor-bias protection is correct and is asserted below
 * so a later cleanup cannot quietly trade it away for freshness.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
const BODY = (() => {
  const i = FN.indexOf("async function recordSliceStats");
  const j = FN.indexOf("\nasync function runRefresh", i);
  return i >= 0 && j > i ? FN.slice(i, j) : "";
})();

describe("a control input must not be best-effort", () => {
  it("writes the shed signal on the awaited path, never deferred", () => {
    expect(BODY, "recordSliceStats could not be located").not.toBe("");
    expect(
      BODY,
      "slice_stats is read by shedSignal — deferring it lets the fleet throttle " +
        "itself on evidence the runtime is free to discard",
    ).not.toMatch(/waitUntil/);
  });

  it("every terminal slice return awaits it", () => {
    // The three returns already had to record; what is new is that they wait
    // for the record to land before the hop ends.
    const awaited = FN.match(/await recordSliceStats\(client, sliceWallStart, inHotPhase\);/g) ?? [];
    expect(awaited.length, "a terminal return that does not await can still lose the write").toBe(3);
    // And nothing may call it without awaiting.
    const bare = FN.match(/(?<!await )recordSliceStats\(client, sliceWallStart, inHotPhase\);/g) ?? [];
    expect(bare.length, "an un-awaited call reintroduces exactly the dropped write").toBe(0);
  });

  it("is bounded, so the rotation can never wedge on its own bookkeeping", () => {
    expect(BODY).toMatch(/Promise\.race\(\[write, new Promise<void>\(\(res\) => setTimeout\(res, SLICE_STATS_WRITE_MS\)\)\]\)/);
    expect(FN).toMatch(/const SLICE_STATS_WRITE_MS = 5_000;/);
    // The write settles rather than rejecting: the timeout may win the race,
    // and a rejection arriving afterwards would be unhandled in a hop that has
    // already returned.
    expect(BODY).toMatch(/\}\)\(\)\.catch\(\(\) => \{/);
  });

  it("still lets a DYING rotation shed — the survivor-bias branch is untouched", () => {
    // If this ever goes green while the two above are red, someone has traded
    // the distress signal for a freshness number.
    expect(FN).toMatch(/if \(rowAge > 30 \* 60_000\) return \{ kind: "stale" as const \};/);
    expect(FN).toMatch(/: shedSignal\.kind === "stale" \? 1/);
  });
});

/**
 * THE SPLIT: LIVENESS IS STAMPED WHERE THE WORK ENDS, TIMING WHERE THE SLICE DOES.
 *
 * One row was answering two questions — "is the rotation alive" (row age) and
 * "what does a slice cost" (the EMA) — and only the terminal writer touched it.
 * A slice that fetched every board and then died in the tail answered no to
 * both, so the shedder cut FETCH capacity to treat a TAIL failure. Measured
 * across 37 min: 12 slices started, 0 recorded, while a 41.2h cold cycle and a
 * 22.6h median proved the fetching itself was landing.
 */
const WORK = (() => {
  const i = FN.indexOf("async function stampSliceWork");
  const j = FN.indexOf("\n/**", i + 10);
  return i >= 0 && j > i ? FN.slice(i, j) : "";
})();

describe("the fetch phase stamps its own pulse", () => {
  it("exists, is awaited, and is not deferred", () => {
    expect(WORK, "stampSliceWork could not be located").not.toBe("");
    expect(WORK, "the pulse must not ride a path the runtime may drop").not.toMatch(/waitUntil/);
    const calls = FN.match(/await stampSliceWork\(client, inHotPhase, sliceWallStart\);/g) ?? [];
    expect(calls.length, "exactly one pulse per slice, at the end of the fetch loop").toBe(1);
  });

  it("stamps BEFORE the tail — the cursor write, the facets and the maintenance kicks", () => {
    // The whole point. Anything that moves this below the tail work
    // reintroduces the defect, because everything between here and the
    // terminal return is what the slice was dying in.
    const pulse = FN.indexOf("await stampSliceWork(client, inHotPhase, sliceWallStart);");
    const cursor = FN.indexOf("const { next: progressAfter, wrapped } = advanceProgress({");
    const terminal = FN.indexOf("await recordSliceStats(client, sliceWallStart, inHotPhase);");
    expect(pulse, "pulse not found").toBeGreaterThan(0);
    expect(pulse, "the pulse must precede the cursor advance").toBeLessThan(cursor);
    expect(pulse, "the pulse must precede every terminal record").toBeLessThan(terminal);
  });

  it("never writes the whole-slice EMAs, which measure a different span", () => {
    // Fetch time is a strict subset of slice time, and the L1/L2 thresholds
    // were calibrated against the whole slice. Writing fetch cost into those
    // keys would silently recalibrate the shedder — the "never copy a cap
    // without matching what it counts" rule, one field over.
    expect(WORK).not.toMatch(/"hotEmaMs"|"coldEmaMs"/);
    expect(WORK, "fetch cost is collected under its own key").toMatch(/workHotEmaMs|workColdEmaMs/);
  });

  it("makes the tail-death rate observable", () => {
    // `works` counts fetch phases, `slices` counts whole slices. The gap was
    // previously unobservable, and it is the number actually worth alarming on.
    expect(WORK).toMatch(/works: \(Number\(pv\.works\) \|\| 0\) \+ 1,/);
    expect(FN).toMatch(/slices: \(Number\(pv\.slices\) \|\| 0\) \+ 1,/);
  });

  it("is bounded by the same budget as the terminal write", () => {
    expect(WORK).toMatch(/Promise\.race\(\[write, new Promise<void>\(\(res\) => setTimeout\(res, SLICE_STATS_WRITE_MS\)\)\]\)/);
  });
});
