// @vitest-environment node
/**
 * AN EMPLOYER ASKED FOR BY NAME IS FOUND BY NAME (wave 4, job-board .93).
 *
 * companies:["Humana"] answered 0 with no note: the filter takes board tokens
 * and an AI sends the name. company-suggest already resolves "humana" to
 * humana~wd5~Humana_External_Career_Site and CenterWell (Humana). The list now
 * resolves names the same way, never merges two employers that share a name,
 * and names every name it could not resolve, with candidates.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resolveCompanyNames, type FacetEmployer } from "../../supabase/functions/job-board/company-names";
import { bootBoardHandler, type BoardHandler } from "./helpers/board-handler";
import type { Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const HUMANA = "humana~wd5~Humana_External_Career_Site";
const CENTERWELL = "humana~wd5~CenterWell_External_Career_Site";
const EMPLOYERS: FacetEmployer[] = [
  { token: HUMANA, name: "Humana", open: 243 },
  { token: CENTERWELL, name: "CenterWell (Humana)", open: 832 },
  { token: "flex", name: "Flex", open: 9 },
  { token: "flextronics~wd1~Careers", name: "Flex", open: 572 },
  { token: "pwc~wd3~a", name: "PwC", open: 100, tokens: ["pwc~wd3~a", "pwc~wd3~b"] },
  { token: "humanagency", name: "Human Agency", open: 4 },
];
const CATALOGUE = new Set([HUMANA, CENTERWELL, "flex", "flextronics~wd1~Careers", "pwc~wd3~a", "pwc~wd3~b", "humanagency"]);

describe("names to tokens (company-names.ts)", () => {
  it("an exact name, plus the boards we name after it in parentheses", () => {
    const r = resolveCompanyNames(["Humana"], CATALOGUE, EMPLOYERS);
    expect(r.companies).toEqual([HUMANA, CENTERWELL]);
    expect(r.resolved).toEqual([{ asked: "Humana", name: "Humana, CenterWell (Humana)", tokens: [HUMANA, CENTERWELL] }]);
    expect(r.unresolved).toEqual([]);
  });

  it("folded both sides, and an employer's sub-boards come with it", () => {
    expect(resolveCompanyNames(["pwc"], CATALOGUE, EMPLOYERS).companies).toEqual(["pwc~wd3~a", "pwc~wd3~b"]);
    expect(resolveCompanyNames(["centerwell (humana)"], CATALOGUE, EMPLOYERS).companies).toEqual([CENTERWELL]);
  });

  it("two employers sharing a name are never merged: refused, with both as candidates", () => {
    const r = resolveCompanyNames(["Flex"], CATALOGUE, EMPLOYERS);
    expect(r.companies).toEqual([]);
    expect(r.unresolved).toEqual([{ asked: "Flex", candidates: [{ token: "flex", name: "Flex", open: 9 }, { token: "flextronics~wd1~Careers", name: "Flex", open: 572 }], ambiguous: true }]);
  });

  it("a name that matches nothing is refused with near names, largest first; never a substring merge", () => {
    const r = resolveCompanyNames(["Hum"], CATALOGUE, EMPLOYERS);
    expect(r.companies).toEqual([]);
    expect(r.unresolved[0].candidates.map((c) => c.name)).toEqual(["CenterWell (Humana)", "Humana", "Human Agency"]);
  });

  it("tokens and non-strings pass through for the filter to judge", () => {
    const r = resolveCompanyNames([HUMANA, 7, "Humana"], CATALOGUE, EMPLOYERS);
    expect(r.companies).toEqual([HUMANA, 7, CENTERWELL]);
  });
});

let board: BoardHandler;
beforeAll(async () => {
  board = await bootBoardHandler();
});

/** company-suggest's employer list, as the refresh row holds it. */
function withFacet() {
  board.answer((q: Query) => {
    const isRefresh = q.table === "job_board_meta" && q.calls.some(([m, a]) => m === "eq" && a[0] === "k" && a[1] === "refresh")
      && q.calls.some(([m, a]) => m === "select" && String(a[0]).includes("companiesFacet"));
    if (!isRefresh) return undefined;
    return {
      data: {
        companiesFacet: [
          { token: HUMANA, name: "Humana", count: 300 },
          { token: CENTERWELL, name: "CenterWell (Humana)", count: 900 },
          // The merge recheck: job-board memoises this list, so every test here reads one list.
          { token: "Meta1", name: "Meta", count: 4 },
          { token: "metaline", name: "Metaline", count: 101 },
        ],
        companiesOpen: { [HUMANA]: 243, [CENTERWELL]: 832, Meta1: 4, metaline: 101 },
      },
      error: null,
    };
  });
}

