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
