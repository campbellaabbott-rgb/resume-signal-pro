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
 *     failed: the apply succeeds and the census counts it;
 *   - the functions it re-issues are created first FROM THEIR PREVIOUS
 *     DEFINITIONS, so a changed parameter name, default or return type fails
 *     here the way it would fail against production;
 *   - each browser writer refuses the call past its budget, keyed on the
 *     platform's address (a forged first forwarded hop changes nothing), and
 *     caps what it stores; a rotating pool meets the ceiling;
 *   - the lifecycle refuses anon and answers a signed-in caller only for the
 *     job ids on their own tracker;
 *   - the check-alerts cron sends a vault-held key, generated once, which
 *     alerts_cron_key_matches recognises and nothing else does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CLIENT_CALLABLE, CLOSED_BY_CENSUS, CREATED_CLOSED, OWNED_ELSEWHERE } from "./helpers/client-callable-allowlist";
import { parseSigRef, splitStatements } from "./helpers/function-acl";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILE = readdirSync(DIR).find((f) => f.startsWith("20261004110000_"))!;
const MIGRATION = readFileSync(resolve(DIR, FILE), "utf8");

const REDEFINED = new Set(["public.get_delivery_health(integer)", "public.get_funnel_cohort_stats(text,integer)"]);

/** Re-issued whole by the census: created here from the definition the database holds before it. */
const REISSUED = [
  "public.log_error_telemetry(text,text,text,integer,text,jsonb)",
  "public.record_scan_outcome(text,text,text)",
  "public.record_scan_feedback(text,boolean,text,integer,boolean,integer,text)",
  "public.log_industry_correction(text,text,text,text)",
  "public.log_industry_correction(text,text,text,text,integer,text[],text,text,text)",
  "public.track_affiliate_click(text,text,text,text)",
  "public.register_affiliate(text,text)",
  "public.login_affiliate(text,text)",
  "public.get_application_lifecycle(text[])",
];
const PRIOR_FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < FILE).sort();

