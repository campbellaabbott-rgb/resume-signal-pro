// @vitest-environment node
//
// Node, not jsdom: the SQL runs in pglite.
/**
 * THE HEALTH PAGE COUNTS THE FAILURES SCANS WRITE, AND THE ANALYSES IT NEVER
 * SAW (S14X-156).
 *
 * WHAT WAS WRONG.
 *   - get_geo_latency_stats counted status = 'error' as a failure, a status
 *     no writer uses: scans log 'failed' and 'validation_error', so every
 *     country's failure rate read 0%. It also counted the heartbeat's and the
 *     scripts' own probes ('heartbeat', 'synthetic') as traffic.
 *   - get_ai_generation_metrics_hourly kept only rows with
 *     content_generation_started_at, which only the delivery lease stamps;
 *     analyze-resume takes no lease, so no Full Analysis ever reached the AI
 *     Generation chart.
 *
 * WHAT HOLDS NOW: the shipped definitions (20251224205114, 20251224180306,
 * closed as 20261004110000 closed them) are loaded on a real Postgres started
 * from Supabase's default grants, then this round's migration, twice (it is
 * safe to re-run). Seeded with 2 failed and 1 validation_error free scans, a
 * model fallback, 3 heartbeat and 1 synthetic rows, and a delivered Full
 * Analysis stamped only content_generation_completed_at:
 *   - before: 0 failed, the probes counted, no Full Analysis (the defect);
 *   - after: 4 failed of 6 real scans, no probe counted, the Full Analysis
 *     counted, a Pro entitlement row not counted as a generation;
 *   - anon and authenticated still cannot execute either; service_role can;
 *   - the migration's own self-check fails when a body lacks a predicate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR);
const fileOf = (stamp: string) => FILES.find((f) => f.startsWith(`${stamp}_`));
/** This round's file, found by what it does, so the integrator's final stamp does not move the test. */
const FILE = FILES.find((f) => /^2026111312\d{4}_the_health_page_counts_the_failures_scans_write/.test(f));
const SHIPPED = ["20251224205114", "20251224180306"].map((s) => readFileSync(resolve(DIR, fileOf(s)!), "utf8"));
const CLOSE = `
  REVOKE ALL ON FUNCTION public.get_geo_latency_stats(integer) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.get_ai_generation_metrics_hourly(integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_geo_latency_stats(integer) TO service_role;
  GRANT EXECUTE ON FUNCTION public.get_ai_generation_metrics_hourly(integer) TO service_role;
`;

let db: PGlite;

const TABLES = `
  ${SUPABASE_DEFAULTS}
  CREATE TABLE public.scan_metrics (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
    scan_type text NOT NULL DEFAULT 'free', status text NOT NULL, duration_ms integer, cache_hit boolean DEFAULT false, ai_model text,
    error_code text, error_message text, ip_country text, visitor_id text, input_length integer, output_valid boolean, response_score integer,
    metadata jsonb DEFAULT '{}'::jsonb);
  CREATE TABLE public.product_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
    stripe_session_id text NOT NULL, customer_email text, product_type text NOT NULL, status text NOT NULL DEFAULT 'payment_received',
    content_generation_started_at timestamptz, content_generation_completed_at timestamptz, generation_success boolean,
    generation_duration_ms integer, metadata jsonb);
  CREATE TABLE public.email_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), status text);
  CREATE TABLE public.webhook_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
    processed boolean, processing_error text, processing_time_ms integer);
`;

const SEED = `
  DELETE FROM public.scan_metrics; DELETE FROM public.product_deliveries;
  INSERT INTO public.scan_metrics (scan_type, status, duration_ms, ip_country, error_code) VALUES
    ('free', 'completed', 900, 'US', NULL), ('free', 'completed', 1100, 'US', 'MODEL_FALLBACK'),
    ('free', 'failed', 4000, 'US', 'AI_TIMEOUT'), ('free', 'failed', 3000, 'US', 'AI_ERROR'),
    ('free', 'validation_error', 10, 'US', 'TOO_SHORT'), ('free', 'completed', 950, 'US', NULL),
    ('heartbeat', 'failed', 30000, 'US', 'AI_TIMEOUT'), ('heartbeat', 'completed', 25000, 'US', NULL), ('heartbeat', 'completed', 26000, 'US', NULL),
    ('synthetic', 'failed', 5000, 'US', NULL);
  INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, content_generation_started_at, content_generation_completed_at, generation_success, generation_duration_ms) VALUES
    ('cs_leased', 'premium_package', 'delivered', now(), now(), true, 20000),
    ('cs_fa', 'full_analysis', 'delivered', NULL, now(), true, NULL),
    ('cs_pro', 'pro_subscription', 'delivered', NULL, now(), true, NULL),
    ('cs_paid_only', 'full_analysis', 'payment_received', NULL, NULL, NULL, NULL);
`;

