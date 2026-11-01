// @vitest-environment node
/**
 * A LOCATION THE MODEL TYPES IS SEARCHED AS THE PLACE IT NAMES (S9-002).
 *
 * A person's AI puts the whole place in search_jobs' location, and the board
 * matched it as one substring of the posting's location. Live 2026-11-01, q
 * "software engineer": "Austin, TX 78701" 0 (Austin, TX: 96), "Austin TX" 0,
 * "New York NY" 0 (New York, NY: 204), "Washington DC" 9 (Washington, DC: 22),
 * "United States" 1,959 of the 6,550 the board files in the US, "remote" 1,123
 * of the 1,953 it marks remote. Nothing in the answer said the place was read
 * literally.
 *
 * Two rules, measured on real posting locations (index notes n1460, n1461):
 *   - job-board placeTerms reads "City, ST" with a ZIP, a dotted code or no
 *     comma as the city in that state under every spelling, keeping what was
 *     typed as a term of its own; anything else reads as before;
 *   - agent-mcp reads a location that is only a country, only remote (or
 *     remote and a country), or "City, Country" as that filter, and says so
 *     in locationReadAs. A filter the caller set itself is never contradicted.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTRY_NAMES, placeTerms } from "../../supabase/functions/job-board/query-place";
import { locationTerms } from "../../supabase/functions/_shared/location-terms";
import { LOCATION_COUNTRIES, readLocation } from "../../supabase/functions/agent-mcp/query-place";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("job-board: 'City, ST' however the model types it is the city in that state", () => {
  it.each([
    ["Austin, TX 78701", ["Austin, TX", "Austin, Texas", "Austin,TX"]],
    ["Salt Lake City, UT 84101", ["Salt Lake City, UT", "Salt Lake City, Utah", "Salt Lake City,UT"]],
    ["Austin TX", ["Austin, TX", "Austin, Texas", "Austin,TX", "Austin TX"]],
    ["New York NY", ["New York, NY", "New York, New York", "New York,NY", "New York NY"]],
    ["Washington DC", ["Washington, DC", "Washington, District of Columbia", "Washington,DC", "Washington DC"]],
    ["Washington, D.C.", ["Washington, DC", "Washington, District of Columbia", "Washington,DC", "Washington, D.C."]],
    ["Seattle WA 98101", ["Seattle, WA", "Seattle, Washington", "Seattle,WA", "Seattle WA 98101"]],
    ["Carson City Nevada", ["Carson City, NV", "Carson City, Nevada", "Carson City,NV", "Carson City Nevada"]],
  ])("%s", (typed, terms) => {
    expect(placeTerms(typed)).toEqual({ terms, expandedFrom: typed });
  });

  it("what was typed stays a term unless a generated spelling already holds it", () => {
    for (const typed of ["Austin TX", "Washington DC", "New York NY", "Seattle WA 98101"]) {
      expect(placeTerms(typed).terms, typed).toContain(typed);
    }
    expect(placeTerms("Austin, TX").terms).toEqual(["Austin, TX", "Austin, Texas", "Austin,TX"]);
  });

  it.each([
    "Colorado or Utah",
    "austin tx",
    "Remote US",
    "Kansas City",
    "New York",
    "Texas",
    "Austin",
    "Berlin, Germany",
    "remote",
    "Greater Boston Area",
  ])("%s reads exactly as the shared aliases do", (typed) => {
    expect(placeTerms(typed)).toEqual(locationTerms(typed));
  });
});

describe("agent-mcp: a location that names a country or remote is that filter", () => {
  it.each([
    ["United States", { country: "US" }],
    ["USA", { country: "US" }],
    ["India", { country: "IN" }],
    ["UK", { country: "GB" }],
    ["remote", { remote: true }],
    ["Anywhere", { remote: true }],
    ["fully remote", { remote: true }],
    ["Remote US", { remote: true, country: "US" }],
    ["Remote - Australia", { remote: true, country: "AU" }],
    ["France, Remote", { remote: true, country: "FR" }],
    ["London, UK", { location: "London", country: "GB" }],
    ["Berlin, Germany", { location: "Berlin", country: "DE" }],
    ["Toronto, Canada", { location: "Toronto", country: "CA" }],
  ])("%s", (sent, want) => {
    expect(readLocation(sent)).toEqual({ sent, ...want });
  });

  it.each([
    "New Mexico",
    "Indiana",
    "Texas",
    "Georgia",
    "New York",
    "Austin, TX",
    "London, UK; Dublin, Ireland",
    "Remote, Austin, TX",
    ", US",
    "Berlin",
  ])("%s goes to the board as sent", (sent) => {
    expect(readLocation(sent)).toBeNull();
  });

  it("a filter the caller set is never contradicted", () => {
    expect(readLocation("United States", { country: "GB" })).toBeNull();
    expect(readLocation("remote", { remote: false })).toBeNull();
    expect(readLocation("remote", { workMode: "hybrid" })).toBeNull();
    // Inside the caller's own list, the country named is the intersection of the two.
    expect(readLocation("United States", { country: "US" })).toEqual({ sent: "United States", country: "US" });
    expect(readLocation("London, UK", { country: "gb,us" })).toEqual({ sent: "London, UK", location: "London", country: "GB" });
  });

  it("names a country exactly as job-board's country table does", () => {
    expect(LOCATION_COUNTRIES).toEqual(COUNTRY_NAMES);
  });
});

describe("the server sends the board the place as meant, and says what it read", () => {
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
        return new Response(JSON.stringify({ jobs: [], total: 0, ignoredFilters: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
    g.__mcpDb = {
      rpc: (name: string) => {
        const data = name === "mcp_anon_check_v2"
          ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: 100, share_used: 1, share_cap: 4000, overall_used: 1, overall_cap: 20000, minute_used: 1, minute_cap: 15 }
          : null;
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

  const rpc = async (method: string, params: Record<string, unknown>) => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }));
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  };
  const search = async (args: Record<string, unknown>) =>
    ((await rpc("tools/call", { name: "search_jobs", arguments: args })).structuredContent ?? {}) as Record<string, unknown>;
  const listBody = () => boardBodies.find((b) => b.action === "list")!;

  it("'United States' searches the US country filter, not the words", async () => {
    const sc = await search({ query: "software engineer", location: "United States" });
    expect(listBody()).toMatchObject({ q: "software engineer", country: "US" });
    expect(listBody().location).toBeUndefined();
    expect(sc.locationReadAs).toEqual({ sent: "United States", country: "US" });
  });

  it("'remote' is the remote filter; 'London, UK' is London in GB", async () => {
    await search({ query: "nurse", location: "remote" });
    expect(listBody()).toMatchObject({ remote: true });
    expect(listBody().location).toBeUndefined();
    boardBodies = [];
    const sc = await search({ query: "nurse", location: "London, UK" });
    expect(listBody()).toMatchObject({ location: "London", country: "GB" });
    expect(sc.locationReadAs).toEqual({ sent: "London, UK", location: "London", country: "GB" });
  });

  it("a place the board reads itself, or one the caller's filters contradict, goes as sent and is not disclosed", async () => {
    for (const args of [
      { query: "nurse", location: "Austin, TX 78701" },
      { query: "nurse", location: "Texas" },
      { query: "nurse", location: "United States", country: "GB" },
      { query: "nurse", location: "remote", remote: false },
    ]) {
      boardBodies = [];
      const sc = await search(args);
      expect(listBody().location, JSON.stringify(args)).toBe(args.location);
      expect(sc.locationReadAs, JSON.stringify(args)).toBeUndefined();
    }
  });

  it("the prompts ask for a country and remote in their own arguments", async () => {
    const got = await rpc("prompts/get", { name: "browse_jobs", arguments: { what: "nurse", where: "Texas" } });
    const text = JSON.stringify(got);
    expect(text).toMatch(/only a country goes in country as its ISO-2 code/);
    const listed = JSON.stringify(await rpc("prompts/list", {}));
    expect(listed).not.toMatch(/City, state, country or 'remote'/);
  });
});
