// @vitest-environment node
//
// Node, not jsdom: this file bundles public-api with esbuild.
/**
 * A /v1 READ BEFORE THE WHO-MAY-APPLY COLUMNS EXIST SERVES EVERY OTHER VENDOR
 * (OD16 review, 2026-11-19).
 *
 * OD16's reads name who_may_apply and hiring_paths (JOB_FIELDS, the federal
 * gate's or(), the change feed's opened select, the statement reads). Those
 * columns exist only once job-board .104's migration 20261119110000 is
 * applied, and that migration was not on main when this lane was built.
 * PostgREST answers a read naming a missing column with 42703, and nothing
 * handled it: a public-api deploy from a main carrying OD16 before the
 * migration answered 500 on every /v1/jobs, /v1/jobs/{id}, /application and
 * /v1/changes read, for every vendor.
 *
 * db() now reads through federalColumnTolerant (./federal-columns.ts): a read
 * refused for one of those columns is sent again without them and with no
 * federal row (source <> 'usajobs'), its fences unchanged. Held here on the
 * shipped handler against a database whose postings table has no such
 * columns. TEETH: the same handler bundled with the wrapper replaced by a
 * pass-through (the first cut of OD16) answers 500 to every read below.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { build, type Plugin } from "esbuild";
import { resolve } from "node:path";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb, type Op } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";
import { FEDERAL_NOT_FOUND_NOTE } from "../../supabase/functions/public-api/federal-rows";
import {
  FEDERAL_COLUMNS, FEDERAL_COLUMNS_RECHECK_MS, isMissingFederalColumn, withoutFederalColumns,
} from "../../supabase/functions/public-api/federal-columns";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const RECENT = ago(2 * DAY);

const GH_ID = "greenhouse:acme:1";
const FED_ID = "usajobs:usajobs:850123456";
// The table before 20261119110000: no who_may_apply, no hiring_paths.
const base = {
  location: "Denver, CO", country: "US", remote: false, work_mode: null, department: null, category: "security",
  posted_at: RECENT, salary: null, salary_min_annual: null, salary_max_annual: null, salary_period: null, salary_currency: null,
  experience_band: null, min_years: null, agency: false, closes_at: null, effective_posted: RECENT, missing_since: null,
  first_seen: ago(DAY), description: "Duties.",
};
const GH = { ...base, id: GH_ID, source: "greenhouse", company_token: "acme", company: "Acme Health", title: "Security Officer", apply_url: "https://boards.greenhouse.io/acme/jobs/1" };
const FED = { ...base, id: FED_ID, source: "usajobs", company_token: "usajobs", company: "Transportation Security Administration", title: "Transportation Security Officer", apply_url: "https://www.usajobs.gov/job/850123456" };

const MISSING = ["who_may_apply", "hiring_paths"] as const;

/**
 * A postings table without the two columns: a read that names either one,
 * in its select or in any filter, answers PostgREST's 42703, as production
 * would before the migration.
 */
class BeforeMigrationDb extends RecordingDb {
  missing: readonly string[] = MISSING;
  client() {
    const base = super.client();
    return {
      ...base,
      from: (table: string) => {
        const q = base.from(table);
        if (table !== "job_board_postings") return q;
        const ops = this.calls[this.calls.length - 1].ops;
        return refusing(q, ops, this.missing);
      },
    };
  }
}

function refusing<Q extends object>(q: Q, ops: Op[], missing: readonly string[]): Q {
  const fault = () => {
    const hit = missing.find((c) => ops.some(([, a]) => JSON.stringify(a).includes(c)));
    return hit ? { code: "42703", message: `column job_board_postings.${hit} does not exist`, details: null, hint: null } : null;
  };
  const refused = () => ({ data: null, error: fault(), count: null });
  const outer: Q = new Proxy(q, {
    get(t, prop) {
      if (prop === "then") {
        return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) =>
          fault() ? Promise.resolve(refused()).then(ok, no) : (t as PromiseLike<unknown>).then(ok, no);
      }
      if (prop === "maybeSingle" || prop === "single") {
        return () => (fault() ? Promise.resolve(refused()) : (t as { maybeSingle: () => Promise<unknown> }).maybeSingle());
      }
      const v = (t as Record<string | symbol, unknown>)[prop];
      return typeof v === "function" ? (...a: unknown[]) => { const out = (v as (...x: unknown[]) => unknown).apply(t, a); return out === t ? outer : out; } : v;
    },
  });
  return outer;
}

