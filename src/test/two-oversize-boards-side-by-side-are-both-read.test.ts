// @vitest-environment node
/**
 * TWO OVERSIZE BOARDS SIDE BY SIDE ARE BOTH READ (board .102 review, CAP-8).
 *
 * CAP-8 allows one streamed read a slice. The catalogue keeps an employer's
 * boards together, so oversize Recruitee boards sit next to each other
 * (transperfect, duravermeer, aaff and tether at 11913-11917; sterkinmatches
 * and vdkgroep at 24134-24135), and a cold slice starts 15-58 boards: both
 * neighbours fall in one slice every lap. The first took the stream; the
 * second was refused, registered, and the cursor moved past it, so it was
 * never read.
 *
 * Now a board refused only for want of the slice's stream (or its clock or
 * heap) is registered waiting, and the next cold slice starts with the board
 * that has waited longest, wherever the cursor is. Run here through the
 * shipped worker span (runVisit) and the shipped wait lane (runWaitLane).
 */
import { describe, expect, it } from "vitest";
import { SLIM_SPECS } from "../../supabase/functions/job-board/slim-stream";
import type { OversizeEntry } from "../../supabase/functions/job-board/oversize-registry";
import { runVisit, runWaitLane } from "./helpers/slice-worker";

const rec = (token: string) => ({ source: "recruitee", token, name: token });
const read = (n: number) => () => ({ jobs: Array.from({ length: n }, (_, i) => ({ id: String(i) })), raw: { offers: [] } });
const STER = rec("sterkinmatches"), VDK = rec("vdkgroep"), NEXT = rec("next-board");

describe("two adjacent oversize boards in one cold slice", () => {
  it("are both read within two slices: the second waits, and the next cold slice streams it first", async () => {
    const registry = new Map<string, OversizeEntry>();
    // Slice 1: both neighbours are base boards; the first oversize one takes the stream.
    const first = await runVisit({ board: STER, failReason: "oversize 6.1MB", slimSpecs: SLIM_SPECS, stream: read(40), registry });
    expect(first.streamCalls.length).toBe(1);
    expect(first.r?.jobs.length).toBe(40);
    const second = await runVisit({ board: VDK, failReason: "oversize 5.2MB", slimSpecs: SLIM_SPECS, stream: read(30), streamedBefore: first.streamed, registry });
    expect(second.streamCalls, "one stream a slice").toEqual([]);
    expect(second.r).toBeNull();
    expect(registry.get("vdkgroep"), "refused only for the stream: it waits").toMatchObject({ source: "recruitee", wait: true });
    // Slice 2: the cursor has moved past both; the wait lane puts vdkgroep first.
    const lane = runWaitLane({ inHotPhase: false, registry, catalogue: [STER, VDK, NEXT], lanes: { demand: [], bootstrap: [], retry: [], stale: [], deep: [], base: [NEXT] } });
    expect(lane.waitKey).toBe("vdkgroep");
    expect(lane.slice.map((b) => b.token), "first in the slice, ahead of every lane").toEqual(["vdkgroep", "next-board"]);
    const again = await runVisit({ board: VDK, failReason: "oversize 5.2MB", slimSpecs: SLIM_SPECS, stream: read(30), streamedBefore: 0, registry });
    expect(again.streamCalls.length).toBe(1);
    expect(again.r?.jobs.length, "read on the second slice").toBe(30);
  });

  it("the hot phase adds no waiting board (its slice is the hot list), and a board a lane already carries is not added twice", () => {
    const registry = new Map<string, OversizeEntry>([["vdkgroep", { source: "recruitee", mb: 5.2, at: "2026-11-16T00:00:00.000Z", wait: true }]]);
    const lanes = { demand: [], bootstrap: [], retry: [], stale: [], deep: [], base: [NEXT] };
    expect(runWaitLane({ inHotPhase: true, registry, catalogue: [VDK, NEXT], lanes }).slice.map((b) => b.token)).toEqual(["next-board"]);
    const carried = runWaitLane({ inHotPhase: false, registry, catalogue: [VDK, NEXT], lanes: { ...lanes, base: [VDK, NEXT] } });
    expect(carried.slice.map((b) => b.token)).toEqual(["vdkgroep", "next-board"]);
    // A registry key the catalogue no longer carries adds nothing.
    expect(runWaitLane({ inHotPhase: false, registry, catalogue: [NEXT], lanes }).slice.map((b) => b.token)).toEqual(["next-board"]);
  });

  it("a board the stream itself refused (a bound it trips) does not wait: it is registered plainly and the lane passes it by", async () => {
    const registry = new Map<string, OversizeEntry>();
    const x = await runVisit({ board: VDK, failReason: "oversize 5.2MB", slimSpecs: SLIM_SPECS, stream: () => null, registry });
    expect(x.streamCalls.length).toBe(1);
    expect(registry.get("vdkgroep")?.wait).toBeUndefined();
    expect(runWaitLane({ inHotPhase: false, registry, catalogue: [VDK, NEXT], lanes: { demand: [], bootstrap: [], retry: [], stale: [], deep: [], base: [NEXT] } }).waitKey).toBeNull();
  });

  it("a hot-phase visit streams its one board: a hot-tier board has no other read", async () => {
    const bjak = { source: "ashby", token: "bjakcareer", name: "BJAK" };
    const x = await runVisit({ board: bjak, failReason: "oversize 34.2MB", slimSpecs: SLIM_SPECS, stream: read(3009), hot: true });
    expect(x.streamCalls.length).toBe(1);
    expect(x.r?.jobs.length).toBe(3009);
    expect(x.registry.size, "read: nothing registered").toBe(0);
  });
});
