// @vitest-environment node
/**
 * A STATE THAT PUBLISHES ONLY A NOTICE DATE IS READ, AND DATED BY OUR FIRST
 * READ (S14X-036).
 *
 * Maryland, Virginia, Arizona and Iowa publish the employer's notice date and
 * no received or posted stamp of their own. Their maps asked for a stamp
 * column, refused every file, and the refusal was a note (the maps were
 * "unverified"), so the night's read stayed ok and none of their notices was
 * ever stored -- Winnebago Industries' Iowa notice of 2026-10-09 (51 workers)
 * among them. Georgia's file has no date at all.
 *
 * Now:
 *   1. the four maps read their saved files with public_basis our_first_fetch
 *      (the public date is the day our read first saw the notice; the notice
 *      date is the event), Georgia is not read and says why, and every map is
 *      pinned to a saved file, so a refused header fails the night's read;
 *   2. the shipped handler (edge harness, files served from the saved samples)
 *      stores Iowa's notices so dated, fails the slice on a refused header, and
 *      HOLDS a first-read state until 20261112182000 answers -- before it, the
 *      writer would re-date every such notice each night;
 *   3. pglite (Supabase's default grants), the layoff lane's chain and then
 *      20261112182000: a second read keeps the first read's date, a state's own
 *      stamp still updates, and the published stamp lag leaves our read out.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb } from "./helpers/proxy-db";
import { ALL_STATE_MAPS, NOT_READ, RAW_STATE_MAPS } from "../../supabase/functions/layoff-filings/warn-maps/index";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const SAMPLES = resolve(ROOT, "scripts/data/layoff-samples");
const FIX = "20261112182000_a_state_notice_keeps_the_day_we_first_read_it_and_an_edited_one_retires_its_old_reading.sql";

// ── 1. the maps ─────────────────────────────────────────────────────────────

describe("1. the maps", () => {
  it("the four notice-only states are read by our first read, Georgia is named as not read, and every map read is pinned to a saved file", () => {
    const first = ALL_STATE_MAPS.filter((m) => m.visibleBasis === "our_first_fetch").map((m) => m.state).sort();
    expect(first).toEqual(["AZ", "IA", "MD", "VA"]);
    expect(ALL_STATE_MAPS.filter((m) => !m.verifiedAgainstSample).map((m) => m.state), "a map read with no saved file behind it").toEqual([]);
    expect(RAW_STATE_MAPS.map((m) => m.state)).not.toContain("GA");
    expect(NOT_READ.GA).toMatch(/separation/);
    for (const m of RAW_STATE_MAPS) {
      expect(m.verifiedBy ?? "", `${m.state} names no saved file`).toMatch(/^[a-z0-9-]+\.(csv|xlsx|html)\b/);
      const file = (m.verifiedBy ?? "").split(" ")[0];
      expect(readdirSync(SAMPLES), `${m.state}'s saved file is missing`).toContain(file);
    }
  });
});

// ── 2. the shipped handler ─────────────────────────────────────────────────

const SECRET = "test-layoff-cron-secret-0123456789";
const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LAYOFF_CRON_SECRET: SECRET };
const sample = (st: string) => readFileSync(resolve(SAMPLES, `bln-raw-${st}.csv`), "utf8");

let files: Record<string, string> = {};
const fetched: string[] = [];
let ready = true;
let upserted: Array<Record<string, unknown>> = [];
let health: Record<string, Record<string, unknown>> = {};
let readLogRows: Array<Record<string, unknown>> = [];
let handler: EdgeHandler;
let db: ProxyDb;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (_p: Promise<unknown>) => {} };
  g.fetch = async (url: string) => {
    const m = /\/raw\/([a-z]{2})\.csv$/.exec(String(url));
    if (!m || files[m[1]] == null) return new Response("not here", { status: 404 });
    fetched.push(m[1]);
    return new Response(files[m[1]], { status: 200, headers: { etag: `W/"${m[1]}-${files[m[1]].length}"`, "content-type": "text/csv" } });
  };
  db = new ProxyDb();
  db.answer = (q) => {
    if (q.rpc === "layoff_warn_retire_unseen") {
      return ready
        ? { data: [{ lr_retired: 0, lr_candidates: 0, lr_active: 0, lr_refused: false }], error: null }
        : { data: null, error: { code: "PGRST202", message: "Could not find the function public.layoff_warn_retire_unseen" } };
    }
    if (q.rpc === "layoff_filings_upsert") {
      const rows = (q.calls[0][1][0] as { p_rows: Array<Record<string, unknown>> }).p_rows;
      upserted.push(...rows);
      return { data: [{ lu_inserted: rows.length, lu_updated: 0, lu_refused: 0 }], error: null };
    }
    if (q.table === "layoff_read_log" && q.calls.some(([mm]) => mm === "select")) {
      const kind = q.calls.find(([mm, a]) => mm === "eq" && a[0] === "kind")?.[1][1];
      return { data: readLogRows.filter((r) => r.kind === kind), error: null };
    }
    if (q.table === "layoff_feed_health") {
      const up = q.calls.find(([mm]) => mm === "upsert");
      if (up) {
        const row = up[1][0] as Record<string, unknown>;
        health[`${row.feed}:${row.state}`] = { ...(health[`${row.feed}:${row.state}`] ?? {}), ...row };
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    return undefined;
  };
  g.__layoffDb = db;
  handler = await loadEdgeHandler("layoff-filings", {
    "https://deno.land/std@0.190.0/http/server.ts": "export const serve = (h) => { globalThis.__edgeHandler = h; };",
    "npm:xlsx@0.18.5": "export const read = () => ({ Sheets: {}, SheetNames: [] }); export const utils = { sheet_to_json: () => [] };",
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__layoffDb;",
  });
});
afterEach(() => { vi.useRealTimers(); files = {}; fetched.length = 0; upserted = []; health = {}; readLogRows = []; ready = true; db.queries = []; });

/** One slice from cursor 3: IA, MD, OR, WA, IL, NY, MA, OH -- read on 2026-11-15. */
const slice = async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T03:40:00Z") });
  const res = await handler(new Request("https://h.supabase.co/functions/v1/layoff-filings", {
    method: "POST", headers: { "content-type": "application/json", "x-layoff-cron": SECRET }, body: JSON.stringify({ action: "warn", cursor: 3 }),
  }));
  return res.json() as Promise<{ ok: boolean; notes: string[] }>;
};

