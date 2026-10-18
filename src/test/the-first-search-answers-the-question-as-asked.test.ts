// @vitest-environment node
/**
 * THE FIRST SEARCH ANSWERS THE QUESTION AS ASKED.
 *
 * Measured 2026-10-11 (spec D2 §2.3): "nurse jobs in Texas" sent as the query
 * found 107 of the 1,584 nurse postings the board serves in Texas, because
 * the place was searched as words; "Humana" in companies found nothing,
 * because companies takes a board token. agent-mcp now reads the place out
 * of the query, and says what it read.
 *
 * AN EMPLOYER NAME IS THE BOARD'S TO RESOLVE (sweep S12-080). agent-mcp used
 * to resolve a name itself, only when it did not look like a token: "CVS"
 * matched no exact name and was dropped, so every nurse job on the board came
 * back under CVS's name; "cvs" went to the board as a token, came back as an
 * employer the board does not carry, and read as total 0 because agent-mcp
 * dropped the board's notes (S12-040). The name now goes to job-board as
 * typed, the board's notes come back, and a scope the board could not apply
 * is never answered as the whole board.
 *
 * The rule (agent-mcp/query-place.ts) on positives and the review's
 * negatives, then the server run as shipped with the board faked: what it
 * sends the board, and what it tells the caller.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("a known place at the end of the query moves to the filter", () => {
  it.each([
    ["nurse jobs in Texas", { query: "nurse", location: "Texas" }],
    ["software engineer jobs in new york", { query: "software engineer", location: "new york" }],
    ["data analyst near Austin, TX", { query: "data analyst", location: "Austin, TX" }],
    ["warehouse operative in Ontario", { query: "warehouse operative", location: "Ontario" }],
    ["product manager roles in Germany", { query: "product manager", country: "DE" }],
    ["react developer remote", { query: "react developer", remote: true }],
    ["accountant in the bay area", { query: "accountant", location: "bay area" }],
    ["accountant in bay area", { query: "accountant", location: "bay area" }],
    ["nurse in the city", { query: "nurse in the city" }],
  ])("%s", (q, want) => {
    expect(readQuery(q)).toMatchObject(want);
  });

  it("'City, ST' is kept as written, and the answer says why", () => {
    const r = readQuery("data analyst in Austin, TX");
    expect(r.location).toBe("Austin, TX");
    expect(r.note).toMatch(/kept as written/);
  });

  it("the ambiguous names resolve as documented: Georgia and Washington are the US states; 'Ontario, CA' stays a city in California", () => {
    expect(readQuery("teacher in Georgia")).toMatchObject({ location: "Georgia" });
    expect(readQuery("teacher in Washington")).toMatchObject({ location: "Washington" });
    expect(readQuery("teacher in Ontario, CA")).toMatchObject({ location: "Ontario, CA" });
  });
});

describe("the review's negatives stay titles", () => {
  it.each([
    "Engineer in Training",
    "Head of Growth in Fintech",
    "Sign in specialist",
    "Director of IN programs",
    "Remote Sensing Analyst",
    "remote",
    "jobs in Texas",
  ])("%s", (q) => {
    const r = readQuery(q);
    // Either untouched, or (for "jobs in Texas") the remainder is the bare
    // filler, which is not empty, so the place still moves; never an empty query.
    expect(r.query.length).toBeGreaterThan(0);
    if (q !== "jobs in Texas") expect(r).toEqual({ query: q });
  });

  it("a filter the caller already set is never overwritten", () => {
    expect(readQuery("nurse jobs in Texas", { location: true })).toEqual({ query: "nurse jobs in Texas" });
    expect(readQuery("react developer remote", { remote: true })).toEqual({ query: "react developer remote" });
  });
});

const NURSE = { id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Nurse" };

describe("the server sends the board the search as meant, and says what it read", () => {
  let handler: EdgeHandler;
  let boardBodies: Array<Record<string, unknown>>;
  /** The board's answer to the next list call; a function of the body sent. */
  let listAnswer: (body: Record<string, unknown>) => Record<string, unknown>;
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.fetch = async (url: string, init: { body?: string } = {}) => {
      if (String(url).endsWith("/functions/v1/job-board")) {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        boardBodies.push(body);
        if (body.action === "company-suggest") return new Response(JSON.stringify({ companies: [] }), { status: 200 });
        return new Response(JSON.stringify(listAnswer(body)), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
    g.__mcpDb = {
      rpc: (name: string) => {
        const data = name === "mcp_anon_check_v2"
          ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: 100, share_used: 1, share_cap: 4000, overall_used: 1, overall_cap: 20000, minute_used: 1, minute_cap: 15 }
          : name === "v1_withheld_company_tokens" ? ["acmesr"] : null;
        const r = Promise.resolve({ data, error: null });
        return Object.assign(r, { maybeSingle: () => r, single: () => r });
      },
      from: () => ({}),
    };
    handler = await loadEdgeHandler("agent-mcp", {
      "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
    });
  }, 120_000);
  beforeEach(() => {
    boardBodies = [];
    listAnswer = () => ({ jobs: [], total: 0, ignoredFilters: [] });
  });

  const call = async (args: Record<string, unknown>) => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_jobs", arguments: args } }),
    }));
    return ((await res.json()) as { result: { isError?: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> } }).result;
  };
  const search = async (args: Record<string, unknown>) => (await call(args)).structuredContent ?? {};
  const listBody = () => boardBodies.find((b) => b.action === "list");

  it("'nurse jobs in Texas' searches nurse in Texas, and says so", async () => {
    const sc = await search({ query: "nurse jobs in Texas" });
    expect(listBody()).toMatchObject({ q: "nurse", location: "Texas" });
    expect(sc.locationInterpreted).toMatchObject({ query: "nurse", location: "Texas", from: "in Texas" });
  });

  it("Humana by name goes to the board as typed, and the board's resolution comes back", async () => {
    const resolved = [{ asked: "Humana", name: "Humana", tokens: ["humana~wd5~Humana_External_Career_Site"] }];
    listAnswer = () => ({ jobs: [{ ...NURSE, token: "humana~wd5~Humana_External_Career_Site", company: "Humana" }], total: 1, companiesResolved: resolved });
    const sc = await search({ query: "nurse", companies: "Humana" });
    expect(listBody()!.companies).toEqual(["Humana"]);
    expect(boardBodies.some((b) => b.action === "company-suggest")).toBe(false);
    expect(sc.companiesResolved).toEqual(resolved);
  });

  it("'CVS' and 'cvs' reach the board alike, and neither is the whole board nor a silent 0", async () => {
    const answers: Array<Record<string, unknown>> = [];
    listAnswer = (body) => {
      const asked = String((body.companies as string[])[0]);
      return {
        jobs: [], total: 0, hasMore: false, nextOffset: 0,
        unknownCompanies: [asked],
        companiesUnresolved: [{ asked, candidates: [{ token: "cvshealth", name: "CVS Health", open: 4100 }] }],
        ignoredFilters: [],
      };
    };
    for (const spelling of ["CVS", "cvs"]) {
      boardBodies = [];
      const sc = await search({ query: "nurse", companies: spelling });
      expect(listBody()!.companies, spelling).toEqual([spelling]);
      expect(sc.jobs, spelling).toEqual([]);
      expect(sc.unknownCompanies, spelling).toEqual([spelling]);
      expect(sc.companiesUnresolved, spelling).toEqual([{ asked: spelling, candidates: [{ token: "cvshealth", name: "CVS Health", open: 4100 }] }]);
      answers.push(sc);
    }
    expect(answers.map((a) => (a.companiesUnresolved as Array<{ candidates: unknown }>)[0].candidates)).toEqual([
      [{ token: "cvshealth", name: "CVS Health", open: 4100 }], [{ token: "cvshealth", name: "CVS Health", open: 4100 }],
    ]);
  });

  it("a scope the board could not apply is answered with nothing, never with every employer's rows", async () => {
    // A job-board older than .93 meeting a name: it names `companies` ignored and serves the whole board.
    listAnswer = () => ({ jobs: [NURSE], total: 52000, hasMore: true, nextOffset: 10, ignoredFilters: ["companies"] });
    const sc = await search({ query: "nurse", companies: "Best Buy" });
    expect(sc.jobs).toEqual([]);
    expect(sc.total).toBeUndefined();
    expect(sc.countUnavailable).toBe(true);
    expect((sc.ignoredFilters as string[]).join(" ")).toMatch(/could not apply "Best Buy", so nothing was searched rather than every employer/);
  });

  it("a scope the board applied, with a name it refused beside a carried token, keeps the rows and the notes", async () => {
    listAnswer = () => ({
      jobs: [NURSE], total: 3, ignoredFilters: ["companies"],
      companiesUnresolved: [{ asked: "Nobody Corp", candidates: [] }],
    });
    const sc = await search({ query: "nurse", companies: "acme,Nobody Corp" });
    expect(listBody()!.companies).toEqual(["acme", "Nobody Corp"]);
    expect((sc.jobs as unknown[]).length).toBe(1);
    expect(sc.companiesUnresolved).toEqual([{ asked: "Nobody Corp", candidates: [] }]);
  });

  it("an entry with no letter or digit is an argument error, sent nowhere", async () => {
    const r = await call({ query: "nurse", companies: "acme, ---" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not an employer name or token/);
    expect(boardBodies).toHaveLength(0);
  });

  it("a capped count and a fallen-back ranking are said, and the board's error text is not (S12-041)", async () => {
    listAnswer = () => ({ jobs: [NURSE], total: 10000, countCapped: true, rankedFellBack: "57014: canceling statement due to statement timeout", hasMore: true, nextOffset: 10 });
    const sc = await search({ query: "nurse" });
    expect(sc.total).toBe(10000);
    expect(sc.countCapped).toBe(true);
    expect(sc.rankedFellBack).toBe(true);
    expect(JSON.stringify(sc)).not.toMatch(/57014|canceling statement/);
  });
});

