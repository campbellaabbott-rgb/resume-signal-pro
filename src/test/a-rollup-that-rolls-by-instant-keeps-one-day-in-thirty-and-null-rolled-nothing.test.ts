// @vitest-environment node
/**
 * A ROLLUP THAT ROLLS BY INSTANT KEEPS ONE DAY IN THIRTY, AND NULL ROLLED NOTHING.
 *
 * roll_up_and_prune_closures read `closed_at < now() - p_keep_days`, grouped
 * by month, overwrote the month's summary and deleted what it had read, so the
 * month the cutoff fell inside was rolled in daily slices, each replacing the
 * last while every slice's rows were deleted. With NULL -- what the cron has
 * passed since 20261001090000 -- `closed_at < NULL` matched nothing, so the
 * roll-up that file said "still runs" ran on nothing (register L13-16). The
 * exit rollup in the same file rolled nothing on NULL either, and the layoff
 * filing rollup copied the slice-and-overwrite shape.
 *
 * Executed in pglite at one pinned instant (2026-10-08 12:00 UTC), old and new
 * definitions over the same rows: one closure, one exit and one filing a day.
 * The property asserted for every new definition is the one the register
 * asks for -- what the summary says a month held equals the rows the prune
 * removed from it -- plus: NULL rolls every month that has ended and deletes
 * nothing, and a second run changes nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionAt, migFile } from "./helpers/fixed-clock-sql";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const AT = "2026-10-08T12:00:00Z";
const AT_NEXT_DAY = "2026-10-09T12:00:00Z";
const OLD_KEEP = "20261001090000_the_closure_ledger_is_the_asset_stop_deleting_it.sql";
const NEW_CLOSURES = "20261008112500_the_closure_rollup_rolls_whole_months_and_rolls_them_when_nothing_is_pruned.sql";
const NEW_EXITS = "20261008113000_the_exit_rollup_rolls_its_ended_months_when_nothing_is_pruned.sql";
const OLD_LAYOFF = "20260918100900_a_filing_is_pruned_only_after_its_month_is_counted.sql";
const NEW_LAYOFF = "20261008113500_a_filing_month_is_rolled_whole_and_counted_once.sql";

const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_closures (
    posting_id text, company_token text NOT NULL, company text, category text NOT NULL DEFAULT '',
    posted_at timestamptz, closed_at timestamptz NOT NULL, superseded boolean NOT NULL DEFAULT false,
    suspect boolean, absence_basis text);
  CREATE TABLE public.job_board_closure_rollup (
    company_token text NOT NULL, company text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'other',
    month date NOT NULL, fills integer NOT NULL DEFAULT 0, relists integer NOT NULL DEFAULT 0,
    dated_n integer NOT NULL DEFAULT 0, backfill_n integer NOT NULL DEFAULT 0,
    p50_days_open numeric, p75_days_open numeric, first_closed_at timestamptz, last_closed_at timestamptz,
    rolled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (company_token, category, month));
  CREATE TABLE public.job_board_exits (
    posting_id text, company_token text NOT NULL, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    country text, exited_at timestamptz NOT NULL, days_on_board numeric, origin_basis text, salary_min_annual numeric,
    work_mode text, experience_band text, employment_type text, region_code text);
  CREATE TABLE public.job_board_exit_rollup (
    company_token text NOT NULL, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    country text NOT NULL DEFAULT '(none)', month date NOT NULL, exits integer NOT NULL DEFAULT 0,
    n_stated integer NOT NULL DEFAULT 0, p50_days_stated numeric, p75_days_stated numeric,
    n_discovered integer NOT NULL DEFAULT 0, p50_days_discovered numeric, p75_days_discovered numeric,
    n_basis_unrecorded integer NOT NULL DEFAULT 0, n_salary_disclosed integer NOT NULL DEFAULT 0,
    p50_salary_min_annual numeric, dim_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    first_exited_at timestamptz, last_exited_at timestamptz, rolled_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (company_token, category, exit_reason, country, month));
  CREATE TABLE public.layoff_filings (
    id bigserial PRIMARY KEY, source text NOT NULL, state text, event_date date NOT NULL, workers integer);
  CREATE TABLE public.layoff_filing_rollup (
    month date NOT NULL, source text NOT NULL, state text NOT NULL DEFAULT '', filings int NOT NULL DEFAULT 0,
    workers_sum bigint, rolled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (month, source, state));
  CREATE TABLE public.layoff_read_log (read_at timestamptz NOT NULL);
`;
// One closure and one exit at noon every day from 2026-07-01 to 2026-10-07:
// a tenth superseded, a few first-lap backfill, so every counter is fed.
const LEDGERS = `
  INSERT INTO public.job_board_closures (posting_id, company_token, company, category, posted_at, closed_at, superseded, suspect, absence_basis)
  SELECT 'c' || d, 'co', 'Co', 'engineering', ts - interval '9 days', ts, extract(day FROM ts)::int % 10 = 0, false,
         CASE WHEN extract(day FROM ts)::int = 15 THEN 'lap_backfill' ELSE 'full_read' END
  FROM generate_series(DATE '2026-07-01', DATE '2026-10-07', interval '1 day') d,
       LATERAL (SELECT d + interval '12 hours' AS ts) t;
  INSERT INTO public.job_board_exits (posting_id, company_token, category, exit_reason, country, exited_at, days_on_board, origin_basis)
  SELECT 'e' || d, 'co', 'engineering', 'aged_out', 'US', d + interval '12 hours', 30, 'stated'
  FROM generate_series(DATE '2026-07-01', DATE '2026-10-07', interval '1 day') d;
`;
// One WARN filing a day from 2025-08-01 to 2025-10-31.
const FILINGS = `
  INSERT INTO public.layoff_filings (source, state, event_date, workers)
  SELECT 'state_warn', 'CA', d::date, 10 FROM generate_series(DATE '2025-08-01', DATE '2025-10-31', interval '1 day') d;
`;

const boot = async (): Promise<PGlite> => {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(LEDGERS);
  await db.exec(FILINGS);
  return db;
};
const dbs: PGlite[] = [];
const fresh = async () => { const db = await boot(); dbs.push(db); return db; };
afterAll(async () => { for (const db of dbs) { try { await db.close(); } catch { /* best effort */ } } });