describe("2. the shipped handler", () => {
  it("Iowa's notices are stored dated by the notice and published as the day of our first read: Winnebago Industries, 2026-10-09, 51 workers", async () => {
    files = { ia: sample("ia"), md: sample("md") };
    const body = await slice();
    const ia = upserted.filter((r) => r.state === "IA");
    expect(ia.length, "no Iowa notice was stored").toBeGreaterThan(50);
    for (const r of ia) {
      expect(r.public_basis).toBe("our_first_fetch");
      expect(r.public_date).toBe("2026-11-15");
      expect(r.event_basis).toBe("warn_notice_date");
    }
    const win = ia.find((r) => /^Winnebago Industries/.test(String(r.filer_raw)) && r.event_date === "2026-10-09");
    expect(win?.workers).toBe(51);
    expect(upserted.filter((r) => r.state === "MD").length, "no Maryland notice was stored").toBeGreaterThan(50);
    expect(body.notes).not.toContain("refused=IA:bln_raw");
    expect(body.notes).not.toContain("failed=IA:bln_raw");
  });

  it("a refused header fails the night's read: a state that changed its file is a failure the heartbeat sees, not a note", async () => {
    files = { ia: "Some Column,Another\na,b\n" };
    const body = await slice();
    expect(body.notes).toContain("failed=IA:bln_raw");
    expect(body.notes).not.toContain("refused=IA:bln_raw");
    expect(body.ok, "a refused header left the slice ok").toBe(false);
    expect(String(health["bln_raw:IA"]?.note)).toMatch(/^header_mismatch/);
  });

  it("before 20261112182000 answers, a first-read state is held: nothing fetched, nothing stored, a note -- and the slice is not failed by it", async () => {
    ready = false;
    files = { ia: sample("ia"), md: sample("md") };
    const body = await slice();
    expect(fetched).not.toContain("ia");
    expect(fetched).not.toContain("md");
    expect(upserted.filter((r) => r.public_basis === "our_first_fetch")).toEqual([]);
    expect(body.notes).toContain("held=IA:bln_raw");
    expect(body.notes).toContain("held=MD:bln_raw");
    expect(body.notes.filter((n) => /^(failed|refused)=(IA|MD):/.test(n))).toEqual([]);
    expect(String(health["bln_raw:IA"]?.note)).toMatch(/^first_fetch_held/);
    expect(health["bln_raw:IA"]?.last_ok_at, "a held read was recorded as a good one").toBeUndefined();
    // The probe is the retire RPC with no span: it retires nothing.
    const probe = db.rpcArgs("layoff_warn_retire_unseen")[0];
    expect(probe).toEqual({ p_state: "", p_feed: "", p_seen: [], p_from: null, p_to: null });
  });
});

