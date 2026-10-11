import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boardTailChecks } from "../../supabase/functions/scan-heartbeat/board-tail";
import { carriedCountsAt } from "../../supabase/functions/job-board/facet-carry";

/**
 * S11-001: for two days the board's pass-end tail died every pass, its served
 * counts aged past 35 hours and the filter audit went dark, and the heartbeat
 * read none of it. These are the live readings of 2026-10-11 ~10Z put through
 * the checks it now runs.
 */
const NOW = Date.parse("2026-10-11T10:00:00Z");
const HB = readFileSync(resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");

const byName = (v: ReturnType<typeof boardTailChecks>) => Object.fromEntries(v.map((c) => [c.name, c]));

describe("the heartbeat reads the pass-end tail's three ages", () => {
  it("the readings of 2026-10-11 fail all three", () => {
    const v = byName(boardTailChecks({
      now: NOW,
      refreshedAt: "2026-10-09T15:51:22.915Z",
      filterAuditAt: "2026-10-09T14:56:50.022Z",
      passEnd: { startedAt: "2026-10-11T09:20:00Z" },
    }));
    expect(v.job_board_refresh_head).toMatchObject({ skipped: false, passed: false });
    expect(v.job_board_filter_audit).toMatchObject({ skipped: false, passed: false });
    expect(v.job_board_pass_end, "a tail that started 40 min ago and never finished").toMatchObject({ skipped: false, passed: false });
  });

  it("a healthy board passes all three, and a tail still inside its grace is not a death", () => {
    const v = byName(boardTailChecks({
      now: NOW,
      refreshedAt: "2026-10-11T09:15:00Z",
      filterAuditAt: "2026-10-11T04:00:00Z",
      passEnd: { startedAt: "2026-10-11T09:50:00Z" },
    }));
    expect(Object.values(v).every((c) => c.skipped === false && c.passed)).toBe(true);
    const done = byName(boardTailChecks({ now: NOW, refreshedAt: "2026-10-11T09:15:00Z", filterAuditAt: "2026-10-11T04:00:00Z", passEnd: { startedAt: "2026-10-11T08:00:00Z", doneAt: "2026-10-11T08:02:30Z" } }));
    expect(done.job_board_pass_end).toMatchObject({ passed: true });
  });

  it("a doneAt from an earlier tail does not cover a later start", () => {
    const v = byName(boardTailChecks({ now: NOW, refreshedAt: null, filterAuditAt: null, passEnd: { startedAt: "2026-10-11T09:00:00Z", doneAt: "2026-10-11T08:10:00Z" } }));
    expect(v.job_board_pass_end).toMatchObject({ passed: false });
  });

  it("a missing row is skipped, never passed", () => {
    const v = byName(boardTailChecks({ now: NOW, refreshedAt: undefined, filterAuditAt: undefined, passEnd: null }));
    for (const n of ["job_board_refresh_head", "job_board_filter_audit", "job_board_pass_end"]) {
      expect(v[n], n).toMatchObject({ skipped: true });
    }
  });

  // Review of S11-001: a carried pass stamps refreshedAt with its own time, so
  // the 3 h bound on refreshedAt stayed green while counts of any age served.
  it("counts carried through a failed aggregate fail on the time they were counted", () => {
    const fresh = { now: NOW, refreshedAt: "2026-10-11T09:15:00Z", filterAuditAt: "2026-10-11T04:00:00Z", passEnd: null };
    expect(byName(boardTailChecks({ ...fresh, facetsCarriedAt: "2026-10-11T05:00:00Z" })).job_board_refresh_head)
      .toMatchObject({ skipped: false, passed: false });
    expect(byName(boardTailChecks({ ...fresh, facetsCarriedAt: "2026-10-11T08:30:00Z" })).job_board_refresh_head)
      .toMatchObject({ skipped: false, passed: true });
    expect(byName(boardTailChecks({ ...fresh, facetsCarriedAt: null })).job_board_refresh_head)
      .toMatchObject({ skipped: false, passed: true });
  });

  it("a carry keeps the time the counts were counted, across carries", () => {
    expect(carriedCountsAt({ refreshedAt: "2026-10-11T05:00:00Z" })).toBe("2026-10-11T05:00:00Z");
    expect(carriedCountsAt({ refreshedAt: "2026-10-11T06:00:00Z", facetsCarried: true, facetsCarriedAt: "2026-10-11T05:00:00Z" })).toBe("2026-10-11T05:00:00Z");
    expect(carriedCountsAt({ refreshedAt: "2026-10-11T06:00:00Z", facetsCarried: true })).toBe("2026-10-11T06:00:00Z");
    expect(carriedCountsAt(null)).toBe(null);
  });

  it("job-board writes the counted time on both rows, and the heartbeat reads it", () => {
    const BOARD = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    expect(BOARD).toMatch(/facetsCarried = true;\s*facetsCountedAt = carriedCountsAt\(pv\);/);
    expect(BOARD).toMatch(/\.\.\.\(facetsCarried \? \{ facetsCarried: true, facetsCarriedAt: facetsCountedAt \?\? startIso \} : \{\}\),\s*refreshedAt: startIso,/);
    expect(BOARD).toMatch(/\.\.\.\(facetsCarried \? \{ facetsCarried: true, facetsCarriedAt: facetsCountedAt \?\? v\.refreshedAt \} : \{\}\),/);
    expect(HB).toMatch(/select\('refreshedAt:v->>refreshedAt,facetsCarriedAt:v->>facetsCarriedAt'\)\.eq\('k', 'refresh_head'\)/);
    expect(HB).toMatch(/facetsCarriedAt: rh\.error \? null : \(rh\.data as \{ facetsCarriedAt\?: string \| null \} \| null\)\?\.facetsCarriedAt,/);
  });

  it("scan-heartbeat runs the checks and degrades on a failure", () => {
    expect(HB).toMatch(/import \{ boardTailChecks, dbFailureCheck \} from "\.\/board-tail\.ts";/);
    // S11-023's check rides the same block, from board_failures.v.dbStreaks.
    expect(HB).toMatch(/select\('dbStreaks:v->dbStreaks'\)\.eq\('k', 'board_failures'\)/);
    expect(HB).toMatch(/const v = dbFailureCheck\(/);
    const at = HB.indexOf("boardTailChecks({");
    expect(at).toBeGreaterThan(0);
    const block = HB.slice(at, at + 1400);
    expect(block).toMatch(/if \(v\.skipped\) \{ skip\(v\.name/);
    expect(block).toMatch(/checks\.push\(\{ name: v\.name, passed: v\.passed/);
    expect(block).toMatch(/if \(overallStatus === 'healthy'\) overallStatus = 'degraded';/);
  });
});