/** Every company scope the request sent to the database. */
function scopesSent(): string[][] {
  const out: string[][] = [];
  for (const q of board.db.queries as Query[]) {
    for (const [m, a] of q.calls) {
      if (m === "rpc") {
        const c = (a[0] as { p_companies?: unknown } | undefined)?.p_companies;
        if (Array.isArray(c)) out.push(c as string[]);
      } else if (m === "in" && a[0] === "company_token") out.push(a[1] as string[]);
    }
  }
  return out;
}

describe("the shipped list resolves a name and names what it could not", () => {
  it('companies:["Humana"] searches Humana\'s boards and says which', async () => {
    board.reset();
    withFacet();
    const r = await board.post({ action: "list", companies: ["Humana"], limit: 10 });
    expect(r.unknownCompanies, JSON.stringify(r).slice(0, 300)).toBeUndefined();
    expect((r.companiesResolved as Array<{ tokens: string[] }>)?.[0]?.tokens).toEqual([HUMANA, CENTERWELL]);
    const scopes = scopesSent();
    expect(scopes.length, "no query was scoped to an employer").toBeGreaterThan(0);
    expect(scopes.every((s) => s.includes(HUMANA) && s.includes(CENTERWELL)), JSON.stringify(scopes)).toBe(true);
  });

  it("a name that resolves to nothing is the empty, named scope, never the whole board", async () => {
    board.reset();
    withFacet();
    const r = await board.post({ action: "list", companies: ["Humana Hospitals Worldwide"], limit: 10 });
    expect(r.unknownCompanies).toEqual(["Humana Hospitals Worldwide"]);
    expect(r.total).toBe(0);
    expect((r.companiesUnresolved as Array<{ asked: string }>)?.[0]?.asked).toBe("Humana Hospitals Worldwide");
    expect(r.ignoredFilters, "a value no token could be is a refused filter value").toContain("companies");
    expect(board.db.queries.some((q: Query) => q.rpc === "search_jobs" || q.table === "job_board_postings"), "the board was searched without the scope").toBe(false);
  });

  // The review of 9fe3bc0d: 300 token-shaped names, forwarded uncapped,
  // were each matched against every employer before any cap.
  it("a body naming 500 employers looks up five, names the rest as not looked up, and searches nothing", async () => {
    board.reset();
    withFacet();
    const names = Array.from({ length: 500 }, (_, i) => `zz-nobody-${i}`);
    const r = await board.post({ action: "list", companies: names, limit: 10 });
    expect((r.companiesUnresolved as Array<{ asked: string }>)?.map((u) => u.asked)).toEqual(names.slice(0, 5));
    expect(r.companiesNotLookedUp).toEqual(names.slice(5));
    expect(r.ignoredFilters).toContain("companies");
    expect(r.total).toBe(0);
    expect(board.db.queries.some((q: Query) => q.rpc === "search_jobs" || q.table === "job_board_postings"), "the board was searched").toBe(false);
  });

  it("a resolved name beside a refused one serves the resolved boards and names the refusal", async () => {
    board.reset();
    withFacet();
    const r = await board.post({ action: "list", companies: ["Humana", "Nowhere Corp"], limit: 10 });
    expect((r.companiesUnresolved as Array<{ asked: string }>)?.map((u) => u.asked)).toEqual(["Nowhere Corp"]);
    expect(r.ignoredFilters, "a dropped value of the filter is named").toContain("companies");
    expect(scopesSent().every((s) => s.includes(HUMANA) && !s.includes("Nowhere Corp"))).toBe(true);
  });
});

/**
 * A BRAND'S NAME IS NOT A FOUR-ROLE STAFFING BOARD'S (the recheck of the
 * merge of main 899be058, 2026-10-25). companies:["Meta"] resolved to the one
 * carried board named exactly "Meta": SmartRecruiters' Meta1, a staffing firm
 * ("My Company support several nationally-known clients"), whose mailroom and
 * reception roles the AI was handed as Meta's openings, agency false on every
 * row. Live main answered that the board does not carry Meta. A single exact
 * match whose boards are all an agency's, or that has fewer than FEW_OPEN open
 * roles, is now offered as a candidate (its open count, vendor and agency
 * flag) and never searched under the name; the catalogue labels Meta1 an
 * agency.
 */
