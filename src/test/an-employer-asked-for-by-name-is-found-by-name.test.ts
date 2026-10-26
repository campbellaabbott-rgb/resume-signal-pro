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
          // Recheck 3: an employer's own board the catalogue had labelled an agency's.
          { token: "jobs.statefarm.com", name: "State Farm", count: 104 },
        ],
        companiesOpen: { [HUMANA]: 243, [CENTERWELL]: 832, Meta1: 4, metaline: 101, "jobs.statefarm.com": 104 },
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
 * reception roles the AI was handed as Meta's openings. A single exact match
 * with fewer than FEW_OPEN open roles is now offered as a candidate (its open
 * count, vendor and agency flag) and never searched under the name.
 *
 * AN EMPLOYER WE CARRY IS NEVER NAMED AS ONE WE DO NOT (recheck 3,
 * 2026-10-26). The first form of that hold also held every board labelled a
 * staffing agency's, whatever its size, and named it in unknownCompanies,
 * which the connector defines as an employer this board does not carry. The
 * catalogue labels some real employers' own boards as agencies (State Farm's,
 * 104 open; Principal Financial Group's, 108), and real agencies are carried
 * too (Surge Staffing, 303 open), so the AI told seekers each one was not on
 * the board. Main never said so. The agency test is gone: FEW_OPEN alone
 * holds Meta1, a held board is never in unknownCompanies, and the employers'
 * own boards lose the wrong label.
 */
