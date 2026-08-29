import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE PUBLISHED TOTAL RAN 6,809 HIGH, AND THE FIRST REPORT READ IT BACKWARDS.
 *
 * Measured 2026-08-23: headline 582,839, servable set 576,030. An earlier
 * report of the same gap concluded "6,809 servable postings are unreachable
 * behind the pagination fence" — inverted. Walking to the end showed the last
 * reachable row IS the servable count and nothing was ever fenced off. The
 * headline simply overcounted: the coverage pass counted missing_since alone,
 * while the read path also requires effective_posted inside the freshness
 * window.
 *
 * One missing predicate, three symptoms:
 *   - the homepage claimed a 30-day-filtered count while showing an unfiltered
 *     one — measured on the exact request the hooks send, total and
 *     totalAllCompanies came back IDENTICAL, while the client comments assert
 *     they differ;
 *   - the pagination fence, fed the overcount, admitted 6,809 offsets that
 *     each walk the full index for ~4s and return zero rows;
 *   - the phantom "unreachable postings" defect above.
 *
 * AND THE TERMINAL PAGE LIED ABOUT HAVING MORE. A terminal page's total counts
 * UNGROUPED rows while the page serves grouped cards, so on 36 of 82 measured
 * terminal browse pages (43.9%, median shortfall 7.3%) the Load-more button
 * survived its own last page and refetched it forever. No postings were lost —
 * the same jobs fold into fewer cards — but the client's gate trusted the count
 * over the server's explicit hasMore:false.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");

describe("a headline counts what the board can serve", () => {
  it("the open count carries the same freshness predicate the read path applies", () => {
    const i = FN.indexOf("const { count: open }");
    expect(i, "the coverage open count moved").toBeGreaterThan(0);
    const blk = FN.slice(i, i + 400);
    expect(blk).toMatch(/\.is\("missing_since", null\)/);
    expect(blk, "without the freshness bound the headline counts rows the reader can never see")
      .toMatch(/\.gte\("effective_posted", new Date\(Date\.now\(\) - FRESH_WINDOW_DAYS \* 86_400_000\)\.toISOString\(\)\)/);
  });

  it("the client ends paging when the server says so", () => {
    // hasMore:false is authoritative. The count comparison stays only as the
    // reason to KEEP going when the server is silent — it must never overrule
    // an explicit no.
    expect(JOBS).toMatch(/data && data\.hasMore !== false && \(typeof data\.total === "number" \? jobs\.length < pageTotalCount : true\) && \(/);
    expect(JOBS).not.toMatch(/typeof data\.total === "number" \? jobs\.length < pageTotalCount : !!data\.hasMore/);
  });

  it("every rescue exit hands back a position that exists", () => {
    // These were nextOffset: 0 — a pager following them loops to the top of
    // the feed. The web client is saved by its hasMore gate; an API consumer
    // is not.
    expect(FN).toMatch(/nextOffset: offset \+ simpleGrouped\.jobs\.length,/);
    expect(FN).toMatch(/nextOffset: offset \+ fuzzyGrouped\.jobs\.length,/);
    const stripped = FN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped, "a literal zero nextOffset is a loop instruction").not.toMatch(/nextOffset: 0,/);
  });

  it("the routed window clamps its successor to the rows it holds", () => {
    // Clamped on BOTH branches now. A short block is the tail, so the successor
    // cannot run past blockStart + its length. A full block steps into the next
    // one — but must land exactly ON the boundary: unclamped, q="cdl" at limit
    // 60 walked 360 -> 420, entered block two at inBlock=20, and permanently
    // skipped the 20 highest-scoring positions of every subsequent block
    // (confirmed by the 2026-08-29 six-lens sweep). Landing on
    // blockStart + ROUTE_WINDOW makes the next request compute inBlock=0.
    expect(FN).toMatch(/nextOffset: blockFull\s*\?\s*Math\.min\(offset \+ limit, blockStart \+ ROUTE_WINDOW\)\s*:\s*Math\.min\(offset \+ limit, blockStart \+ ordered\.length\),/);
  });
});