function freshDb(): BeforeMigrationDb {
  const db = new BeforeMigrationDb();
  db.rpcs.api_key_check = () => ({ data: { ...ALLOWED }, error: null });
  db.rpcs.v1_withheld_company_tokens = () => ({ data: [], error: null });
  db.tables.job_board_postings = [GH, FED].map((r) => ({ ...r }));
  db.tables.job_board_closures = [];
  db.tables.job_board_verifications = [{ company_token: "greenhouse:acme", verified_at: RECENT }];
  db.tables.job_board_meta = [{ k: "refresh", updated_at: RECENT, v: {
    companiesFacet: [{ token: "acme", name: "Acme Health", count: 40 }, { token: "usajobs", name: "USAJOBS", count: 18_505 }],
    companiesOpen: { acme: 40, usajobs: 18_505 },
  } }];
  return db;
}

/** The reads of the postings table, each with whether it named a missing column. */
const postingsReads = (db: RecordingDb) =>
  db.queriesOf("job_board_postings").map((ops) => ({ ops, named: MISSING.some((c) => ops.some(([, a]) => JSON.stringify(a).includes(c))) }));
const hasNeqFederal = (ops: Op[]) => ops.some(([m, a]) => m === "neq" && a[0] === "source" && a[1] === "usajobs");
const hasFence = (ops: Op[]) =>
  ops.some(([m, a]) => m === "is" && a[0] === "missing_since") && ops.some(([m, a]) => m === "gte" && a[0] === "effective_posted")
  && ops.some(([m, a]) => m === "not" && a[0] === "source" && a[1] === "in");

const NOW = Date.now();
let handler: EdgeHandler;
beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
}, 180_000);
afterEach(() => { vi.useRealTimers(); });

/** Each test starts past the isolate's memory of a miss, so it sees the first read refused and the second served. */
let clock = NOW;
function freshIsolateClock() {
  clock += FEDERAL_COLUMNS_RECHECK_MS + 60_000;
  vi.useFakeTimers({ toFake: ["Date"], now: clock });
}

describe("before 20261119110000, /v1 serves every other vendor and no federal row", () => {
  it("/v1/jobs answers 200 with the Greenhouse row, read again without the columns and with no federal row, its fences intact", async () => {
    freshIsolateClock();
    const db = freshDb(); useDb(db);
    const r = await callApi(handler, "/v1/jobs");
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect((r.body.data as Array<Record<string, unknown>>).map((x) => x.id)).toEqual([GH_ID]);
    const row = (r.body.data as Array<Record<string, unknown>>)[0];
    expect([row.who_may_apply, row.hiring_paths]).toEqual([null, null]);
    const reads = postingsReads(db);
    expect(reads.some((x) => x.named), "the first read did not name the federal columns: the retry was never exercised").toBe(true);
    const retried = reads.filter((x) => !x.named);
    expect(retried.length).toBeGreaterThan(0);
    for (const x of retried) {
      expect(hasNeqFederal(x.ops), "a retried read let federal rows through").toBe(true);
      expect(hasFence(x.ops), "a retried read lost a fence").toBe(true);
    }
  });

  it("/v1/jobs/{id} serves a Greenhouse posting, and a federal id answers 404 with the note, never 500", async () => {
    freshIsolateClock();
    useDb(freshDb());
    expect((await callApi(handler, `/v1/jobs/${encodeURIComponent(GH_ID)}`)).status).toBe(200);
    useDb(freshDb());
    const fed = await callApi(handler, `/v1/jobs/${encodeURIComponent(FED_ID)}`);
    expect(fed.status).toBe(404);
    expect((fed.body.error as { message: string }).message).toContain(FEDERAL_NOT_FOUND_NOTE);
  });

  it("the application route answers a federal id 404, never 500", async () => {
    freshIsolateClock();
    useDb(freshDb());
    const r = await callApi(handler, `/v1/jobs/${encodeURIComponent(FED_ID)}/application`);
    expect(r.status).toBe(404);
  });

  it("/v1/changes answers 200 with the Greenhouse row opened and no federal row", async () => {
    freshIsolateClock();
    useDb(freshDb());
    const r = await callApi(handler, `/v1/changes?since=${encodeURIComponent(ago(10 * DAY))}`);
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect((r.body.opened as Array<Record<string, unknown>>).map((x) => x.id)).toEqual([GH_ID]);
  });

  it("/v1/companies lists no federal agency, and says the count completed rather than failed", async () => {
    freshIsolateClock();
    useDb(freshDb());
    const r = await callApi(handler, "/v1/companies?limit=10");
    expect(r.status).toBe(200);
    const fed = r.body.federalAgencies as { agencies: unknown[]; complete: boolean } | null;
    expect(fed?.agencies).toEqual([]);
    expect(fed?.complete).toBe(true);
  });

  it("the isolate remembers the miss for ten minutes (one read, in the old shape), then asks in the new shape again", async () => {
    freshIsolateClock();
    useDb(freshDb());
    await callApi(handler, `/v1/jobs/${encodeURIComponent(GH_ID)}`);
    // Inside the window: one postings read, never naming the columns.
    vi.setSystemTime(clock + 60_000);
    const inside = freshDb(); useDb(inside);
    expect((await callApi(handler, `/v1/jobs/${encodeURIComponent(GH_ID)}`)).status).toBe(200);
    expect(postingsReads(inside).map((x) => x.named)).toEqual([false]);
    // Past it, with the migration applied: the new shape, read once, serves the federal row's columns.
    vi.setSystemTime(clock + FEDERAL_COLUMNS_RECHECK_MS + 120_000);
    const after = freshDb(); after.missing = []; useDb(after);
    const r = await callApi(handler, `/v1/jobs/${encodeURIComponent(GH_ID)}`);
    expect(r.status).toBe(200);
    expect(postingsReads(after).map((x) => x.named)).toEqual([true]);
  });

  it("an error that is not a missing federal column is not retried or masked", async () => {
    // A statement timeout: answered as before, and never sent again.
    freshIsolateClock();
    const slow = freshDb();
    slow.missing = [];
    slow.faults.job_board_postings = { code: "57014", message: "canceling statement due to statement timeout" };
    useDb(slow);
    expect((await callApi(handler, `/v1/jobs/${encodeURIComponent(GH_ID)}`)).status).toBe(500);
    expect(postingsReads(slow).map((x) => x.named)).toEqual([true]);
    // A missing column that is not one of the three: the same.
    freshIsolateClock();
    const other = freshDb();
    other.missing = ["salary_rank_usd"];
    useDb(other);
    expect((await callApi(handler, "/v1/jobs?salary_min=50000")).status).toBe(500);
    expect(postingsReads(other).every((x) => x.named), "a read was sent again in the old shape for a column it does not cover").toBe(true);
  });
});

