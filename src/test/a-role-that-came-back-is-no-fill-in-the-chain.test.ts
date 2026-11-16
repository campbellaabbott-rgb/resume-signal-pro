// @vitest-environment node
/**
 * A ROLE THAT CAME BACK IS NO FILL IN THE CHAIN (S14X-066).
 *
 * get_company_fill_curve's role ledger called a role re-listed when it closed
 * more than once, was superseded or is served again, while its closure arms
 * still marked each of that role's clean closures a FILL: live on 2026-11-15
 * Fonio printed fills_90d 38 beside filled_roles_90d 19. On pglite, the live
 * definitions (20261012121000, 20261012122000) first, then this round's two
 * files (20261112192000 the employer curve, 20261112192500 the field curve):
 *
 *   board R, every shape a role can take (the 20261008110000 fixture):
 *     f1..f5 closed once and stayed down        5 fills
 *     t1..t3 closed twice                       6 fill events before, re-lists now
 *     l1..l2 closed once, served again today    2 fill events before, re-lists now
 *     s1..s2 closed as same-title re-lists      re-lists before and now
 *     d1     a suspect closure never seen again censored
 *     r1     a suspect closure, then closed     1 fill (the doubted row drops)
 *   board M, two hundred roles in a fixed mix of the same shapes;
 *   the field curve, a board whose young takedowns partly came back.
 *
 * fills_90d equals filled_roles_90d on every board now and exceeds it before;
 * the re-listed events move to relists_90d and out of the 14-day chain.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { liveDefinitionOf } from "./helpers/live-sql";

vi.setConfig({ hookTimeout: 240_000, testTimeout: 120_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, files.find((f) => f.startsWith(prefix))!), "utf8");
// The employer curve reads the multi-site helper (20261012120000), which reads
// normalize_close_title; both are loaded first, in their live form.
const HELPER = mig("20261012120000_");
const COMPANY_WAS = mig("20261012121000_");
const FIELD_WAS = mig("20261012122000_");
const FIX = mig("20261112192000_") + "\n" + mig("20261112192500_");

// Supabase's client roles with its default grants, so a function created
// here is executable by anon until a migration says otherwise.
const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    title text, location text, region_code text,
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '', title text,
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
    bucket text NOT NULL CHECK (bucket IN ('full_read','lap_proven','lap_pending','unprovable','unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_watch (
    company_token text PRIMARY KEY, first_observed_on date NOT NULL, first_observed_basis text NOT NULL,
    is_censored boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on));
  CREATE OR REPLACE ${liveDefinitionOf("normalize_close_title").body}
$$;
`;

const closure = (tok: string, id: string, closedDaysAgo: number, opts: { superseded?: boolean; suspect?: boolean; cat?: string; posted?: number } = {}) => `
  INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, first_seen, closed_at, superseded, suspect, batch_live_before, absence_basis)
  VALUES ('${tok}:${id}', 'greenhouse', '${tok}', '${opts.cat ?? "engineering"}', now() - interval '${opts.posted ?? 25} days', now() - interval '${opts.posted ?? 25} days',
          now() - interval '${closedDaysAgo} days', ${opts.superseded ? "true" : "false"}, ${opts.suspect ? "true" : "NULL"}, 5000, 'full_read');`;
const stored = (tok: string, id: string, firstSeenDaysAgo: number, opts: { cat?: string; posted?: number } = {}) => `
  INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
  VALUES ('${tok}:${id}', 'greenhouse', '${tok}', '${opts.cat ?? "engineering"}', now() - interval '${opts.posted ?? 25} days', now() - interval '${opts.posted ?? 25} days',
          now() - interval '${firstSeenDaysAgo} days', now() - interval '${firstSeenDaysAgo} days');`;
const watched = (tok: string) => `
  INSERT INTO public.job_board_company_snapshots VALUES ('${tok}', current_date - 30, 300);
  INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('${tok}', 'full_read');
  INSERT INTO public.job_board_board_watch (company_token, first_observed_on, first_observed_basis) VALUES ('${tok}', current_date - 80, 'company_snapshot');`;

const BOARD_R = [
  ...["f1", "f2", "f3", "f4", "f5"].map((id) => closure("R", id, 12)),
  ...["t1", "t2", "t3"].flatMap((id) => [closure("R", id, 20), closure("R", id, 8)]),
  ...["l1", "l2"].flatMap((id) => [closure("R", id, 15), stored("R", id, 10)]),
  ...["s1", "s2"].map((id) => closure("R", id, 14, { superseded: true })),
  closure("R", "d1", 18, { suspect: true }),
  closure("R", "r1", 18, { suspect: true }), closure("R", "r1", 6),
  ...Array.from({ length: 40 }, (_, i) => stored("R", `live${i}`, 20)),
  watched("R"),
].join("\n");

/** Two hundred roles on board M: i % 6 picks the shape, so every shape recurs. */
const BOARD_M = [
  ...Array.from({ length: 200 }, (_, i) => {
    switch (i % 6) {
      case 0: return [closure("M", `m${i}`, 22 - (i % 5)), closure("M", `m${i}`, 9 - (i % 3))].join("\n");
      case 1: return [closure("M", `m${i}`, 16 - (i % 4)), stored("M", `m${i}`, 8)].join("\n");
      case 2: return closure("M", `m${i}`, 13 - (i % 7), { superseded: true });
      case 3: return stored("M", `m${i}`, 24);
      default: return closure("M", `m${i}`, 18 - (i % 9));
    }
  }),
  watched("M"),
].join("\n");

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? NaN : Number(v));
const company = async (db: PGlite, tok: string) =>
  (await db.query<Row>(`SELECT * FROM public.get_company_fill_curve(ARRAY['${tok}'])`)).rows[0];

