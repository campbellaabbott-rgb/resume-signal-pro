// @vitest-environment node
/**
 * THE FIRST SEARCH ANSWERS THE QUESTION AS ASKED.
 *
 * Measured 2026-10-11 (spec D2 §2.3): "nurse jobs in Texas" sent as the query
 * found 107 of the 1,584 nurse postings the board serves in Texas, because
 * the place was searched as words; "Humana" in companies found nothing,
 * because companies takes a board token. agent-mcp now reads the place out
 * of the query and resolves a company name through job-board's
 * company-suggest, and says what it read.
 *
 * The rule (agent-mcp/query-place.ts) on positives and the review's
 * negatives, then the server run as shipped with the board faked: what it
 * sends the board, and what it tells the caller.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { foldName, looksLikeToken, pickCompany, readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

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

describe("a company name resolves to its board, or is named as ignored", () => {
  const candidates = [
    { token: "humana~wd5~Humana_External_Career_Site", name: "Humana", open: 812 },
    { token: "centerwell", name: "CenterWell Senior Primary Care", open: 90 },
  ];
  it("an exact name, folded, resolves; a parenthesised qualifier is the same employer", () => {
    expect(pickCompany("humana", candidates)).toEqual({ name: "Humana", tokens: ["humana~wd5~Humana_External_Career_Site"] });
    expect(pickCompany("Domino's", [{ token: "dominos", name: "Dominos (US)" }])).toEqual({ name: "Dominos", tokens: ["dominos"] });
    expect(foldName("Domino's")).toBe(foldName("dominos"));
  });
  it("a name that is only part of another employer's never merges them", () => {
    expect(pickCompany("Center", candidates)).toEqual({ candidates: ["Humana", "CenterWell Senior Primary Care"] });
  });
  it("a token is not a name", () => {
    expect(looksLikeToken("humana~wd5~Humana_External_Career_Site")).toBe(true);
    expect(looksLikeToken("acme")).toBe(true);
    expect(looksLikeToken("Humana")).toBe(false);
    expect(looksLikeToken("Best Buy")).toBe(false);
  });
});

describe("the server sends the board the search as meant, and says what it read", () => {
  let handler: EdgeHandler;
  let boardBodies: Array<Record<string, unknown>>;
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.fetch = async (url: string, init: { body?: string } = {}) => {
      if (String(url).endsWith("/functions/v1/job-board")) {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        boardBodies.push(body);
        if (body.action === "company-suggest") {
          return new Response(JSON.stringify({ companies: String(body.q).includes("humana") ? [{ token: "humana~wd5~Humana_External_Career_Site", name: "Humana", open: 812 }] : [{ token: "acme", name: "Acme Widgets" }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ jobs: [], total: 0, ignoredFilters: [] }), { status: 200 });
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
  beforeEach(() => { boardBodies = []; });

  const search = async (args: Record<string, unknown>) => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_jobs", arguments: args } }),
    }));
    return ((await res.json()) as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
  };

  it("'nurse jobs in Texas' searches nurse in Texas, and says so", async () => {
    const sc = await search({ query: "nurse jobs in Texas" });
    const list = boardBodies.find((b) => b.action === "list")!;
    expect(list).toMatchObject({ q: "nurse", location: "Texas" });
    expect(sc.locationInterpreted).toMatchObject({ query: "nurse", location: "Texas", from: "in Texas" });
  });

  it("Humana by name scopes the search to Humana's board, and says which", async () => {
    const sc = await search({ query: "nurse", companies: "Humana" });
    expect(boardBodies.find((b) => b.action === "list")).toMatchObject({ companies: ["humana~wd5~Humana_External_Career_Site"] });
    expect(sc.companiesResolved).toEqual([{ asked: "Humana", name: "Humana", tokens: ["humana~wd5~Humana_External_Career_Site"] }]);
  });

  it("a company the board does not carry is named in ignoredFilters with its closest candidates, never merged", async () => {
    const sc = await search({ query: "nurse", companies: "Nonexistent Corp" });
    expect(boardBodies.find((b) => b.action === "list")!.companies).toBeUndefined();
    expect((sc.ignoredFilters as string[]).join(" ")).toMatch(/"Nonexistent Corp" matched no employer by name \(closest: Acme Widgets\)/);
  });
});
