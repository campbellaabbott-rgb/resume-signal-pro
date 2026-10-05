import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE THROTTLE HAD NO LEVER FOR THE THING THAT WAS KILLING SLICES.
 *
 * Every paginated fetcher accumulates a whole board into one array before
 * returning, so per-board memory is O(board), not O(page). The `pages`
 * overrides added 2026-08-31 made 315 boards deep-pageable and 77 of them able
 * to pull 2,000+ postings in one visit — 20,800 for an iCIMS giant, 13,000 for
 * an Oracle one, 5,000 for a Workday one.
 *
 * Measured 2026-09-02: slices died INSIDE the fetch loop on
 * WORKER_RESOURCE_LIMIT, having already advanced the cursor and drained the
 * bootstrap queue optimistically, and never reached stampSliceWork. The fleet
 * read its own row as stale and floored itself at L1 — where it could not
 * recover, because EVERY shed lever cuts the NUMBER of boards in a slice
 * (coldSlice 80->48, concurrency 8->5, hotSlice 10->5, deep 8->4) and NONE of
 * them cuts the SIZE of one board. A single giant can exhaust an invocation on
 * its own, so shedding could never be the answer. The cold tail fell 3,765
 * minutes behind a 1,392 SLA while this went round.
 *
 * The cap is therefore in POSTINGS, and its correctness rests entirely on the
 * resume contract below.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const fnBody = (name: string) => {
  const i = FN.indexOf(`async function ${name}(`);
  if (i < 0) return "";
  const j = FN.indexOf("\n}", i);
  return j > i ? FN.slice(i, j) : "";
};