let db: PGlite;
const was: Record<string, Row> = {};
const now: Record<string, Row> = {};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(BOARD_R);
  await db.exec(BOARD_M);
  await db.exec(HELPER);
  await db.exec(COMPANY_WAS);
  await db.exec(FIELD_WAS);
  for (const t of ["R", "M"]) was[t] = await company(db, t);
  await db.exec(FIX);
  for (const t of ["R", "M"]) now[t] = await company(db, t);
});
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the live employer curve (the positive control)", () => {
  it("counted each clean closure of a role that came back as a fill: R 14 fill events against 6 filled roles", () => {
    expect([was.R.fills_90d, was.R.relists_90d]).toEqual([14, 2]);
    expect([was.R.filled_roles_90d, was.R.relisted_roles_90d]).toEqual([6, 7]);
    expect(num(was.M.fills_90d)).toBeGreaterThan(num(was.M.filled_roles_90d));
  });
});

describe("the employer curve now", () => {
  it("counts a role that closed once and stayed down as one fill, and nothing else", () => {
    expect(now.R.fills_90d).toBe(6);
    expect(now.R.filled_roles_90d).toBe(6);
  });

  it("moves every clean closure of a role that came back to the re-list events, and leaves the role ledger as it was", () => {
    expect(now.R.relists_90d).toBe(2 + 6 + 2);
    expect(now.R.relisted_roles_90d).toBe(7);
  });

  it("fills_90d equals filled_roles_90d on the two-hundred-role board, which it exceeded before", () => {
    expect(num(now.M.fills_90d)).toBe(num(now.M.filled_roles_90d));
    expect(num(now.M.filled_roles_90d)).toBe(num(was.M.filled_roles_90d));
    expect(num(now.M.relisted_roles_90d)).toBe(num(was.M.relisted_roles_90d));
    expect(num(now.M.fills_90d) + num(now.M.relists_90d)).toBe(num(was.M.fills_90d) + num(was.M.relists_90d));
  });

  it("the 14-day chain stops counting the returned roles as fills and counts them as re-lists", () => {
    for (const t of ["R", "M"]) {
      expect(num(now[t].fills_le_14), t).toBeLessThan(num(was[t].fills_le_14));
      expect(num(now[t].fill_rate_14), t).toBeLessThan(num(was[t].fill_rate_14));
      expect(num(now[t].relist_rate_14), t).toBeGreaterThan(num(was[t].relist_rate_14));
      expect(num(now[t].n_at_risk_14), t).toBe(num(was[t].n_at_risk_14));
    }
  });

  it("keeps every column, in order", async () => {
    const cols = async (sig: string) =>
      (await db.query<{ r: string }>(`SELECT pg_get_function_result('${sig}'::regprocedure) AS r`)).rows[0].r;
    expect(Object.keys(now.R)).toEqual(Object.keys(was.R));
    expect(await cols("public.get_company_fill_curve(text[])")).toMatch(/^TABLE\(company_token text, n_at_risk_14 integer/);
    expect(await cols("public.get_category_fill_curve(int, int)")).toMatch(/admitted_boards_14 integer, admitted_boards_30 integer, still_open_30_k1 numeric, still_open_30_k3 numeric\)$/);
  });
});

describe("the field curve", () => {
  // A board whose young takedowns partly came back: 15 roles posted 20 days
  // ago came down on day 5; ten of them are served again today.
  const FIELD = [
    ...Array.from({ length: 15 }, (_, i) => closure("F", `y${i}`, 15, { cat: "finance", posted: 20 })),
    ...Array.from({ length: 10 }, (_, i) => stored("F", `y${i}`, 10, { cat: "finance", posted: 20 })),
    ...Array.from({ length: 45 }, (_, i) => stored("F", `live${i}`, 20, { cat: "finance", posted: 20 })),
    watched("F"),
  ].join("\n");
  let before: Row;
  let after: Row;

  beforeAll(async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(FIELD);
    await d.exec(HELPER);
    await d.exec(COMPANY_WAS);
    await d.exec(FIELD_WAS);
    before = (await d.query<Row>(`SELECT * FROM public.get_category_fill_curve(90, 25) WHERE category = 'finance'`)).rows[0];
    await d.exec(FIX);
    after = (await d.query<Row>(`SELECT * FROM public.get_category_fill_curve(90, 25) WHERE category = 'finance'`)).rows[0];
    await d.close();
  });

  it("pooled the ten returned takedowns as fills, and counts them as re-lists now", () => {
    expect(before, "no finance row before").toBeTruthy();
    expect(after, "no finance row after").toBeTruthy();
    expect(num(before.fills_le_14)).toBe(15);
    expect(num(after.fills_le_14)).toBe(5);
    expect(num(after.n_at_risk_14)).toBe(num(before.n_at_risk_14));
    expect(num(after.relist_rate_14)).toBeGreaterThan(num(before.relist_rate_14));
  });
});

