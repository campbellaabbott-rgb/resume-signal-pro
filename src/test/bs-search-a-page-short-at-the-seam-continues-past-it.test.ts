// @vitest-environment node
/**
 * A PAGE SHORT AT THE SEAM CONTINUES PAST IT (S13-012).
 *
 * Live on job-board.2026-09-09.96, 2026-11-01, q=nurse limit=50: offsets 0, 57
 * and 109 served 50 cards each, then offset 174 served 7 cards. The rerank
 * pushes a third-and-later posting from one employer to the window's tail, so
 * the last 226 pool positions held a handful of employers' repeats, and
 * collapseClusters folded them into 7 cards (clusters of 113 and 80 rows).
 * The page then jumped to offset 400, a visitor saw a 7-card page in the
 * middle of a 20,000-row result, and nothing filled it.
 *
 * Now a page that reached the seam short is continued with the rows SQL ranks
 * next (rank 200 on), the rows the window already holds dropped by id, and the
 * walk resumes exactly where that continuation stopped: nextOffset is the seam
 * plus the deep rows consumed, so the deep regime starts at SQL rank
 * 200 + raw, with nothing served twice and nothing skipped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collapseClusters, continuePastSeam } from "../../supabase/functions/job-board/clusters";
import { planRankedPage, RANKED_WINDOW, RING_WINDOW } from "../../supabase/functions/job-board/paging";

const BOARD = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

type Row = Record<string, unknown>;
const row = (id: string, company: string, title: string, location = "Austin, TX"): Row =>
  ({ id, company, title, location, country: "US" });

/** The q=nurse shape: varied employers, then the tail of two employers' repeats. */
function window(tailA: number, tailB: number, head: number): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < head; i++) out.push(row(`h${i}`, `Hospital ${i}`, "Registered Nurse"));
  for (let i = 0; i < tailA; i++) out.push(row(`a${i}`, "Staffing A", "Travel Nurse RN", `Town ${i}, TX`));
  for (let i = 0; i < tailB; i++) out.push(row(`b${i}`, "Staffing B", "Per Diem Nurse", `City ${i}, OK`));
  return out;
}
const deepRows = (n: number, from = 200): Row[] =>
  Array.from({ length: n }, (_, i) => row(`d${from + i}`, `Clinic ${from + i}`, "Nurse Practitioner"));

/** Postings a page accounts for: every card plus every posting folded into it. */
const postings = (jobs: Row[]) => jobs.reduce((s, j) => s + (Number(j.postingCount) || 1), 0);

describe("the defect, as main serves it", () => {
  it("a window whose tail is two employers' repeats folds to a few cards", () => {
    const w = window(113, 80, 5);
    const main = collapseClusters(w, 50);
    expect(main.jobs.length, "main's page at the seam").toBe(7);
    expect(main.rawConsumed).toBe(w.length);
  });
});