describe("a lever that cuts count cannot cut size", () => {
  it("bounds a visit by postings, at Oracle's already-tolerated default", () => {
    // Was pinned at the literal 2_000 ("20 pages x 100, the Oracle default
    // that has always been safe"). Safe for Oracle's pagination is not the
    // same question as survivable for the isolate: at the fitted ~146KB a
    // posting, one 2,000-posting board is ~285MB — more than the whole
    // ceiling, on its own, before any other board lands. Pin the property.
    expect(FN).toMatch(/const MAX_POSTINGS_PER_VISIT = [0-9_]+;/);
    const cap = Number(FN.match(/const MAX_POSTINGS_PER_VISIT = ([0-9_]+);/)![1].replace(/_/g, ""));
    expect(cap * 146 / 1024, "one board must never be able to reach the ceiling alone").toBeLessThan(256 / 2);
  });

  it("the capped fetchers RESUME rather than wrap — the whole correctness argument", () => {
    // Breaking out with `exhausted` still false is what leaves
    // nextOffset = startOffset + all.length. Setting it true would wrap the
    // board to offset 0 and re-read it from the top forever, and the giant
    // would never be fully ingested.
    for (const fn of ["fetchWorkday", "fetchOracle"]) {
      const body = fnBody(fn);
      expect(body, `${fn} not found`).not.toBe("");
      expect(body, `${fn} does not cap its accumulation`).toMatch(
        /if \(all\.length >= MAX_POSTINGS_PER_VISIT\) break outer;/,
      );
      // The cap line must NOT set exhausted.
      const capLine = /if \(all\.length >= MAX_POSTINGS_PER_VISIT\)[^\n]*/.exec(body)?.[0] ?? "";
      expect(capLine, `${fn}'s cap wraps the board instead of resuming it`).not.toMatch(/exhausted/);
      // And the resume arithmetic must still be there.
      expect(body, `${fn} lost its nextOffset arithmetic`).toMatch(/startOffset \+ all\.length/);
    }
  });

  it("never caps a fetcher that cannot resume — that would TRUNCATE a board", () => {
    // UKG and ADP take no startOffset and return no nextOffset, so a cap
    // there does not defer the rest of the board, it discards it. They need
    // offset support before they can be bounded. (iCIMS gained it in .28 and
    // USAJOBS in .89; both moved to the capped list.)
    for (const fn of ["fetchUkg", "fetchAdp"]) {
      const body = fnBody(fn);
      if (!body) continue;
      expect(body, `${fn} cannot resume, so capping it silently truncates the board`)
        .not.toMatch(/MAX_POSTINGS_PER_VISIT/);
    }
  });

  it("USAJOBS resumes since .89, and is therefore capped and reports where it stopped", () => {
    // Its 500-result page never fit the 4 MB bound, so the federal feed was
    // deferred on every visit and never stored a row. Pages of 100 from the
    // cursor's page, capped per visit, resumed next visit.
    const u = FN.indexOf('s.source === "usajobs"');
    const usajobs = FN.slice(u, FN.indexOf('s.source === "rippling"', u));
    expect(usajobs, "usajobs block not found").not.toBe("");
    expect(usajobs).toMatch(/const startPage = Math\.floor\(startOffset \/ PAGE\) \+ 1;/);
    expect(usajobs).toMatch(/if \(all\.length >= MAX_POSTINGS_PER_VISIT\) break;/);
    const capLine = /if \(all\.length >= MAX_POSTINGS_PER_VISIT\)[^\n]*/.exec(usajobs)?.[0] ?? "";
    expect(capLine, "usajobs cap wraps the feed instead of resuming it").not.toMatch(/exhausted/);
    expect(usajobs, "usajobs must return nextOffset so the deep cursor can resume it").toMatch(/return \{[\s\S]{0,400}?\bnextOffset\b/);
    expect(usajobs, "a page of 500 is over the byte bound by itself").not.toMatch(/PAGE = 500/);
    expect(usajobs, "usajobs pages must be read through the byte bound").toMatch(/readChunkPage\(res\)/);
    expect(FN).toMatch(/const CAPPED_VISIT_VENDORS = new Set\(\[[^\]]*"usajobs"[^\]]*\]\);/);
  });

  it("iCIMS resumes since .28, and is therefore capped like Workday and Oracle", () => {
    // It held the single largest per-visit fetch on the board (20,800) and
    // was the one giant .27 could not touch. The dispatcher already persisted
    // nextOffset for ANY vendor; iCIMS only had to consume startOffset and
    // report where it stopped. Since .89 the walk lives in fetchIcims and takes
    // its page size from the caller (100, then 50, then 25 for a first page
    // over the byte bound).
    const block = fnBody("fetchIcims");
    expect(block, "fetchIcims not found").not.toBe("");
    expect(block).toMatch(/const startPage = Math\.floor\(startOffset \/ pageSize\) \+ 1;/);
    expect(block, "iCIMS must report where it stopped, from the offset it really started at").toMatch(/const advancedIc = base \+ all\.length;/);
    // The PROPERTY, not the trailing brace: this used to pin
    // `feedTotal, nextOffset }` and would have gone red the moment the return
    // grew feedEnded/endOffset for the lap proof — a guard failing over a
    // comma while the resumability it names was untouched.
    expect(block, "iCIMS must return nextOffset so the deep cursor can resume it").toMatch(/return \{[\s\S]{0,400}?\bnextOffset\b/);
    expect(block, "iCIMS must return the vendor's advertised total").toMatch(/return \{[\s\S]{0,400}?\bfeedTotal\b/);
    expect(block).toMatch(/if \(all\.length >= MAX_POSTINGS_PER_VISIT\) break outer;/);
    const capLine = /if \(all\.length >= MAX_POSTINGS_PER_VISIT\)[^\n]*/.exec(block)?.[0] ?? "";
    expect(capLine, "iCIMS cap wraps the board instead of resuming it").not.toMatch(/exhausted/);
  });

  it("a capped board still reads as windowed, so the prune stays off it", () => {
    // The Four Seasons rule: a board that is still filling must not look like a
    // board that shrank, or the closure prune deletes live postings.
    // Since .89 through workdayWindowed, which also calls a mid-feed visit
    // windowed (a tenant that states its total only at offset 0 answers 0
    // past it); its behaviour is held by a-mid-feed-zero-is-not-a-whole-board.
    expect(fnBody("fetchWorkday")).toMatch(/windowed: workdayWindowed\(startOffset, feedTotal, all\.length, exhausted\)/);
    expect(fnBody("fetchOracle")).toMatch(/windowed: !exhausted/);
  });
});
