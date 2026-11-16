// @vitest-environment node
/**
 * A NOTICE THE STATE EDITS IN PLACE RETIRES ITS OLD READING (S14X-069).
 *
 * Washington moved Alaska Airlines' notice (received 2026-10-30, 121 workers)
 * from "SeaTac" to "Seattle, Spokane, Renton". The dedupe key hashes the site,
 * so the edit was a new filing id; the writer only upserts, so the old reading
 * stayed active beside it and the employer page listed one notice twice
 * (la_total_n 2).
 *
 *   1. the shipped handler (edge harness): after each changed, fully mapped
 *      read of a whole-history feed it calls layoff_warn_retire_unseen with the
 *      ids the read produced and the read's own event-date span; the edited
 *      notice's first id is absent from the second read's list;
 *   2. pglite (Supabase's default grants), the layoff lane's chain, then
 *      20261112182000: the unseen row inside the span is superseded and the
 *      reader returns one row; a row outside the span stays; the breaker
 *      retires nothing when one read would retire too many; and the migration's
 *      one-off pass retires today's stale duplicate.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb } from "./helpers/proxy-db";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const FIX = "20261112182000_a_state_notice_keeps_the_day_we_first_read_it_and_an_edited_one_retires_its_old_reading.sql";

// ── 1. the shipped handler ─────────────────────────────────────────────────

const SECRET = "test-layoff-cron-secret-0123456789";
const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LAYOFF_CRON_SECRET: SECRET };
const WA_HEADER = "Company,Location,Layoff Start Date,# of Workers,Closure Layoff,Type of Layoff,Received Date,Notice";
const waCsv = (alaskaSite: string) => [
  WA_HEADER,
  `Alaska Airlines,${alaskaSite.includes(",") ? `"${alaskaSite}"` : alaskaSite},12/31/2026,121,Layoff,Permanent,10/30/2026,`,
  "Pacific Ag Services LLC,Grant and Franklin Counties,11/15/2026,530,Layoff,Permanent,9/16/2026,",
].join("\n") + "\n";

let wa = "";
let retire: Array<Record<string, unknown>> = [];
let upserted: Array<Record<string, unknown>> = [];
let handler: EdgeHandler;
let db: ProxyDb;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (_p: Promise<unknown>) => {} };
  g.fetch = async (url: string) => {
    if (!/\/raw\/wa\.csv$/.test(String(url)) || !wa) return new Response("not here", { status: 404 });
    return new Response(wa, { status: 200, headers: { etag: `W/"wa-${wa.length}"`, "content-type": "text/csv" } });
  };
  db = new ProxyDb();
  db.answer = (q) => {
    if (q.rpc === "layoff_warn_retire_unseen") {
      const a = q.calls[0][1][0] as Record<string, unknown>;
      if (a.p_state) retire.push(a);
      return { data: [{ lr_retired: a.p_state ? 1 : 0, lr_candidates: a.p_state ? 1 : 0, lr_active: 2, lr_refused: false }], error: null };
    }
    if (q.rpc === "layoff_filings_upsert") {
      const rows = (q.calls[0][1][0] as { p_rows: Array<Record<string, unknown>> }).p_rows;
      upserted.push(...rows);
      return { data: [{ lu_inserted: rows.length, lu_updated: 0, lu_refused: 0 }], error: null };
    }
    return undefined;
  };
  g.__layoffDb = db;
  handler = await loadEdgeHandler("layoff-filings", {
    "https://deno.land/std@0.190.0/http/server.ts": "export const serve = (h) => { globalThis.__edgeHandler = h; };",
    "https://esm.sh/xlsx@0.18.5": "export const read = () => ({ Sheets: {}, SheetNames: [] }); export const utils = { sheet_to_json: () => [] };",
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__layoffDb;",
  });
});
afterEach(() => { vi.useRealTimers(); });

const slice = async (at: string) => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(at) });
  const res = await handler(new Request("https://h.supabase.co/functions/v1/layoff-filings", {
    method: "POST", headers: { "content-type": "application/json", "x-layoff-cron": SECRET }, body: JSON.stringify({ action: "warn", cursor: 3 }),
  }));
  vi.useRealTimers();
  return res.json() as Promise<{ ok: boolean; notes: string[] }>;
};

describe("1. the shipped handler retires what a whole-history read no longer holds", () => {
  it("the second read's retire call leaves out the edited notice's first id, inside the read's own span", async () => {
    wa = waCsv("SeaTac");
    await slice("2026-11-03T03:40:00Z");
    const first = upserted.filter((r) => r.state === "WA" && r.filer_raw === "Alaska Airlines");
    expect(first.length).toBe(1);
    const oldId = String(first[0].filing_id);
    expect(retire.length, "a changed read of a whole-history feed called no retire").toBe(1);
    expect(retire[0].p_seen).toContain(oldId);

    upserted = []; retire = [];
    wa = waCsv("Seattle, Spokane, Renton");
    await slice("2026-11-07T03:40:00Z");
    const edited = upserted.find((r) => r.state === "WA" && r.filer_raw === "Alaska Airlines")!;
    expect(edited.filing_id, "positive control: the edit is a new dedupe key").not.toBe(oldId);
    expect(retire.length).toBe(1);
    const call = retire[0];
    expect(call).toMatchObject({ p_state: "WA", p_feed: "bln_raw", p_from: "2026-09-16", p_to: "2026-10-30" });
    expect(call.p_seen).toContain(edited.filing_id);
    expect(call.p_seen, "the edited notice's old reading was named as seen").not.toContain(oldId);
  });
});

// ── 2. the retire, in Postgres ─────────────────────────────────────────────

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
    last_seen timestamptz, missing_since timestamptz, country text, region_code text);
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer, absence_basis text);
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz);
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now());
`;
async function boot(): Promise<PGlite> {
  const d = new PGlite();
  await d.exec(STAND_INS);
  for (const f of CHAIN) await d.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));
  return d;
}
const fix = (d: PGlite) => d.exec(readFileSync(resolve(MIGRATIONS, FIX), "utf8"));

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const TOKEN = "talent.alaskaair.com";
/** A WA row as the writer stores it; `seenHoursAgo` is when a read last produced it. */
const row = (id: string, site: string, eventDaysAgo: number, seenHoursAgo = 0, filer = "Alaska Airlines", state = "WA") => `
  INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis,
    source_read_at, source_url, source_name, status, state, feed, workers, event_type, site_raw, last_seen_at)
  VALUES ('${id}', 'state_warn', '${filer}', lower('${filer}'), '${day(eventDaysAgo)}', 'warn_received', '${day(eventDaysAgo)}', 'state_received',
    now(), 'https://esd.wa.gov/x', 'Washington ESD', 'active', '${state}', 'bln_raw', 121, 'layoff', '${site}', now() - interval '${seenHoursAgo} hours');`;
