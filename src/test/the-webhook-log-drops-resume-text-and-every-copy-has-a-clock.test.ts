// @vitest-environment node
/**
 * THE WEBHOOK LOG DROPS RÉSUMÉ TEXT, AND EVERY COPY HAS A CLOCK.
 *
 * Migration 20261004150000, applied to pglite over a stand-in of the five
 * tables it touches and of pg_cron (pglite has no pg_cron). It holds that:
 *   - stored webhook payloads lose metadata.resumeData wherever it sits, and
 *     the events themselves, and every other key, survive;
 *   - a row written afterwards -- by insert or by update -- cannot carry it;
 *   - the four stores the site now dates are purged at the published clocks,
 *     immediately and by a scheduled job, and nothing outside a clock moves;
 *   - the helper is closed to anon and authenticated, open to service_role;
 *   - re-applying is harmless, and a database without pg_cron refuses the
 *     file instead of publishing a retention nothing enforces.
 */
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const FILE = readdirSync(resolve(ROOT, "supabase/migrations")).find((f) => f.startsWith("20261004150000_"))!;
const SQL = readFileSync(resolve(ROOT, "supabase/migrations", FILE), "utf8");

const CRON = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (
    jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
    database text NOT NULL DEFAULT 'postgres', username text NOT NULL DEFAULT 'postgres',
    active boolean NOT NULL DEFAULT true, jobname text UNIQUE
  );
  CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
    RETURNING jobid;
  $$;
  CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$
    WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT count(*) > 0 FROM d;
  $$;
`;

// The tables as the production migrations define them.
const TABLES = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.webhook_events (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    event_type text NOT NULL, event_id text NOT NULL UNIQUE,
    payload jsonb, processed boolean DEFAULT false, processing_error text, processing_time_ms integer
  );
  ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Service role only" ON public.webhook_events FOR ALL USING (false) WITH CHECK (false);
  CREATE TABLE public.temp_resume_storage (
    session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_text text NOT NULL, linkedin_text text, job_description_text text,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
    created_at timestamptz DEFAULT now()
  );
  CREATE TABLE public.ai_response_cache (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, cache_key text NOT NULL, function_name text NOT NULL,
    response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, hit_count integer NOT NULL DEFAULT 0
  );
  CREATE TABLE public.scan_report_cache (cache_key text PRIMARY KEY, report jsonb NOT NULL, engine_version text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.resume_analyses (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    share_id text NOT NULL UNIQUE DEFAULT md5(random()::text),
    resume_text text, analysis_result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz DEFAULT now() + interval '30 days'
  );
`;

const SEED = `
  INSERT INTO public.webhook_events (event_type, event_id, payload) VALUES
    ('checkout.session.completed', 'evt_top', '{"id":"cs_a","metadata":{"resumeData":"\\"Jordan Probe\\\\njordan@example.com","originalCurrency":"usd","baseAmountUSD":"5"},"amount_total":500}'),
    ('checkout.session.expired', 'evt_nested', '{"id":"cs_b","metadata":{"product_type":"full_analysis"},"lines":[{"metadata":{"resumeData":"Jordan Probe"}}]}'),
    ('charge.refunded', 'evt_clean', '{"id":"ch_c","metadata":{"charge_id":"ch_c"}}'),
    ('checkout.session.completed', 'evt_null', NULL);
  INSERT INTO public.temp_resume_storage (resume_text, created_at, expires_at) VALUES
    ('expired text', now() - interval '30 hours', now() - interval '6 hours'),
    ('fresh text', now() - interval '1 hour', now() + interval '23 hours'),
    ('overlong text', now() - interval '1 hour', now() + interval '6 days');
  INSERT INTO public.ai_response_cache (cache_key, function_name, response, expires_at) VALUES
    ('k1', 'analyze-resume', '{}', now() - interval '1 minute'),
    ('k2', 'analyze-resume', '{}', now() + interval '40 hours');
  INSERT INTO public.scan_report_cache (cache_key, report, created_at) VALUES
    ('old', '{"atsParsedPreview":"Jordan Probe"}', now() - interval '8 days'),
    ('new', '{"atsParsedPreview":"Jordan Probe"}', now() - interval '2 days');
  INSERT INTO public.resume_analyses (share_id, analysis_result, created_at, expires_at) VALUES
    ('past', '{}', now() - interval '100 days', now() - interval '10 days'),
    ('live', '{}', now() - interval '10 days', now() + interval '80 days'),
    ('undated_old', '{}', now() - interval '120 days', NULL),
    ('undated_new', '{}', now() - interval '5 days', NULL);
`;