type Month = { month: string; total: number };
const closureMonths = async (db: PGlite): Promise<Month[]> =>
  (await db.query<Month>(`SELECT month::text, (fills + relists + backfill_n)::int AS total FROM public.job_board_closure_rollup ORDER BY month`)).rows;
const exitMonths = async (db: PGlite): Promise<Month[]> =>
  (await db.query<Month>(`SELECT month::text, exits::int AS total FROM public.job_board_exit_rollup ORDER BY month`)).rows;
const filingMonths = async (db: PGlite): Promise<Month[]> =>
  (await db.query<Month>(`SELECT month::text, filings::int AS total FROM public.layoff_filing_rollup ORDER BY month`)).rows;
const count = async (db: PGlite, table: string, where = "true") =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`)).rows[0].n;

describe("the closure rollup", () => {
  let oldDb: PGlite; let newDb: PGlite;
  beforeAll(async () => {
    oldDb = await fresh(); newDb = await fresh();
    for (const [db, file, suffix] of [[oldDb, OLD_KEEP, "old"], [newDb, NEW_CLOSURES, "new"]] as const) {
      await db.exec(definitionAt(file, "roll_up_and_prune_closures", AT, suffix));
      await db.exec(definitionAt(file, "roll_up_and_prune_closures", AT_NEXT_DAY, `${suffix}_next`));
    }
  });

  it("rolled nothing on the NULL the cron passes, until this change", async () => {
    await oldDb.query(`SELECT * FROM public.roll_up_and_prune_closures_old(NULL)`);
    expect(await closureMonths(oldDb)).toEqual([]);
  });

  it("now rolls the months that have ended on NULL, one whole month a run, deletes nothing, and stops at the current month", async () => {
    const run = async () => (await newDb.query<{ months_rolled: number }>(`SELECT * FROM public.roll_up_and_prune_closures_new(NULL)`)).rows[0].months_rolled;
    expect(await run()).toBe(1);
    expect(await closureMonths(newDb)).toEqual([{ month: "2026-07-01", total: 31 }]);
    expect(await run()).toBe(1);
    expect(await run()).toBe(1);
    expect(await run(), "October has not ended").toBe(0);
    expect(await closureMonths(newDb)).toEqual([
      { month: "2026-07-01", total: 31 }, { month: "2026-08-01", total: 31 }, { month: "2026-09-01", total: 30 },
    ]);
    expect(await count(newDb, "job_board_closures")).toBe(99);
  });

  it("a day count deletes whole ended months only, and the summary holds exactly the rows it removed", async () => {
    const before = await count(newDb, "job_board_closures", "closed_at < '2026-08-01'");
    const r = (await newDb.query<{ rows_pruned: number }>(`SELECT * FROM public.roll_up_and_prune_closures_new(60)`)).rows[0];
    // The cutoff is 2026-08-09: July ended before it, August did not.
    expect(r.rows_pruned).toBe(before);
    expect((await closureMonths(newDb)).find((m) => m.month === "2026-07-01")!.total).toBe(r.rows_pruned);
    expect(await count(newDb, "job_board_closures", "closed_at >= '2026-08-01' AND closed_at < '2026-09-01'")).toBe(31);
    // The next day changes nothing it has already counted.
    const again = (await newDb.query<{ rows_pruned: number }>(`SELECT * FROM public.roll_up_and_prune_closures_new_next(59)`)).rows[0];
    expect(again.rows_pruned).toBe(0);
    expect((await closureMonths(newDb)).map((m) => m.total)).toEqual([31, 31, 30]);
  });

  it("a month with no rows does not stall the next one", async () => {
    const db = await fresh();
    await db.exec(definitionAt(NEW_CLOSURES, "roll_up_and_prune_closures", AT, "new"));
    await db.exec(`DELETE FROM public.job_board_closures WHERE closed_at >= '2026-08-01' AND closed_at < '2026-09-01'`);
    for (let i = 0; i < 3; i++) await db.query(`SELECT * FROM public.roll_up_and_prune_closures_new(NULL)`);
    expect(await closureMonths(db)).toEqual([{ month: "2026-07-01", total: 31 }, { month: "2026-09-01", total: 30 }]);
  });

  it("teeth: rolled by instant, two nights in a row kept one day of the month the cutoff cut and deleted the rest", async () => {
    await oldDb.query(`SELECT * FROM public.roll_up_and_prune_closures_old(60)`);
    await oldDb.query(`SELECT * FROM public.roll_up_and_prune_closures_old_next(60)`);
    const deletedFromAugust = 31 - await count(oldDb, "job_board_closures", "closed_at >= '2026-08-01' AND closed_at < '2026-09-01'");
    const august = (await closureMonths(oldDb)).find((m) => m.month === "2026-08-01")!.total;
    expect(deletedFromAugust).toBe(9);
    expect(august, "the summary keeps only the last night's slice").toBe(1);
  });
});

describe("the exit rollup", () => {
  let oldDb: PGlite; let newDb: PGlite;
  beforeAll(async () => {
    oldDb = await fresh(); newDb = await fresh();
    await oldDb.exec(definitionAt(OLD_KEEP, "roll_up_and_prune_exits", AT, "old"));
    await newDb.exec(definitionAt(NEW_EXITS, "roll_up_and_prune_exits", AT, "new"));
  });

  it("rolled nothing on NULL until this change", async () => {
    await oldDb.query(`SELECT * FROM public.roll_up_and_prune_exits_old(NULL)`);
    expect(await exitMonths(oldDb)).toEqual([]);
  });

  it("now rolls the months that have ended on NULL, one a run, and deletes nothing; a day count deletes exactly what the summary holds", async () => {
    for (let i = 0; i < 4; i++) await newDb.query(`SELECT * FROM public.roll_up_and_prune_exits_new(NULL)`);
    expect(await exitMonths(newDb)).toEqual([
      { month: "2026-07-01", total: 31 }, { month: "2026-08-01", total: 31 }, { month: "2026-09-01", total: 30 },
    ]);
    expect(await count(newDb, "job_board_exits")).toBe(99);
    const r = (await newDb.query<{ rows_pruned: number }>(`SELECT * FROM public.roll_up_and_prune_exits_new(60)`)).rows[0];
    expect(r.rows_pruned).toBe(31);
    expect(await count(newDb, "job_board_exits")).toBe(68);
  });
});

describe("the layoff filing rollup", () => {
  let oldDb: PGlite; let newDb: PGlite;
  beforeAll(async () => {
    oldDb = await fresh(); newDb = await fresh();
    for (const [db, file, suffix] of [[oldDb, OLD_LAYOFF, "old"], [newDb, NEW_LAYOFF, "new"]] as const) {
      await db.exec(definitionAt(file, "roll_up_and_prune_layoff_filings", AT, suffix));
      await db.exec(definitionAt(file, "roll_up_and_prune_layoff_filings", AT_NEXT_DAY, `${suffix}_next`));
    }
  });

  it("rolls whole months only and the summary holds exactly the filings it removed, a late one included", async () => {
    // Cutoff 2025-10-08: August and September 2025 have ended; October has not.
    const r = (await newDb.query<{ lr_filings_pruned: number }>(`SELECT * FROM public.roll_up_and_prune_layoff_filings_new(365)`)).rows[0];
    expect(r.lr_filings_pruned).toBe(61);
    expect(await filingMonths(newDb)).toEqual([{ month: "2025-08-01", total: 31 }, { month: "2025-09-01", total: 30 }]);
    expect(await count(newDb, "layoff_filings")).toBe(31);
    // A September notice the mirror reads late joins its month; it does not replace it.
    await newDb.exec(`INSERT INTO public.layoff_filings (source, state, event_date, workers) VALUES ('state_warn', 'CA', DATE '2025-09-15', 10)`);
    const late = (await newDb.query<{ lr_filings_pruned: number }>(`SELECT * FROM public.roll_up_and_prune_layoff_filings_new_next(365)`)).rows[0];
    expect(late.lr_filings_pruned).toBe(1);
    expect(await filingMonths(newDb)).toEqual([{ month: "2025-08-01", total: 31 }, { month: "2025-09-01", total: 31 }]);
    const sum = (await newDb.query<{ w: number }>(`SELECT workers_sum::int AS w FROM public.layoff_filing_rollup WHERE month = '2025-09-01'`)).rows[0].w;
    expect(sum).toBe(310);
  });

  it("teeth: the old shape rolled a slice of October, then overwrote it with the next slice, and replaced September with the late notice", async () => {
    await oldDb.query(`SELECT * FROM public.roll_up_and_prune_layoff_filings_old(365)`);
    await oldDb.exec(`INSERT INTO public.layoff_filings (source, state, event_date, workers) VALUES ('state_warn', 'CA', DATE '2025-09-15', 10)`);
    await oldDb.query(`SELECT * FROM public.roll_up_and_prune_layoff_filings_old_next(365)`);
    const months = await filingMonths(oldDb);
    const deleted = 31 + 30 + 31 + 1 - await count(oldDb, "layoff_filings");
    const counted = months.reduce((a, m) => a + m.total, 0);
    expect(deleted).toBe(31 + 30 + 1 + 8);
    expect(counted, "the summary lost the filings it deleted").toBeLessThan(deleted);
  });
});

describe("the three files apply whole, check their own end state, and give both retention jobs their header", () => {
  // A stand-in for pg_cron: the two jobs as 20261001090000 left them in
  // production -- bare commands, no statement_timeout (get_cron_health,
  // 2026-10-08: timeout null on both).
  const CRON = `
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL,
                           command text NOT NULL, active boolean NOT NULL DEFAULT true);
    CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
                                   database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $$
      UPDATE cron.job j SET command = coalesce(alter_job.command, j.command),
                            schedule = coalesce(alter_job.schedule, j.schedule),
                            active = coalesce(alter_job.active, j.active)
       WHERE j.jobid = job_id $$;
    CREATE FUNCTION cron.schedule(name text, sched text, cmd text) RETURNS bigint LANGUAGE sql AS $$
      INSERT INTO cron.job (jobname, schedule, command) VALUES (name, sched, cmd) RETURNING jobid $$;
    INSERT INTO cron.job (jobname, schedule, command, active) VALUES
      ('job-board-closures-rollup-retention', '17 3 * * *', ' SELECT public.roll_up_and_prune_closures(NULL); ', true),
      ('job-board-exits-rollup-retention', '17 4 * * *', ' SELECT public.roll_up_and_prune_exits(NULL); ', false);
  `;
  it("rewrites each job's command in place, keeps its schedule and active flag, and leaves the prunes service-role only", async () => {
    const db = await fresh();
    await db.exec(CRON);
    for (const f of [NEW_CLOSURES, NEW_EXITS, NEW_LAYOFF]) await db.exec(migFile(f));
    const jobs = (await db.query<{ jobname: string; schedule: string; command: string; active: boolean }>(
      `SELECT jobname, schedule, command, active FROM cron.job ORDER BY jobname`)).rows;
    expect(jobs).toEqual([
      { jobname: "job-board-closures-rollup-retention", schedule: "17 3 * * *", command: "SET statement_timeout = '10min'; SELECT public.roll_up_and_prune_closures(NULL);", active: true },
      { jobname: "job-board-exits-rollup-retention", schedule: "17 4 * * *", command: "SET statement_timeout = '10min'; SELECT public.roll_up_and_prune_exits(NULL);", active: false },
    ]);
    const acl = (await db.query<{ fn: string; anon: boolean; svc: boolean }>(`
      SELECT p.proname AS fn, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
        FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname IN ('roll_up_and_prune_closures', 'roll_up_and_prune_exits', 'roll_up_and_prune_layoff_filings')
       ORDER BY 1`)).rows;
    expect(acl).toEqual([
      { fn: "roll_up_and_prune_closures", anon: false, svc: true },
      { fn: "roll_up_and_prune_exits", anon: false, svc: true },
      { fn: "roll_up_and_prune_layoff_filings", anon: false, svc: true },
    ]);
  });
});
