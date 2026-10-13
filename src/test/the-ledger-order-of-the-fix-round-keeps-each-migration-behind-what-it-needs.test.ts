// @vitest-environment node
/**
 * THE LEDGER ORDER OF THE FIX ROUND KEEPS EACH MIGRATION BEHIND WHAT IT
 * NEEDS (wave-3 fix round integration, where S11-049 met S11-139 and S11-146).
 *
 * seo-ingest-ops gave the ledger `migrationOrder` (S11-049) from the wave-3
 * notes as they stood; payments-account wrote two migrations in the same round
 * that changed what those rules had to say. Run together:
 *
 *   - 20261009134200 (S11-139) re-creates owner_row_cap and its triggers so the
 *     tracker cap counts only what the member added. With no rule it went in
 *     the step before the functions, and 20261009131000, which waits for the
 *     frontend, then re-created owner_row_cap and its triggers in their older
 *     form: the agent's mirror rows filled the member's 2,000 again.
 *   - 20261009140000 was edited (S11-146) so the 'generating' rows go only to a
 *     sweep that passes p_include_generating, and the live sweep's one-argument
 *     call keeps working. The rule still waited for the new
 *     retry-failed-deliveries first, and that build always passes the second
 *     argument, which no function took until the migration ran: every retry
 *     sweep in the gap failed.
 *
 * Both are read from the real policy through the ledger's own phase rule, and
 * the migrations run in a real Postgres (pglite) in the order the ledger gives.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const POLICY = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
const WAVE3 = readdirSync(MIG).filter((f) => /^20261009\d{6}_.*\.sql$/.test(f)).sort();
const HELD = new Set((POLICY.holdUntilVerified ?? []).map((h: { stamp: string }) => h.stamp));
const PENDING = WAVE3.filter((f) => !HELD.has(f.slice(0, 14)));

type Row = { fn: string; want: string | null; have: string | null; state: string };
let L: typeof import("../../scripts/deploy-ledger.mjs");
const realFetch = globalThis.fetch;
let ROWS: Row[] = [];
let ORDERED: string[] = [];
let phases: ReturnType<typeof import("../../scripts/deploy-ledger.mjs")["migrationPhases"]>;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("the ledger reached the network on import"); });
  L = await import("../../scripts/deploy-ledger.mjs");
  vi.unstubAllGlobals();
  // Every function deploys in this message: none of wave 3's builds is live.
  const fnDir = resolve(ROOT, "supabase/functions");
  ROWS = readdirSync(fnDir).filter((d) => d !== "_shared").flatMap((fn) => {
    let src = ""; try { src = readFileSync(join(fnDir, fn, "index.ts"), "utf8"); } catch { return []; }
    const want = L.buildOf(fn, src);
    return [{ fn, want, have: null, state: want ? "deploy (no live header)" : "no-marker" }];
  });
  phases = L.migrationPhases(PENDING, POLICY, ROWS);
  ORDERED = [...phases.pre, ...phases.afterFunctions, ...phases.afterFrontend].map((m) => m.file);
});
afterAll(() => { globalThis.fetch = realFetch; vi.unstubAllGlobals(); });

const position = (stamp: string) => ORDERED.findIndex((f) => f.startsWith(stamp));

describe("the policy can be met and places both migrations where they work", () => {
  it("has no unmet rule", () => {
    expect(phases.errors).toEqual([]);
  });

  it("134200 applies after 131000, which re-creates the cap in its older form", () => {
    expect(position("20261009131000")).toBeGreaterThanOrEqual(0);
    expect(position("20261009134200")).toBeGreaterThan(position("20261009131000"));
  });

  it("140000 applies before the retry sweep that calls its two-argument function", () => {
    const m = phases.pre.find((x) => x.file.startsWith("20261009140000"));
    expect(m, "140000 waits for a function deploy").toBeDefined();
    expect(m!.note).toMatch(/before retry-failed-deliveries/);
    const sweep = codeOf(readFileSync(resolve(ROOT, "supabase/functions/retry-failed-deliveries/index.ts"), "utf8"));
    // The call may also ask for the made-but-unmailed orders: 20261011143000
    // adds that third argument and, with no ledger rule, also applies before
    // the functions, so the sweep's call never names a missing function.
    expect(sweep).toMatch(/\.rpc\('get_failed_deliveries_for_retry', \{ p_limit: \d+, p_include_generating: true(, p_include_unmailed: true)? \}\)/);
    expect(POLICY.migrationOrder?.["20261011143000"], "20261011143000 must apply before the sweep that passes its third argument").toBeUndefined();
  });
});

// ── the tracker cap, applied in the ledger's order ────────────────────────────
const U1 = "00000000-0000-4000-8000-0000000000c1";
const CAP_STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
  CREATE TABLE public.user_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, company text, role text, label text,
    location text, status text, job_id text, apply_url text, job_posting text, fit_missing jsonb, kit jsonb,
    posting_closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX user_applications_user_job_uniq ON public.user_applications (user_id, job_id);
  CREATE TABLE public.user_scans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, resume_text text);
  CREATE TABLE public.agent_learned_answers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL, question_key text NOT NULL,
    question_label text NOT NULL DEFAULT '', answer_kind text NOT NULL DEFAULT 'fill', answer_value text NOT NULL DEFAULT '',
    UNIQUE (user_id, question_key));
  CREATE TABLE public.shortlist_candidates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, file_name text);
  CREATE TABLE public.agent_submissions (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid, posting_id text, status text);
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text, title text, posted_at timestamptz, first_seen timestamptz, missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    posting_id text NOT NULL, closed_at timestamptz NOT NULL, posted_at timestamptz, first_seen timestamptz,
    company_token text, title text, absence_basis text, superseded boolean NOT NULL DEFAULT false, suspect boolean NOT NULL DEFAULT false);
`;

describe("the tracker cap the ledger's order leaves behind counts only what the member added (S11-139)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(CAP_STAND_INS);
    for (const f of ORDERED.filter((x) => x.startsWith("20261009131000") || x.startsWith("20261009134200"))) {
      await db.exec(readFileSync(resolve(MIG, f), "utf8"));
    }
  }, 180_000);
  afterAll(async () => { await db?.close(); });

  it("2,000 rows of the agent's mirror do not refuse the member's own Save", async () => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false);`);
    await db.exec(`INSERT INTO public.user_applications (user_id, company, job_id, status) SELECT '${U1}', 'Mirror', 'gh:sent:' || g, 'applied' FROM generate_series(1, 2000) g`);
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${U1}', false), set_config('request.jwt.claim.role', 'authenticated', false);`);
    await db.exec(`INSERT INTO public.user_applications (user_id, company, job_id, status) VALUES ('${U1}', 'Mine', 'gh:mine:1', 'saved')`);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.user_applications WHERE user_id = '${U1}'`);
    expect(rows[0].n).toBe(2001);
  });
});

// ── the retry selector, before and after 140000 ───────────────────────────────
describe("the retry selector: the live sweep works on either side of 140000, the new one only after it", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.product_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text, product_type text, product_name text,
        customer_email text, status text, retry_count integer NOT NULL DEFAULT 0, max_retries integer NOT NULL DEFAULT 3,
        next_retry_at timestamptz, content_generation_started_at timestamptz, metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now());
      -- The live selector's signature (20261005110000): one argument.
      CREATE FUNCTION public.get_failed_deliveries_for_retry(p_limit integer DEFAULT 10)
      RETURNS SETOF public.product_deliveries LANGUAGE sql AS $$
        SELECT * FROM public.product_deliveries WHERE status IN ('payment_received', 'generation_failed', 'email_failed') LIMIT p_limit $$;
      INSERT INTO public.product_deliveries (status, created_at, content_generation_started_at)
        VALUES ('generating', now() - interval '1 hour', now() - interval '1 hour'),
               ('email_failed', now() - interval '1 hour', NULL);
    `);
  }, 60_000);
  afterAll(async () => { await db?.close(); });

  const liveCall = "SELECT status FROM public.get_failed_deliveries_for_retry(p_limit => 5) ORDER BY status";
  const newCall = "SELECT status FROM public.get_failed_deliveries_for_retry(p_limit => 5, p_include_generating => true) ORDER BY status";

  it("before 140000 the new sweep's call names no function at all", async () => {
    await expect(db.query(newCall)).rejects.toThrow(/does not exist/);
    const { rows } = await db.query<{ status: string }>(liveCall);
    expect(rows.map((r) => r.status)).toEqual(["email_failed"]);
  });

  it("after 140000 both calls resolve, and only the new sweep is handed the stuck generation", async () => {
    await db.exec(readFileSync(resolve(MIG, WAVE3.find((f) => f.startsWith("20261009140000"))!), "utf8"));
    const live = await db.query<{ status: string }>(liveCall);
    expect(live.rows.map((r) => r.status)).toEqual(["email_failed"]);
    const fresh = await db.query<{ status: string }>(newCall);
    expect(fresh.rows.map((r) => r.status)).toEqual(["email_failed", "generating"]);
  });
});