/** The last CREATE of `sig` in the files that sort before the census: what production holds when it applies. */
function priorCreate(sig: string): string {
  const name = sig.slice("public.".length, sig.indexOf("("));
  let last = "";
  for (const f of PRIOR_FILES) {
    const text = readFileSync(resolve(DIR, f), "utf8");
    if (!text.includes(name)) continue;
    for (const st of splitStatements(text)) {
      const m = /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+/i.exec(st);
      if (!m) continue;
      const ref = parseSigRef(st.slice(m[0].length));
      if (ref && `public.${ref.name}(${ref.args})` === sig) last = st;
    }
  }
  if (!last) throw new Error(`no definition of ${sig} before ${FILE}`);
  return last;
}

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
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    -- pgcrypto stand-ins with the same contract: crypt(p, crypt(p, s)) = crypt(p, s).
    CREATE SCHEMA extensions;
    CREATE FUNCTION extensions.gen_salt(t text) RETURNS text LANGUAGE sql AS $$ SELECT 'S' $$;
    CREATE FUNCTION extensions.crypt(p text, s text) RETURNS text LANGUAGE sql AS $$ SELECT 'S' || md5(p) $$;
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
    CREATE TABLE public.error_telemetry (
      id bigserial PRIMARY KEY, error_code text, error_type text, error_message text, http_status integer,
      function_name text, context jsonb, visitor_id text, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.scan_outcomes (
      id bigserial PRIMARY KEY, report_id text NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('interview', 'no_response', 'rejected')),
      ip_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (report_id, ip_hash));
    CREATE TABLE public.scan_feedback (
      id bigserial PRIMARY KEY, visitor_id text, rating boolean NOT NULL, industry text, ats_score integer,
      had_job_description boolean, resume_word_count integer, feedback_text text);
    CREATE TABLE public.industry_corrections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), visitor_id text,
      original_industry text NOT NULL, original_confidence text, corrected_industry text NOT NULL, detection_source text,
      resume_text_length integer, server_signals text[], ai_suggested_industry text, ip_country text);
    CREATE TABLE public.affiliates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, password_hash text NOT NULL,
      referral_code text NOT NULL UNIQUE DEFAULT md5(random()::text), status text NOT NULL DEFAULT 'active');
    CREATE TABLE public.affiliate_clicks (
      id bigserial PRIMARY KEY, affiliate_id uuid NOT NULL, ip_hash text, user_agent text, referrer text);
    CREATE TABLE public.affiliate_sessions (
      id bigserial PRIMARY KEY, affiliate_id uuid NOT NULL, session_token text NOT NULL DEFAULT md5(random()::text),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days');
    CREATE TABLE public.user_applications (id bigserial PRIMARY KEY, user_id uuid NOT NULL, job_id text);
    CREATE TABLE public.job_board_closures (
      posting_id text, closed_at timestamptz, posted_at timestamptz, first_seen timestamptz,
      company_token text, title text, absence_basis text);
    CREATE TABLE public.job_board_postings (
      id text PRIMARY KEY, posted_at timestamptz, first_seen timestamptz, company_token text, title text);
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
    if (a.sig === opts.skip || REDEFINED.has(a.sig) || REISSUED.includes(a.sig)) continue;
    ddl += a.roles === "anon" ? stub(a.sig) : stub(a.sig, "authenticated, service_role") + `REVOKE ALL ON FUNCTION ${a.sig} FROM PUBLIC;\n`;
  }
  // As production holds them: the previous definition, open to the publishable key.
  for (const sig of REISSUED) {
    if (sig === opts.skip) continue;
    ddl += `${priorCreate(sig)};\nGRANT EXECUTE ON FUNCTION ${sig} TO anon, authenticated, service_role;\n`;
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

// ── the bounded writers, the lifecycle, the alert cron ──────────────────────

/** Run `fn` as `role` with these request headers, as PostgREST would set them. */
async function asCaller<T>(db: PGlite, role: string, headers: Record<string, string> | null, fn: () => Promise<T>, sub?: string): Promise<T> {
  await db.query("SELECT set_config('request.headers', $1, false)", [headers ? JSON.stringify(headers) : ""]);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [sub ?? ""]);
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.headers', '', false)");
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}
const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r;

