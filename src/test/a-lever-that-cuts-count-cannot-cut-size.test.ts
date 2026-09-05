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
    // 2,000 is 20 pages x 100 — the Oracle default that has always been safe —
    // so no board that was already fine changes behaviour.
    expect(FN).toMatch(/const MAX_POSTINGS_PER_VISIT = 2_000;/);
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
    // UKG, ADP and USAJOBS take no startOffset and return no nextOffset, so a
    // cap there does not defer the rest of the board, it discards it. They
    // need offset support before they can be bounded. (iCIMS gained it in
    // .28 and moved to the capped list below.)
    for (const fn of ["fetchUkg", "fetchAdp"]) {
      const body = fnBody(fn);
      if (!body) continue;
      expect(body, `${fn} cannot resume, so capping it silently truncates the board`)
        .not.toMatch(/MAX_POSTINGS_PER_VISIT/);
    }
    const u = FN.indexOf('s.source === "usajobs"');
    const usajobs = FN.slice(u, FN.indexOf("return { jobs:", u));
    expect(usajobs, "usajobs cannot resume, so capping it truncates the federal feed").not.toMatch(/MAX_POSTINGS_PER_VISIT/);
  });

  it("iCIMS resumes since .28, and is therefore capped like Workday and Oracle", () => {
    // It held the single largest per-visit fetch on the board (20,800) and
    // was the one giant .27 could not touch. The dispatcher already persisted
    // nextOffset for ANY vendor; iCIMS only had to consume startOffset and
    // report where it stopped.
    const i = FN.indexOf('s.source === "icims"');
    const block = FN.slice(i, FN.indexOf('s.source === "usajobs"', i));
    expect(block, "iCIMS block not found").not.toBe("");
    expect(block).toMatch(/const startPage = Math\.floor\(startOffset \/ ICIMS_PAGE\) \+ 1;/);
    expect(block, "iCIMS must report where it stopped").toMatch(/startOffset \+ all\.length/);
    expect(block, "iCIMS must return nextOffset so the deep cursor can resume it").toMatch(/feedTotal, nextOffset \}/);
    expect(block).toMatch(/if \(all\.length >= MAX_POSTINGS_PER_VISIT\) break outer;/);
    const capLine = /if \(all\.length >= MAX_POSTINGS_PER_VISIT\)[^\n]*/.exec(block)?.[0] ?? "";
    expect(capLine, "iCIMS cap wraps the board instead of resuming it").not.toMatch(/exhausted/);
  });

  it("a capped board still reads as windowed, so the prune stays off it", () => {
    // The Four Seasons rule: a board that is still filling must not look like a
    // board that shrank, or the closure prune deletes live postings.
    expect(fnBody("fetchWorkday")).toMatch(/windowed: feedTotal > all\.length/);
    expect(fnBody("fetchOracle")).toMatch(/windowed: !exhausted/);
  });
});