describe("the file", () => {
  it("runs twice, keeps both curves callable by the page's roles and by nobody through PUBLIC, and states the rule once", async () => {
    await db.exec(FIX);
    const acl = (await db.query<{ sig: string; anon: boolean; auth: boolean; pub: boolean; definer: boolean; note: string }>(`
      SELECT p.oid::regprocedure::text AS sig,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
             EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub,
             p.prosecdef AS definer,
             obj_description(p.oid, 'pg_proc') AS note
        FROM pg_proc p WHERE p.proname IN ('get_company_fill_curve', 'get_category_fill_curve') ORDER BY 1`)).rows;
    expect(acl.map(({ note: _note, ...r }) => r)).toEqual([
      { sig: "get_category_fill_curve(integer,integer)", anon: true, auth: true, pub: false, definer: true },
      { sig: "get_company_fill_curve(text[])", anon: true, auth: true, pub: false, definer: true },
    ]);
    for (const r of acl) expect(r.note.split("A ROLE THAT CAME BACK IS NO FILL (20261112192000)").length - 1, r.sig).toBe(1);
    expect(await company(db, "R")).toEqual(now.R);
  });

  it("the end-state block refuses a curve re-issued without the rule", async () => {
    const stripped = FIX.replace(/  came_back AS \([\s\S]*?\n  \),\n  raw AS MATERIALIZED \(\n    SELECT r\.tok, r\.tt,[\s\S]*?LEFT JOIN came_back b ON b\.tok = r\.tok AND b\.pid = r\.pid\n  \),\n/,
      "  raw AS MATERIALIZED (SELECT * FROM raw0),\n");
    expect(stripped).not.toBe(FIX);
    await expect(db.exec(`BEGIN;\n${stripped}`)).rejects.toThrow(/get_company_fill_curve: a role that came back is still a fill/);
    await db.exec("ROLLBACK");
  });
});

describe("cost", () => {
  it("prints the run time on a five-thousand-row board beside the live definition's", async () => {
    const big = new PGlite();
    await big.exec(SCHEMA);
    await big.exec(Array.from({ length: 25 }, (_, b) => BOARD_M.replace(/'M'/g, `'B${b}'`).replace(/'M:/g, `'B${b}:`)).join("\n"));
    await big.exec(HELPER);
    await big.exec(COMPANY_WAS);
    await big.exec(FIELD_WAS);
    const toks = `ARRAY[${Array.from({ length: 25 }, (_, b) => `'B${b}'`).join(",")}]`;
    const time = async (sql: string) => {
      const ms: number[] = [];
      for (let i = 0; i < 5; i++) { const t0 = performance.now(); await big.query(sql); ms.push(performance.now() - t0); }
      return ms.sort((a, b) => a - b)[2];
    };
    const rows = (await big.query<{ n: number }>(`SELECT (SELECT count(*) FROM public.job_board_closures) + (SELECT count(*) FROM public.job_board_postings) AS n`)).rows[0].n;
    const companyWas = await time(`SELECT * FROM public.get_company_fill_curve(${toks})`);
    const fieldWas = await time(`SELECT * FROM public.get_category_fill_curve(90, 25)`);
    await big.exec(FIX);
    const companyNow = await time(`SELECT * FROM public.get_company_fill_curve(${toks})`);
    const fieldNow = await time(`SELECT * FROM public.get_category_fill_curve(90, 25)`);
    await big.close();
    console.info(`[S14X-066 cost] ${rows} rows, 25 boards: employer curve ${companyWas.toFixed(0)} ms -> ${companyNow.toFixed(0)} ms; field curve ${fieldWas.toFixed(0)} ms -> ${fieldNow.toFixed(0)} ms (median of five)`);
    expect(rows).toBeGreaterThanOrEqual(5000);
    // The target is within 10%; the assertion is a coarse ceiling so a timer's
    // noise on a shared machine cannot fail it, while a plan that rescans the
    // ledgers per row still does.
    expect(companyNow).toBeLessThan(companyWas * 1.5 + 50);
    expect(fieldNow).toBeLessThan(fieldWas * 1.5 + 50);
  });
});
