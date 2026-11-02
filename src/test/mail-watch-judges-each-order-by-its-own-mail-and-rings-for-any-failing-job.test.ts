// @vitest-environment node
/**
 * MAIL-WATCH JUDGES EACH ORDER BY ITS OWN MAIL AND RINGS FOR ANY FAILING JOB
 * (audit 2026-10-31, S13-109 and S13-081; mail-watch 2026-11-03.1).
 *
 * WHAT WAS WRONG.
 *   S13-109  R2 counted every purchase mail sent in the day against every
 *            order. A Pro member's Full Analysis is a delivered order mailed
 *            only its report ('analysis_results'), so on a quiet day it rang
 *            "not one purchase mail sent"; and one buyer's mail hid another
 *            buyer's missing one, so a report that never left rang nothing.
 *   S13-081  R9 asked the cron reader one question: has the heartbeat's own
 *            job run. A SQL cron cancelled on every run, a daily or monthly
 *            job whose run failed, and a job switched off rang nobody.
 *
 * WHAT HOLDS NOW (the shipped handler, against pglite with the live
 * mail_door_take; Resend, DNS and the cron readers faked from fixtures):
 *   - R2: a Pro grant mailed its report is answered; an order whose own
 *     buyer was never mailed rings although another buyer was mailed; the
 *     report answers only a Full Analysis; a mail before the order's time
 *     window does not answer it; an order under 15 minutes old is not judged;
 *   - R10: a job cancelled every run, a daily job whose one run failed, and
 *     a job switched off after it ran each ring, naming the job; a job that
 *     failed once among many and recovered does not; a job switched off long
 *     ago (no runs in the window) does not;
 *   - R10 also rings for a job disarmed: active, reading a vault secret that
 *     no longer exists, so every run succeeds by posting nothing. Read with
 *     cron_disarmed_jobs, migration 20261103120000, run here twice from
 *     Supabase's default grants against a cron and a vault of the test's own;
 *     its name reader finds the secret in every vault-guarded cron command
 *     the repo's migrations schedule, and nothing in the others.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { liveDefinitionOf } from "./helpers/live-sql";
import { PgSupabase } from "./helpers/pglite-supabase";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVICE = "service_mail_watch_key_0123456789abcdef0123456789";
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com", OWNER_NOTIFY_EMAIL: "owner@example.com",
};

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const DISARMED_MIGRATION = readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((n) => n.startsWith("20261103120000_"))!), "utf8");

let db: PGlite;
let watch: EdgeHandler;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text, active boolean NOT NULL DEFAULT true);
    CREATE SCHEMA vault;
    CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
    CREATE TABLE public.email_send_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id text, template_name text, recipient_email text,
      status text, error_message text, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now(), provider_message_id text);
    CREATE TABLE public.email_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
      email_type text NOT NULL, recipient text NOT NULL, subject text, status text NOT NULL DEFAULT 'pending', error_message text, metadata jsonb);
    CREATE TABLE public.product_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
      stripe_session_id text NOT NULL, product_type text NOT NULL, status text NOT NULL DEFAULT 'payment_received', email_sent_at timestamptz,
      email_success boolean, generation_error text, customer_email text);
    CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz);
    CREATE TABLE public.mail_door_counts (door text NOT NULL, bucket text NOT NULL, window_start timestamptz NOT NULL DEFAULT now(),
      hits integer NOT NULL DEFAULT 1, PRIMARY KEY (door, bucket));
    CREATE TABLE public.cron_fixture (jobname text, schedule text, active boolean, runs bigint, failed bigint, timeouts bigint,
      last_start timestamptz, last_status text);
    CREATE FUNCTION public.get_cron_health(p_hours integer DEFAULT 24)
      RETURNS TABLE (ch_jobname text, ch_schedule text, ch_active boolean, ch_timeout text, ch_runs bigint, ch_failed bigint, ch_timeouts bigint,
        ch_last_start timestamptz, ch_last_status text, ch_last_seconds numeric, ch_max_seconds numeric) LANGUAGE sql AS
      $$ SELECT jobname, schedule, active, NULL::text, runs, failed, timeouts, last_start, last_status, NULL::numeric, NULL::numeric FROM public.cron_fixture $$;
    CREATE FUNCTION public.cron_http_answers(p_minutes integer DEFAULT 60, p_error_minutes integer DEFAULT 180)
      RETURNS TABLE (available boolean, refused integer, server_errors integer, timed_out integer) LANGUAGE sql AS $$ SELECT true, 0, 0, 0 $$;
  `);
  await db.exec(`CREATE OR REPLACE ${liveDefinitionOf("mail_door_take").body}\n$$;`);
  await db.exec(DISARMED_MIGRATION);
  await db.exec(DISARMED_MIGRATION);
  const client = new PgSupabase(db);
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__mwClient = client;
  g.fetch = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://api.resend.com/emails") return new Response("{}", { status: 200 });
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) return new Response("busy", { status: 503 });
    throw new Error(`unexpected network call: ${url}`);
  };
  watch = await loadEdgeHandler("mail-watch", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__mwClient;",
  });
}, 180_000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec("TRUNCATE public.email_send_log, public.email_logs, public.product_deliveries, public.job_board_meta, public.mail_door_counts, public.cron_fixture, cron.job, vault.decrypted_secrets");
  await db.exec(`INSERT INTO public.cron_fixture VALUES ('scan-heartbeat-sentinel', '*/30 * * * *', true, 52, 0, 0, now() - interval '5 minutes', 'succeeded')`);
});