describe("the schema an agent reads says what the count is (S12-041)", () => {
  const MCP = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8"));
  const schema = MCP.slice(MCP.indexOf("const DISCLOSURE_SCHEMA = {"), MCP.indexOf("\n};", MCP.indexOf("const DISCLOSURE_SCHEMA = {")));

  it("total is not called exact, countCapped and rankedFellBack are declared, and the employer notes are", () => {
    expect(schema).not.toMatch(/Exact match count/);
    expect(schema).toMatch(/total: \{ type: \["integer", "null"\], description: "[^"]*countCapped[^"]*"/);
    for (const k of ["countCapped", "rankedFellBack", "unknownCompanies", "companiesUnresolved", "companiesNotLookedUp", "companiesResolved"]) {
      expect(schema, k).toMatch(new RegExp(`\\b${k}: \\{ type:`));
    }
  });

  it("disclosures() passes every one of them on", () => {
    const fn = MCP.slice(MCP.indexOf("function disclosures("), MCP.indexOf("const SEARCH_PROPERTIES"));
    for (const k of ["countCapped", "unknownCompanies", "companiesResolved", "companiesUnresolved", "companiesNotLookedUp"]) expect(fn, k).toContain(`"${k}"`);
    expect(fn).toMatch(/if \(r\.rankedFellBack\) out\.rankedFellBack = true;/);
  });
});
