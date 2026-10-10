// @vitest-environment node
/**
 * AN EMPLOYER WHOSE NAME HOLDS "OF" NEVER TOOK THE EMPLOYER ROUTE.
 *
 * Sweep S8-090 (2026-10-08). The router is handed the query after the filler
 * words are dropped ("bank of america" -> "bank america"), while the alias
 * table is keyed on the whole display name ("bankofamerica"), so 14 of the 499
 * employers (Bank of America, University of Rochester, Coffee and Bagel
 * Brands, ...) never routed. Live on .90, 2026-10-08: q="bank of america"
 * answered searchRoute null with droppedTerms ["of"], its third card MUFG's
 * "Latin America" role.
 *
 * And q="constructor" answered HTTP 500 "Job board temporarily unavailable"
 * (live, the same day): the alias lookup read Object's own constructor off the
 * table and the route threw.
 *
 * Run through the shipped handler (helpers/board-list.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootBoardList, calls, row, type BoardList } from "./helpers/board-list";
import { fillerFoldedAliases, pickRoute } from "../../supabase/functions/job-board/search-routing";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardList;
beforeAll(async () => { board = await bootBoardList(); });
beforeEach(() => board.reset());

const tokenReads = () => board.db.queries.filter((q) => q.table === "job_board_postings" && calls(q, "in", "company_token"));

describe("an employer name with a filler word routes to the employer (S8-090)", () => {
  it("q=bank of america reads Bank of America's own boards", async () => {
    board.answer((q) => (q.table === "job_board_postings" && calls(q, "in", "company_token")
      ? { data: [row("workday:ghr~wd1~Lateral-US:1", "Relationship Manager", { company: "Bank of America", company_token: "ghr~wd1~Lateral-US" })], error: null }
      : undefined));
    const r = await board.post({ action: "list", q: "bank of america", limit: 60, groupSimilar: false });
    expect(r.searchRoute, "the router never saw the employer's name").toBe("EMPLOYER");
    expect(r.companyMatched).toBe("Bank of America");
    expect(tokenReads()[0].calls.find(([m, a]) => m === "in" && a[0] === "company_token")![1][1])
      .toEqual(EMPLOYER_ALIASES.bankofamerica.tokens);
  });

  it("q=university of rochester and q=jobs at coffee and bagel brands route too", async () => {
    for (const [q, name] of [["university of rochester", "University of Rochester"], ["jobs at coffee and bagel brands", "Coffee and Bagel Brands"]]) {
      board.reset();
      board.answer((x) => (x.table === "job_board_postings" && calls(x, "in", "company_token")
        ? { data: [row("workday:t:1", "Associate", { company: name })], error: null } : undefined));
      const r = await board.post({ action: "list", q, limit: 60, groupSimilar: false });
      expect(r.companyMatched, q).toBe(name);
      expect(tokenReads().length, q).toBeGreaterThan(0);
    }
  });

  it("a name that keeps one word once its filler is gone claims nothing", () => {
    // "Destination Careers" would otherwise take every search for "destination".
    const extra = fillerFoldedAliases(EMPLOYER_ALIASES, new Set(["careers", "of", "and", "the"]));
    expect(extra.has("destination")).toBe(false);
    expect(pickRoute("destination", EMPLOYER_ALIASES, new Set(["careers"])).route).not.toBe("EMPLOYER");
  });
});

describe("a query spelled like an Object property is a query (S8-090)", () => {
  it("q=constructor answers a page, not a 500", async () => {
    board.answer((q) => (q.rpc === "search_jobs"
      ? { data: [{ ...row("greenhouse:acme:1", "Constructor - Bridges"), total_rows: 1 }], error: null }
      : undefined));
    const r = await board.post({ action: "list", q: "constructor", limit: 60, groupSimilar: false });
    expect(r.error, "the alias table answered Object.prototype.constructor").toBeUndefined();
    expect(r.searchRoute).not.toBe("EMPLOYER");
    expect(Array.isArray(r.jobs)).toBe(true);
  });
});
