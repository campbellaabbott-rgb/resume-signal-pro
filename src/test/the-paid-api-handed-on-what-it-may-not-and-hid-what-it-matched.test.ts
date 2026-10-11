// @vitest-environment node
/**
 * The paid /v1 API, run as shipped with only its network faked.
 *
 *  - OWNER DECISION 4 (2026-10-08): SmartRecruiters postings are withheld from
 *    /v1 until SmartRecruiters (SAP) grants permission, as the federal feed is.
 *    /v1 handed their rows on, and listed their employers in /v1/companies.
 *  - S8-029: engine=ranked never sent groupSimilar:false, so the board folded
 *    an employer's same-title postings into one card and skipped the siblings.
 *  - S8-077: the ranked total published the title count only, and no row said
 *    whether it matched by title or by description.
 *  - S8-078: employment_type was a raw case-sensitive equality, an empty
 *    max_years bound min_years <= 0, an empty max_age_days was a 400, and the
 *    ranked engine served remote=false and remote=1 as no filter at all.
 *  - L13-01 on /v1: a state-code location (", DE") was a plain substring, so
 *    Delaware matched "Berlin, DE"; the board binds it at a boundary on a
 *    US, Canadian or unplaced row since .91.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

type Call = [string, unknown[]];
type Chain = { table: string; calls: Call[] };

let handler: EdgeHandler;
let chains: Chain[];
let rpcs: Array<{ name: string; args: unknown }>;
let boardBodies: Array<Record<string, unknown>>;
let boardAnswer: Record<string, unknown>;
let withheld: string[] | null;
let facet: Record<string, unknown> | null;

/** A PostgREST builder that records every call and answers `result` when awaited. */
function chain(table: string, result: unknown): unknown {
  const rec: Chain = { table, calls: [] };
  chains.push(rec);
  const p: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(result).then(ok, no);
      if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(result);
      return (...args: unknown[]) => { rec.calls.push([String(prop), args]); return p; };
    },
  });
  return p;
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      boardBodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(boardAnswer), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  handler = await loadEdgeHandler("public-api", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__apiDb; }",
  });
}, 120_000);

beforeEach(() => {
  chains = []; rpcs = []; boardBodies = [];
  withheld = ["acme-sr"];
  facet = null;
  boardAnswer = {
    jobs: [
      { id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Kubernetes Engineer", matchScope: "title" },
      { id: "greenhouse:acme:2", source: "greenhouse", token: "acme", company: "Acme", title: "Platform Engineer", matchScope: "description" },
      { id: "smartrecruiters:acme-sr:9", source: "smartrecruiters", token: "acme-sr", company: "Acme SR", title: "Kubernetes Engineer", matchScope: "title" },
    ],
    total: 141, relatedTotal: 2859, hasMore: true, nextOffset: 20,
  };
  (globalThis as Record<string, unknown>).__apiDb = {
    rpc: (name: string, args: unknown) => {
      rpcs.push({ name, args });
      const data = name === "api_key_check"
        ? { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "pro", rate_limit: 60, rate_used: 1, quota_limit: 10000, quota_used: 1 }
        : name === "v1_withheld_company_tokens" ? withheld : null;
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r });
    },
    from: (t: string) => chain(t, t === "job_board_meta"
      ? { data: facet, error: null }
      : { data: [], error: null, count: 0 }),
  };
});

