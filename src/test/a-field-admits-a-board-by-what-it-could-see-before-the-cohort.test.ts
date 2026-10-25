/**
 * A FIELD ADMITS A BOARD BY WHAT IT COULD SEE BEFORE THE COHORT
 * (20261012122000, ghost spec Track 1, A5).
 *
 * The day-30 field pool admitted a board on its own cohort's events, which
 * selects on the outcome it measures (excluded boards S30 0.892 against 0.435
 * admitted, 753 boards, 2026-10-11); the 14-day pool took every board, so
 * boards that cannot see a takedown entered as roles that never came down.
 * Executed in pglite, the new function beside the one it replaces:
 *
 *   QUIET  read in full, six takedowns before the cohort, a cohort that all
 *          aged out: refused before (no cohort events), admitted now;
 *   BUSY   read in full, prior takedowns and a cohort with takedowns: admitted
 *          by both;
 *   BLIND  read in full but no takedown before the cohort: admitted before on
 *          its cohort's own events, refused now;
 *   LAPP   a lap_pending board: in the old 14-day pool, not in the new one.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const MIG = resolve(__dirname, "../../supabase/migrations");
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");
const NEW = read("20261012122000_a_field_admits_a_board_by_what_it_could_see_before_the_cohort.sql");
const OLD = read("20261008110500_a_field_pools_a_posting_seen_again_after_a_dark_batch_once.sql");

const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
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
`;

/** cohort_from as both functions compute it, so the prior window is placed exactly. */
const COHORT_FROM = `GREATEST((now() - interval '90 days')::date + 1, DATE '2026-09-06' - 30)`;

function board(tok: string, bucket: string, opts: { prior: number; cohortFills: number; youngFills: number }): string {
  const s: string[] = [];
  const close = (tag: string, n: number, posted: string, closed: string) => s.push(`
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, first_seen, closed_at, batch_live_before, absence_basis)
    SELECT '${tok}:${tag}:'||g, 'greenhouse', '${tok}', 'engineering', ${posted}, ${posted}, ${closed}, 5000, 'full_read'
    FROM generate_series(1, ${n}) g;`);
  // Takedowns before the cohort, ten days after their posting, inside the
  // admission window [cohort_from - 90, cohort_from) and outside both
  // functions' 90-day arms on every date. Placed at cohort_from - 20 alone
  // they were inside the arm only while cohort_from sat on its 2026-08-07
  // floor and now() - 90 days had not passed 2026-07-18: the 14-day figures
  // below held until 2026-10-16 and then moved by the fifteen prior rows.
  if (opts.prior > 0) close("prior", opts.prior,
    `LEAST(((${COHORT_FROM}) - 20)::timestamp AT TIME ZONE 'UTC', now() - interval '100 days')`,
    `LEAST(((${COHORT_FROM}) - 10)::timestamp AT TIME ZONE 'UTC', now() - interval '90 days')`);
  // The day-30 cohort: 40 roles posted 40 days ago; some taken down on day 10, the rest aged out at the cap.
  if (opts.cohortFills > 0) close("c30", opts.cohortFills, `now() - interval '40 days'`, `now() - interval '30 days'`);
  s.push(`
    INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
    SELECT '${tok}:age:'||g, 'greenhouse', '${tok}', 'engineering', 'aged_out', now() - interval '10 days' + interval '2 hours', now() - interval '40 days'
    FROM generate_series(1, ${40 - opts.cohortFills}) g;`);
  // A young cohort for the 14-day pool: 60 roles posted 20 days ago, some down on day 5, the rest live.
  if (opts.youngFills > 0) close("young", opts.youngFills, `now() - interval '20 days'`, `now() - interval '15 days'`);
  s.push(`
    INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen)
    SELECT '${tok}:live:'||g, 'greenhouse', '${tok}', 'engineering', now() - interval '20 days', now() - interval '20 days', now() - interval '20 days'
    FROM generate_series(1, ${60 - opts.youngFills}) g;`);
  s.push(`INSERT INTO public.job_board_company_snapshots VALUES ('${tok}', current_date - 30, 500);`);
  s.push(`INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('${tok}', '${bucket}');`);
  s.push(`INSERT INTO public.job_board_board_watch (company_token, first_observed_on, first_observed_basis) VALUES ('${tok}', (${COHORT_FROM}) - 60, 'company_snapshot');`);
  return s.join("\n");
}

