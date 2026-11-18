// @vitest-environment node
/**
 * A LOG OLDER THAN NINETY DAYS KEEPS NO ADDRESS (S14X-042).
 *
 * The Privacy page says log data is kept for up to 90 days. Before
 * 20261112100000 nothing deleted an abandoned checkout (with the buyer's
 * email), error_telemetry, heartbeat_results or parse_failures, and four
 * tables kept the visitor's raw address forever: scan_metrics,
 * parse_failures and industry_detection_metrics in visitor_id, and
 * used_stripe_sessions in ip_address.
 *
 * Run in a real Postgres (pglite) under Supabase's default grants, with a
 * pg_cron stand-in, the tables built by the migrations that created them, and
 * the new migration applied twice. The paid-claim verdicts are read through
 * the two shared functions the generators use, so "the address became a
 * constant, never NULL" is proven by what they answer, not by the spelling.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./helpers/agent-db";
import { unnamedClaimRefusal } from "../../supabase/functions/_shared/paid-session";
import { priorRedemptionOf } from "../../supabase/functions/_shared/full-analysis";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const RETENTION = "20261112100000_a_log_keeps_no_address_past_ninety_days.sql";
const CREATORS = [
  "20251216023523_ec1953e6-2409-455e-924f-645f6f7f36b5.sql", // used_stripe_sessions
  "20251221232853_cb2ede5e-7500-463e-99e9-8c3be3fc26e1.sql", // error_telemetry
  "20251222170715_d19fa395-cdbc-48ce-a0f5-0d82b0e5ba52.sql", // payment_failures
  "20251223182331_0f66b3f3-9ea2-459b-9657-4f1880078e61.sql", // scan_metrics, heartbeat_results, log_scan_metric, log_heartbeat_result
  "20251223224123_1907cc89-5e4c-45fc-a5f1-835052ab2f80.sql", // parse_failures, log_parse_failure
  "20251226040656_209705f7-e115-43d1-a41c-d3595106c7dd.sql", // industry_detection_metrics, log_industry_detection
];
const CRON_STAND_IN = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command
    RETURNING jobid $$;
`;
const ADDR = "203.0.113.7";
const ago = (days: number) => `now() - interval '${days} days'`;

/** The claims a paid generator reads, seeded before the migration runs. */
const CLAIMS: Array<{ id: string; product: string | null; ip: string | null; usedAt: string }> = [
  { id: "cs_live_named_with_address", product: "full_analysis", ip: ADDR, usedAt: "2026-10-01T00:00:00Z" },
  { id: "cs_live_unnamed_with_address", product: null, ip: ADDR, usedAt: "2026-08-01T00:00:00Z" },
  { id: "cs_live_unnamed_webhook", product: null, ip: null, usedAt: "2026-08-01T00:00:00Z" },
  { id: "cs_live_named_webhook", product: "scan_pack", ip: null, usedAt: "2026-10-01T00:00:00Z" },
];

