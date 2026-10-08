// @vitest-environment node
/**
 * THE CHIPS COUNTED A DIFFERENT POPULATION THAN THE LIST (L13-24, old 1.40).
 *
 * q="rn", US: facetCounts legal 1,159 (facetSource "ranked") while the legal
 * list for the same query answered total null, totalAtLeast 8. A one-term
 * query's chips came from count_jobs_capped, a contiguous ILIKE ("rn" inside
 * "internal", "Northwestern"), and a multi-term query's from buildQuery's ILIKE
 * terms; the list matches by FTS. Clicking a chip contradicted it.
 *
 * A text query now withholds the per-category numbers (facetSource
 * "withheld"); an employer query counts its own tokens, the routed list's
 * matcher; no query counts the filters alone, as before.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootBoardList, calls, type BoardList } from "./helpers/board-list";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardList;
beforeAll(async () => { board = await bootBoardList(); });
beforeEach(() => board.reset());

describe("chip counts under a text query", () => {
  it("q=rn: withheld, and no substring count is asked", async () => {
    board.answer((q) => (q.rpc === "count_jobs_capped" ? { data: [{ n: 1159, capped: false }], error: null } : undefined));
    const r = await board.post({ action: "list", q: "rn", country: "US", facetCounts: true });
    expect(r.categories).toEqual({});
    expect(r.facetSource).toBe("withheld");
    expect(board.db.rpcArgs("count_jobs_capped")).toEqual([]);
    expect(board.db.queries.filter((q) => q.table === "job_board_postings").length).toBe(0);
  });

  it("a multi-word query is withheld too (its ILIKE terms were the other substring matcher)", async () => {
    const r = await board.post({ action: "list", q: "senior nurse", facetCounts: true });
    expect(r.facetSource).toBe("withheld");
  });

  it("q=dominos: each chip counts Domino's own rows, the routed list's matcher", async () => {
    board.answer((q) => (q.table === "job_board_postings" && calls(q, "in", "company_token") ? { data: [], error: null, count: 7 } : undefined));
    const r = await board.post({ action: "list", q: "dominos", facetCounts: true });
    expect(r.facetSource).toBe("employer");
    const reads = board.db.queries.filter((q) => q.table === "job_board_postings");
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) {
      expect(q.calls.find(([m, a]) => m === "in" && a[0] === "company_token")![1][1]).toEqual(["dominos"]);
      expect(calls(q, "or"), "no title ILIKE").toBe(false);
    }
    expect(Object.values(r.categories as Record<string, number>).every((n) => n === 7)).toBe(true);
  });

  it("no query: counted from the filters, as before", async () => {
    board.answer((q) => (q.table === "job_board_postings" ? { data: [], error: null, count: 3 } : undefined));
    const r = await board.post({ action: "list", country: "GB", facetCounts: true });
    expect(r.facetSource).toBe("filters");
    expect(Object.keys(r.categories as Record<string, number>).length).toBeGreaterThan(0);
  });
});
