// @vitest-environment node
//
// Node, not jsdom: this file bundles both edge functions with esbuild.
/**
 * A FEDERAL ROW WITHOUT WHO MAY APPLY STAYS WITHHELD (OD16, owner 2026-11-18).
 *
 * Not every U.S. federal announcement is open to the public: some take only
 * current federal staff ("Temp Promo"), some only Guard members, and an
 * announcement often comes as two twins, one public and one internal. The
 * board stores the agency's own statement of who may apply only from job-board
 * .104 on (migration 20261119110000), and an announcement learns it on its
 * next read. Until it has one, /v1 and the Claude connector must not hand it
 * on: an assistant would suggest a job the person may not be allowed to apply
 * for. That is what lets this lane deploy while .104's labels are still
 * filling.
 *
 * THE GATE HAS TWO HALVES, and each is held here on the shipped handlers:
 *   - SQL: every direct read of job_board_postings that serves a row binds
 *     FEDERAL_GATE_OR beside the redistribution fence (the harness records it
 *     and does not apply it, so the in-memory half is what the rows below
 *     prove, and the recorded op is what proves the SQL half);
 *   - memory: a row read without its statement, and every federal row a
 *     proxied path (the ranked engine, the connector) gets from job-board,
 *     which carries no statement, is dropped unless a fenced read of the
 *     table finds the statement stored. A read that fails keeps no federal
 *     row at all.
 * A federal id asked for by itself answers 404 (/v1) or restricted (the
 * connector) with the reason, never the row.
 *
 * TEETH. The same calls against a public-api bundle whose federal module lets
 * every row through serve the unlabelled announcement; an or() evaluator
 * shows the SQL expression admits it once the gate is inverted; and the code
 * before OD16 answered ?source=usajobs with 451, which the first test fails.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build, type Plugin } from "esbuild";
import { resolve } from "node:path";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import {
  FEDERAL_GATE_OR, FEDERAL_NOT_FOUND_NOTE, FEDERAL_UNLABELLED_NOTE, passesFederalGate,
} from "../../supabase/functions/public-api/federal-rows";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const DAY = 86_400_000;
const RECENT = new Date(Date.now() - 2 * DAY).toISOString();
const FIRST_SEEN = new Date(Date.now() - 20 * DAY).toISOString();
const CLOSES = new Date(Date.now() + 25 * DAY).toISOString();
const READ_AT = new Date(Date.now() - 3_600_000).toISOString();

const LABELLED_ID = "usajobs:usajobs:850123456";
const UNLABELLED_ID = "usajobs:usajobs:881700001";
const UNLABELLED_AGENCY = "Air National Guard Units";

const base = {
  source: "usajobs", company_token: "usajobs", location: "Denver, CO", country: "US", remote: false, work_mode: null,
  department: null, category: "security", posted_at: RECENT, first_seen: FIRST_SEEN, salary: null, salary_min_annual: null,
  salary_max_annual: null, salary_period: null, salary_currency: null, experience_band: null, min_years: null, agency: false,
  closes_at: CLOSES, hiring_paths: null, effective_posted: RECENT, missing_since: null, description: "Duties.",
};
const LABELLED = {
  ...base, id: LABELLED_ID, company: "Transportation Security Administration", title: "Transportation Security Officer",
  apply_url: "https://www.usajobs.gov/job/850123456", who_may_apply: "Open to the public", hiring_paths: ["public"],
};
// The internal twin: same kind of role, no statement stored yet.
const UNLABELLED = {
  ...base, id: UNLABELLED_ID, company: UNLABELLED_AGENCY, title: "Security Officer (Title 32)",
  apply_url: "https://www.usajobs.gov/job/881700001", who_may_apply: null,
};
const GH = {
  ...base, id: "greenhouse:acme:1", source: "greenhouse", company_token: "acme", company: "Acme Health", title: "Security Officer",
  apply_url: "https://boards.greenhouse.io/acme/jobs/1", closes_at: null, who_may_apply: null,
};
const ROWS = [LABELLED, UNLABELLED, GH];

/** The board's answer for a ranked page: its own field names, no statement on any row. */
const boardJob = (r: typeof LABELLED | typeof UNLABELLED | typeof GH) => ({
  id: r.id, source: r.source, token: r.company_token, company: r.company, title: r.title, location: r.location,
  country: r.country, postedAt: r.posted_at, applyUrl: r.apply_url, recheckedAt: READ_AT,
});
const BOARD_PAGE = { jobs: ROWS.map(boardJob), total: 3, hasMore: false };