describe("the wrapper's two rules", () => {
  it("a refusal counts only when it names one of the three columns", () => {
    expect(isMissingFederalColumn({ code: "42703", message: "column job_board_postings.who_may_apply does not exist" })).toBe(true);
    expect(isMissingFederalColumn({ code: "PGRST204", message: "Could not find the 'hiring_paths' column of 'job_board_postings' in the schema cache" })).toBe(true);
    expect(isMissingFederalColumn({ code: "42703", message: "column job_board_postings.closes_at does not exist" })).toBe(true);
    expect(isMissingFederalColumn({ code: "42703", message: "column job_board_postings.salary_rank_usd does not exist" })).toBe(false);
    expect(isMissingFederalColumn({ code: "42703", message: "column job_board_postings.closes_at_basis does not exist" })).toBe(false);
    expect(isMissingFederalColumn({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isMissingFederalColumn(null)).toBe(false);
  });

  it("the old shape's select drops the three columns and nothing else", () => {
    expect([...FEDERAL_COLUMNS]).toEqual(["closes_at", "who_may_apply", "hiring_paths"]);
    expect(withoutFederalColumns("id,source,closes_at,who_may_apply,hiring_paths,effective_posted,description")).toBe("id,source,effective_posted,description");
    expect(withoutFederalColumns("who_may_apply,hiring_paths")).toBe("id");
  });
});

// ── teeth ───────────────────────────────────────────────────────────────────

/** public-api bundled with the column wrapper replaced by a pass-through: the first cut of OD16. */
async function loadUnwrappedPublicApi(): Promise<EdgeHandler> {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  g.fetch = async () => new Response("{}", { status: 404 });
  const plugin: Plugin = {
    name: "unwrapped",
    setup(b) {
      b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js@2\.45\.0$/ }, (a) => ({ path: a.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export function createClient() { return globalThis.__apiDb; }", loader: "js" }));
      b.onLoad({ filter: /public-api[\\/]federal-columns\.ts$/ }, () => ({ contents: "export function federalColumnTolerant(c) { return c; }", loader: "js" }));
    },
  };
  const out = await build({
    entryPoints: [resolve(__dirname, "../../supabase/functions/public-api/index.ts")],
    bundle: true, write: false, format: "iife", platform: "node", target: "es2022", plugins: [plugin], logLevel: "silent",
  });
  g.__edgeHandler = undefined;
  new Function(out.outputFiles[0].text)();
  return g.__edgeHandler as EdgeHandler;
}

describe("TEETH: without the wrapper every row read is a 500", () => {
  let unwrapped: EdgeHandler;
  beforeAll(async () => { unwrapped = await loadUnwrappedPublicApi(); }, 180_000);
  afterAll(() => { delete (globalThis as Record<string, unknown>).__edgeHandler; });

  it("/v1/jobs, /v1/jobs/{id} and /v1/changes answer 500 for a Greenhouse caller", async () => {
    useDb(freshDb());
    expect((await callApi(unwrapped, "/v1/jobs")).status).toBe(500);
    useDb(freshDb());
    expect((await callApi(unwrapped, `/v1/jobs/${encodeURIComponent(GH_ID)}`)).status).toBe(500);
    useDb(freshDb());
    expect((await callApi(unwrapped, `/v1/changes?since=${encodeURIComponent(ago(10 * DAY))}`)).status).toBe(500);
  });
});