describe("a single exact match with a handful of roles is a candidate, not a scope; an employer we carry is never uncarried", () => {
  const AGENCY_FACTS = (t: string) => (t === "Meta1" ? { source: "smartrecruiters", agency: true } : t === "surge" ? { source: "breezy", agency: true } : { source: "greenhouse", agency: false });
  const LIST: FacetEmployer[] = [
    { token: "Meta1", name: "Meta", open: 4 },
    { token: "metaline", name: "Metaline", open: 101 },
    { token: "metabase", name: "Metabase", open: 2 },
    { token: "surge", name: "Surge Staffing", open: 303 },
    { token: HUMANA, name: "Humana", open: 243 },
  ];
  const CAT = new Set(LIST.map((e) => e.token!));

  it('"Meta" is held as a handful of roles: the staffing board is offered with its open count, vendor and agency flag, and nothing is scoped', async () => {
    const { FEW_OPEN } = await import("../../supabase/functions/job-board/company-names");
    const r = resolveCompanyNames(["Meta"], CAT, LIST, undefined, AGENCY_FACTS);
    expect(r.companies).toEqual([]);
    expect(r.resolved).toEqual([]);
    expect(r.unresolved).toEqual([{ asked: "Meta", candidates: [{ token: "Meta1", name: "Meta", open: 4, vendor: "smartrecruiters", agency: true }], held: "few_open" }]);
    expect(FEW_OPEN).toBe(10);
  });

  it("an agency's own board of ten or more roles resolves by its name like any employer's", () => {
    expect(resolveCompanyNames(["Surge Staffing"], CAT, LIST, undefined, AGENCY_FACTS).resolved).toEqual([{ asked: "Surge Staffing", name: "Surge Staffing", tokens: ["surge"] }]);
    expect(resolveCompanyNames(["Metabase"], CAT, LIST, undefined, AGENCY_FACTS).unresolved[0]).toMatchObject({ held: "few_open", candidates: [{ token: "metabase", open: 2, vendor: "greenhouse" }] });
  });

  it("positive control: an employer with its own board of ten or more roles still resolves by name", () => {
    expect(resolveCompanyNames(["Humana"], CAT, LIST, undefined, AGENCY_FACTS).resolved).toEqual([{ asked: "Humana", name: "Humana", tokens: [HUMANA] }]);
    expect(resolveCompanyNames(["Metaline"], CAT, LIST, undefined, AGENCY_FACTS).resolved[0].tokens).toEqual(["metaline"]);
  });

  // The recheck's names, with the open counts live company-suggest gave on
  // 2026-10-26 and the catalogue's own facts for each board.
  it("State Farm, Principal Financial Group, Goodwill of Colorado and Surge Staffing, asked for by name, resolve to their own boards", async () => {
    const { JOB_SOURCES } = await import("../../supabase/functions/job-board/sources");
    const facts = (t: string) => JOB_SOURCES.find((s) => s.token === t);
    const live: FacetEmployer[] = [
      { token: "jobs.statefarm.com", name: "State Farm", open: 104 },
      { token: "copperstatefarms", name: "Copperstate Farms", open: 11 },
      { token: "careers.principal.com", name: "Principal Financial Group", open: 108 },
      { token: "recruiting2~DIS1007~08caf206-1236-731a-787b-c3376bc8c99f", name: "Goodwill of Colorado", open: 152 },
      { token: "surge", name: "Surge Staffing", open: 303 },
      { token: "liquidpersonnel", name: "Liquid Personnel", open: 151 },
    ];
    const cat = new Set(JOB_SOURCES.map((s) => s.token));
    for (const [name, token] of [["State Farm", "jobs.statefarm.com"], ["Principal Financial Group", "careers.principal.com"], ["Goodwill of Colorado", "recruiting2~DIS1007~08caf206-1236-731a-787b-c3376bc8c99f"], ["Surge Staffing", "surge"], ["Liquid Personnel", "liquidpersonnel"]]) {
      const r = resolveCompanyNames([name], cat, live, undefined, facts);
      expect(r.unresolved, name).toEqual([]);
      expect(r.resolved, name).toEqual([{ asked: name, name, tokens: [token] }]);
    }
  });

  it("the catalogue does not label an employer's own board a staffing agency's", async () => {
    const { JOB_SOURCES } = await import("../../supabase/functions/job-board/sources");
    const OWN_BOARDS = [
      "jobs.statefarm.com", "careers.principal.com", "recruiting2~DIS1007~08caf206-1236-731a-787b-c3376bc8c99f",
      "fa-ewqq-saasfaprod1~ocs~CX_1", "fa-evxn-saasfaukgovprod1~ocs~CX_1001", "fa-evxn-saasfaukgovprod1~ocs~CX_1", "fa-exux-saasfaprod1~ocs~CX_1",
      "fa-evlo-saasfaprod1~ocs~CX_1", "fa-evlo-saasfaprod1~ocs~CX_1001", "fa-evlo-saasfaprod1~ocs~CX_2", "ejgo~em2~CX_1",
      "recruiting2~CAL1001CALA~46b96419-fba6-4dd0-a5fa-715bdfcf845b",
    ];
    for (const t of OWN_BOARDS) {
      const rows = JOB_SOURCES.filter((s) => s.token === t);
      expect(rows.length, t).toBe(1);
      expect(rows[0].agency, `${t} (${rows[0].name})`).toBeUndefined();
    }
    // Positive control: real agencies keep the label.
    for (const t of ["surge", "liquidpersonnel", "gotham-enterprises", "Meta1", "careers.ctg.com", "ehnn~us2~CX_1"]) expect(JOB_SOURCES.find((s) => s.token === t)?.agency, t).toBe(true);
  });

  it("the agency tagger never puts the label back on those boards", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const tagger = resolve(__dirname, "../../scripts/tag-agencies.mjs");
    const out = execFileSync("node", [tagger, "--dry-run"], { cwd: resolve(__dirname, "../.."), encoding: "utf8" });
    expect(out).toMatch(/^tagged 0 boards/m);
    const convictions = /const RELEASED_CONVICTIONS = new Set\(\[([\s\S]*?)\]\);/.exec(readFileSync(tagger, "utf8"))?.[1] ?? "";
    expect(convictions).toMatch(/"icims:careers\.ctg\.com"/);
    expect(convictions).not.toMatch(/statefarm|principal/);
  });

  it("the connector tells the AI what a held name is, with the board's own threshold, and never calls a carried employer uncarried", async () => {
    const { FEW_OPEN } = await import("../../supabase/functions/job-board/company-names");
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { codeOf } = await import("./helpers/strip-comments");
    const mcp = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8"));
    expect(mcp.match(new RegExp(`only a board with under ${FEW_OPEN} open roles`, "g"))?.length).toBe(2);
    expect(mcp).not.toMatch(/staffing agency's board or one with under/);
  });

  it("the catalogue labels Meta1 a staffing agency, so its cards say so", async () => {
    const { JOB_SOURCES } = await import("../../supabase/functions/job-board/sources");
    expect(JOB_SOURCES.filter((s) => s.token === "Meta1")).toEqual([{ name: "Meta", source: "smartrecruiters", token: "Meta1", agency: true }]);
  });

  it('the shipped list: companies:["Meta"] searches nothing, names nothing uncarried, and offers the small board', async () => {
    board.reset();
    withFacet();
    const r = await board.post({ action: "list", companies: ["Meta"], limit: 10 });
    expect(r.unknownCompanies ?? []).not.toContain("Meta");
    expect(r.total).toBe(0);
    expect(r.companiesResolved).toBeUndefined();
    expect(r.companiesUnresolved).toEqual([{ asked: "Meta", candidates: [{ token: "Meta1", name: "Meta", open: 4, vendor: "smartrecruiters", agency: true }], held: "few_open" }]);
    expect(board.db.queries.some((q: Query) => q.rpc === "search_jobs" || q.table === "job_board_postings"), "the board was searched under the name").toBe(false);
  });

  it('the shipped list: companies:["State Farm"] searches State Farm\'s own board and never says the board does not carry it', async () => {
    board.reset();
    withFacet();
    const r = await board.post({ action: "list", companies: ["State Farm"], limit: 10 });
    expect(r.unknownCompanies, JSON.stringify(r).slice(0, 300)).toBeUndefined();
    expect(r.companiesUnresolved).toBeUndefined();
    expect((r.companiesResolved as Array<{ tokens: string[] }>)?.[0]?.tokens).toEqual(["jobs.statefarm.com"]);
    const scopes = scopesSent();
    expect(scopes.length, "no query was scoped to the employer").toBeGreaterThan(0);
    expect(scopes.every((s) => s.includes("jobs.statefarm.com")), JSON.stringify(scopes)).toBe(true);
  });
});