function freshDb(tier = "free"): RecordingDb {
  const db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: { ...ALLOWED, key_tier: tier }, error: null });
  db.rpcs.v1_withheld_company_tokens = () => ({ data: [], error: null });
  db.tables.job_board_postings = ROWS.map((r) => ({ ...r }));
  db.tables.job_board_verifications = [
    { company_token: "usajobs:usajobs", verified_at: READ_AT },
    { company_token: "greenhouse:acme", verified_at: READ_AT },
  ];
  db.tables.job_board_meta = [{ k: "refresh", updated_at: READ_AT, v: {
    companiesFacet: [{ token: "acme", name: "Acme Health", count: 40 }, { token: "usajobs", name: "USAJOBS", count: 18_505 }],
    companiesOpen: { acme: 40, usajobs: 18_505 },
  } }];
  return db;
}

/** Every read of the postings table that bound the redistribution fence, and whether each also bound the federal gate. */
function fencedReads(db: RecordingDb): Array<{ gated: boolean; ops: Array<[string, unknown[]]> }> {
  return db.queriesOf("job_board_postings")
    .filter((ops) => ops.some(([m, a]) => m === "not" && a[0] === "source" && a[1] === "in"))
    .map((ops) => ({
      ops,
      gated: ops.some(([m, a]) => m === "or" && a[0] === FEDERAL_GATE_OR) || ops.some(([m, a]) => m === "not" && a[0] === "who_may_apply" && a[1] === "is"),
    }));
}

// ── a small evaluator for the gate's or() expression ────────────────────────

/** PostgREST or(a.op.v,b.op.v) over one row: the subset of operators the gate uses. */
function orAdmits(expr: string, row: Record<string, unknown>): boolean {
  return expr.split(",").some((arm) => {
    const [col, ...rest] = arm.split(".");
    const v = row[col] ?? null;
    const op = rest.join(".");
    if (op.startsWith("neq.")) return v !== null && String(v) !== op.slice(4);
    if (op.startsWith("eq.")) return v !== null && String(v) === op.slice(3);
    if (op === "not.is.null") return v !== null;
    if (op === "is.null") return v === null;
    throw new Error(`orAdmits: no operator for ${arm}`);
  });
}

// ── /v1, the shipped handler ────────────────────────────────────────────────

