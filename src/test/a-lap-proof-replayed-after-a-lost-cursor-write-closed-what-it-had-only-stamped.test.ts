// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

/**
 * A LAP PROOF REPLAYED AFTER A LOST CURSOR WRITE CLOSED WHAT IT HAD ONLY STAMPED.
 *
 * Sweep S8-031 (2026-10-08). The rule (n104): on a windowed board the first
 * proven wrap STAMPS a row the whole lap never served, and the second proven
 * wrap CLOSES it, so a posting must be missed by two laps to be logged as a
 * takedown. But the lap-proving visit drops its cursor in memory, and the
 * deep_cursor row is written once at the end of the slice; a failed write, a
 * dead hop or an overlapping isolate's stale map leaves the cursor where it
 * was, the next visit proves the SAME lap again, and the vanish rule compared
 * only the stamp's age against the grace. Every row the first proof only
 * stamped was then closed on one lap's evidence.
 *
 * This runs the SHIPPED vanish loop (the span of the refresh worker from
 * `vanished = [];` to the unstamp list, lifted from index.ts and transpiled)
 * over one board's stored rows.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const span = (() => {
  const a = FN.indexOf("          vanished = [];\n");
  const b = FN.indexOf("          toUnstamp = [...liveIds]", a);
  expect(a, "the vanish loop moved; re-point this test").toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return FN.slice(a, b);
})();
const NAMES = ["vanishedAll", "agedOutIds", "partialRead", "lapMode", "existingById", "lapMark", "missingSinceById", "nowMs", "needMs", "toStamp", "lapOpenMs"];
const run = new Function(...NAMES, `${transformSync(`let vanished; ${span}; return vanished;`, { loader: "ts" }).code}`) as (...a: unknown[]) => string[];

const H = 3_600_000;
const GRACE = 5 * 60_000;
type Row = { id: string; lap_epoch: number; missing_since: string | null };
function visit(o: { rows: Row[]; now: number; lapOpen: number; lapMark: number; lapMode: boolean }) {
  const toStamp: string[] = [];
  const vanished = run(
    o.rows.map((r) => r.id),
    new Set<string>(),
    true,
    o.lapMode,
    new Map(o.rows.map((r) => [r.id, r])),
    o.lapMark,
    new Map(o.rows.filter((r) => r.missing_since).map((r) => [r.id, r.missing_since!])),
    o.now,
    GRACE,
    toStamp,
    o.lapOpen,
  );
  return { closed: vanished, stamped: toStamp };
}

describe("a lap proof closes only what an EARLIER lap already found missing", () => {
  const lapOpen = Date.parse("2026-10-08T00:00:00Z");
  const firstProof = lapOpen + 20 * H;

  it("the first proof of lap e stamps the rows lap e never served, and closes none of them", () => {
    const rows: Row[] = [{ id: "a", lap_epoch: 6, missing_since: null }, { id: "b", lap_epoch: 6, missing_since: null }];
    const v = visit({ rows, now: firstProof, lapOpen, lapMark: 7, lapMode: true });
    expect(v.closed).toEqual([]);
    expect(v.stamped).toEqual(["a", "b"]);
  });

  it("the same lap proved again an hour later (the cursor write was lost) closes nothing it stamped", () => {
    const stampedAt = new Date(firstProof).toISOString();
    const rows: Row[] = [{ id: "a", lap_epoch: 6, missing_since: stampedAt }, { id: "b", lap_epoch: 6, missing_since: stampedAt }];
    const v = visit({ rows, now: firstProof + H, lapOpen, lapMark: 7, lapMode: true });
    expect(v.closed, "one lap's evidence was logged as employer takedowns").toEqual([]);
    expect(v.stamped).toEqual([]);
  });

  it("the NEXT lap's proof closes them: two laps missed them", () => {
    const stampedAt = new Date(firstProof).toISOString();
    const nextOpen = firstProof + 2 * H;
    const rows: Row[] = [{ id: "a", lap_epoch: 6, missing_since: stampedAt }];
    expect(visit({ rows, now: nextOpen + 20 * H, lapOpen: nextOpen, lapMark: 8, lapMode: true }).closed).toEqual(["a"]);
  });

  it("a row the current lap served is never closed, whatever its stamp", () => {
    const rows: Row[] = [{ id: "a", lap_epoch: 7, missing_since: new Date(lapOpen - 50 * H).toISOString() }];
    expect(visit({ rows, now: firstProof, lapOpen, lapMark: 7, lapMode: true }).closed).toEqual([]);
  });

  it("a windowed visit that proves nothing closes nothing", () => {
    const rows: Row[] = [{ id: "a", lap_epoch: 6, missing_since: new Date(lapOpen - 50 * H).toISOString() }];
    expect(visit({ rows, now: firstProof, lapOpen, lapMark: 7, lapMode: false })).toEqual({ closed: [], stamped: [] });
  });
});