describe("2b. the clock the read-only verifier judges by", () => {
  it("every read-log note names the build that wrote it, and the GET says which build ran the newest complete chain and audit", async () => {
    files = { ia: sample("ia") };
    await slice();
    const notes = db.on("layoff_read_log", "insert").map((q) => (q.calls.find(([mm]) => mm === "insert")![1][0] as { note: string }).note);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).toMatch(/^build=\d{4}-\d{2}-\d{2}\.\d+; /);
    readLogRows = [
      { kind: "warn", read_at: "2026-11-17T03:52:00Z", note: "build=2026-11-12.1; cursor=11; next=13" },
      { kind: "warn", read_at: "2026-11-17T03:51:00Z", note: "build=2026-11-12.1; cursor=8; done; refused=GA:bln_raw" },
      { kind: "edgar_fts_audit", read_at: "2026-11-17T05:17:00Z", note: "build=2026-11-12.1; fts_only=0; reread=10; reread_replaced=3" },
    ];
    const res = await handler(new Request("https://h.supabase.co/functions/v1/layoff-filings", { method: "GET" }));
    const body = await res.json() as { parser: string; runs: { warnDone: { at: string; build: string }; audit: { build: string; reread: number; rereadReplaced: number } } };
    expect(body.parser).toBe("parse205_v3_ts");
    expect(body.runs.warnDone).toEqual({ at: "2026-11-17T03:51:00Z", build: "2026-11-12.1" });
    expect(body.runs.audit).toMatchObject({ build: "2026-11-12.1", reread: 10, rereadReplaced: 3 });
    // A read log the GET cannot read answers no clock, never an error.
    const orig = db.answer;
    db.answer = (q) => (q.table === "layoff_read_log" ? Promise.reject(new Error("down")) : orig(q));
    try {
      const down = await (await handler(new Request("https://h.supabase.co/functions/v1/layoff-filings", { method: "GET" }))).json() as { ok: boolean; runs: unknown };
      expect(down).toMatchObject({ ok: true, runs: null });
    } finally {
      db.answer = orig;
    }
  });
});

// ── 3. the writer and the stamp lag ────────────────────────────────────────

const LANE = readdirSync(MIGRATIONS).filter((f) => /^202609181\d{5}_/.test(f) && f.endsWith(".sql")).sort();
const CHAIN = [
  ...LANE,
  readdirSync(MIGRATIONS).find((f) => f.startsWith("20261009160000_"))!,
  readdirSync(MIGRATIONS).find((f) => f.startsWith("20261009160100_"))!,
];
const STAND_INS = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz, country text, region_code text
  );
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer, absence_basis text
  );
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
  );
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date)
  );
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now()
  );