let db: PGlite;
const q = async <T>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;
type Claim = { session_id: string; product_type: string | null; ip_address: string | null; used_at: string };
const claims = async () => q<Claim>("SELECT session_id, product_type, ip_address, to_char(used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS used_at FROM public.used_stripe_sessions ORDER BY session_id");
const verdicts = (rows: Claim[]) => rows.map((c) => ({
  id: c.session_id,
  refusal: unnamedClaimRefusal(c.session_id, { ip_address: c.ip_address, used_at: c.used_at }),
  prior: priorRedemptionOf(null, { product_type: c.product_type, ip_address: c.ip_address }),
}));
let before: ReturnType<typeof verdicts>;
let scanRowsBefore = 0;
let visitorAddressesBefore = 0;

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
  await db.exec(CRON_STAND_IN);
  for (const f of CREATORS) await db.exec(migration(f));
  await db.exec(`
    ALTER TABLE public.used_stripe_sessions ADD COLUMN IF NOT EXISTS product_type text;
    CREATE TABLE public.pro_subscribers (
      email text PRIMARY KEY, stripe_customer_id text, status text NOT NULL DEFAULT 'inactive',
      current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), user_id uuid);
  `);

  // What the database held the day before: raw addresses everywhere.
  for (const c of CLAIMS) {
    await db.query("INSERT INTO public.used_stripe_sessions (session_id, product_type, ip_address, used_at) VALUES ($1, $2, $3, $4)",
      [c.id, c.product, c.ip, c.usedAt]);
  }
  await db.exec(`
    INSERT INTO public.scan_metrics (status, visitor_id, created_at) VALUES
      ('completed', '${ADDR}', ${ago(120)}), ('completed', '${ADDR}', ${ago(10)}), ('failed', NULL, ${ago(10)});
    INSERT INTO public.industry_detection_metrics
      (resume_text_length, server_industry, server_confidence, server_score, final_industry, final_confidence, detection_source, visitor_id, created_at)
      VALUES (900, 'general', 'low', 0, 'general', 'low', 'server_high', '${ADDR}', ${ago(120)});
    INSERT INTO public.parse_failures (file_type, visitor_id, created_at) VALUES ('pdf', '${ADDR}', ${ago(120)}), ('docx', '${ADDR}', ${ago(10)});
    INSERT INTO public.payment_failures (payment_intent_id, amount, failure_code, customer_email, created_at) VALUES
      ('pi_old_abandon', 500, 'checkout_expired', 'old@x.test', ${ago(120)}),
      ('pi_new_abandon', 500, 'checkout_expired', 'new@x.test', ${ago(10)}),
      ('pi_old_decline', 500, 'card_declined', 'declined@x.test', ${ago(120)}),
      ('pi_new_decline', 500, 'card_declined', 'recent@x.test', ${ago(10)});
    INSERT INTO public.error_telemetry (error_code, error_type, created_at) VALUES ('E1', 'x', ${ago(120)}), ('E2', 'x', ${ago(10)});
    INSERT INTO public.heartbeat_results (function_name, status, test_passed, created_at) VALUES
      ('free-keyword-scan', 'healthy', true, ${ago(120)}), ('free-keyword-scan', 'healthy', true, ${ago(10)});
    INSERT INTO public.pro_subscribers (email, stripe_customer_id, status, updated_at) VALUES
      ('cache-old@x.test', NULL, 'inactive', ${ago(2)}),
      ('cache-fresh@x.test', NULL, 'inactive', now() - interval '2 minutes'),
      ('comp@x.test', NULL, 'active', ${ago(200)}),
      ('payer@x.test', 'cus_123', 'inactive', ${ago(200)});
  `);
  before = verdicts(await claims());
  scanRowsBefore = (await q<{ n: number }>("SELECT count(*)::int AS n FROM public.scan_metrics"))[0].n;

  for (let i = 0; i < 2; i++) await db.exec(migration(RETENTION));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("what is already stored: the claims and abandoned checkouts at apply time, the visitor addresses on the first night", () => {
  it("scan_metrics keeps every row, and the visitor addresses wait for the batched nightly: one unbatched UPDATE of a table with a row per scan could fail the file", async () => {
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.scan_metrics"))[0].n).toBe(scanRowsBefore);
    expect(migration(RETENTION).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n"), "no whole-table UPDATE of a log table at apply time")
      .not.toMatch(/UPDATE public\.%I SET visitor_id = NULL WHERE visitor_id IS NOT NULL'/);
    visitorAddressesBefore = 0;
    for (const t of ["scan_metrics", "industry_detection_metrics"]) {
      visitorAddressesBefore += (await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t} WHERE visitor_id IS NOT NULL`))[0].n;
    }
    expect(visitorAddressesBefore, "the seeded addresses are still there until the first night").toBeGreaterThan(0);
  });

  it("every claim's address is the constant 'withheld', a NULL stays NULL, and no paid generator's verdict moves", async () => {
    const after = await claims();
    expect(after.map((c) => [c.session_id, c.ip_address])).toEqual([
      ["cs_live_named_webhook", null],
      ["cs_live_named_with_address", "withheld"],
      ["cs_live_unnamed_webhook", null],
      ["cs_live_unnamed_with_address", "withheld"],
    ]);
    expect(verdicts(after)).toEqual(before);
    // The control: had the address become NULL, the unnamed claim a buyer's
    // generator wrote would read as the webhook's and be honoured everywhere.
    const nulled = after.map((c) => ({ ...c, ip_address: null }));
    expect(verdicts(nulled)).not.toEqual(before);
  });

  it("an abandoned checkout keeps no email; a decline keeps its email until it is ninety days old", async () => {
    expect(await q("SELECT payment_intent_id, customer_email FROM public.payment_failures ORDER BY payment_intent_id")).toEqual([
      { payment_intent_id: "pi_new_abandon", customer_email: null },
      { payment_intent_id: "pi_new_decline", customer_email: "recent@x.test" },
      { payment_intent_id: "pi_old_abandon", customer_email: null },
      { payment_intent_id: "pi_old_decline", customer_email: "declined@x.test" },
    ]);
  });
});

describe("a new address never lands", () => {
  it("the three log writers called with an address store NULL", async () => {
    await db.query("SELECT public.log_scan_metric(p_status := 'completed', p_visitor_id := $1)", [ADDR]);
    await db.query("SELECT public.log_parse_failure(p_file_type := 'pdf', p_visitor_id := $1)", [ADDR]);
    await db.query("SELECT public.log_industry_detection(p_resume_text_length := 10, p_visitor_id := $1)", [ADDR]);
    // Only the rows written here: the seeded backlog waits for the first night.
    for (const t of ["scan_metrics", "parse_failures", "industry_detection_metrics"]) {
      expect(await q(`SELECT visitor_id FROM public.${t} WHERE visitor_id IS NOT NULL AND created_at > now() - interval '1 day'`), t).toEqual([]);
    }
  });

  it("a direct write of an address, insert or update, stores NULL too", async () => {
    await db.exec(`INSERT INTO public.scan_metrics (status, visitor_id) VALUES ('started', '${ADDR}');
                   UPDATE public.parse_failures SET visitor_id = '${ADDR}';`);
    expect(await q("SELECT 1 FROM public.scan_metrics WHERE visitor_id IS NOT NULL AND created_at > now() - interval '1 day'")).toEqual([]);
    expect(await q("SELECT 1 FROM public.parse_failures WHERE visitor_id IS NOT NULL")).toEqual([]);
  });

  it("a new claim written with the caller's address stores 'withheld'; one written without stays NULL", async () => {
    await db.query("INSERT INTO public.used_stripe_sessions (session_id, product_type, ip_address) VALUES ('cs_live_new', 'ats_defense', $1), ('cs_live_new_webhook', 'full_analysis', NULL)", [ADDR]);
    await db.query("UPDATE public.used_stripe_sessions SET ip_address = $1 WHERE session_id = 'cs_live_named_with_address'", [ADDR]);
    expect(await q("SELECT session_id, ip_address FROM public.used_stripe_sessions WHERE session_id IN ('cs_live_new', 'cs_live_new_webhook', 'cs_live_named_with_address') ORDER BY session_id")).toEqual([
      { session_id: "cs_live_named_with_address", ip_address: "withheld" },
      { session_id: "cs_live_new", ip_address: "withheld" },
      { session_id: "cs_live_new_webhook", ip_address: null },
    ]);
  });

  it("an abandoned checkout written with an email stores none; a decline keeps it", async () => {
    await db.exec(`INSERT INTO public.payment_failures (payment_intent_id, amount, failure_code, customer_email) VALUES
      ('pi_abandon_now', 500, 'checkout_expired', 'a@x.test'), ('pi_decline_now', 500, 'card_declined', 'd@x.test');`);
    expect(await q("SELECT payment_intent_id, customer_email FROM public.payment_failures WHERE payment_intent_id LIKE '%_now' ORDER BY 1")).toEqual([
      { payment_intent_id: "pi_abandon_now", customer_email: null },
      { payment_intent_id: "pi_decline_now", customer_email: "d@x.test" },
    ]);
  });
});

describe("the nightly keeps the ninety-day promise", () => {
  let first: Record<string, number | boolean>;
  beforeAll(async () => {
    first = (await q<{ r: Record<string, number | boolean> }>("SELECT public.privacy_retention_nightly() AS r"))[0].r;
  });

  it("deletes abandoned checkouts, error_telemetry, heartbeat_results and parse_failures older than ninety days, and nothing younger", async () => {
    expect(await q("SELECT payment_intent_id, customer_email FROM public.payment_failures ORDER BY payment_intent_id")).toEqual([
      { payment_intent_id: "pi_abandon_now", customer_email: null },
      { payment_intent_id: "pi_decline_now", customer_email: "d@x.test" },
      { payment_intent_id: "pi_new_abandon", customer_email: null },
      { payment_intent_id: "pi_new_decline", customer_email: "recent@x.test" },
      { payment_intent_id: "pi_old_decline", customer_email: null },
    ]);
    expect(await q("SELECT error_code FROM public.error_telemetry")).toEqual([{ error_code: "E2" }]);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.heartbeat_results"))[0].n).toBe(1);
    expect(await q("SELECT file_type FROM public.parse_failures ORDER BY file_type")).toEqual([{ file_type: "docx" }, { file_type: "pdf" }]);
    expect(first).toMatchObject({
      abandoned_checkouts_deleted: 1, failure_emails_dropped: 1,
      error_telemetry_deleted: 1, heartbeat_results_deleted: 1, parse_failures_deleted: 1, unfinished: false,
    });
  });

  it("clears every visitor address already stored on its first night, in batches, keeping the rows", async () => {
    for (const t of ["scan_metrics", "parse_failures", "industry_detection_metrics"]) {
      expect(await q(`SELECT visitor_id FROM public.${t} WHERE visitor_id IS NOT NULL`), t).toEqual([]);
    }
    expect(Number(first.visitor_addresses_cleared)).toBeGreaterThanOrEqual(visitorAddressesBefore);
  });

  it("keeps every scan row, so the public scan count does not move", async () => {
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM public.scan_metrics WHERE status = 'completed'"))[0].n).toBe(3);
  });

  it("deletes the day-old 'not subscribed' cache rows and keeps a fresh one, a comped plan and a paying customer's row", async () => {
    expect(await q("SELECT email FROM public.pro_subscribers ORDER BY email")).toEqual([
      { email: "cache-fresh@x.test" }, { email: "comp@x.test" }, { email: "payer@x.test" },
    ]);
    expect(first.subscription_cache_rows_deleted).toBe(1);
  });

  it("a second night finds nothing to do", async () => {
    const again = (await q<{ r: Record<string, number | boolean> }>("SELECT public.privacy_retention_nightly() AS r"))[0].r;
    expect(Object.entries(again).filter(([, v]) => typeof v === "number" && v > 0)).toEqual([]);
  });

  it("a stranger cannot run it: the service role only, under Supabase's default grants", async () => {
    const can = async (role: string) => (await q<{ ok: boolean }>("SELECT has_function_privilege($1, 'public.privacy_retention_nightly()', 'EXECUTE') AS ok", [role]))[0].ok;
    expect(await can("anon")).toBe(false);
    expect(await can("authenticated")).toBe(false);
    expect(await can("service_role")).toBe(true);
    expect((await q<{ d: boolean }>("SELECT prosecdef AS d FROM pg_proc WHERE oid = 'public.privacy_retention_nightly()'::regprocedure"))[0].d).toBe(true);
  });

  it("runs nightly with its own statement_timeout in the command, and never deletes a claim", async () => {
    const job = await q<{ schedule: string; command: string }>("SELECT schedule, command FROM cron.job WHERE jobname = 'privacy-retention-nightly'");
    expect(job).toHaveLength(1);
    expect(job[0].schedule).toBe("41 4 * * *");
    expect(job[0].command).toMatch(/^\s*SET statement_timeout = '10min'; SELECT public\.privacy_retention_nightly\(\);\s*$/);
    const all = await q<{ command: string }>("SELECT command FROM cron.job");
    expect(all.filter((j) => /cleanup_expired_stripe_sessions/.test(j.command))).toEqual([]);
  });
});