describe("the browser's writers are bounded by the platform's address (pglite)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await boot();
    await apply(db);
    await db.exec(`INSERT INTO public.affiliates (email, password_hash, referral_code) VALUES ('owner@example.com', 'S' || md5('right-password'), 'abc123def456')`);
  });
  beforeEach(async () => {
    await db.exec("DELETE FROM public.client_write_budget; DELETE FROM public.error_telemetry; DELETE FROM public.scan_outcomes; DELETE FROM public.affiliate_clicks;");
  });

  it("reads cf-connecting-ip, else the LAST forwarded hop -- never the first, which the caller writes", async () => {
    const addr = async (h: Record<string, string> | string | null) => {
      await db.query("SELECT set_config('request.headers', $1, false)", [h === null ? "" : typeof h === "string" ? h : JSON.stringify(h)]);
      return one<string | null>(db, "SELECT public.request_client_address() AS r");
    };
    expect(await addr({ "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.1, 198.51.100.2" })).toBe("203.0.113.5");
    expect(await addr({ "x-forwarded-for": "6.6.6.6, 198.51.100.2" })).toBe("198.51.100.2");
    expect(await addr({ "x-forwarded-for": " " })).toBeNull();
    expect(await addr(null)).toBeNull();
    expect(await addr("not json"), "a header blob that is not JSON names no address rather than failing the write").toBeNull();
    await db.query("SELECT set_config('request.headers', '', false)");
  });

  it("log_error_telemetry: the 31st call from one address writes nothing, a forged first hop changes nothing, another address writes", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 31; i++) {
      results.push(await asCaller(db, "anon", { "x-forwarded-for": `10.0.0.${i}, 198.51.100.7` }, () =>
        one<boolean>(db, "SELECT public.log_error_telemetry('E_X', 'client', 'boom', 500, 'fn', NULL) AS r")));
    }
    expect(results.filter(Boolean)).toHaveLength(30);
    expect(results[30], "the 31st call, with a fresh first hop, is still the same address").toBe(false);
    expect(await one<number>(db, "SELECT count(*)::int AS r FROM public.error_telemetry")).toBe(30);
    expect(await asCaller(db, "anon", { "cf-connecting-ip": "203.0.113.9" }, () =>
      one<boolean>(db, "SELECT public.log_error_telemetry('E_X', 'client', 'boom', 500, 'fn', NULL) AS r"))).toBe(true);
  });

  it("log_error_telemetry caps what it stores and keeps a visitor id only in visitor-id form", async () => {
    await asCaller(db, "anon", { "cf-connecting-ip": "203.0.113.10" }, async () => {
      await db.query("SELECT public.log_error_telemetry($1, $2, $3, 99999, $4, $5::jsonb)", [
        "C".repeat(500), "T".repeat(500), "m".repeat(5000), "f".repeat(500),
        JSON.stringify({ visitor_id: "<a href=x>", blob: "x".repeat(10000) }),
      ]);
      await db.query("SELECT public.log_error_telemetry('E', 'client', 'ok', 404, 'fn', $1::jsonb)", [
        JSON.stringify({ visitor_id: "3f2b1c9e-0000-4000-8000-000000000001" }),
      ]);
    });
    const rows = (await db.query<{ error_code: string; error_type: string; error_message: string; http_status: number | null; function_name: string; context: Record<string, unknown>; visitor_id: string | null }>(
      "SELECT * FROM public.error_telemetry ORDER BY id")).rows;
    expect(rows[0].error_code).toHaveLength(64);
    expect(rows[0].error_type).toHaveLength(64);
    expect(rows[0].error_message).toHaveLength(1000);
    expect(rows[0].function_name).toHaveLength(128);
    expect(rows[0].http_status).toBeNull();
    expect(rows[0].context).toMatchObject({ truncated: true });
    expect(rows[0].visitor_id).toBeNull();
    expect(rows[1].visitor_id).toBe("3f2b1c9e-0000-4000-8000-000000000001");
    expect(rows[1].http_status).toBe(404);
  });

  it("record_scan_outcome: five a day per address, whatever p_ip (the caller's own visitor id) says", async () => {
    const got: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      got.push(await asCaller(db, "anon", { "cf-connecting-ip": "203.0.113.20" }, () =>
        one<boolean>(db, "SELECT public.record_scan_outcome($1, 'interview', $2) AS r", [`REPORT-${i}`, `visitor-${i}`])));
    }
    expect(got).toEqual([true, true, true, true, true, false]);
    expect(await asCaller(db, "anon", { "cf-connecting-ip": "203.0.113.21" }, () =>
      one<boolean>(db, "SELECT public.record_scan_outcome('REPORT-X', 'made_up', 'v') AS r")), "an outcome off the list is refused").toBe(false);
    expect(await one<number>(db, "SELECT count(*)::int AS r FROM public.scan_outcomes")).toBe(5);
  });

  it("track_affiliate_click: three a day per address per code, and the stored hash is the platform's, not the caller's", async () => {
    const got: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      got.push(await asCaller(db, "anon", { "cf-connecting-ip": "203.0.113.30" }, () =>
        one<boolean>(db, "SELECT public.track_affiliate_click('abc123def456', $1, 'ua', 'https://ref.example') AS r", [`forged-hash-${i}`])));
    }
    expect(got).toEqual([true, true, true, false]);
    const hashes = (await db.query<{ ip_hash: string }>("SELECT DISTINCT ip_hash FROM public.affiliate_clicks")).rows.map((r) => r.ip_hash);
    expect(hashes).toEqual([await one<string>(db, "SELECT md5('affiliate-click:203.0.113.30') AS r")]);
  });

  it("register_affiliate: a refused attempt is still counted, and the fourth from one address is refused before any lookup", async () => {
    const reg = (email: string) => asCaller(db, "anon", { "cf-connecting-ip": "203.0.113.40" }, () =>
      one<{ success: boolean; error?: string }>(db, "SELECT public.register_affiliate($1, 'long-enough-password') AS r", [email]));
    for (let i = 0; i < 3; i++) expect(await reg("owner@example.com")).toMatchObject({ success: false, error: expect.stringMatching(/cannot be registered/) });
    expect(await reg("fresh@example.com"), "three counted failures spend the address's day").toMatchObject({ success: false, error: expect.stringMatching(/Too many sign-up attempts/) });
    expect(await one<number>(db, "SELECT count(*)::int AS r FROM public.affiliates WHERE email = 'fresh@example.com'")).toBe(0);
    await expect(asCaller(db, "anon", { "cf-connecting-ip": "203.0.113.41" }, () =>
      db.query("SELECT public.register_affiliate('not-an-email', 'long-enough-password')"))).rejects.toThrow(/Invalid email format/);
  });

  it("login_affiliate: a wrong password is counted (not rolled back), twenty an hour per email across every address", async () => {
    const login = (ip: string, pw: string) => asCaller(db, "anon", { "cf-connecting-ip": ip }, () =>
      one<{ success: boolean; error?: string; email?: string }>(db, "SELECT public.login_affiliate('owner@example.com', $1) AS r", [pw]));
    for (let i = 0; i < 20; i++) expect(await login(`198.18.0.${i}`, "wrong-guess")).toMatchObject({ success: false, error: "Invalid email or password" });
    expect(await login("198.18.1.1", "right-password"), "the twenty-first guess at one account, from a fresh address").toMatchObject({
      success: false, error: expect.stringMatching(/Too many sign-in attempts/),
    });
    await db.exec("DELETE FROM public.client_write_budget");
    expect(await login("198.18.1.1", "right-password")).toMatchObject({ success: true, email: "owner@example.com" });
  });

  it("record_scan_feedback and the nine-argument log_industry_correction cap every field they store", async () => {
    await asCaller(db, "anon", { "cf-connecting-ip": "203.0.113.50" }, async () => {
      await db.query("SELECT public.record_scan_feedback($1, true, $2, 400, true, -5, $3)", ["v".repeat(300), "i".repeat(300), "t".repeat(5000)]);
      await db.query("SELECT public.log_industry_correction('tech', 'finance', $1, $2, 50, $3::text[], $4, $5, $6)", [
        "c".repeat(100), "s".repeat(100), Array.from({ length: 50 }, () => "z".repeat(200)), "a".repeat(100), "v".repeat(300), "XXXXXXXXXXXX",
      ]);
    });
    const fb = (await db.query<{ visitor_id: string; industry: string; ats_score: number | null; resume_word_count: number | null; feedback_text: string }>(
      "SELECT * FROM public.scan_feedback")).rows[0];
    expect([fb.visitor_id.length, fb.industry.length, fb.feedback_text.length]).toEqual([64, 60, 1000]);
    expect([fb.ats_score, fb.resume_word_count]).toEqual([null, null]);
    const ic = (await db.query<{ original_confidence: string; detection_source: string; server_signals: string[]; ai_suggested_industry: string; visitor_id: string; ip_country: string }>(
      "SELECT * FROM public.industry_corrections")).rows[0];
    expect([ic.original_confidence.length, ic.detection_source.length, ic.ai_suggested_industry.length, ic.visitor_id.length, ic.ip_country.length]).toEqual([20, 60, 50, 64, 8]);
    expect(ic.server_signals).toHaveLength(20);
    expect(ic.server_signals.every((x) => x.length === 60)).toBe(true);
  });

  it("a pool that rotates addresses meets the ceiling, and callers the platform names no address for share one bucket", async () => {
    const allowed = async (h: Record<string, string> | null) =>
      (await db.query<{ r: boolean }>("SELECT set_config('request.headers', $1, false), public.client_write_allowed('test-scope', 2, 5, 10) AS r",
        [h ? JSON.stringify(h) : ""])).rows[0].r;
    const got: boolean[] = [];
    for (let i = 0; i < 6; i++) got.push(await allowed({ "cf-connecting-ip": `192.0.2.${i}` }));
    expect(got, "five addresses fit the ceiling of five; the sixth does not").toEqual([true, true, true, true, true, false]);
    await db.exec("DELETE FROM public.client_write_budget");
    const none: boolean[] = [];
    for (let i = 0; i < 6; i++) none.push(await allowed(null));
    expect(none, "no address: one shared bucket, held to the ceiling, not to the per-address two").toEqual([true, true, true, true, true, false]);
    await expect(db.query("SELECT public.client_write_allowed('x', 5, 2, 10)"), "a ceiling below the per-address budget is not a budget").rejects.toThrow(/not a budget/);
    expect(await one<number>(db, "SELECT count(*)::int AS r FROM public.client_write_budget WHERE bucket LIKE 'ip:%' AND bucket ~ '192'"), "addresses are stored hashed").toBe(0);
    await db.query("SELECT set_config('request.headers', '', false)");
  });

  it("the budget, its table and the address helper refuse both client roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await asCaller(db, role, { "cf-connecting-ip": "203.0.113.60" }, async () => {
        await expect(db.query("SELECT * FROM public.client_write_budget"), role).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.client_write_allowed('error-telemetry', 1000, 1000, 1)"), role).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.request_client_address()"), role).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.alerts_cron_key_matches(repeat('a', 64))"), role).rejects.toThrow(/permission denied/);
      });
    }
    for (const { sig } of CREATED_CLOSED) expect(await can(db, "service_role", sig), sig).toBe(true);
  });

  it("the census tells a caller whether its request carried a platform address", async () => {
    const src = async (h: Record<string, string> | null) =>
      asCaller(db, "anon", h, async () => (await db.query<{ c: Census & { request_address_source: string } }>("SELECT public.client_callable_census() AS c")).rows[0].c.request_address_source);
    expect(await src({ "cf-connecting-ip": "203.0.113.70" })).toBe("cf");
    expect(await src({ "x-forwarded-for": "203.0.113.70" })).toBe("xff");
    expect(await src(null)).toBe("none");
  });
});