const geo = async () => (await db.query<{ country: string; total_scans: string | number; failed_scans: string | number }>(
  "SELECT country, total_scans, failed_scans FROM public.get_geo_latency_stats(24)")).rows.map((r) => ({ country: r.country, total: Number(r.total_scans), failed: Number(r.failed_scans) }));
const ai = async () => (await db.query<{ total_generations: string | number; successful_generations: string | number }>(
  "SELECT total_generations, successful_generations FROM public.get_ai_generation_metrics_hourly(24)")).rows
  .reduce((a, r) => ({ total: a.total + Number(r.total_generations), ok: a.ok + Number(r.successful_generations) }), { total: 0, ok: 0 });
const canRun = async (role: string, fn: string) =>
  (await db.query<{ ok: boolean }>(`SELECT has_function_privilege('${role}', 'public.${fn}(integer)', 'EXECUTE') AS ok`)).rows[0].ok;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(TABLES);
  for (const sql of SHIPPED) await db.exec(sql);
  await db.exec(CLOSE);
  await db.exec(SEED);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("the shipped readers (the defect, kept as the baseline)", () => {
  it("count no failed scan, count the probes, and never see the Full Analysis", async () => {
    expect(await geo()).toEqual([{ country: "US", total: 10, failed: 0 }]);
    expect(await ai()).toEqual({ total: 1, ok: 1 });
  });
});

describe("after this round's migration, applied twice", () => {
  beforeAll(async () => {
    expect(FILE, "the 20261113 migration re-creating the two health readers is missing").toBeTruthy();
    const sql = readFileSync(resolve(DIR, FILE!), "utf8");
    await db.exec(sql);
    await db.exec(sql);
  }, 60_000);

  it("geo counts failed, validation_error and a model fallback as failures, over real scans only", async () => {
    expect(await geo()).toEqual([{ country: "US", total: 6, failed: 4 }]);
  });

  it("the AI chart counts a delivered Full Analysis stamped only on completion, and no Pro entitlement", async () => {
    expect(await ai()).toEqual({ total: 2, ok: 2 });
  });

  it("anon and authenticated still cannot execute either reader; service_role can", async () => {
    for (const fn of ["get_geo_latency_stats", "get_ai_generation_metrics_hourly"]) {
      expect(await canRun("anon", fn), `${fn} opened to anon`).toBe(false);
      expect(await canRun("authenticated", fn), `${fn} opened to authenticated`).toBe(false);
      expect(await canRun("service_role", fn), `${fn} closed to service_role`).toBe(true);
    }
  });

  it("the migration's self-check fails when a reader lost its new predicate", async () => {
    const sql = readFileSync(resolve(DIR, FILE!), "utf8");
    const check = /DO \$self_check\$[\s\S]*?\$self_check\$;/.exec(sql)?.[0];
    expect(check, "no DO $self_check$ block in the migration").toBeTruthy();
    await db.exec(SHIPPED[0]);
    await expect(db.exec(check!)).rejects.toThrow(/get_geo_latency_stats/);
    await db.exec(sql);
    await expect(db.exec(check!)).resolves.toBeTruthy();
  });

  it("the self-check fails when a reader is opened to anon", async () => {
    const sql = readFileSync(resolve(DIR, FILE!), "utf8");
    const check = /DO \$self_check\$[\s\S]*?\$self_check\$;/.exec(sql)![0];
    await db.exec("GRANT EXECUTE ON FUNCTION public.get_ai_generation_metrics_hourly(integer) TO anon");
    await expect(db.exec(check)).rejects.toThrow(/get_ai_generation_metrics_hourly/);
    await db.exec(sql);
    expect(await canRun("anon", "get_ai_generation_metrics_hourly")).toBe(false);
  });
});
