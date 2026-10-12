// @vitest-environment node
/**
 * /v1 SAYS WHEN THE EMPLOYER'S FEED LAST LISTED A POSTING, AND NAMES AN
 * EMPLOYER IT HAS NEVER READ.
 *
 * Sweep S12-121: /v1 published `last_seen`, which job-board writes once, at
 * insert, and never again, so it was the discovery time. A customer filtering
 * on it for freshness dropped every long-lived posting that is still live.
 * Every job object now carries `last_verified_at`, the board's verification
 * stamp for the posting's feed (its own board key on a shared token), and
 * `last_seen` holds the same value; null when no stamp is known, never the
 * insert time.
 *
 * Sweep S12-040: the ranked engine dropped the board's unknownCompanies, and
 * the default engine answered an empty 200 for a company_token the board has
 * never read, so an employer we do not carry read as one with no openings.
 *
 * The shipped handler with only its database faked, and the module it uses.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { codeOf } from "./helpers/strip-comments";
import { attachLastVerified, neverReadTokens } from "../../supabase/functions/public-api/last-verified";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const INSERTED = "2026-08-01T00:00:00.000Z";
const VERIFIED = "2026-10-12T09:55:00.000Z";
const TWIN_VERIFIED = "2026-10-12T09:59:00.000Z";
const POSTING = {
  id: "greenhouse:acme:4012345", source: "greenhouse", company_token: "acme", company: "Acme", title: "Platform Engineer",
  location: "London", country: "GB", remote: false, work_mode: "hybrid", department: "Engineering", category: "software",
  posted_at: "2026-10-10T00:00:00.000Z", first_seen: INSERTED, apply_url: "https://boards.greenhouse.io/acme/jobs/4012345",
  salary: null, salary_min_annual: null, salary_max_annual: null, salary_period: null, salary_currency: null,
  experience_band: "mid", min_years: 3, agency: false, description: "Kubernetes.",
};

let handler: EdgeHandler;
let posting: Record<string, unknown> | null;
let stamps: Array<{ company_token: string; verified_at: string }>;
let selects: Array<{ table: string; columns: string }>;
let stampQueries: string[][];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  g.fetch = async () => new Response("{}", { status: 404 });
  handler = await loadEdgeHandler("public-api", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__v1Db; }",
  });
}, 120_000);

beforeEach(() => {
  posting = { ...POSTING };
  stamps = [{ company_token: "acme", verified_at: VERIFIED }];
  selects = [];
  stampQueries = [];
  const chainFor = (table: string): unknown => {
    let inValues: string[] = [];
    const chain: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "select") return (columns: string) => { selects.push({ table, columns: String(columns) }); return chain; };
        if (prop === "in") return (_col: string, values: string[]) => { inValues = values; return chain; };
        if (prop === "maybeSingle" || prop === "single") {
          return () => Promise.resolve({ data: table === "job_board_postings" ? posting : null, error: null });
        }
        if (prop === "then") {
          if (table === "job_board_verifications") stampQueries.push(inValues);
          const data = table === "job_board_verifications" ? stamps.filter((s) => inValues.includes(s.company_token)) : [];
          return (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null, count: 0 }).then(ok);
        }
        return () => chain;
      },
    });
    return chain;
  };
  (globalThis as Record<string, unknown>).__v1Db = {
    rpc: (name: string) => {
      const r = Promise.resolve(
        name === "api_key_check"
          ? { data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null }
          : { data: null, error: null },
      );
      return Object.assign(r, { maybeSingle: () => r });
    },
    from: (table: string) => chainFor(table),
  };
});

const get = async (path: string) => {
  const res = await handler(new Request(`https://harness.supabase.co/functions/v1/public-api${path}`, { headers: { authorization: "Bearer rb_live_harness_key_0123456789" } }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
};

describe("a job object says when its feed last listed it (S12-121)", () => {
  it("/v1/jobs/{id}: last_verified_at is the feed's stamp, and last_seen is the same, never the insert time", async () => {
    posting = { ...POSTING, last_seen: INSERTED };
    const { status, body } = await get(`/v1/jobs/${encodeURIComponent(POSTING.id)}`);
    expect(status).toBe(200);
    expect(body.data.last_verified_at).toBe(VERIFIED);
    expect(body.data.last_seen).toBe(VERIFIED);
    expect(body.data.first_seen).toBe(INSERTED);
  });

  it("the insert-only column is not read at all", async () => {
    await get(`/v1/jobs/${encodeURIComponent(POSTING.id)}`);
    const read = selects.find((s) => s.table === "job_board_postings")!;
    expect(read.columns.split(",")).not.toContain("last_seen");
    expect(read.columns.split(",")).toContain("first_seen");
  });

  it("on a token several boards share, the posting's own board's stamp wins over the token's", async () => {
    stamps = [{ company_token: "acme", verified_at: TWIN_VERIFIED }, { company_token: "greenhouse:acme", verified_at: VERIFIED }];
    const { body } = await get(`/v1/jobs/${encodeURIComponent(POSTING.id)}`);
    expect(body.data.last_verified_at).toBe(VERIFIED);
  });

  it("no stamp known is null, never a guess", async () => {
    stamps = [];
    posting = { ...POSTING, last_seen: INSERTED };
    const { body } = await get(`/v1/jobs/${encodeURIComponent(POSTING.id)}`);
    expect(body.data.last_verified_at).toBeNull();
    expect(body.data.last_seen).toBeNull();
  });

  it("the ranked engine reads the board's recheckedAt, never its lastSeen", () => {
    const API = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8"));
    const toV1 = API.slice(API.indexOf("const toV1 = (j: Record<string, unknown>) => ({"), API.indexOf("const total = typeof r.total"));
    expect(toV1).not.toMatch(/j\.lastSeen/);
    expect(toV1).toMatch(/last_verified_at: typeof j\.recheckedAt === "string" \? j\.recheckedAt : null/);
    expect(toV1).toMatch(/last_seen: typeof j\.recheckedAt === "string" \? j\.recheckedAt : null/);
  });
});

describe("an employer the board has never read is named, not served as an empty market (S12-040)", () => {
  it("/v1/jobs?company_token=shipbob answers an empty page that says the board has never read it", async () => {
    const { status, body } = await get("/v1/jobs?company_token=shipbob");
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.disclosures?.unknownCompanies).toEqual(["shipbob"]);
    expect(body.disclosures?.unknownCompaniesNote).toMatch(/not their hiring/);
  });

  it("a token the board has read is not named, even on an empty page", async () => {
    const { body } = await get("/v1/jobs?company_token=acme");
    expect(body.disclosures?.unknownCompanies).toBeUndefined();
  });

  it("the ranked engine passes the board's employer notes and its fallback on", () => {
    const API = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8"));
    const ranked = API.slice(API.indexOf("async function listJobsRanked("), API.indexOf("async function listJobs(client"));
    for (const k of ["unknownCompanies", "companiesResolved", "companiesUnresolved", "companiesNotLookedUp"]) expect(ranked, k).toContain(`"${k}"`);
    expect(ranked).toMatch(/if \(r\.rankedFellBack\) disc\.rankedFellBack = true;/);
  });
});

describe("the stamp reader", () => {
  const db = (rows: Array<{ company_token: string; verified_at: string }> | "error" | "hang") => ({
    from: () => ({
      select: () => ({
        in: (_c: string, values: string[]) =>
          rows === "hang" ? new Promise(() => {})
          : Promise.resolve(rows === "error" ? { data: null, error: { message: "boom" } } : { data: rows.filter((r) => values.includes(r.company_token)), error: null }),
      }),
    }),
  });

  it("a failed or slow read leaves every row null, never the insert time", async () => {
    for (const mode of ["error", "hang"] as const) {
      const rows: Array<Record<string, unknown>> = [{ source: "greenhouse", company_token: "acme", last_seen: INSERTED }];
      await attachLastVerified(db(mode), rows);
      expect(rows[0], mode).toMatchObject({ last_verified_at: null, last_seen: null });
    }
  }, 10_000);

  it("a hundred employers are read in chunks a URL can carry", async () => {
    const seen: number[] = [];
    const client = { from: () => ({ select: () => ({ in: (_c: string, v: string[]) => { seen.push(v.length); return Promise.resolve({ data: [], error: null }); } }) }) };
    const rows = Array.from({ length: 100 }, (_, i) => ({ source: "lever", company_token: `employer-${i}` }));
    await attachLastVerified(client, rows);
    expect(Math.max(...seen)).toBeLessThanOrEqual(80);
    expect(seen.reduce((a, b) => a + b, 0)).toBe(200);
  });

  it("neverReadTokens names only the tokens with no stamp, and null when it could not read", async () => {
    expect(await neverReadTokens(db([{ company_token: "acme", verified_at: VERIFIED }]), ["acme", "shipbob"])).toEqual(["shipbob"]);
    expect(await neverReadTokens(db("error"), ["acme"])).toBeNull();
  });
});
