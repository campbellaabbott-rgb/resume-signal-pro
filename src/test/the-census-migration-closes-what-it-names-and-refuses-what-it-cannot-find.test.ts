// @vitest-environment node
/**
 * THE CENSUS MIGRATION CLOSES WHAT IT NAMES AND REFUSES WHAT IT CANNOT FIND.
 *
 * 20261004110000 is executed here in a real Postgres (pglite), against a
 * database that holds every signature it names with Supabase's default grants
 * (EXECUTE to anon and authenticated directly), the four tables it closes with
 * their open policies, and the two tables the redefined readers read.
 *
 * The properties, each run, not read:
 *   - it applies cleanly, and afterwards client_callable_census() -- called AS
 *     anon -- reports nothing closed that a client can call, nothing listed
 *     that a client cannot, nothing open outside the lists, the tables shut;
 *   - every closed signature is refused to anon and authenticated and granted
 *     to service_role; an overload no migration wrote, of a closed name, is
 *     closed too; store_temp_resume's three-argument form stays open;
 *   - the delivery reader returns no email and no session id, and the window
 *     is clamped; the cohort reader refuses a key off its list;
 *   - a missing signature RAISES before anything is revoked;
 *   - an allowlisted function a client can no longer call RAISES (a page the
 *     migration would have broken);
 *   - a client-callable definer function outside every list is REPORTED, not
 *     failed: the apply succeeds and the census counts it.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CLIENT_CALLABLE, CLOSED_BY_CENSUS, OWNED_ELSEWHERE } from "./helpers/client-callable-allowlist";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILE = readdirSync(DIR).find((f) => f.startsWith("20261004110000_"))!;
const MIGRATION = readFileSync(resolve(DIR, FILE), "utf8");

const REDEFINED = new Set(["public.get_delivery_health(integer)", "public.get_funnel_cohort_stats(text,integer)"]);

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

type Census = {
  definers: number; client_callable: number; unlisted_client_callable: number; closed: number; closed_missing: number;
  closed_still_callable: string[]; allowlisted: number; allowlisted_not_callable: string[]; closed_tables_still_open: string[];
};

/** Supabase's default for a fresh public function: anon, authenticated and service_role hold EXECUTE directly. */
const stub = (sig: string, roles = "anon, authenticated, service_role") =>
  `CREATE FUNCTION ${sig} RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END $$;\n` +
  `GRANT EXECUTE ON FUNCTION ${sig} TO ${roles};\n`;

