import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * FIVE REVIEW FINDINGS ON .33/.34, EACH CONFIRMED BY THREE REFUTERS.
 * 2026-09-03, local adversarial review of the day's commits.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("a deferred board is not a failed one", () => {
  it("budget-deferred tokens are excluded from failure accounting", () => {
    expect(CODE).toMatch(/const budgetSkippedSet = new Set\(budgetSkipped\);/);
    expect(CODE).toMatch(/\.filter\(\(tk\) => !skipTokens\.has\(tk\) && !quarantineSkipped\.has\(tk\) && !budgetSkippedSet\.has\(tk\) && !okSet\.has\(tk\)\);/);
  });

  it("betterDate keys the Workday rule on the ROW's vendor, never the hop's slot", () => {
    expect(CODE).toMatch(/const betterDate = postedAt && \(row\.source === "workday" \|\| !row\.posted_at\) \? postedAt : null;/);
    expect(CODE).not.toMatch(/\(vendor === "workday" \|\| !row\.posted_at\)/);
  });

  it("a board whose visit can return the cap reserves the cap, even in a cold slice", () => {
    expect(CODE).toMatch(/const CAPPED_VISIT_VENDORS = new Set\(\["workday", "oracle", "icims", "smartrecruiters", "rippling"\]\);/);
    expect(CODE).toMatch(/const reserve = inHotPhase \|\| deepTokens\.has\(s\.token\) \|\| CAPPED_VISIT_VENDORS\.has\(s\.source\) \|\| !!s\.pages \? MAX_POSTINGS_PER_VISIT : COLD_BOARD_RESERVE;/);
    // every fetcher that carries a resume offset is in the set
    for (const v of ["workday", "oracle", "icims", "smartrecruiters", "rippling"]) expect(CODE).toContain(`"${v}"`);
  });

  it("the desc sweep walks a first_seen cursor and hands it to the next hop", () => {
    expect(CODE).toMatch(/const descCursor = typeof body\.cursor === "string" && body\.cursor \? body\.cursor : null;/);
    expect(CODE).toMatch(/if \(descCursor\) sel = sel\.lt\("first_seen", descCursor\);/);
    expect(CODE).toMatch(/posted_at, work_mode, first_seen"\)/);
    expect(CODE).toMatch(/const exhausted = queue\.length < DESC_SWEEP_PER_HOP;\s*const nextCursor = exhausted \? null : \(queue\[queue\.length - 1\]\?\.first_seen \?\? null\);/);
    expect(CODE, "the no-op escape hatch is gone").not.toMatch(/queue\.length < DESC_SWEEP_PER_HOP \|\| updated === 0/);
    expect(CODE).toMatch(/action: "desc-sweep", chainKey: key, vi, vstart, \.\.\.\(nextCursor \? \{ cursor: nextCursor \} : \{\}\)/);
    expect(CODE).toMatch(/v: \{ runningVi: vi, vendor, cursor: descCursor \}/);
  });

  it("pages served on purpose say ranked: true", () => {
    expect(CODE).toMatch(/locationSplit: \{ q: won\.head, location: won\.place \},\s*ranked: true,/);
    expect(CODE).toMatch(/exactWordMatch: qText,\s*ranked: true,/);
  });
});