describe("continuePastSeam fills the page and accounts for every row", () => {
  it("the 7-card page becomes a full page, and every deep row consumed is on it", () => {
    const w = window(113, 80, 5);
    const deep = deepRows(150);
    const got = continuePastSeam(w, deep, new Set(w.map((r) => String(r.id))), 50);
    expect(got).not.toBeNull();
    expect(got!.grouped.jobs.length).toBe(50);
    expect(got!.raw).toBe(43);
    expect(postings(got!.grouped.jobs), "no row consumed and missing").toBe(w.length + got!.raw);
    const ids = got!.grouped.jobs.map((j) => String(j.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a deep row already served below the seam is dropped, but its rank is still counted", () => {
    const w = window(3, 3, 2);
    const seenLater = row("d201", "Clinic 201", "Nurse Practitioner");
    w.push(seenLater); // the ring served it below the seam
    const deep = deepRows(10);
    const got = continuePastSeam(w, deep, new Set(w.map((r) => String(r.id))), 8);
    expect(got!.grouped.jobs.map((j) => String(j.id)).filter((id) => id === "d201")).toEqual(["d201"]);
    // window cards: h0 h1 a0 b0 d201 = 5; three more deep rows: d200, d202, d203.
    expect(got!.grouped.jobs.slice(5).map((j) => j.id)).toEqual(["d200", "d202", "d203"]);
    expect(got!.raw, "rank 201 was passed over, not lost").toBe(4);
  });

  it("deep rows that fold into a window card are consumed, not re-served as cards", () => {
    const w = window(4, 0, 1);
    const deep = [row("d200", "Staffing A", "Travel Nurse RN", "Far Town, TX"), ...deepRows(5, 201)];
    const got = continuePastSeam(w, deep, new Set(w.map((r) => String(r.id))), 4);
    expect(got!.grouped.jobs.map((j) => j.id)).toEqual(["h0", "a0", "d201", "d202"]);
    expect(got!.grouped.jobs[1].postingCount).toBe(5);
    expect(got!.raw).toBe(3);
  });

  it("nothing to add answers null, so the page and its nextOffset stay main's", () => {
    const w = window(3, 3, 1);
    const seen = new Set(w.map((r) => String(r.id)));
    expect(continuePastSeam(w, [], seen, 10)).toBeNull();
    const dup = [row("h0", "Hospital 0", "Registered Nurse")];
    expect(continuePastSeam(w, dup, seen, 10)).toBeNull();
  });

  it("walking the seam and the deep regime serves every SQL rank once (non-ring and ring)", () => {
    // SQL rank 0..599. The window holds ranks 0..199 (reranked: tail = repeats);
    // the deep regime pages ranks >= 200 by planRankedPage.
    for (const ring of [false, true]) {
      for (const limit of [20, 50, 67]) {
        const sql: Row[] = [...window(120, 70, 10), ...deepRows(400)];
        const seam = ring ? RING_WINDOW : RANKED_WINDOW;
        const pool = sql.slice(0, RANKED_WINDOW);
        const fetchLimit = Math.min(limit * 3, 200);
        // The page that reaches the seam: offset 10 in this pool's order.
        const offset = 10;
        const win = pool.slice(offset);
        const g = collapseClusters(win, limit);
        expect(g.jobs.length).toBeLessThan(limit);
        const top = continuePastSeam(win, sql.slice(RANKED_WINDOW, RANKED_WINDOW + fetchLimit), new Set(pool.map((r) => String(r.id))), limit)!;
        expect(top.grouped.jobs.length, `ring=${ring} limit=${limit}`).toBe(limit);
        let next = seam + top.raw;
        const consumed: string[] = [...win, ...sql.slice(RANKED_WINDOW, RANKED_WINDOW + top.raw)].map((r) => String(r.id));
        for (let step = 0; step < 4; step++) {
          const plan = planRankedPage({ offset: next, fetchLimit, scoreRanked: true, newestFirst: false, deepPageable: true, ringMerged: ring });
          expect(plan.deepPage).toBe(true);
          const rows = sql.slice(plan.pOffset, plan.pOffset + plan.pLimit);
          const page = collapseClusters(rows, limit);
          consumed.push(...rows.slice(0, page.rawConsumed).map((r) => String(r.id)));
          next += page.rawConsumed;
        }
        expect(new Set(consumed).size, "a rank served twice").toBe(consumed.length);
        const expected = sql.slice(offset, offset + consumed.length).map((r) => String(r.id));
        expect(consumed, "a rank skipped").toEqual(expected);
      }
    }
  });
});

describe("index.ts continues a short seam page and resumes the walk after it", () => {
  const at = BOARD.indexOf("let seamRaw = 0;");
  const block = BOARD.slice(at, at + 1600);

  it("only below the seam, on a deep-pageable grouped page that came up short with the SQL window full", () => {
    expect(at, "the seam block has moved").toBeGreaterThan(-1);
    expect(block).toMatch(/const seamReached = !deepPage && deepPageable && rankedRows\.length >= RANKED_WINDOW && \(ringMerged \? poolExhausted && ringResolved : offset \+ rankedGrouped\.rawConsumed >= RANKED_WINDOW\);/);
    expect(block).toMatch(/if \(seamReached && groupSimilar && rankedGrouped\.jobs\.length < limit && budgetLeft\(\) > 2_000\)/);
  });

  it("reads SQL rank 200 with the page's own filters and tier, drops what the pool holds, and never fails the page", () => {
    expect(block).toMatch(/rankedCall\(\{ p_limit: fetchLimit, p_offset: RANKED_WINDOW \}, rankedAnswer\.cut\)/);
    expect(block).toMatch(/continuePastSeam\(rankedWindow, .+, mergedSeen, limit\);/);
    expect(block).toMatch(/\} catch \{/);
    expect(BOARD, "the first ranked call and the seam call share one call").toMatch(/await rankedCall\(\{\s*\/\/[^\n]*\n\s*p_limit: pagePlan\.pLimit,\s*p_offset: pagePlan\.pOffset,\s*\}, titleOnly\)/);
  });

  it("nextOffset resumes at the seam plus the deep rows consumed", () => {
    expect(BOARD).toMatch(/nextOffset: poolExhausted \? RING_WINDOW \+ seamRaw : seamRaw \? RANKED_WINDOW \+ seamRaw : offset \+ rankedGrouped\.rawConsumed,/);
  });
});
