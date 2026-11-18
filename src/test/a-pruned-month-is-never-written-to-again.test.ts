// @vitest-environment node
/**
 * A PRUNED MONTH IS NEVER WRITTEN TO AGAIN (S14X-158).
 *
 * The monthly prune floored its keep window at 180 days while the writers
 * keep 365 (LAYOFF_RETENTION_DAYS; the EDGAR backfill searches a year by
 * filing date), and no writer refused a row in a month the prune had already
 * rolled up: an 8-K filed 2025-12-02 for a 2025-11-28 report, read on
 * 2026-12-03, was stored in November 2025 after November was counted.
 *
 *   1. pglite (Supabase's default grants): 20261110160000 then the fix; a run
 *      asked for 200 days prunes nothing newer than 365 days;
 *   2. the floor the database applies is the writers' LAYOFF_RETENTION_DAYS;
 *   3. the shipped handler (edge harness, clock at 2026-12-03) refuses that
 *      8-K at the write and still writes one dated inside the kept month.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migFile } from "./helpers/fixed-clock-sql";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb } from "./helpers/proxy-db";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const HOTFIX = "20261110160000_a_pruned_filing_is_counted_once_in_the_column_its_status_names.sql";
const FIX = "20261112181000_a_pruned_month_is_never_written_to_again.sql";
const INDEX = readFileSync(resolve(__dirname, "../../supabase/functions/layoff-filings/index.ts"), "utf8");

const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.layoff_filings (
    filing_id text PRIMARY KEY, source text NOT NULL, status text NOT NULL DEFAULT 'active',
    form text, is_workforce_event boolean, state char(2), event_date date NOT NULL, workers int);
  CREATE TABLE public.layoff_filing_rollup (
    month date NOT NULL, source text NOT NULL, state text NOT NULL DEFAULT '', filings int NOT NULL DEFAULT 0,
    workers_sum bigint, rolled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (month, source, state));
  CREATE TABLE public.layoff_read_log (id bigserial PRIMARY KEY, read_at timestamptz NOT NULL);
  ALTER TABLE public.layoff_filing_rollup ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.layoff_filings FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON TABLE public.layoff_filing_rollup FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON TABLE public.layoff_read_log FROM PUBLIC, anon, authenticated;
`;
const ROWS = `
  INSERT INTO public.layoff_filings (filing_id, source, state, event_date, workers) VALUES
    ('warn:kept-250', 'state_warn', 'CA', current_date - 250, 120),
    ('warn:gone-420', 'state_warn', 'CA', current_date - 420, 60);
`;
async function boot(withFix: boolean): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migFile(HOTFIX));
  if (withFix) { await db.exec(migFile(FIX)); await db.exec(migFile(FIX)); }
  await db.exec(ROWS);
  return db;
}
const left = async (db: PGlite) => (await db.query<{ filing_id: string }>("SELECT filing_id FROM public.layoff_filings ORDER BY 1")).rows.map((r) => r.filing_id);

describe("1-2. the prune keeps the writers' window", () => {
  let before: PGlite, after: PGlite;
  beforeAll(async () => { before = await boot(false); after = await boot(true); });

  it("positive control: before the fix a 200-day run pruned a month the writers still write", async () => {
    await before.query("SELECT * FROM public.roll_up_and_prune_layoff_filings(200)");
    expect(await left(before)).toEqual([]);
  });

  it("a run asked for 200 days prunes nothing newer than 365 days", async () => {
    await after.query("SELECT * FROM public.roll_up_and_prune_layoff_filings(200)");
    expect(await left(after), "a month inside the writers' window was pruned").toEqual(["warn:kept-250"]);
  });

  it("the floor the database applies is LAYOFF_RETENTION_DAYS", async () => {
    const def = (await after.query<{ d: string }>("SELECT pg_get_functiondef('public.roll_up_and_prune_layoff_filings(int)'::regprocedure) AS d")).rows[0].d;
    const floor = /GREATEST\(COALESCE\(p_keep_days, 365\), (\d+)\)/.exec(def)?.[1];
    const writers = /export const LAYOFF_RETENTION_DAYS = (\d+);/.exec(INDEX)?.[1];
    expect(writers).toBeDefined();
    expect(floor, "the prune's floor is not the writers' window").toBe(writers);
  });
});

// ── 3. the write ─────────────────────────────────────────────────────────────

const SECRET = "test-layoff-cron-secret-0123456789";
const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LAYOFF_CRON_SECRET: SECRET };
const CIK = 4242;
const ROLLED = "0001234567-25-000300";
const KEPT = "0001234567-25-000301";
const doc = `<html><body><p>Item 2.05 Costs Associated with Exit or Disposal Activities.</p><p>On November 28, 2025, the Board approved a reduction in force of approximately 140 employees.</p><p>Item 9.01 Exhibits.</p></body></html>`;
const subs = JSON.stringify({
  cik: String(CIK), name: "Acme Corp", tickers: ["ACME"],
  filings: { recent: {
    accessionNumber: [ROLLED, KEPT], form: ["8-K", "8-K"], filingDate: ["2025-12-02", "2025-12-08"], reportDate: ["2025-11-28", "2025-12-05"],
    acceptanceDateTime: ["2025-12-02T16:05:00.000Z", "2025-12-08T16:05:00.000Z"], items: ["2.05", "2.05"], primaryDocument: ["a.htm", "b.htm"],
  }, files: [] },
});
const hit = (adsh: string, fileDate: string) => ({ _source: { adsh, ciks: [String(CIK)], items: ["2.05"], form: "8-K", file_date: fileDate, display_names: ["Acme Corp"] } });

describe("3. the write choke point refuses a month already rolled up", () => {
  let handler: EdgeHandler;
  let db: ProxyDb;
  const written: Array<Record<string, unknown>> = [];
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.EdgeRuntime = { waitUntil: (_p: Promise<unknown>) => {} };
    g.fetch = async (input: string) => {
      const url = String(input);
      if (url.startsWith("https://efts.sec.gov/")) return new Response(JSON.stringify({ hits: { hits: [hit(ROLLED, "2025-12-02"), hit(KEPT, "2025-12-08")] } }), { status: 200 });
      if (url === `https://data.sec.gov/submissions/CIK${String(CIK).padStart(10, "0")}.json`) return new Response(subs, { status: 200 });
      if (/\/Archives\/edgar\/data\/.+\.htm$/.test(url)) return new Response(doc, { status: 200, headers: { "content-type": "text/html" } });
      return new Response("not found", { status: 404 });
    };
    db = new ProxyDb();
    db.answer = (q) => {
      if (q.rpc === "layoff_filings_upsert") {
        const rows = (q.calls[0][1][0] as { p_rows: Array<Record<string, unknown>> }).p_rows;
        written.push(...rows);
        return { data: [{ lu_inserted: rows.length, lu_updated: 0, lu_refused: 0 }], error: null };
      }
      return undefined;
    };
    g.__layoffDb = db;
    handler = await loadEdgeHandler("layoff-filings", {
      "https://deno.land/std@0.190.0/http/server.ts": "export const serve = (h) => { globalThis.__edgeHandler = h; };",
      "npm:xlsx@0.18.5": "export const read = () => ({ Sheets: {}, SheetNames: [] }); export const utils = { sheet_to_json: () => [] };",
      "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__layoffDb;",
    });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-03T12:00:00Z") });
  });
  afterAll(() => { vi.useRealTimers(); });

  it("an 8-K filed inside the window for a report in a rolled-up month is refused; one in the kept month is written", async () => {
    const res = await handler(new Request("https://h.supabase.co/functions/v1/layoff-filings", {
      method: "POST", headers: { "content-type": "application/json", "x-layoff-cron": SECRET }, body: JSON.stringify({ action: "edgar_backfill" }),
    }));
    const body = await res.json() as { refused: number; notes: string[] };
    expect(written.find((r) => r.filing_id === `sec:${ROLLED}`), "a 2025-11-28 report was written after November 2025 was rolled up").toBeUndefined();
    expect(written.find((r) => r.filing_id === `sec:${KEPT}`)?.event_date).toBe("2025-12-05");
    expect(body.refused).toBe(1);
    expect(body.notes.join(" ")).toMatch(/before 2025-12-01/);
  });
});