describe("/v1 keeps an unlabelled federal row back on every path", () => {
  let handler: EdgeHandler;
  let rankedFetches = 0;
  beforeAll(async () => {
    ({ handler } = await loadPublicApi((f) => {
      if (f.url.endsWith("/functions/v1/job-board")) { rankedFetches += 1; return new Response(JSON.stringify(BOARD_PAGE), { status: 200 }); }
      return new Response("{}", { status: 404 });
    }));
  }, 180_000);

  it("a list page of the federal feed answers 200 with the labelled row only, and every read bound the gate", async () => {
    const db = freshDb(); useDb(db);
    const r = await callApi(handler, "/v1/jobs?source=usajobs");
    expect(r.status, "the federal feed is answered since OD16").toBe(200);
    const ids = (r.body.data as Array<Record<string, unknown>>).map((x) => x.id);
    expect(ids).toEqual([LABELLED_ID]);
    const reads = fencedReads(db);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((x) => !x.gated), "a fenced read of the postings table did not bind the federal gate").toEqual([]);
  });

  it("an unlabelled id answers 404 saying an open federal announcement waits for its statement, and the read bound the gate", async () => {
    const db = freshDb(); useDb(db);
    const r = await callApi(handler, `/v1/jobs/${encodeURIComponent(UNLABELLED_ID)}`);
    expect(r.status).toBe(404);
    const e = r.body.error as { code: string; message: string };
    expect(e.code).toBe("not_found");
    expect(e.message).toContain(FEDERAL_NOT_FOUND_NOTE);
    expect(JSON.stringify(r.body)).not.toContain(UNLABELLED_AGENCY);
    expect(fencedReads(db).length, "no fenced read was made: this check would pass vacuously").toBeGreaterThan(0);
    expect(fencedReads(db).every((x) => x.gated)).toBe(true);
    // The control: the labelled id is served.
    useDb(freshDb());
    expect((await callApi(handler, `/v1/jobs/${encodeURIComponent(LABELLED_ID)}`)).status).toBe(200);
  });

  it("the application route answers the same 404 and reads no form", async () => {
    const db = freshDb(); useDb(db);
    const r = await callApi(handler, `/v1/jobs/${encodeURIComponent(UNLABELLED_ID)}/application`);
    expect(r.status).toBe(404);
    expect((r.body.error as { message: string }).message).toContain(FEDERAL_NOT_FOUND_NOTE);
    expect(fencedReads(db).length, "no fenced read was made: this check would pass vacuously").toBeGreaterThan(0);
    expect(fencedReads(db).every((x) => x.gated)).toBe(true);
  });

  it("the change feed opens the labelled announcement only", async () => {
    const db = freshDb(); useDb(db);
    const since = new Date(Date.now() - 25 * DAY).toISOString();
    const r = await callApi(handler, `/v1/changes?since=${encodeURIComponent(since)}`);
    expect(r.status).toBe(200);
    const opened = (r.body.opened as Array<Record<string, unknown>>).map((x) => x.id);
    expect(opened).toContain(LABELLED_ID);
    expect(opened).not.toContain(UNLABELLED_ID);
    const openedRead = db.queriesOf("job_board_postings").find((ops) => ops.some(([m, a]) => m === "gte" && a[0] === "first_seen"));
    expect(openedRead?.some(([m, a]) => m === "or" && a[0] === FEDERAL_GATE_OR), "the opened read did not bind the federal gate").toBe(true);
  });

  it("/v1/companies credits no agency whose only announcement is unlabelled", async () => {
    const db = freshDb(); useDb(db);
    const r = await callApi(handler, "/v1/companies?limit=10");
    expect(r.status).toBe(200);
    const fed = r.body.federalAgencies as { agencies: Array<{ company: string; open_postings: number }> };
    expect(fed.agencies.map((a) => a.company)).toEqual(["Transportation Security Administration"]);
    expect(JSON.stringify(r.body)).not.toContain(UNLABELLED_AGENCY);
  });

  it("the ranked engine, which proxies job-board, reads the statements and drops the unlabelled row, counted and named", async () => {
    const db = freshDb("builder"); useDb(db);
    const before = rankedFetches;
    const r = await callApi(handler, "/v1/jobs?engine=ranked&q=security");
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(rankedFetches).toBe(before + 1);
    const ids = (r.body.data as Array<Record<string, unknown>>).map((x) => x.id);
    expect(ids).toEqual([LABELLED_ID, "greenhouse:acme:1"]);
    const disc = r.body.disclosures as { federalWithheld?: { count: number; reason: string } };
    expect(disc.federalWithheld).toEqual({ count: 1, reason: FEDERAL_UNLABELLED_NOTE });
    // The statement read is by id, for the federal ids alone, and fenced.
    const labelRead = db.queriesOf("job_board_postings").find((ops) => ops.some(([m, a]) => m === "in" && a[0] === "id"));
    expect(labelRead?.find(([m]) => m === "in")?.[1][1]).toEqual([LABELLED_ID, UNLABELLED_ID]);
    expect(labelRead?.some(([m, a]) => m === "not" && a[0] === "who_may_apply")).toBe(true);
    expect(labelRead?.some(([m, a]) => m === "is" && a[0] === "missing_since")).toBe(true);
  });

  it("a statement read that fails keeps every federal row back, and the rest of the page is served", async () => {
    const db = freshDb("builder");
    db.faults.job_board_postings = { message: "canceling statement due to statement timeout" };
    useDb(db);
    const r = await callApi(handler, "/v1/jobs?engine=ranked&q=security");
    expect(r.status).toBe(200);
    expect((r.body.data as Array<Record<string, unknown>>).map((x) => x.id)).toEqual(["greenhouse:acme:1"]);
    expect((r.body.disclosures as { federalWithheld?: { count: number } }).federalWithheld?.count).toBe(2);
    expect(r.body.meta, "no federal row, so no OPM credit").toBeUndefined();
  });
});