const rule = async (id: string) => {
  const res = await watch(new Request("https://harness.supabase.co/functions/v1/mail-watch", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
  }));
  const j = await res.json() as { rules: Array<{ id: string; state: string; detail: string }> };
  return j.rules.find((r) => r.id === id)!;
};
const order = (session: string, type: string, email: string | null, ago = "1 hour") =>
  db.query(`INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status, created_at)
    VALUES ($1, $2, $3, 'delivered', now() - $4::interval)`, [session, type, email, ago]);
const mail = (type: string, to: string, ago = "50 minutes", status = "sent") =>
  db.query(`INSERT INTO public.email_logs (email_type, recipient, status, created_at) VALUES ($1, $2, $3, now() - $4::interval)`, [type, to, status, ago]);

describe("R2 judges each order by its own mail (S13-109)", () => {
  it("a Pro member's Full Analysis mailed only its report is answered", async () => {
    await order("pro_grant_1", "full_analysis", "Member@Example.com");
    await mail("analysis_results", "member@example.com");
    expect((await rule("R2")).state).toBe("ok");
  });

  it("an order whose own buyer was never mailed rings, though another buyer was", async () => {
    await order("cs_live_mailed", "full_analysis", "mailed@example.com");
    await mail("product_full_analysis", "mailed@example.com");
    await order("cs_live_unmailed", "full_analysis", "forgotten@example.com");
    const r = await rule("R2");
    expect(r.state).toBe("alarm");
    expect(r.detail).toMatch(/^1 of 2 paid order\(s\)/);
    expect(r.detail).not.toMatch(/@/);
  });

  it("a Pro member's report that failed to leave rings", async () => {
    await order("pro_grant_2", "full_analysis", "member@example.com");
    await mail("analysis_results", "member@example.com", "50 minutes", "failed");
    expect((await rule("R2")).state).toBe("alarm");
  });

  it("the report answers only a Full Analysis, and a mail from before the order does not answer it", async () => {
    await order("cs_live_boost", "freelance_boost", "boost@example.com");
    await mail("analysis_results", "boost@example.com");
    expect((await rule("R2")).state).toBe("alarm");
    await db.exec("TRUNCATE public.email_logs, public.product_deliveries");
    await order("cs_live_again", "full_analysis", "again@example.com");
    await mail("product_full_analysis", "again@example.com", "20 hours");
    expect((await rule("R2")).state).toBe("alarm");
  });

  it("an order under fifteen minutes old is not judged yet, and one with no address is counted, not judged", async () => {
    await order("cs_live_new", "full_analysis", "new@example.com", "2 minutes");
    await order("cs_live_noaddr", "full_analysis", null);
    const r = await rule("R2");
    expect(r.state).toBe("ok");
    expect(r.detail).toMatch(/1 with no address, not judged/);
  });
});

describe("R10 rings for any scheduled job failing or switched off (S13-081)", () => {
  const job = (name: string, schedule: string, active: boolean, runs: number, failed: number, timeouts: number, status: string | null) =>
    db.query(`INSERT INTO public.cron_fixture VALUES ($1, $2, $3, $4, $5, $6, now() - interval '10 minutes', $7)`,
      [name, schedule, active, runs, failed, timeouts, status]);

  it("a quiet day is ok", async () => {
    await job("refresh-stats-cache", "*/10 * * * *", true, 150, 0, 0, "succeeded");
    expect((await rule("R10")).state).toBe("ok");
  });

  it("a SQL cron cancelled at its statement timeout on every run rings, naming it", async () => {
    await job("refresh-stats-cache", "*/10 * * * *", true, 150, 150, 150, "failed");
    const r = await rule("R10");
    expect(r.state).toBe("alarm");
    expect(r.detail).toMatch(/refresh-stats-cache \(150 of 150 run\(s\) failed, 150 cancelled at its statement timeout\)/);
  });

  it("a daily or monthly job whose one run failed rings", async () => {
    await job("prune-monthly", "0 3 1 * *", true, 1, 1, 0, "failed");
    expect((await rule("R10")).detail).toMatch(/prune-monthly/);
  });

  it("a job switched off after it ran rings; one switched off long ago does not", async () => {
    await job("job-board-refresh", "*/5 * * * *", false, 40, 0, 0, "succeeded");
    await job("send-agent-digest", "0 6 * * *", false, 0, 0, 0, null);
    const r = await rule("R10");
    expect(r.state).toBe("alarm");
    expect(r.detail).toMatch(/switched off after running: job-board-refresh$/);
  });

  it("a job that failed once among many and recovered is not judged", async () => {
    await job("job-board-refresh", "*/5 * * * *", true, 300, 2, 0, "succeeded");
    await job("flaky", "*/5 * * * *", true, 300, 3, 0, "failed");
    expect((await rule("R10")).state).toBe("ok");
  });
});