const FIXTURE = [
  board("QUIET", "full_read", { prior: 6, cohortFills: 0, youngFills: 10 }),
  board("BUSY", "full_read", { prior: 9, cohortFills: 20, youngFills: 15 }),
  board("BLIND", "full_read", { prior: 0, cohortFills: 10, youngFills: 12 }),
  board("LAPP", "lap_pending", { prior: 9, cohortFills: 0, youngFills: 0 }),
].join("\n");

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? NaN : Number(v));
let oldDb: PGlite;
let newDb: PGlite;
let oldRow: Row;
let newRow: Row;

beforeAll(async () => {
  oldDb = new PGlite(); await oldDb.exec(SCHEMA); await oldDb.exec(FIXTURE); await oldDb.exec(OLD);
  newDb = new PGlite(); await newDb.exec(SCHEMA); await newDb.exec(FIXTURE); await newDb.exec(NEW);
  oldRow = (await oldDb.query<Row>(`SELECT * FROM public.get_category_fill_curve(90, 25) WHERE category = 'engineering'`)).rows[0];
  newRow = (await newDb.query<Row>(`SELECT * FROM public.get_category_fill_curve(90, 25) WHERE category = 'engineering'`)).rows[0];
}, 120_000);

describe("day-30 admission", () => {
  it("before: the pool was the boards whose cohorts happened to produce takedowns (BUSY and BLIND)", () => {
    expect(oldRow, "the old function answered no engineering row").toBeTruthy();
    // 160 dated cohort roles (LAPP included); BUSY 40 + BLIND 40 admitted, QUIET refused.
    expect(num(oldRow.gate_share_30)).toBeCloseTo(80 / 160, 3);
  });

  it("now: a board is admitted by takedowns it showed before the cohort (QUIET and BUSY), never by its cohort's own", () => {
    expect(num(newRow.admitted_boards_30)).toBe(2);
    expect(num(newRow.gate_share_30)).toBeCloseTo(80 / 160, 3);
    // QUIET's 40 survivors and BUSY's 20 survivors of 80: S(30) = 0.75 by the
    // pooled product (BLIND's 10 takedowns are not in it).
    expect(num(newRow.still_open_30)).toBeCloseTo(0.75, 2);
    expect(num(oldRow.still_open_30), "the old pool: BUSY and BLIND, 30 down of 80").toBeCloseTo(0.625, 2);
  });

  it("publishes the pooled S(30) at a floor of one and three prior takedowns", () => {
    // Floor 1 and 3 admit the same two boards here (BLIND has none).
    expect(num(newRow.still_open_30_k1)).toBeCloseTo(0.75, 2);
    expect(num(newRow.still_open_30_k3)).toBeCloseTo(0.75, 2);
  });
});

describe("the 14-day pool", () => {
  it("holds only boards read in full with a floor, and says how many", () => {
    expect(num(newRow.admitted_boards_14)).toBe(3);
    // The three full-read boards hold 300 dated roles in the 90-day arm (the
    // cohort and the young roles; the prior takedowns are posted before it);
    // 37 come down on day 5 and 30 on day 10 with nothing censored before
    // then, so R(14) = 67/300. LAPP's 100 roles are not in the pool; the old
    // pool took them, none down, and printed 67 of 400.
    expect(num(newRow.fill_rate_14)).toBeCloseTo(67 / 300, 3);
    expect(num(oldRow.fill_rate_14), "the old pool: 67 of 400").toBeCloseTo(67 / 400, 3);
  });

  it("the interval holds its share", () => {
    expect(num(newRow.fill_rate_14_lo)).toBeLessThanOrEqual(num(newRow.fill_rate_14));
    expect(num(newRow.fill_rate_14_hi)).toBeGreaterThanOrEqual(num(newRow.fill_rate_14));
  });
});

describe("the file", () => {
  it("is safe to run twice and keeps anon EXECUTE", async () => {
    await expect(newDb.exec(NEW)).resolves.toBeDefined();
    const { rows } = await newDb.query<{ a: boolean }>(`SELECT has_function_privilege('anon', 'public.get_category_fill_curve(int, int)', 'EXECUTE') AS a`);
    expect(rows[0].a).toBe(true);
  });
});