describe("the tracker's lifecycle answers only for the caller's own tracker (pglite)", () => {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  let db: PGlite;
  beforeAll(async () => {
    db = await boot();
    await apply(db);
    await db.exec(`
      INSERT INTO public.user_applications (user_id, job_id) VALUES ('${A}', 'greenhouse:acme:1'), ('${B}', 'greenhouse:acme:2');
      INSERT INTO public.job_board_closures (posting_id, closed_at, posted_at, company_token, title, absence_basis) VALUES
        ('greenhouse:acme:1', now() - interval '2 days', now() - interval '12 days', 'acme', 'Engineer', 'full_read'),
        ('greenhouse:acme:2', now() - interval '3 days', now() - interval '13 days', 'acme', 'Designer', 'full_read'),
        ('greenhouse:stripe:44', now() - interval '1 day', now() - interval '30 days', 'stripe', 'Analyst', 'full_read');
    `);
  });

  it("refuses the publishable key outright", async () => {
    await expect(asCaller(db, "anon", null, () => db.query("SELECT * FROM public.get_application_lifecycle(ARRAY['greenhouse:stripe:44'])")))
      .rejects.toThrow(/permission denied/);
  });

  it("answers a signed-in caller for its own job ids only, whatever ids it sends", async () => {
    const asked = ["greenhouse:acme:1", "greenhouse:acme:2", "greenhouse:stripe:44"];
    const rowsA = await asCaller(db, "authenticated", null, async () =>
      (await db.query<{ job_id: string; outcome: string; days_standing: string }>("SELECT * FROM public.get_application_lifecycle($1::text[])", [asked])).rows, A);
    expect(rowsA.map((r) => r.job_id)).toEqual(["greenhouse:acme:1"]);
    expect(rowsA[0].outcome).toBe("came_down");
    expect(Number(rowsA[0].days_standing)).toBe(10);
    const rowsB = await asCaller(db, "authenticated", null, async () =>
      (await db.query<{ job_id: string }>("SELECT * FROM public.get_application_lifecycle(ARRAY['greenhouse:acme:1', 'greenhouse:stripe:44'])")).rows, B);
    expect(rowsB, "another user's job id and a posting on nobody's tracker answer nothing").toEqual([]);
  });
});