// ── the connector, the shipped handler ──────────────────────────────────────

describe("the connector keeps an unlabelled federal row back on every tool", () => {
  let m: KeylessMcp;
  const labelOps: Array<Array<[string, unknown[]]>> = [];
  let labelFault = false;
  beforeAll(async () => {
    m = await bootKeylessMcp();
    m.board = (body) => {
      if (body.action === "detail") {
        const row = ROWS.find((x) => x.id === body.id);
        return new Response(JSON.stringify(row ? { job: boardJob(row), description: row.description } : { job: null }), { status: 200 });
      }
      return new Response(JSON.stringify(BOARD_PAGE), { status: 200 });
    };
    // The statement read: it answers EVERY federal row it is asked about,
    // the unlabelled one included, as a table with the SQL gate ignored would.
    // So what keeps the unlabelled row back here is the in-memory half; the
    // recorded ops prove the SQL half was asked for too.
    const db = (globalThis as Record<string, unknown>).__keylessMcpDb as { from: (t: string) => unknown };
    const plainFrom = db.from;
    db.from = (table: string) => {
      if (table !== "job_board_postings") return plainFrom(table);
      let ids: string[] = [];
      const ops: Array<[string, unknown[]]> = [];
      labelOps.push(ops);
      const chain: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") {
            const result = labelFault
              ? { data: null, error: { message: "canceling statement due to statement timeout" } }
              : { data: ROWS.filter((r) => ids.includes(r.id)).map(({ id, who_may_apply, hiring_paths, closes_at, first_seen }) => ({ id, who_may_apply, hiring_paths, closes_at, first_seen })), error: null };
            return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(result).then(ok, no);
          }
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
          return (...a: unknown[]) => { ops.push([String(prop), a]); if (prop === "in" && a[0] === "id") ids = a[1] as string[]; return chain; };
        },
      });
      return chain;
    };
  }, 180_000);

  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await m.call(args, { name });
    expect(r.isError, r.text.slice(0, 400)).toBe(false);
    return JSON.parse(r.text) as Record<string, unknown>;
  };

  it("search_jobs serves the labelled card, counts the unlabelled one as withheld and says why", async () => {
    labelFault = false;
    const out = await tool("search_jobs", { query: "security officer" });
    expect((out.jobs as Array<Record<string, unknown>>).map((j) => j.id)).toEqual([LABELLED_ID, "greenhouse:acme:1"]);
    expect(out.withheld).toBe(1);
    expect(String(out.withheldNote)).toMatch(/USAJOBS announcements whose statement of who may apply is not stored yet/);
    expect(JSON.stringify(out)).not.toContain(UNLABELLED_AGENCY);
    // The SQL half was asked for on the statement read.
    const last = labelOps.at(-1)!;
    expect(last.some(([mm, a]) => mm === "not" && a[0] === "who_may_apply" && a[1] === "is")).toBe(true);
    expect(last.some(([mm, a]) => mm === "is" && a[0] === "missing_since")).toBe(true);
  });

  it("get_job on the unlabelled id is restricted with the reason, and on the labelled id serves the card", async () => {
    labelFault = false;
    const held = await tool("get_job", { id: UNLABELLED_ID });
    expect(held).toMatchObject({ id: UNLABELLED_ID, job: null, restricted: true, note: FEDERAL_UNLABELLED_NOTE });
    expect(JSON.stringify(held)).not.toContain(UNLABELLED_AGENCY);
    const served = await tool("get_job", { id: LABELLED_ID });
    expect(served.id).toBe(LABELLED_ID);
    expect((served.federal as Record<string, unknown>).whoMayApply).toBe("Open to the public");
  });

  it("get_jobs holds the unlabelled id back beside a served one", async () => {
    labelFault = false;
    const out = await tool("get_jobs", { ids: [LABELLED_ID, UNLABELLED_ID], includeDescription: false });
    const text = JSON.stringify(out);
    expect(text).toContain(LABELLED_ID);
    expect(text).toContain(FEDERAL_UNLABELLED_NOTE);
    expect(text).not.toContain(UNLABELLED_AGENCY);
  });

  it("apply_myself gives no application help for the unlabelled id", async () => {
    labelFault = false;
    const out = await tool("apply_myself", { id: UNLABELLED_ID });
    expect(out).toMatchObject({ jobId: UNLABELLED_ID, state: "restricted", note: FEDERAL_UNLABELLED_NOTE });
    expect(out.form).toBeUndefined();
    expect(out.applyUrl).toBeUndefined();
  });

  it("a statement read that fails keeps both federal cards back and serves the rest", async () => {
    labelFault = true;
    try {
      const out = await tool("search_jobs", { query: "security officer" });
      expect((out.jobs as Array<Record<string, unknown>>).map((j) => j.id)).toEqual(["greenhouse:acme:1"]);
      expect(out.withheld).toBe(2);
      expect(out.federalAttribution).toBeUndefined();
    } finally { labelFault = false; }
  });
});

