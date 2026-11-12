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
 * One rule, measured on real posting locations (index notes n1460, n1461):
 *   - job-board placeTerms reads "City, ST" with a ZIP, a dotted code or no
 *     comma as the city in that state under every spelling, keeping what was
 *     typed as a term of its own; anything else reads as before.
 * agent-mcp sends the location as typed, as main does, with one exception.
 * Reading a bare country or "remote" as the board's country or remote filter
 * was measured and declined: it lost rows main found (a "Remote TX" row the
 * board stores with remote false), and the answer could not say which
 * (recheck, 2026-11-01; n1461). "City, <country>" is the exception (connect
 * W1, BR-02, 2026-11-08): "London, UK" as typed found 27 software jobs where
 * London in GB found 271, so it is read as the city and the country and the
 * answer says so in locationInterpreted; n1461's cost (a row listing several
 * cities filed under another country's code) is the price, stated there.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { placeTerms } from "../../supabase/functions/job-board/query-place";
import { locationTerms } from "../../supabase/functions/_shared/location-terms";
import * as mcpPlace from "../../supabase/functions/agent-mcp/query-place";
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

describe("agent-mcp reads a location argument only in the shape 'City, <country>'", () => {
  it("query-place's one location reader splits a city from its country and leaves every other place as typed", () => {
    expect(Object.keys(mcpPlace).sort()).toEqual(["placeHint", "placeInQuery", "readLocationArg", "readQuery", "sponsorshipOnly"]);
    for (const typed of ["United States", "remote", "Remote TX", "Austin, TX 78701", "Austin, TX", "Texas", "Berlin, DE"]) {
      expect(mcpPlace.readLocationArg(typed), typed).toBeNull();
    }
    expect(mcpPlace.readLocationArg("London, UK")).toMatchObject({ location: "London", country: "GB" });
  });
});

describe("the server sends the board the location as typed, as main does", () => {
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

  it.each([
    ["United States", "software engineer"],
    ["remote", "nurse"],
    ["Remote TX", "nurse"],
    ["Austin, TX 78701", "nurse"],
  ])("location %s goes to the board as typed, with no country or remote filter added and no locationReadAs", async (location, query) => {
    const sc = await search({ query, location });
    expect(listBody().location).toBe(location);
    expect(listBody().country).toBeUndefined();
    expect(listBody().remote).toBeUndefined();
    expect(sc.locationReadAs).toBeUndefined();
    expect(sc.locationInterpreted).toBeUndefined();
  });

  it.each([
    ["London, UK", "nurse", "London", "GB"],
    ["Toronto, Canada", "manager", "Toronto", "CA"],
  ])("location %s goes to the board as the city and its country, and the answer says so", async (location, query, city, country) => {
    const sc = await search({ query, location });
    expect(listBody().location).toBe(city);
    expect(listBody().country).toBe(country);
    expect(listBody().remote).toBeUndefined();
    expect(sc.locationInterpreted).toMatchObject({ location: city, country, locationSent: location });
  });

  it("the prompts ask for the place as main's prompts do, and never steer a country or remote into a filter", async () => {
    const got = JSON.stringify(await rpc("prompts/get", { name: "browse_jobs", arguments: { what: "nurse", where: "Texas" } }));
    expect(got).not.toMatch(/only a country goes in country/);
    const listed = JSON.stringify(await rpc("prompts/list", {}));
    expect(listed).toMatch(/City, state, country or 'remote'/);
  });
});