describe("R10 rings for a job disarmed by a missing vault secret (S13-081, 20261103120000)", () => {
  const guarded = (secret: string) =>
    `SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/send-search-digest', headers := jsonb_build_object('x-email-cron', `
    + `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${secret}'))) WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = '${secret}');`;
  const schedule = (name: string, command: string, active = true) =>
    db.query("INSERT INTO cron.job (jobname, schedule, command, active) VALUES ($1, '0 * * * *', $2, $3)", [name, command, active]);
  const secret = (name: string) => db.query("INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES ($1, 'value')", [name]);

  it("a job whose secret is there is armed, and R10 says it read the vault", async () => {
    await secret("email_cron_key");
    await schedule("send-search-digest", guarded("email_cron_key"));
    await schedule("refresh-stats-cache", "SELECT public.refresh_stats_cache()");
    const r = await rule("R10");
    expect(r.state).toBe("ok");
    expect(r.detail).toMatch(/none failing, newly switched off or disarmed$/);
  });

  it("an active job whose secret is gone rings, naming the job and the secret and never the secret's value", async () => {
    await secret("email_cron_key");
    await schedule("send-search-digest", guarded("email_cron_key"));
    await schedule("layoff-warn", guarded("layoff_cron_key"));
    const r = await rule("R10");
    expect(r.state).toBe("alarm");
    expect(r.detail).toBe("disarmed, running and posting nothing: layoff-warn (vault secret layoff_cron_key is missing)");
    expect(r.detail).not.toMatch(/value|http_post/);
  });

  it("a job switched off is not disarmed news", async () => {
    await schedule("layoff-warn", guarded("layoff_cron_key"), false);
    expect((await rule("R10")).state).toBe("ok");
  });

  it("before the migration is applied, R10 still judges the jobs and says the vault was not read", async () => {
    await db.exec("ALTER FUNCTION public.cron_disarmed_jobs() RENAME TO cron_disarmed_jobs_away");
    try {
      const r = await rule("R10");
      expect(r.state).toBe("ok");
      expect(r.detail).toMatch(/cron_disarmed_jobs did not answer, so a disarmed job is not judged$/);
    } finally {
      await db.exec("ALTER FUNCTION public.cron_disarmed_jobs_away() RENAME TO cron_disarmed_jobs");
    }
  });

  it("the name reader finds the secret in every vault-guarded cron the migrations schedule, and nothing in the others", async () => {
    // Every cron command in the repo's migrations, as each file wrote it:
    // the $job$ or $cmd$ body a cron.schedule call is handed.
    const commands: Array<{ file: string; command: string }> = [];
    for (const file of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = readFileSync(resolve(MIGRATIONS, file), "utf8");
      if (!/cron\.schedule/.test(sql)) continue;
      for (const m of sql.matchAll(/\$(job|cmd)\$([\s\S]*?)\$\1\$/g)) commands.push({ file, command: m[2] });
    }
    const guardedCommands = commands.filter((c) => /decrypted_secrets/.test(c.command));
    expect(commands.length, "the corpus found no cron command: re-anchor the reader").toBeGreaterThanOrEqual(40);
    expect(guardedCommands.length, "the corpus found no vault-guarded command: re-anchor the reader").toBeGreaterThanOrEqual(15);
    for (const c of commands) {
      const { rows } = await db.query<{ names: string[] }>("SELECT public.cron_command_secret_names($1) AS names", [c.command]);
      const want = [...new Set([...c.command.matchAll(/decrypted_secrets[^)]*?\bname\s*=\s*'([A-Za-z0-9_.:-]+)'/gi)].map((x) => x[1]))].sort();
      expect(rows[0].names, `${c.file}`).toEqual(want);
      if (/decrypted_secrets/.test(c.command)) expect(rows[0].names.length, `${c.file}: a vault read with no name found`).toBeGreaterThan(0);
    }
  });
});
