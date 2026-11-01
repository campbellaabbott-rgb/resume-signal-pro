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
    // Since .89 the failure set is built per BOARD (a shared token's twins are
    // tracked apart); the deferral sets stay token-keyed.
    expect(CODE).toMatch(/\.filter\(\(s\) => !skipTokens\.has\(boardKeyOf\(s\)\) && !quarantineSkipped\.has\(s\.token\) && !budgetSkippedSet\.has\(s\.token\) && !okKeySet\.has\(boardKeyOf\(s\)\)\)/);
  });

  it("betterDate keys the Workday rule on the ROW's vendor, never the hop's slot", () => {
    expect(CODE).toMatch(/const betterDate = postedAt && \(row\.source === "workday" \|\| !row\.posted_at\) \? postedAt : null;/);
    expect(CODE).not.toMatch(/\(vendor === "workday" \|\| !row\.posted_at\)/);
  });

  it("a board whose visit can return the cap reserves the cap, even in a cold slice", () => {
    expect(CODE).toMatch(/const CAPPED_VISIT_VENDORS = new Set\(\["workday", "oracle", "icims", "smartrecruiters", "rippling", "usajobs", "teamtailor"\]\);/);
    expect(CODE).toMatch(/const reserve = inHotPhase \|\| deepTokens\.has\(s\.token\) \|\| CAPPED_VISIT_VENDORS\.has\(s\.source\) \|\| !!s\.pages \? MAX_POSTINGS_PER_VISIT : COLD_BOARD_RESERVE;/);
    // every fetcher that carries a resume offset is in the set
    for (const v of ["workday", "oracle", "icims", "smartrecruiters", "rippling", "teamtailor"]) expect(CODE).toContain(`"${v}"`);
  });

  it("the desc sweep walks a first_seen cursor and hands it to the next hop", () => {
    expect(CODE).toMatch(/const descCursor = typeof body\.cursor === "string" && body\.cursor \? body\.cursor : null;/);
    // A (first_seen, id) keyset since .100 (S13-113): lte is the index bound, the OR breaks a tie by id.
    expect(CODE).toMatch(/if \(curFs\) sel = sel\.lte\("first_seen", curFs\);/);
    expect(CODE).toMatch(/sel = sel\.or\(`first_seen\.lt\."\$\{curFs\}",id\.lt\."/);
    // The property is that the CURSOR COLUMN is selected — a walk cannot hand
    // on a watermark it never read. It used to be pinned as the END of the
    // column list, which made it fail when a later column was added for an
    // unrelated reason (the row's own stored pay, for the vendor-pay fill-only
    // rule). Pinning a list's last element guards its length, not its contents.
    expect(CODE).toMatch(/posted_at, work_mode, first_seen/);
    expect(CODE).toMatch(/const exhausted = queue\.length < DESC_SWEEP_PER_HOP;\s*const tail = queue\[queue\.length - 1\];\s*const nextCursor = exhausted \|\| !tail\?\.first_seen \? null : `\$\{tail\.first_seen\}\|\$\{tail\.id\}`;/);
    expect(CODE, "the no-op escape hatch is gone").not.toMatch(/queue\.length < DESC_SWEEP_PER_HOP \|\| updated === 0/);
    expect(CODE).toMatch(/action: "desc-sweep", chainKey: key, vi, vstart, \.\.\.\(nextCursor \? \{ cursor: nextCursor \} : \{\}\)/);
    expect(CODE).toMatch(/v: \{ runningVi: vi, vendor, cursor: descCursor[,} ]/);
  });

  it("pages served on purpose say ranked: true", () => {
    expect(CODE).toMatch(/locationSplit: \{ q: won\.head, location: won\.place \},\s*ranked: true,/);
    // .39 REVERSED HALF OF THIS. The exact-word rescue tier concatenates two
    // recency reads and scores nothing, so `ranked: true` there was a false
    // claim that also blinded the ranked-path outage detector
    // (four-ways-to-lose-a-board.test.ts). The location split is genuinely
    // reranked and keeps it.
    expect(CODE).not.toMatch(/exactWordMatch: qText,\s*ranked: true,/);
  });
});