describe("check-alerts' cron key (pglite, with stand-ins for pg_cron and the vault)", () => {
  const STAND_INS = (scheduleKeepsOld = false) => `
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL);
    CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
      INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule,
        ${scheduleKeepsOld ? "'SELECT net.http_post(url := ''https://x/functions/v1/check-alerts'', body := ''{}''::jsonb);'" : "p_command"})
      ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
    CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
      WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
    INSERT INTO cron.job (jobname, schedule, command) VALUES ('check-alerts', '18 */6 * * *',
      'SELECT net.http_post(url := ''https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/check-alerts'', headers := ''{"Content-Type": "application/json"}''::jsonb, body := ''{}''::jsonb);');
    CREATE SCHEMA vault;
    CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text NOT NULL);
    CREATE FUNCTION vault.create_secret(p_secret text, p_name text) RETURNS uuid LANGUAGE sql AS $$
      INSERT INTO vault.secrets (name, secret) VALUES (p_name, p_secret) RETURNING id $$;
    CREATE VIEW vault.decrypted_secrets AS SELECT name, secret AS decrypted_secret FROM vault.secrets;
  `;

  it("generates the key once, the cron sends it from the vault, and only the key matches", async () => {
    const db = await boot({ extra: STAND_INS() });
    await apply(db);
    const job = (await db.query<{ schedule: string; command: string }>("SELECT schedule, command FROM cron.job WHERE jobname = 'check-alerts'")).rows[0];
    expect(job.schedule, "the minutes it always ran on").toBe("18 */6 * * *");
    expect(job.command).toMatch(/'x-alerts-cron', \(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name = 'alerts_cron_key'/);
    expect(job.command).toMatch(/WHERE EXISTS \(SELECT 1 FROM vault\.decrypted_secrets WHERE name = 'alerts_cron_key'\)/);
    const key = await one<string>(db, "SELECT secret AS r FROM vault.secrets WHERE name = 'alerts_cron_key'");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await one<boolean>(db, "SELECT public.alerts_cron_key_matches($1) AS r", [key])).toBe(true);
    expect(await one<boolean>(db, "SELECT public.alerts_cron_key_matches($1) AS r", [key.slice(0, -1) + "0"])).toBe(key.endsWith("0"));
    expect(await one<boolean>(db, "SELECT public.alerts_cron_key_matches('') AS r")).toBe(false);
    expect(await one<boolean>(db, "SELECT public.alerts_cron_key_matches(NULL) AS r")).toBe(false);
    await apply(db);
    expect(await one<string>(db, "SELECT secret AS r FROM vault.secrets WHERE name = 'alerts_cron_key'"), "a re-run keeps the key it made").toBe(key);
    expect(await one<number>(db, "SELECT count(*)::int AS r FROM cron.job WHERE jobname = 'check-alerts'")).toBe(1);
  });

  it("without a vault the key check answers false for anything", async () => {
    const db = await boot();
    await apply(db);
    expect(await one<boolean>(db, "SELECT public.alerts_cron_key_matches(repeat('a', 64)) AS r")).toBe(false);
  });

  it("the self-check RAISES when the cron command it wrote is not the command pg_cron holds", async () => {
    const db = await boot({ extra: STAND_INS(true) });
    await expect(apply(db)).rejects.toThrow(/the check-alerts cron job does not send x-alerts-cron/);
  });
});