const get = async (path: string) => {
  const res = await handler(new Request(`https://harness.supabase.co/functions/v1/public-api${path}`, { headers: { authorization: "Bearer rb_live_harness_key_0123456789" } }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const postingsCalls = () => chains.filter((c) => c.table === "job_board_postings").flatMap((c) => c.calls);

describe("SmartRecruiters is withheld from /v1 until permission", () => {
  it("the ranked engine drops its rows", async () => {
    const { status, body } = await get("/v1/jobs?engine=ranked&q=kubernetes");
    expect(status).toBe(200);
    const sources = (body.data as Array<{ source: string }>).map((r) => r.source);
    expect(sources).not.toContain("smartrecruiters");
    expect((body.disclosures as { excludedSources: { sources: string[] } }).excludedSources.sources).toContain("smartrecruiters");
  });

  it("the default engine binds it out in SQL", async () => {
    await get("/v1/jobs?q=kubernetes");
    const notIn = postingsCalls().filter(([m, a]) => m === "not" && a[0] === "source").map(([, a]) => String(a[2]));
    expect(notIn.length).toBeGreaterThan(0);
    for (const v of notIn) expect(v).toContain("smartrecruiters");
  });

  it("naming it, or one of its employers, is a 451 and not an empty page", async () => {
    expect((await get("/v1/jobs?source=smartrecruiters")).status).toBe(451);
    expect((await get("/v1/jobs?company_token=acme-sr")).status).toBe(451);
    expect((await get("/v1/jobs?company_token=acme")).status).toBe(200);
  });

  it("/v1/companies does not list its employers", async () => {
    facet = { v: { companiesFacet: [{ token: "acme", name: "Acme", count: 3 }, { token: "acme-sr", name: "Acme SR", count: 9 }], companiesOpen: { acme: 2, "acme-sr": 7 } }, updated_at: "2026-10-09T00:00:00Z" };
    const { status, body } = await get("/v1/companies");
    expect(status).toBe(200);
    expect((body.data as Array<{ company_token: string }>).map((c) => c.company_token)).toEqual(["acme"]);
  });
});

describe("engine=ranked returns every posting and says what it matched", () => {
  it("asks the board not to fold sibling postings into one card", async () => {
    await get("/v1/jobs?engine=ranked&q=cashier");
    expect(boardBodies[0]).toMatchObject({ groupSimilar: false });
  });

  it("publishes the description-match total beside the title one, and each row's scope", async () => {
    const { body } = await get("/v1/jobs?engine=ranked&q=kubernetes");
    expect(body.total).toMatchObject({ value: 141, related: 2859 });
    expect((body.data as Array<{ match_scope: string }>).map((r) => r.match_scope)).toEqual(["title", "description"]);
  });
});

describe("the parameters mean the same on both engines", () => {
  it("refuses remote=false and a non-boolean on the ranked engine instead of serving no filter", async () => {
    expect((await get("/v1/jobs?engine=ranked&remote=false")).status).toBe(400);
    expect((await get("/v1/jobs?engine=ranked&remote=1")).status).toBe(400);
    expect((await get("/v1/jobs?engine=ranked&has_stated_pay=yes")).status).toBe(400);
    expect((await get("/v1/jobs?engine=ranked&remote=true")).status).toBe(200);
  });

  it("employment_type is a closed, case-folded list on both engines", async () => {
    expect((await get("/v1/jobs?employment_type=bogus")).status).toBe(400);
    await get("/v1/jobs?employment_type=Full_Time,part_time");
    expect(postingsCalls().some(([m, a]) => m === "in" && a[0] === "employment_type" && JSON.stringify(a[1]) === JSON.stringify(["full_time", "part_time"]))).toBe(true);
    await get("/v1/jobs?engine=ranked&employment_type=Full_Time");
    expect(boardBodies.at(-1)).toMatchObject({ employmentType: "full_time" });
  });

  it("an empty max_years or max_age_days is unset, not zero and not a 400", async () => {
    const { status } = await get("/v1/jobs?max_years=&max_age_days=");
    expect(status).toBe(200);
    expect(postingsCalls().some(([m, a]) => m === "lte" && a[0] === "min_years")).toBe(false);
  });

  it("a state code binds at a boundary on a US/CA row, as the board binds it", async () => {
    await get("/v1/jobs?location=oregon");
    const or = postingsCalls().filter(([m]) => m === "or").map(([, a]) => String(a[0])).join(" ");
    expect(or).toContain('location.match.", OR($|[^A-Za-z])"');
    expect(or).toContain("country.in.(US,CA)");
  });
});

// Review of S11-021 on /v1: .92's ingest stores every location with the ASCII
// apostrophe, and only the board's list action folded what was typed. /v1's
// own location filter sent a phone's "St. John’s" as typed, which would match
// nothing once the rows were folded (live .91: 0 against 101).
describe("a phone's apostrophe on /v1 is the board's apostrophe", () => {
  it("the default engine's location filter carries the ASCII apostrophe the rows carry", async () => {
    await get(`/v1/jobs?location=${encodeURIComponent("St. John’s")}`);
    const loc = postingsCalls().filter(([m, a]) => m === "ilike" && a[0] === "location").map(([, a]) => String(a[1]));
    expect(loc.length).toBeGreaterThan(0);
    expect([...new Set(loc)]).toEqual(["%St. John's%"]);
  });

  it("the shared location terms fold it, so /v1 and the board send one string", async () => {
    const { locationTerms } = await import("../../supabase/functions/_shared/location-terms");
    const { foldTypedText } = await import("../../supabase/functions/job-board/typed-text");
    for (const typed of ["St. John’s", "Coeur d‘Alene", "Martha＇s Vineyard", "Kaʼu"]) {
      expect(locationTerms(typed).terms).toEqual([foldTypedText({ location: typed }).location]);
    }
  });
});