const match = (id: string) => `
  INSERT INTO public.layoff_matches (filing_id, company_token, matched_via, matched_norm, relation)
  VALUES ('${id}', '${TOKEN}', 'exact_multitoken', 'alaska airlines', 'filer');`;
const statusOf = async (d: PGlite) =>
  Object.fromEntries((await d.query<{ filing_id: string; status: string }>("SELECT filing_id, status FROM public.layoff_filings ORDER BY 1")).rows.map((r) => [r.filing_id, r.status]));
type Retire = { lr_retired: number; lr_candidates: number; lr_active: number; lr_refused: boolean };
const retireRpc = async (d: PGlite, seen: string[], from: string | null, to: string | null, state = "WA") =>
  (await d.query<Retire>("SELECT * FROM public.layoff_warn_retire_unseen($1, 'bln_raw', $2::text[], $3::date, $4::date)", [state, seen, from, to])).rows[0];

describe("2. the retire, in Postgres", () => {
  it("the edited notice's old reading is superseded, the employer page lists the notice once, and a row outside the read's span stays", async () => {
    const d = await boot();
    await fix(d);
    await d.exec(row("warn:alaska-seatac", "SeaTac", 17) + row("warn:alaska-seattle", "Seattle, Spokane, Renton", 17) + match("warn:alaska-seatac") + match("warn:alaska-seattle"));
    await d.exec(row("warn:pacific", "Grant and Franklin Counties", 30, 0, "Pacific Ag Services LLC"));
    await d.exec(row("warn:older", "Tacoma", 80, 0, "Older Co"));
    const before = await d.query<{ la_total_n: number }>("SELECT * FROM public.get_employer_layoff_filings_all($1)", [TOKEN]);
    expect(before.rows.length, "positive control: the page listed one notice twice").toBe(2);
    const r = await retireRpc(d, ["warn:alaska-seattle", "warn:pacific"], day(30), day(17));
    expect(r).toEqual({ lr_retired: 1, lr_candidates: 1, lr_active: 4, lr_refused: false });
    expect(await statusOf(d)).toEqual({
      "warn:alaska-seatac": "superseded", "warn:alaska-seattle": "active", "warn:older": "active", "warn:pacific": "active",
    });
    const after = await d.query<{ la_site: string; la_total_n: number }>("SELECT * FROM public.get_employer_layoff_filings_all($1)", [TOKEN]);
    expect(after.rows.map((x) => [x.la_site, x.la_total_n])).toEqual([["Seattle, Spokane, Renton", 1]]);
  });

  it("the breaker retires nothing when one read would retire too many; a read with no span retires nothing", async () => {
    const d = await boot();
    await fix(d);
    let sql = "";
    for (let i = 0; i < 30; i++) sql += row(`warn:bulk-${String(i).padStart(2, "0")}`, `Site ${i}`, 20 + (i % 5), 0, `Bulk Co ${i}`);
    await d.exec(sql);
    const r = await retireRpc(d, [], day(40), day(10));
    expect(r).toEqual({ lr_retired: 0, lr_candidates: 30, lr_active: 30, lr_refused: true });
    // Four of thirty is past the 10% bar too.
    const ids = Array.from({ length: 30 }, (_x, i) => `warn:bulk-${String(i).padStart(2, "0")}`);
    expect(await retireRpc(d, ids.slice(4), day(40), day(10))).toEqual({ lr_retired: 0, lr_candidates: 4, lr_active: 30, lr_refused: true });
    // Two retire: two is never past the bar.
    expect(await retireRpc(d, ids.slice(2), day(40), day(10))).toEqual({ lr_retired: 2, lr_candidates: 2, lr_active: 30, lr_refused: false });
    expect(await retireRpc(d, [], null, null)).toEqual({ lr_retired: 0, lr_candidates: 0, lr_active: 0, lr_refused: false });
    expect(await retireRpc(d, [], null, null, "")).toEqual({ lr_retired: 0, lr_candidates: 0, lr_active: 0, lr_refused: false });
    const active = (await d.query<{ n: number }>("SELECT count(*)::int AS n FROM public.layoff_filings WHERE status = 'active'")).rows[0].n;
    expect(active).toBe(28);
  });

  it("the migration's one-off pass retires today's stale duplicate: the row the feed's latest read did not see, inside that read's span", async () => {
    const d = await boot();
    // Today's state: the last read (now) produced Seattle and Pacific; SeaTac was last produced four days ago.
    await d.exec(row("warn:alaska-seatac", "SeaTac", 17, 96) + row("warn:alaska-seattle", "Seattle, Spokane, Renton", 17, 0) + row("warn:pacific", "Grant and Franklin Counties", 30, 0, "Pacific Ag Services LLC"));
    // Outside the latest read's span: not retired, however old its last sighting.
    await d.exec(row("warn:older", "Tacoma", 80, 96, "Older Co"));
    // Another state's feed is judged by its own latest read.
    await d.exec(row("warn:or-1", "Portland", 20, 30, "Oregon Co", "OR"));
    await fix(d);
    expect(await statusOf(d)).toEqual({
      "warn:alaska-seatac": "superseded", "warn:alaska-seattle": "active", "warn:older": "active", "warn:or-1": "active", "warn:pacific": "active",
    });
    // Safe to re-run.
    await fix(d);
    expect((await statusOf(d))["warn:alaska-seattle"]).toBe("active");
  });
});