describe("a single exact match that is an agency or a handful of roles is a candidate, not a scope", () => {
  const AGENCY_FACTS = (t: string) => (t === "Meta1" ? { source: "smartrecruiters", agency: true } : t === "surge" ? { source: "workable", agency: true } : { source: "greenhouse", agency: false });
  const LIST: FacetEmployer[] = [
    { token: "Meta1", name: "Meta", open: 4 },
    { token: "metaline", name: "Metaline", open: 101 },
    { token: "metabase", name: "Metabase", open: 2 },
    { token: "surge", name: "Surge Staffing", open: 300 },
    { token: HUMANA, name: "Humana", open: 243 },
  ];
  const CAT = new Set(LIST.map((e) => e.token!));

  it('"Meta" is held: the staffing board is offered with its open count, vendor and agency flag, and nothing is scoped', async () => {
    const { FEW_OPEN } = await import("../../supabase/functions/job-board/company-names");
    const r = resolveCompanyNames(["Meta"], CAT, LIST, undefined, AGENCY_FACTS);
    expect(r.companies).toEqual([]);
    expect(r.resolved).toEqual([]);
    expect(r.unresolved).toEqual([{ asked: "Meta", candidates: [{ token: "Meta1", name: "Meta", open: 4, vendor: "smartrecruiters", agency: true }], held: "agency" }]);
    expect(FEW_OPEN).toBe(10);
  });

  it("an agency's board is held whatever its size; a small employer's board is held as a handful of roles", () => {
    expect(resolveCompanyNames(["Surge Staffing"], CAT, LIST, undefined, AGENCY_FACTS).unresolved[0]).toMatchObject({ held: "agency", candidates: [{ token: "surge", open: 300, agency: true }] });
    expect(resolveCompanyNames(["Metabase"], CAT, LIST, undefined, AGENCY_FACTS).unresolved[0]).toMatchObject({ held: "few_open", candidates: [{ token: "metabase", open: 2, vendor: "greenhouse" }] });
  });

  it("positive control: an employer with its own board of ten or more roles still resolves by name", () => {
    expect(resolveCompanyNames(["Humana"], CAT, LIST, undefined, AGENCY_FACTS).resolved).toEqual([{ asked: "Humana", name: "Humana", tokens: [HUMANA] }]);
    expect(resolveCompanyNames(["Metaline"], CAT, LIST, undefined, AGENCY_FACTS).resolved[0].tokens).toEqual(["metaline"]);
  });

  it("the connector tells the AI what a held name is, with the board's own threshold", async () => {
    const { FEW_OPEN } = await import("../../supabase/functions/job-board/company-names");
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { codeOf } = await import("./helpers/strip-comments");
    const mcp = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8"));
    expect(mcp.match(new RegExp(`staffing agency's board or one with under ${FEW_OPEN} open roles`, "g"))?.length).toBe(2);
  });

  it("the catalogue labels Meta1 a staffing agency, so its cards say so", async () => {
    const { JOB_SOURCES } = await import("../../supabase/functions/job-board/sources");
    expect(JOB_SOURCES.filter((s) => s.token === "Meta1")).toEqual([{ name: "Meta", source: "smartrecruiters", token: "Meta1", agency: true }]);
  });

  it('the shipped list: companies:["Meta"] searches nothing, says the board does not carry Meta, and offers the agency\'s board', async () => {
    board.reset();
    withFacet();
    const r = await board.post({ action: "list", companies: ["Meta"], limit: 10 });
    expect(r.unknownCompanies).toEqual(["Meta"]);
    expect(r.total).toBe(0);
    expect(r.companiesResolved).toBeUndefined();
    expect(r.companiesUnresolved).toEqual([{ asked: "Meta", candidates: [{ token: "Meta1", name: "Meta", open: 4, vendor: "smartrecruiters", agency: true }], held: "agency" }]);
    expect(board.db.queries.some((q: Query) => q.rpc === "search_jobs" || q.table === "job_board_postings"), "the board was searched under the name").toBe(false);
  });
});