async function boot(opts: { skip?: string; revokeAnon?: string; extra?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(`
    CREATE FUNCTION public.scrub_emails(t text) RETURNS text LANGUAGE sql IMMUTABLE
      AS $$ SELECT regexp_replace(t, '[^[:space:]@]+@[^[:space:]@]+', '[email]', 'g') $$;
    CREATE TABLE public.product_deliveries (
      id bigserial PRIMARY KEY, stripe_session_id text, customer_email text, product_name text, status text,
      generation_error text, email_error text, generation_duration_ms integer, generation_success boolean,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.ab_test_events (
      id bigserial PRIMARY KEY, test_name text, variant text, metadata jsonb, visitor_id text,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, verified_at timestamptz, feed_total integer);
    CREATE TABLE public.job_board_closure_rollup (month date PRIMARY KEY, n integer);
    CREATE TABLE public.error_telemetry (id bigserial PRIMARY KEY, error_type text);
    CREATE TABLE public.industry_detection_metrics (id bigserial PRIMARY KEY, final_industry text);
    CREATE TABLE public.job_board_stats_rollup (k text PRIMARY KEY, v jsonb, computed_at timestamptz);
    ALTER TABLE public.job_board_verifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.job_board_closure_rollup ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.error_telemetry ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.industry_detection_metrics ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.job_board_stats_rollup ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "job_board_verifications_public_read" ON public.job_board_verifications FOR SELECT USING (true);
    CREATE POLICY "closure_rollup_public_read" ON public.job_board_closure_rollup FOR SELECT USING (true);
    CREATE POLICY "Anyone can insert error telemetry" ON public.error_telemetry FOR INSERT WITH CHECK (true);
    CREATE POLICY "Allow anonymous inserts" ON public.industry_detection_metrics FOR INSERT WITH CHECK (true);
    CREATE POLICY "stats_rollup_public_read" ON public.job_board_stats_rollup FOR SELECT USING (true);
    GRANT ALL ON public.product_deliveries, public.ab_test_events, public.job_board_verifications,
      public.job_board_closure_rollup, public.error_telemetry, public.industry_detection_metrics,
      public.job_board_stats_rollup TO anon, authenticated, service_role;
  `);
  let ddl = "";
  for (const s of [...CLOSED_BY_CENSUS.map((c) => c.sig), ...OWNED_ELSEWHERE.map((e) => e.sig)]) {
    if (s === opts.skip || REDEFINED.has(s)) continue;
    ddl += stub(s);
  }
  for (const a of CLIENT_CALLABLE) {
    if (a.sig === opts.skip || REDEFINED.has(a.sig)) continue;
    ddl += a.roles === "anon" ? stub(a.sig) : stub(a.sig, "authenticated, service_role") + `REVOKE ALL ON FUNCTION ${a.sig} FROM PUBLIC;\n`;
  }
  // The two the migration redefines exist beforehand with their live return types.
  ddl += `
    CREATE FUNCTION public.get_delivery_health(p_hours_back integer DEFAULT 24)
    RETURNS TABLE(total_orders INTEGER, fully_delivered INTEGER, generation_failed INTEGER, email_failed INTEGER,
                  pending INTEGER, delivery_rate NUMERIC, avg_generation_time_ms NUMERIC, recent_failures JSONB)
    LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
    GRANT EXECUTE ON FUNCTION public.get_delivery_health(integer) TO anon, authenticated, service_role;
    CREATE FUNCTION public.get_funnel_cohort_stats(p_cohort_dimension text DEFAULT 'trafficSource', p_days_back integer DEFAULT 7)
    RETURNS TABLE(cohort_value text, landing_view bigint, upload_started bigint, upload_completed bigint, scan_started bigint,
                  scan_completed bigint, results_viewed bigint, product_clicked bigint, checkout_started bigint,
                  purchase_completed bigint, upload_rate numeric, scan_rate numeric, view_rate numeric,
                  checkout_rate numeric, conversion_rate numeric)
    LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
    GRANT EXECUTE ON FUNCTION public.get_funnel_cohort_stats(text, integer) TO anon, authenticated, service_role;
  `;
  if (opts.revokeAnon) ddl += `REVOKE ALL ON FUNCTION ${opts.revokeAnon} FROM PUBLIC, anon;\n`;
  if (opts.extra) ddl += opts.extra;
  await db.exec(ddl);
  return db;
}

async function apply(db: PGlite): Promise<void> {
  await db.exec(`BEGIN;\n${MIGRATION}\nCOMMIT;`);
}

async function censusAsAnon(db: PGlite): Promise<Census> {
  await db.exec("SET ROLE anon");
  try {
    const r = await db.query<{ c: Census }>("SELECT public.client_callable_census() AS c");
    return r.rows[0].c;
  } finally {
    await db.exec("RESET ROLE");
  }
}

const can = async (db: PGlite, role: string, sig: string) =>
  (await db.query<{ ok: boolean }>(`SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS ok`, [role, sig])).rows[0].ok;

describe("applied to a database holding every signature it names (pglite)", () => {
  let db: PGlite;

  it("applies, and the census -- read as anon -- reports the end state the file intends", async () => {
    db = await boot({
      // An overload of a closed name that no migration wrote, open by default.
      extra: stub("public.get_payment_health(text)"),
    });
    await db.exec(`
      INSERT INTO public.product_deliveries (stripe_session_id, customer_email, product_name, status, generation_error, created_at)
      SELECT 'cs_live_' || g, 'buyer' || g || '@example.com', 'Full Analysis', 'email_failed',
             'Resend: You can only send testing emails to buyer' || g || '@example.com', now() - (g || ' minutes')::interval
      FROM generate_series(1, 15) g;
      INSERT INTO public.product_deliveries (stripe_session_id, customer_email, status, created_at)
      VALUES ('cs_live_old', 'old@example.com', 'email_failed', now() - interval '30 days');
      INSERT INTO public.ab_test_events (test_name, variant, metadata, visitor_id)
      VALUES ('conversion_funnel', 'landing_view', '{"trafficSource":"direct","referrer":"https://mail.example.com/?u=jane@example.com"}', 'v1');
    `);
    await apply(db);
    const c = await censusAsAnon(db);
    expect(c.closed).toBe(CLOSED_BY_CENSUS.length);
    expect(c.closed_missing).toBe(0);
    expect(c.closed_still_callable).toEqual([]);
    expect(c.allowlisted).toBe(CLIENT_CALLABLE.length);
    expect(c.allowlisted_not_callable).toEqual([]);
    expect(c.closed_tables_still_open).toEqual([]);
    expect(c.unlisted_client_callable).toBe(0);
  });

  it("every closed signature is refused to both client roles and granted to service_role", async () => {
    for (const { sig } of CLOSED_BY_CENSUS) {
      expect(await can(db, "anon", sig), `anon can still execute ${sig}`).toBe(false);
      expect(await can(db, "authenticated", sig), `authenticated can still execute ${sig}`).toBe(false);
      expect(await can(db, "service_role", sig), `service_role lost ${sig}`).toBe(true);
    }
    expect(await can(db, "anon", "public.get_payment_health(text)"), "the unwritten overload stayed open").toBe(false);
    expect(await can(db, "anon", "public.store_temp_resume(text,text,text)"), "the free scanner's store was closed").toBe(true);
    expect(await can(db, "anon", "public.get_scan_credits(text)"), "another lane's function was touched").toBe(true);
  });

  it("the four tables refuse anon outright; the rollup the INVOKER readers need still answers", async () => {
    await db.exec("SET ROLE anon");
    try {
      for (const t of ["job_board_verifications", "job_board_closure_rollup"]) {
        await expect(db.query(`SELECT * FROM public.${t} LIMIT 1`), t).rejects.toThrow(/permission denied/);
      }
      await expect(db.query("INSERT INTO public.error_telemetry (error_type) VALUES ('x')")).rejects.toThrow(/permission denied/);
      await expect(db.query("INSERT INTO public.industry_detection_metrics (final_industry) VALUES ('x')")).rejects.toThrow(/permission denied/);
      await expect(db.query("SELECT * FROM public.job_board_stats_rollup LIMIT 1")).resolves.toBeTruthy();
    } finally {
      await db.exec("RESET ROLE");
    }
  });

  it("the delivery reader hands back no address and no session id, at most ten failures, within a week", async () => {
    const r = await db.query<{ recent_failures: Array<Record<string, string>>; total_orders: number }>(
      "SELECT * FROM public.get_delivery_health(100000)");
    const row = r.rows[0];
    expect(row.total_orders, "a 100000-hour window must be clamped to a week (the 30-day-old row is outside)").toBe(15);
    const f = row.recent_failures;
    expect(f).toHaveLength(10);
    const text = JSON.stringify(f);
    expect(text).not.toMatch(/cs_live_/);
    expect(text).not.toMatch(/buyer\d+@example\.com/);
    expect(f[0].email).toMatch(/^bu\*\*\*@example\.com$/);
    expect(f[0].session_ref).toMatch(/^[0-9a-f]{10}$/);
    expect(f[0]).not.toHaveProperty("session_id");
  });

  it("the cohort reader answers its dimensions and refuses any other key", async () => {
    const ok = await db.query<{ cohort_value: string }>("SELECT cohort_value FROM public.get_funnel_cohort_stats('trafficSource', 1)");
    expect(ok.rows.map((x) => x.cohort_value)).toEqual(["direct"]);
    await expect(db.query("SELECT * FROM public.get_funnel_cohort_stats('referrer', 1)")).rejects.toThrow(/not a cohort dimension/);
    await expect(db.query("SELECT * FROM public.get_funnel_cohort_stats(NULL, 1)")).rejects.toThrow(/not a cohort dimension/);
  });
});

describe("what the self-check refuses (pglite)", () => {
  it("a signature it closes that does not exist RAISES, and nothing is revoked", async () => {
    const db = await boot({ skip: "public.save_free_scan_lead(text,text,integer)" });
    await expect(apply(db)).rejects.toThrow(/do not exist here: public\.save_free_scan_lead\(text,text,integer\)/);
    await db.exec("ROLLBACK");
    expect(await can(db, "anon", "public.log_alert_sent(text,text,numeric,numeric,text,boolean)"), "a revoke ran before the check").toBe(true);
  });

  it("an allowlisted function a client can no longer call RAISES -- a page it would have broken", async () => {
    const db = await boot({ revokeAnon: "public.get_stats_cache()" });
    await expect(apply(db)).rejects.toThrow(/allowlisted but not callable: .*get_stats_cache/);
  });

  it("an open definer function no list names is REPORTED and counted, not failed", async () => {
    const db = await boot({ extra: stub("public.made_outside_the_folder(text)") });
    await apply(db);
    const c = await censusAsAnon(db);
    expect(c.unlisted_client_callable).toBe(1);
    expect(c.closed_still_callable).toEqual([]);
  });
});
