// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { advanceProgress, type RefreshProgress } from "../../supabase/functions/job-board/rotation.ts";

/**
 * A COLD CURSOR THAT STEPS BACK IS ITS OWN CORRECTION (follow-up (c), n434).
 *
 * Polled on .89 2026-10-06: cold 137 at 19:32:30, 104 at 19:33:32, then still
 * until 19:39:40; 285 at 19:41:48, 212 at 19:42:49. Every cold slice writes
 * the cursor twice: at admission by the whole base slice (80), and, if it
 * survives, corrected to the base boards it started. A poll between the two
 * reads a step back of base - started; no board is skipped or repeated. The
 * slice now records both values (slice_stats.cursorStep) so the next poll can
 * tell this correction from a real regression. The recording block is cut
 * from index.ts and run against the shipped advanceProgress.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const block = (() => {
  const at = RAW.indexOf("  if (!inHotPhase) {\n    const len = Math.max(1, COLD_LIST.length);\n    sliceCursorNote = ");
  expect(at, "the cursorStep block has moved").toBeGreaterThan(-1);
  return RAW.slice(at, RAW.indexOf("\n  }\n", at) + 4);
})();
type Note = { from: number; admitted: number; to: number; base: number; started: number } | null;
function record(prev: RefreshProgress, base: number, started: number, coldLen: number, inHotPhase = false): { note: Note; admitted: number; after: number } {
  const args = { inHotPhase, hotSlice: 10, baseSliceLen: base, coldListLen: coldLen };
  const admitted = advanceProgress({ prev, ...args }).next.cold;
  const progressAfter = advanceProgress({ prev, ...args, baseSliceLen: started }).next;
  const js = transformSync(`let sliceCursorNote = null;\n${block}\nreturn sliceCursorNote;`, { loader: "ts" }).code;
  const note = new Function("inHotPhase", "COLD_LIST", "progressBefore", "baseSlice", "progressAfter", "baseAttempted", js)(
    inHotPhase, { length: coldLen }, prev, { length: base }, progressAfter, started,
  ) as Note;
  return { note, admitted, after: progressAfter.cold };
}

describe("the cursor's two writes, recorded", () => {
  const prev = (cold: number): RefreshProgress => ({ hot: 120, cold, coldDone: 146, failedAcc: [], failedTotal: 0 });

  it("57 -> admitted 137 -> written back 104: the measured step back is 80 base minus 47 started", () => {
    const r = record(prev(57), 80, 47, 44399);
    expect(r.admitted).toBe(137);
    expect(r.after).toBe(104);
    expect(r.note).toEqual({ from: 57, admitted: 137, to: 104, base: 80, started: 47 });
  });

  it("the next slice starts at the corrected cursor, so nothing between is skipped", () => {
    const r = record(prev(205), 80, 7, 44399);
    expect(r.note).toEqual({ from: 205, admitted: 285, to: 212, base: 80, started: 7 });
    expect(record(prev(r.after), 80, 80, 44399).note?.from).toBe(212);
  });

  it("a hot slice records nothing (the cursor does not move)", () => {
    expect(record(prev(57), 80, 47, 44399, true).note).toBeNull();
  });
});