`;
async function bootLayoffChain(withFix: boolean): Promise<PGlite> {
  const d = new PGlite();
  await d.exec(STAND_INS);
  for (const f of CHAIN) await d.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));
  if (withFix) { await d.exec(readFileSync(resolve(MIGRATIONS, FIX), "utf8")); await d.exec(readFileSync(resolve(MIGRATIONS, FIX), "utf8")); }
  return d;
}

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const warnRow = (id: string, basis: string, event: number, pub: number) => ({
  filing_id: id, source: "state_warn", filer_raw: "Winnebago Industries", filer_norm: "winnebago industries",
  event_date: day(event), event_basis: "warn_notice_date", public_date: day(pub), public_basis: basis,
  source_read_at: new Date().toISOString(), source_url: "https://workforce.iowa.gov/x", source_name: "Iowa Workforce Development",
  status: "active", state: "IA", feed: "bln_raw", workers: 51, event_type: "layoff",
});
const upsert = (d: PGlite, rows: unknown[]) => d.query("SELECT * FROM public.layoff_filings_upsert($1::jsonb)", [JSON.stringify(rows)]);
const publicDate = async (d: PGlite, id: string) =>
  (await d.query<{ p: string }>("SELECT public_date::text AS p FROM public.layoff_filings WHERE filing_id = $1", [id])).rows[0]?.p;

describe("3. the writer keeps the first read's date; the stamp lag leaves our read out", () => {
  let before: PGlite, after: PGlite;
  beforeAll(async () => { before = await bootLayoffChain(false); after = await bootLayoffChain(true); });

  it("positive control: before the fix a second night's read re-dated the notice", async () => {
    await upsert(before, [warnRow("warn:ia-1", "our_first_fetch", 37, 3)]);
    await upsert(before, [warnRow("warn:ia-1", "our_first_fetch", 37, 0)]);
    expect(await publicDate(before, "warn:ia-1")).toBe(day(0));
  });

  it("a second night's read keeps the day of the first read; a state's own stamp still updates", async () => {
    await upsert(after, [warnRow("warn:ia-1", "our_first_fetch", 37, 3), warnRow("warn:or-1", "state_received", 37, 3)]);
    await upsert(after, [warnRow("warn:ia-1", "our_first_fetch", 37, 0), warnRow("warn:or-1", "state_received", 37, 1)]);
    expect(await publicDate(after, "warn:ia-1"), "the first read's date was overwritten").toBe(day(3));
    expect(await publicDate(after, "warn:or-1"), "a state's corrected stamp no longer lands").toBe(day(1));
  });

  it("the published stamp lag counts the states' stamps and never our own read", async () => {
    const lag = async (d: PGlite) => {
      await d.query("SELECT * FROM public.refresh_layoff_partition()");
      return (await d.query<{ warn_lag_n: number; warn_lag_p50_days: string | null }>(
        "SELECT warn_lag_n, warn_lag_p50_days FROM public.job_board_layoff_partition WHERE arm = 'filed'")).rows[0];
    };
    for (const d of [before, after]) {
      await d.exec("DELETE FROM public.layoff_filings");
      await upsert(d, [warnRow("warn:first-read", "our_first_fetch", 40, 1), warnRow("warn:stamped", "state_received", 30, 28)]);
    }
    expect((await lag(before)).warn_lag_n, "positive control: before the fix our read fed the lag").toBe(2);
    const a = await lag(after);
    expect(a.warn_lag_n).toBe(1);
    expect(Number(a.warn_lag_p50_days)).toBe(2);
  });

  it("the retire is service_role only, and the writer stays closed to anon", async () => {
    const can = async (role: string, sig: string) =>
      (await after.query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, sig])).rows[0].ok;
    const sig = "public.layoff_warn_retire_unseen(text, text, text[], date, date)";
    expect(await can("anon", sig)).toBe(false);
    expect(await can("authenticated", sig)).toBe(false);
    expect(await can("service_role", sig)).toBe(true);
    expect(await can("anon", "public.layoff_filings_upsert(jsonb)")).toBe(false);
  });

  it("the stamp-lag anchor is in the live writer's body too (20261002122309, then 20261009160100), not only in the lane's first one", () => {
    const live = readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith("20261002122309_"))!), "utf8");
    const il = "     AND f.event_basis = 'warn_notice_date'\n     AND f.event_date >= current_date - 90;";
    expect(live).toContain(il);
    const afterIl = live.replace(il, "     AND f.event_basis = 'warn_notice_date'\n     AND f.status = 'active'\n     AND f.event_date <= f.public_date\n     AND f.event_date >= current_date - 90;");
    expect(afterIl).toContain("     AND f.status = 'active'\n     AND f.event_date <= f.public_date\n     AND f.event_date >= current_date - 90;");
  });

  it("the build's readiness probe and the writer's first-read rule ship in one migration, so the probe answering proves the writer is in", () => {
    const sql = readFileSync(resolve(MIGRATIONS, FIX), "utf8");
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.layoff_warn_retire_unseen/);
    expect(sql).toMatch(/LEAST\(f\.public_date, EXCLUDED\.public_date\)/);
  });
});
