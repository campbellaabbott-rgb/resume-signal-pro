// @vitest-environment node
/**
 * "CVS" FINDS CVS HEALTH, AND "ACCOUNTANT" FINDS ACCOUNTANTS (S12-014, S12-018;
 * job-board .93, wave 4 round 2).
 *
 * S12-014. The router's employer table was generated once, on 2026-08-21, and
 * keyed on whole folded display names, so "cvs" (CVS Health, 15,828 open)
 * matched 21 titles, "cvs pharmacist" one row against 1,453, and "UPS", "3M"
 * and "P&G", whose names arrived later by override, fell to the title-only
 * SIMPLE route ("3M" and "P&G" fold to two characters, under the router's
 * floor). The router now also reads keys off the live employer list, and a
 * SIMPLE literal that names an employer matches that employer's boards too.
 *
 * S12-018. The english stemmer files "accountant" under "account",
 * "mechanic" under "mechanical", "operator" under "operations": live on
 * 2026-10-12, accountant + Denver served 160 of 180 rows without the word,
 * GB mechanic 148 of 169. Those words take the SIMPLE route, matched
 * unstemmed in both numbers, by the list and its count alike.
 *
 * The pure rules are imported; the routes are driven through the shipped
 * handler (helpers/board-list.ts bundles the real index.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootBoardList, calls, row, type BoardList } from "./helpers/board-list";
import {
  brandKeysOf, pickRoute, simpleRouteFilters, STEM_COLLISIONS, withLiveBrands,
} from "../../supabase/functions/job-board/search-routing";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";
import { ROLE_ALIASES } from "../../supabase/functions/job-board/search-alias";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

// The live employer list, as company-suggest read it on 2026-10-12.
const FACET = [
  { token: "cvshealth~wd1~CVS_Health_Careers", name: "CVS Health", count: 16000, open: 15828 },
  { token: "hcmportal~wd5~Search", name: "UPS", count: 1600, open: 1511 },
  { token: "3m~wd1~Search", name: "3M", count: 380, open: 371 },
  { token: "pg~wd5~1000", name: "P&G", count: 470, open: 459 },
  { token: "homedepot~wd5~careerdepot", name: "The Home Depot", count: 540, open: 530 },
  { token: "eluq~us2~CX_1", name: "The Kroger Co.", count: 10000, open: 9945 },
  { token: "advocate~wd1~x", name: "Advocate Health", count: 900, open: 880 },
  { token: "cna-ins", name: "CNA", count: 300, open: 250 },
  { token: "tiny", name: "Tiny Co", count: 20, open: 12 },
  { token: "flex-a", name: "Flex A Group", count: 300, open: 300 },
  { token: "flex-b", name: "Flex A Holdings", count: 300, open: 300 },
];
const REFUSE = new Set(["cna", "rn", "lpn"]);

describe("employer keys come from the live employer list (S12-014)", () => {
  it("a brand without its corporate word, a short or symbolled name, never a lone common word", () => {
    expect(brandKeysOf("CVS Health")).toEqual(expect.arrayContaining(["cvshealth", "cvs"]));
    expect(brandKeysOf("UPS")).toEqual(["ups"]);
    expect(brandKeysOf("3M")).toEqual(["3m"]);
    expect(brandKeysOf("P&G")).toEqual(["pg"]);
    expect(brandKeysOf("The Home Depot")).toEqual(expect.arrayContaining(["thehomedepot", "homedepot"]));
    expect(brandKeysOf("The Kroger Co."), "one six-letter word is too likely a job search").not.toContain("kroger");
    expect(brandKeysOf("Advocate Health"), "'advocate' is a job").not.toContain("advocate");
  });

  it("joins the table without overriding it, refusing shared, small and guarded keys", () => {
    const a = withLiveBrands(EMPLOYER_ALIASES, FACET, REFUSE);
    expect(a.cvs?.tokens).toEqual(["cvshealth~wd1~CVS_Health_Careers"]);
    expect(a.ups?.name).toBe("UPS");
    expect(a["3m"]?.name).toBe("3M");
    expect(a.pg?.name).toBe("P&G");
    expect(a.cvshealth, "the table's own entry wins").toEqual(EMPLOYER_ALIASES.cvshealth);
    expect(a.cna, "a job acronym is never an employer key").toBeUndefined();
    expect(a.tinyco, "an employer under the open floor gets no key").toBeUndefined();
    expect(a.flexa, "a key two employers would share is nobody's").toBeUndefined();
  });

  it("the router takes the employer route for each, and 'hr' still is not one", () => {
    const a = withLiveBrands(EMPLOYER_ALIASES, FACET, REFUSE);
    for (const [q, name] of [["cvs", "CVS Health"], ["UPS", "UPS"], ["3M", "3M"], ["P&G", "P&G"]]) {
      const d = pickRoute(q, a);
      expect(d.route, q).toBe("EMPLOYER");
      expect(d.matchedName, q).toBe(name);
    }
    expect(pickRoute("home depot", a).route, "the table's own homedepot key").toBe("EMPLOYER");
    expect(pickRoute("hr", a).route).not.toBe("EMPLOYER");
    expect(pickRoute("cna", a).route).not.toBe("EMPLOYER");
    expect(pickRoute("cvs", EMPLOYER_ALIASES).route, "the table alone never routed it").not.toBe("EMPLOYER");
  });

  it("a SIMPLE literal that names an employer matches its boards as well as its titles", () => {
    const a = withLiveBrands(EMPLOYER_ALIASES, FACET, REFUSE);
    expect(pickRoute("cvs pharmacist", a).route).toBe("SIMPLE");
    const split = simpleRouteFilters("cvs pharmacist", ROLE_ALIASES, a)!;
    expect(split.filters[0]).toMatchObject({ column: "title", config: "simple", orCompanyTokens: ["cvshealth~wd1~CVS_Health_Careers"] });
    expect(simpleRouteFilters("it manager", ROLE_ALIASES, a)!.filters[0].orCompanyTokens).toBeUndefined();
  });
});

describe("a stemmer collision is matched unstemmed (S12-018)", () => {
  it("routes SIMPLE with both numbers of the word, alone or beside other words", () => {
    for (const q of ["accountant", "staff accountant", "mechanic", "machine operators", "generator technician", "police officer"]) {
      expect(pickRoute(q, EMPLOYER_ALIASES).route, q).toBe("SIMPLE");
    }
    expect(simpleRouteFilters("accountant", ROLE_ALIASES)!.filters).toEqual([{ column: "title", query: "accountant or accountants", config: "simple" }]);
    const staff = simpleRouteFilters("staff accountant", ROLE_ALIASES)!;
    expect(staff.filters[0]).toEqual({ column: "title", query: "accountant or accountants", config: "simple" });
    expect(staff.filters.slice(1).map((f) => f.config)).toEqual(["english", "english"]);
    expect(staff.expansions, "a plural is not an alias phrase").toEqual([]);
    expect(STEM_COLLISIONS.mechanics).toEqual(["mechanic", "mechanics"]);
  });

  it("positive control: an ordinary word keeps the ranked route", () => {
    for (const q of ["nurse", "software engineer", "mechanical engineer", "account executive"]) expect(pickRoute(q, EMPLOYER_ALIASES).route, q).toBe("RANKED");
  });
});

describe("through the shipped handler", () => {
  let board: BoardList;
  beforeAll(async () => { board = await bootBoardList(); });
  beforeEach(() => board.reset());
  const facet = () => board.answer((q) => (q.table === "job_board_meta" && calls(q, "eq", "k", "refresh") && q.calls.some(([m, a]) => m === "select" && String(a[0]).includes("companiesFacet"))
    ? { data: { companiesFacet: FACET, companiesOpen: Object.fromEntries(FACET.map((f) => [f.token, f.open])) }, error: null }
    : undefined));

  it("q=cvs reads CVS Health's boards, and q=cvs pharmacist reads its titles or its boards", async () => {
    facet();
    board.answer((q) => (q.table === "job_board_postings" ? { data: [row("workday:cvshealth~wd1~CVS_Health_Careers:1", "Pharmacist", { company: "CVS Health", company_token: "cvshealth~wd1~CVS_Health_Careers" })], error: null } : undefined));
    const r = await board.post({ action: "list", q: "cvs", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("EMPLOYER");
    expect(r.companyMatched).toBe("CVS Health");

    board.reset();
    facet();
    board.answer((q) => (q.table === "job_board_postings" ? { data: [row("workday:cvshealth~wd1~CVS_Health_Careers:1", "Pharmacist", { company: "CVS Health" })], error: null } : undefined));
    const p = await board.post({ action: "list", q: "cvs pharmacist", limit: 60, groupSimilar: false });
    expect(p.searchRoute).toBe("SIMPLE");
    const or = board.db.queries.filter((q) => q.table === "job_board_postings").flatMap((q) => q.calls.filter(([m]) => m === "or").map(([, a]) => String(a[0])));
    expect(or.some((f) => f.includes('title.wfts(simple)."cvs"') && f.includes('company_token.in.("cvshealth~wd1~CVS_Health_Careers")')), or.join(" || ")).toBe(true);
  });

  it("q=accountant + Denver reads titles that say accountant, and never the stemmed ranked search", async () => {
    board.answer((q) => (q.table === "job_board_postings" ? { data: [row("greenhouse:acme:1", "Staff Accountant", { location: "Denver, CO", country: "US" })], error: null } : undefined));
    const r = await board.post({ action: "list", q: "accountant", location: "Denver", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("SIMPLE");
    const fts = board.db.queries.filter((q) => q.table === "job_board_postings").flatMap((q) => q.calls.filter(([m]) => m === "textSearch").map(([, a]) => a));
    expect(fts.some((a) => a[0] === "title" && a[1] === "accountant or accountants" && (a[2] as { config?: string }).config === "simple"), JSON.stringify(fts)).toBe(true);
    expect(board.db.rpcArgs("search_jobs"), "the stemmed search never ran").toEqual([]);
    const c = await board.post({ action: "list", q: "accountant", location: "Denver", countOnly: true });
    expect(c.total, "the count reads the list's own predicate").toBe(1);
  });
});