// ── teeth ───────────────────────────────────────────────────────────────────

/** public-api bundled with its federal module's gate opened: every row passes. */
async function loadGatelessPublicApi(): Promise<EdgeHandler> {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  g.fetch = async () => new Response("{}", { status: 404 });
  const { readFileSync } = await import("node:fs");
  const plugin: Plugin = {
    name: "gateless",
    setup(b) {
      b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js@2\.45\.0$/ }, (a) => ({ path: a.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export function createClient() { return globalThis.__apiDb; }", loader: "js" }));
      b.onLoad({ filter: /public-api[\\/]federal-rows\.ts$/ }, (a) => {
        const src = readFileSync(a.path, "utf8");
        const open = src.replace(
          /export function passesFederalGate\(source: unknown, whoMayApply: unknown\): boolean \{\n  return [^\n]*\n\}/,
          "export function passesFederalGate(_source: unknown, _whoMayApply: unknown): boolean {\n  return true;\n}",
        );
        if (open === src) throw new Error("the gate mutation did not apply: RE-ANCHOR this tooth");
        return { contents: open, loader: "ts" };
      });
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

describe("TEETH: an opened gate serves the unlabelled announcement", () => {
  let gateless: EdgeHandler;
  beforeAll(async () => { gateless = await loadGatelessPublicApi(); }, 180_000);
  afterAll(() => { delete (globalThis as Record<string, unknown>).__edgeHandler; });

  it("the list page and the id lookup hand the unlabelled row on once the in-memory half is gone", async () => {
    useDb(freshDb());
    const r = await callApi(gateless, "/v1/jobs?source=usajobs");
    expect((r.body.data as Array<Record<string, unknown>>).map((x) => x.id)).toContain(UNLABELLED_ID);
    useDb(freshDb());
    expect((await callApi(gateless, `/v1/jobs/${encodeURIComponent(UNLABELLED_ID)}`)).status).toBe(200);
  });

  it("the SQL expression keeps the unlabelled row out, admits the rest, and an inverted one admits it", () => {
    expect(ROWS.filter((r) => orAdmits(FEDERAL_GATE_OR, r)).map((r) => r.id)).toEqual([LABELLED_ID, "greenhouse:acme:1"]);
    const inverted = FEDERAL_GATE_OR.replace("who_may_apply.not.is.null", "who_may_apply.is.null");
    expect(inverted).not.toBe(FEDERAL_GATE_OR);
    expect(ROWS.filter((r) => orAdmits(inverted, r)).map((r) => r.id)).toContain(UNLABELLED_ID);
    const dropped = FEDERAL_GATE_OR.replace("source.neq.usajobs,", "");
    expect(ROWS.filter((r) => orAdmits(dropped, r)).map((r) => r.id), "without the vendor arm the gate would drop every other vendor").not.toContain("greenhouse:acme:1");
  });

  it("the in-memory predicate refuses a blank statement as it refuses a missing one", () => {
    expect(passesFederalGate("usajobs", null)).toBe(false);
    expect(passesFederalGate("usajobs", "   ")).toBe(false);
    expect(passesFederalGate(" USAJOBS ", undefined)).toBe(false);
    expect(passesFederalGate("usajobs", "United States Citizens")).toBe(true);
    expect(passesFederalGate("greenhouse", null)).toBe(true);
  });
});
