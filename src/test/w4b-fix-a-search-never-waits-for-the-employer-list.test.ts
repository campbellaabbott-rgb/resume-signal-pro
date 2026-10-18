// @vitest-environment node
/**
 * A SEARCH NEVER WAITS FOR THE EMPLOYER LIST, AND A LIVE BRAND KEY NEVER
 * CLAIMS A COUNTRY OR TWO LETTERS (wave 4 round 2 review, search lens; S12-014
 * made to work on the live function).
 *
 * WHAT WAS WRONG.
 *   - routeAliasesFor was awaited before every text list, count and facet
 *     request, racing an 800 ms timer against the employer read (~0.8-0.9 s
 *     on the live function, memo almost never warm): up to 0.8 s added to most
 *     searches, and most still routed on the table alone.
 *   - A live brand key could claim a country word ("USA Health" took 'usa'
 *     and routed a search for USA to one hospital system) or two letters
 *     ('go', 'uc', 'ge', 'hp'), and a SIMPLE literal joined that employer's
 *     boards ('software engineer usa').
 *   - withLiveBrands' memo kept every ~32k-row employers list it ever saw for
 *     the life of the isolate (a WeakMap keyed by a module constant, holding a
 *     Map keyed by each list).
 *
 * WHAT HOLDS NOW (the shipped handler, its database faked):
 *   - with the employer read held for 1.5 s, a cold isolate's text search
 *     answers well inside it, on the table's keys; once the read lands (after
 *     the response), the next search routes 'cvs' to CVS Health;
 *   - 'USA' never takes the employer route to 'USA Health', and a two-letter
 *     literal never joins an employer's boards (whole-query 3M and P&G still route);
 *   - a SIMPLE literal on the occupation guard never joins an employer's boards;
 *   - withLiveBrands keeps the last set only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootBoardList, calls, row, type BoardList } from "./helpers/board-list";
import { simpleRouteFilters, withLiveBrands } from "../../supabase/functions/job-board/search-routing";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";
import { ROLE_ALIASES } from "../../supabase/functions/job-board/search-alias";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const FACET = [
  { token: "cvshealth~wd1~CVS_Health_Careers", name: "CVS Health", count: 16000, open: 15828 },
  { token: "usahealth", name: "USA Health", count: 100, open: 100 },
  { token: "ucdenver", name: "UC Health", count: 268, open: 268 },
  { token: "gehc", name: "GE HealthCare", count: 584, open: 584 },
  { token: "hp~wd5", name: "HP", count: 1072, open: 1072 },
  { token: "gostores", name: "Go! Stores", count: 214, open: 214 },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("through the shipped handler", () => {
  let board: BoardList;
  let facetReads = 0;
  beforeAll(async () => {
    board = await bootBoardList();
    // A promise only for the employer read: any other query must get undefined
    // synchronously, so the next answer is asked.
    board.answer((q) => {
      if (!(q.table === "job_board_meta" && calls(q, "eq", "k", "refresh") && q.calls.some(([m, a]) => m === "select" && String(a[0]).includes("companiesFacet")))) return undefined;
      facetReads++;
      return sleep(1500).then(() => ({ data: { companiesFacet: FACET, companiesOpen: Object.fromEntries(FACET.map((f) => [f.token, f.open])) }, error: null }));
    });
    board.answer((q) => (q.table === "job_board_postings" ? { data: [row("workday:cvshealth~wd1~CVS_Health_Careers:1", "Pharmacist", { company: "CVS Health", company_token: "cvshealth~wd1~CVS_Health_Careers" })], error: null } : undefined));
  });

  it("a cold isolate answers without waiting for the employer read, then routes on the live keys once it lands", async () => {
    const t0 = Date.now();
    const cold = await board.post({ action: "list", q: "cvs", limit: 20, groupSimilar: false });
    expect(Date.now() - t0, "neither the 1.5 s employer read nor the old 800 ms deadline was waited for").toBeLessThan(700);
    expect(cold.searchRoute).not.toBe("EMPLOYER");
    expect(facetReads).toBe(1);

    await sleep(1700);
    const warm = await board.post({ action: "list", q: "cvs", limit: 20, groupSimilar: false });
    expect(warm.searchRoute, JSON.stringify(warm).slice(0, 400)).toBe("EMPLOYER");
    expect(warm.companyMatched).toBe("CVS Health");
  });

  it("'USA' is not a hospital system, and no two-letter brand key routes", async () => {
    for (const q of ["USA", "usa", "uc", "ge", "hp", "go"]) {
      const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
      expect(r.searchRoute, q).not.toBe("EMPLOYER");
    }
  });
});

describe("the rules", () => {
  it("withLiveBrands keeps the last set only, and a two-letter literal never joins an employer's boards", () => {
    const refuse = new Set(["usa", "us"]);
    const a = withLiveBrands(EMPLOYER_ALIASES, FACET, refuse);
    expect(Object.prototype.hasOwnProperty.call(a, "usa") && !Object.prototype.hasOwnProperty.call(EMPLOYER_ALIASES, "usa")).toBe(false);
    for (const q of ["go developer", "nurse uc", "ge technician"]) {
      expect(simpleRouteFilters(q, ROLE_ALIASES, a)?.filters.some((f) => f.orCompanyTokens?.length) ?? false, q).toBe(false);
    }
    expect(withLiveBrands(EMPLOYER_ALIASES, FACET, refuse)).toBe(a);
    const other = [...FACET];
    expect(withLiveBrands(EMPLOYER_ALIASES, other, refuse)).not.toBe(a);
    expect(withLiveBrands(EMPLOYER_ALIASES, FACET, refuse), "the first list was let go").not.toBe(a);
  });

  it("a SIMPLE literal on the occupation guard never joins an employer's boards", () => {
    const employers = { it: { tokens: ["it-co"], name: "IT Co" } };
    const r = simpleRouteFilters("it support", ROLE_ALIASES, employers);
    expect(r?.filters.some((f) => f.orCompanyTokens?.length)).toBe(false);
  });
});