// Every database a case opens is closed after it: each pglite holds its own
// Postgres in memory, and seven left open is a few hundred megabytes on a
// machine that is also running the rest of the suite.
const opened: PGlite[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.close().catch(() => undefined);
});

async function boot(withCron = true): Promise<PGlite> {
  const db = new PGlite();
  opened.push(db);
  await db.exec((withCron ? CRON : "") + TABLES + SEED);
  return db;
}
const rows = async <T>(db: PGlite, q: string) => (await db.query<T>(q)).rows;

// pglite boots a fresh Postgres per test; on a machine running several suites at
// once that alone can pass the 5-second default, so this file states its own.
describe("migration 20261004150000 on a database that has the leak", { timeout: 60_000 }, () => {
  it("scrubs the stored payloads at every depth and keeps the events and every other key", async () => {
    const db = await boot();
    await db.exec(SQL);
    const ev = Object.fromEntries((await rows<{ event_id: string; payload: Record<string, unknown> | null }>(db, "SELECT event_id, payload FROM public.webhook_events")).map((r) => [r.event_id, r.payload]));
    expect(Object.keys(ev).sort()).toEqual(["evt_clean", "evt_nested", "evt_null", "evt_top"]);
    expect(ev.evt_top).toEqual({ id: "cs_a", metadata: { originalCurrency: "usd", baseAmountUSD: "5" }, amount_total: 500 });
    expect(ev.evt_nested).toEqual({ id: "cs_b", metadata: { product_type: "full_analysis" }, lines: [{ metadata: {} }] });
    expect(ev.evt_clean).toEqual({ id: "ch_c", metadata: { charge_id: "ch_c" } });
    expect(ev.evt_null).toBeNull();
  });

  it("refuses the text on every later write, insert or update, whoever writes", async () => {
    const db = await boot();
    await db.exec(SQL);
    await db.exec(`INSERT INTO public.webhook_events (event_type, event_id, payload) VALUES ('checkout.session.expired', 'evt_late', '{"metadata":{"resumeData":"late","k":"v"}}')`);
    await db.exec(`UPDATE public.webhook_events SET payload = '{"metadata":{"resumeData":"again"}}' WHERE event_id = 'evt_clean'`);
    const ev = Object.fromEntries((await rows<{ event_id: string; payload: unknown }>(db, "SELECT event_id, payload FROM public.webhook_events")).map((r) => [r.event_id, r.payload]));
    expect(ev.evt_late).toEqual({ metadata: { k: "v" } });
    expect(ev.evt_clean).toEqual({ metadata: {} });
    // The self-verify's probe row does not survive the apply.
    expect((await rows(db, "SELECT 1 FROM public.webhook_events WHERE event_type LIKE 'selfcheck%'")).length).toBe(0);
  });

  it("purges each store at its published clock and nothing inside one", async () => {
    const db = await boot();
    await db.exec(SQL);
    const temp = await rows<{ resume_text: string; within: boolean }>(db, "SELECT resume_text, expires_at <= coalesce(created_at, now()) + interval '24 hours' AS within FROM public.temp_resume_storage ORDER BY resume_text");
    expect(temp).toEqual([{ resume_text: "fresh text", within: true }, { resume_text: "overlong text", within: true }]);
    expect((await rows<{ cache_key: string }>(db, "SELECT cache_key FROM public.ai_response_cache")).map((r) => r.cache_key)).toEqual(["k2"]);
    expect((await rows<{ cache_key: string }>(db, "SELECT cache_key FROM public.scan_report_cache")).map((r) => r.cache_key)).toEqual(["new"]);
    expect((await rows<{ share_id: string }>(db, "SELECT share_id FROM public.resume_analyses ORDER BY share_id")).map((r) => r.share_id)).toEqual(["live", "undated_new"]);
    // New rows get the published clocks by default.
    await db.exec("INSERT INTO public.temp_resume_storage (resume_text) VALUES ('now')");
    await db.exec("INSERT INTO public.resume_analyses (share_id, analysis_result) VALUES ('now', '{}')");
    const [t] = await rows<{ h: number }>(db, "SELECT round(extract(epoch FROM expires_at - now()) / 3600) AS h FROM public.temp_resume_storage WHERE resume_text = 'now'");
    const [a] = await rows<{ d: number }>(db, "SELECT round(extract(epoch FROM expires_at - now()) / 86400) AS d FROM public.resume_analyses WHERE share_id = 'now'");
    expect(Number(t.h)).toBe(24);
    expect(Number(a.d)).toBe(90);
  });

  it("schedules the four jobs, and each job's command does what the page says", async () => {
    const db = await boot();
    await db.exec(SQL);
    const jobs = Object.fromEntries((await rows<{ jobname: string; schedule: string; command: string; active: boolean }>(db, "SELECT jobname, schedule, command, active FROM cron.job")).map((j) => [j.jobname, j]));
    expect(Object.keys(jobs).sort()).toEqual(["ai-response-cache-retention", "scan-report-cache-retention", "shared-analysis-retention", "temp-resume-retention"]);
    expect(jobs["temp-resume-retention"].schedule).toBe("*/15 * * * *");
    // Run each command as pg_cron would, against rows that have since expired.
    await db.exec(`
      INSERT INTO public.temp_resume_storage (resume_text, created_at, expires_at) VALUES ('stale', now() - interval '25 hours', now() - interval '1 hour');
      INSERT INTO public.ai_response_cache (cache_key, function_name, response, expires_at) VALUES ('k3', 'free-keyword-scan-stream', '{}', now() - interval '1 second');
      INSERT INTO public.scan_report_cache (cache_key, report, created_at) VALUES ('stale', '{}', now() - interval '7 days 1 minute');
      INSERT INTO public.resume_analyses (share_id, analysis_result, expires_at) VALUES ('stale', '{}', now() - interval '1 second');
    `);
    for (const j of Object.values(jobs)) await db.exec(j.command);
    expect((await rows(db, "SELECT 1 FROM public.temp_resume_storage WHERE resume_text = 'stale'")).length).toBe(0);
    expect((await rows(db, "SELECT 1 FROM public.ai_response_cache WHERE cache_key = 'k3'")).length).toBe(0);
    expect((await rows(db, "SELECT 1 FROM public.scan_report_cache WHERE cache_key = 'stale'")).length).toBe(0);
    expect((await rows(db, "SELECT 1 FROM public.resume_analyses WHERE share_id = 'stale'")).length).toBe(0);
    expect((await rows(db, "SELECT 1 FROM public.scan_report_cache WHERE cache_key = 'new'")).length).toBe(1);
  });

  it("closes the helper to anon and authenticated, and service_role can still write the table", async () => {
    const db = await boot();
    await db.exec(SQL);
    for (const role of ["anon", "authenticated"]) {
      await expect(db.exec(`SET ROLE ${role}; SELECT public.strip_resume_keys('{}'::jsonb);`)).rejects.toThrow(/permission denied/);
      await db.exec("RESET ROLE");
    }
    await db.exec("GRANT INSERT, SELECT ON public.webhook_events TO service_role; ALTER TABLE public.webhook_events DISABLE ROW LEVEL SECURITY;");
    await db.exec(`SET ROLE service_role; INSERT INTO public.webhook_events (event_type, event_id, payload) VALUES ('x', 'evt_service', '{"metadata":{"resumeData":"s"}}'); RESET ROLE;`);
    const [r] = await rows<{ payload: unknown }>(db, "SELECT payload FROM public.webhook_events WHERE event_id = 'evt_service'");
    expect(r.payload).toEqual({ metadata: {} });
  });

  it("re-applies cleanly", async () => {
    const db = await boot();
    await db.exec(SQL);
    await db.exec(SQL);
    expect((await rows(db, "SELECT 1 FROM cron.job")).length).toBe(4);
  });

  it("refuses the file on a database with no pg_cron, rather than publish a clock nothing enforces", async () => {
    const db = await boot(false);
    await expect(db.exec(SQL)).rejects.toThrow(/pg_cron is absent/);
  });
});
