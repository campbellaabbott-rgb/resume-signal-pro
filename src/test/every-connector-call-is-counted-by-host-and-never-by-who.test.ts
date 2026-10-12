// @vitest-environment node
/**
 * EVERY CONNECTOR CALL IS COUNTED BY HOST AND OUTCOME, AND NEVER BY WHO; AN
 * EMPLOYER'S FORM IS READ ONCE A DAY.
 *
 * 20261011101000 gives the owner a record of keyless use that can say which
 * tool, which platform and how a call ended (the 50% alert has something to
 * read), and stores no address, subject, key or argument. 20261011100000
 * holds the employer forms apply_myself reads, for 24 hours. Both RUN here in
 * pglite, twice, self-checks included.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./helpers/agent-db";

const FORMS = "20261011100000_an_employers_application_form_is_read_once_a_day_not_once_a_question.sql";
const CALLS = "20261011101000_every_connector_call_is_counted_by_host_and_outcome_and_never_by_who.sql";

let db: PGlite;
const priv = async (role: string, kind: "function" | "table", target: string, p: string) =>
  (await db.query<{ ok: boolean }>(`SELECT has_${kind}_privilege($1, $2, $3) AS ok`, [role, target, p])).rows[0].ok;

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;");
  await db.exec(migration("20260915100000_a_shared_egress_makes_a_per_address_bucket_a_global_one_so_both_exist.sql"));
  await db.exec(`
    CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_prefix text, tier text, daily_quota integer, revoked_at timestamptz);
    CREATE TABLE public.api_usage (key_id uuid, day date, endpoint text, calls integer);
  `);
  for (const m of [FORMS, CALLS, FORMS, CALLS]) await db.exec(migration(m));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("who may touch them: the service role only, by name", () => {
  it("every function and table is closed to anon and authenticated even under Supabase's default grants", async () => {
    for (const sig of [
      "public.application_form_cache_put(text, text, boolean, jsonb)",
      "public.mcp_count_call(text, text, text, text)",
      "public.mcp_allowance_alert_claim(text, integer, integer)",
      "public.mcp_connector_report(integer)",
      "public.mcp_free_key_leads(integer)",
    ]) {
      for (const role of ["anon", "authenticated"]) expect(await priv(role, "function", sig, "EXECUTE"), `${role} ${sig}`).toBe(false);
      expect(await priv("service_role", "function", sig, "EXECUTE")).toBe(true);
    }
    for (const t of ["public.application_form_cache", "public.mcp_calls_daily", "public.mcp_allowance_alerts"]) {
      for (const role of ["anon", "authenticated"]) expect(await priv(role, "table", t, "SELECT"), `${role} ${t}`).toBe(false);
    }
  });
});

describe("a call is counted by host, surface, tool and outcome — nothing else", () => {
  it("counts once per combination per day, folds unknown words to 'other', and has no column for who", async () => {
    await db.exec("DELETE FROM public.mcp_calls_daily");
    await db.query("SELECT public.mcp_count_call('claude', 'keyless', 'search_jobs', 'ok')");
    await db.query("SELECT public.mcp_count_call('claude', 'keyless', 'search_jobs', 'ok')");
    await db.query("SELECT public.mcp_count_call('203.0.113.7', 'whoever', 'search_jobs; DROP TABLE x', 'stolen')");
    const rows = (await db.query<{ host: string; surface: string; tool: string; outcome: string; calls: number }>("SELECT host, surface, tool, outcome, calls FROM public.mcp_calls_daily ORDER BY calls DESC")).rows;
    expect(rows).toEqual([
      { host: "claude", surface: "keyless", tool: "search_jobs", outcome: "ok", calls: 2 },
      { host: "other", surface: "keyless", tool: "search_jobsx", outcome: "other", calls: 1 },
    ]);
    const cols = (await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'mcp_calls_daily' ORDER BY 1")).rows.map((r) => r.column_name);
    expect(cols).toEqual(["calls", "day", "host", "outcome", "surface", "tool"]);
  });

  it("the 50% alert is claimed once per share per day, and never under half", async () => {
    const claim = async (used: number, cap: number) => (await db.query<{ ok: boolean }>("SELECT public.mcp_allowance_alert_claim('global:claude', $1, $2) AS ok", [used, cap])).rows[0].ok;
    await db.exec("DELETE FROM public.mcp_allowance_alerts");
    expect(await claim(4_999, 10_000)).toBe(false);
    expect(await claim(5_000, 10_000)).toBe(true);
    expect(await claim(6_000, 10_000)).toBe(false);
  });

  it("the owner's reader shows calls, shares against their caps, and alerts", async () => {
    await db.exec("INSERT INTO public.mcp_anon_rate (day, bucket, calls, cap) VALUES (current_date, 'global:claude', 5000, 10000) ON CONFLICT (day, bucket) DO UPDATE SET calls = 5000, cap = 10000");
    const kinds = (await db.query<{ kind: string }>("SELECT DISTINCT kind FROM public.mcp_connector_report(7) ORDER BY 1")).rows.map((r) => r.kind);
    expect(kinds).toEqual(["alert", "calls", "share"]);
  });

  it("free keys busy three days of seven are listed as leads, by key only", async () => {
    const { rows: [k] } = await db.query<{ id: string }>("INSERT INTO public.api_keys (key_prefix, tier, daily_quota) VALUES ('rb_live_ab', 'free', 1000) RETURNING id");
    for (const d of [0, 1, 2]) await db.query("INSERT INTO public.api_usage (key_id, day, endpoint, calls) VALUES ($1, current_date - $2::int, '/v1/jobs', 850)", [k.id, d]);
    const leads = (await db.query<{ key_prefix: string; busy_days: number }>("SELECT key_prefix, busy_days FROM public.mcp_free_key_leads(7)")).rows;
    expect(leads).toEqual([{ key_prefix: "rb_live_ab", busy_days: 3 }]);
  });
});

describe("an employer's form is read once a day", () => {
  it("a second read replaces the first, and an absent form is cached the same way", async () => {
    await db.query("SELECT public.application_form_cache_put('greenhouse:acme:1', 'greenhouse', true, '{\"questions\":[]}'::jsonb)");
    await db.query("SELECT public.application_form_cache_put('greenhouse:acme:1', 'greenhouse', false, '{}'::jsonb)");
    const rows = (await db.query<{ ok: boolean }>("SELECT ok FROM public.application_form_cache WHERE posting_id = 'greenhouse:acme:1'")).rows;
    expect(rows).toEqual([{ ok: false }]);
  });

  it("a blank id or vendor writes nothing", async () => {
    await db.query("SELECT public.application_form_cache_put('', 'greenhouse', true, '{}'::jsonb)");
    await db.query("SELECT public.application_form_cache_put('x:y:1', NULL, true, '{}'::jsonb)");
    expect((await db.query("SELECT 1 FROM public.application_form_cache WHERE posting_id IN ('', 'x:y:1')")).rows).toEqual([]);
  });

  it("no self-check row is left behind by either migration", async () => {
    expect((await db.query("SELECT 1 FROM public.application_form_cache WHERE posting_id LIKE 'zz:%'")).rows).toEqual([]);
    expect((await db.query("SELECT 1 FROM public.mcp_calls_daily WHERE tool LIKE 'zz%'")).rows).toEqual([]);
    expect((await db.query("SELECT 1 FROM public.mcp_allowance_alerts WHERE share LIKE '%zz%'")).rows).toEqual([]);
  });
});
