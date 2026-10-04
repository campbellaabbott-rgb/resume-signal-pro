// @vitest-environment node
/**
 * EVERY CRON JOB GETS THE TIME ITS FUNCTION ASKS FOR.
 *
 * 20261003220000 proved a function's SET statement_timeout never reaches a
 * pg_cron run (the timer is armed when the cron statement starts; the setting
 * has no assign hook) and fixed the two field-curve jobs. 20261004010000 does
 * the same for every job the live catalogue says needs it, and adds a public
 * reader of cron health so the result can be seen without the service role.
 *
 * Run against pglite with a stand-in cron schema (pglite has neither pg_cron
 * nor statement timers). It holds that:
 *   - a single call to a public function whose every overload asks for more
 *     than two minutes gets that header in front of its command, byte for
 *     byte, and keeps its schedule, owner and ACTIVE flag;
 *   - nothing else moves: headers at or under 120s, no header, overloads that
 *     disagree or half-lack a header, edge-function calls, plain SQL,
 *     multi-statement commands, and the two jobs 20261003220000 already set;
 *   - a job this role cannot alter fails the file by name, never silently;
 *   - re-applying changes nothing;
 *   - the reader returns per-job counts and timings, the timeout each command
 *     sets, never the command or a message, and anon may call it.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SQL = readFileSync(resolve(ROOT, "supabase/migrations/20261004010000_every_cron_job_gets_the_time_its_function_asks_for.sql"), "utf8");

const STAND_IN = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (
    jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
    database text NOT NULL DEFAULT 'postgres', username text NOT NULL DEFAULT 'postgres',
    active boolean NOT NULL DEFAULT true, jobname text UNIQUE
  );
  CREATE TABLE cron.job_run_details (
    runid bigserial PRIMARY KEY, jobid bigint, status text, return_message text,
    start_time timestamptz, end_time timestamptz
  );
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
                                 database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF (SELECT j.jobname FROM cron.job j WHERE j.jobid = job_id) = 'locked-job' THEN
      RAISE EXCEPTION 'permission denied for job %', job_id;
    END IF;
    UPDATE cron.job j SET
      schedule = coalesce(alter_job.schedule, j.schedule),
      command = coalesce(alter_job.command, j.command),
      database = coalesce(alter_job.database, j.database),
      username = coalesce(alter_job.username, j.username),
      active = coalesce(alter_job.active, j.active)
     WHERE j.jobid = job_id;
  END $$;
`;
const fn = (name: string, args: string, header: string | null) =>
  `CREATE FUNCTION public.${name}(${args}) RETURNS void LANGUAGE plpgsql${header ? ` SET statement_timeout = '${header}'` : ""} AS $$ BEGIN END $$;`;
const FUNCTIONS = [
  fn("refresh_ghost_stats", "", "15min"),
  fn("refresh_transparency_cache", "", "3min"),
  fn("roll_up_and_prune_exits", "p_keep_days integer", "300s"),
  fn("snapshot_company_counts", "", "180s"),
  fn("refresh_job_board_stats", "", "4min"),
  fn("refresh_closure_population", "", "10min"),
  fn("short_job", "", "60s"),
  fn("exactly_two_minutes", "", "120s"),
  fn("no_header", "", null),
  fn("split_overloads", "p integer", "5min"), fn("split_overloads", "p text", "10min"),
  fn("half_headed", "p integer", "5min"), fn("half_headed", "p text", null),
  fn("locked_fn", "", "5min"),
  fn("refresh_stats_cache", "", "10min"), fn("refresh_explore_cache", "", "15min"),
].join("\n");
const JOBS: Array<[string, string, string, boolean?]> = [
  ["refresh-ghost-stats", "5,35 * * * *", "SELECT public.refresh_ghost_stats();"],
  ["transparency-cache-hourly", "37 * * * *", "SELECT public.refresh_transparency_cache();"],
  ["job-board-exits-rollup-retention", "17 4 * * *", "SELECT public.roll_up_and_prune_exits(NULL);"],
  ["snapshot-company-counts", "30 2 * * *", "\n    SELECT public.snapshot_company_counts();\n  "],
  ["job-board-stats-rollup", "*/15 * * * *", "select refresh_job_board_stats()"],
  ["refresh-closure-population", "9,39 * * * *", "SELECT public.refresh_closure_population();", false],
  ["short", "1 * * * *", "SELECT public.short_job();"],
  ["two-minutes", "2 * * * *", "SELECT public.exactly_two_minutes();"],
  ["no-header", "3 * * * *", "SELECT public.no_header();"],
  ["split", "4 * * * *", "SELECT public.split_overloads(1);"],
  ["half", "5 * * * *", "SELECT public.half_headed(1);"],
  ["http", "6 * * * *", "SELECT net.http_post(url := 'https://example.invalid/functions/v1/job-board');"],
  ["plain-sql", "7 4 * * *", "DELETE FROM public.some_log WHERE at < now() - interval '30 days';"],
  ["two-calls", "8 * * * *", "SELECT public.refresh_ghost_stats(); SELECT public.refresh_transparency_cache();"],
  ["refresh-stats-cache", "27 * * * *", "SET statement_timeout = '10min'; SELECT public.refresh_stats_cache();"],
  ["refresh-explore-cache", "7 * * * *", "SET statement_timeout = '15min'; SELECT public.refresh_explore_cache();"],
];

async function boot(withLocked = false): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STAND_IN + FUNCTIONS);
  const jobs = withLocked ? [...JOBS, ["locked-job", "9 * * * *", "SELECT public.locked_fn();"] as [string, string, string]] : JOBS;
  for (const [name, schedule, command, active] of jobs) {
    await db.query("INSERT INTO cron.job (jobname, schedule, command, active) VALUES ($1, $2, $3, $4)", [name, schedule, command, active ?? true]);
  }
  return db;
}
type Job = { jobname: string; schedule: string; command: string; active: boolean; username: string };
const jobs = async (db: PGlite) =>
  Object.fromEntries((await db.query<Job>("SELECT jobname, schedule, command, active, username FROM cron.job")).rows.map((r) => [r.jobname, r]));

// Each case boots its own pglite; under a loaded machine that alone passes the
// 5-second default (measured 5.5-9.9 s at load ~12-27 on 2026-10-04), so the
// cases carry the suite's 30-second working range (helpers/mount-budget.ts).
describe("a job whose function asks for more than two minutes gets it in its command", { timeout: 30_000 }, () => {
  it("wraps exactly those, byte for byte, and keeps schedule, owner and active flag", async () => {
    const db = await boot();
    await db.exec(SQL);
    const j = await jobs(db);
    expect(j["refresh-ghost-stats"].command).toBe("SET statement_timeout = '15min'; SELECT public.refresh_ghost_stats();");
    expect(j["transparency-cache-hourly"].command).toBe("SET statement_timeout = '3min'; SELECT public.refresh_transparency_cache();");
    expect(j["job-board-exits-rollup-retention"].command).toBe("SET statement_timeout = '300s'; SELECT public.roll_up_and_prune_exits(NULL);");
    expect(j["snapshot-company-counts"].command, "surrounding whitespace is trimmed, the call is not").toBe("SET statement_timeout = '180s'; SELECT public.snapshot_company_counts();");
    expect(j["job-board-stats-rollup"].command, "an unqualified, lower-case call resolves in public").toBe("SET statement_timeout = '4min'; select refresh_job_board_stats()");
    expect(j["refresh-closure-population"]).toMatchObject({ command: "SET statement_timeout = '10min'; SELECT public.refresh_closure_population();", active: false });
    for (const name of Object.keys(j)) {
      const before = JOBS.find(([n]) => n === name)!;
      expect(j[name].schedule, name).toBe(before[1]);
      expect(j[name].username, name).toBe("postgres");
    }
  });

  it("leaves everything else exactly as it was", async () => {
    const db = await boot();
    await db.exec(SQL);
    const j = await jobs(db);
    for (const name of ["short", "two-minutes", "no-header", "split", "half", "http", "plain-sql", "two-calls", "refresh-stats-cache", "refresh-explore-cache"]) {
      expect(j[name].command, name).toBe(JOBS.find(([n]) => n === name)![2]);
    }
  });

  it("re-applying changes nothing", async () => {
    const db = await boot();
    await db.exec(SQL);
    const once = await jobs(db);
    await db.exec(SQL);
    expect(await jobs(db)).toEqual(once);
  });

  it("a job this role cannot alter fails the file by name, never silently", async () => {
    const db = await boot(true);
    await expect(db.exec(SQL)).rejects.toThrow(/still bounded by the session[^]*locked-job \(locked_fn, header 5min\)/);
  });

  it("a host without pg_cron gets the reader and nothing else", async () => {
    const db = new PGlite();
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    await db.exec(SQL);
    expect((await db.query("SELECT * FROM public.get_cron_health(24)")).rows).toEqual([]);
  });
});

describe("the cron health reader", { timeout: 30_000 }, () => {
  it("reports runs, failures, timeout cancels and timings per job, and the timeout each command sets", async () => {
    const db = await boot();
    await db.exec(SQL);
    await db.exec(`
      INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
      SELECT j.jobid, x.status, x.msg, now() - x.ago, now() - x.ago + x.took
        FROM cron.job j, (VALUES
          ('failed', 'ERROR: canceling statement due to statement timeout', interval '3 hours', interval '120 seconds'),
          ('succeeded', '1 row', interval '1 hour', interval '200 seconds'),
          ('succeeded', '1 row', interval '30 minutes', interval '150.04 seconds'),
          ('failed', 'something old', interval '3 days', interval '1 second')
        ) x(status, msg, ago, took)
       WHERE j.jobname = 'refresh-ghost-stats';
    `);
    const rows = (await db.query<Record<string, unknown>>("SELECT * FROM public.get_cron_health(24)")).rows;
    const ghost = rows.find((r) => r.ch_jobname === "refresh-ghost-stats")!;
    expect(ghost).toMatchObject({ ch_schedule: "5,35 * * * *", ch_active: true, ch_timeout: "15min", ch_last_status: "succeeded" });
    expect(Number(ghost.ch_runs), "the 3-day-old run is outside the window").toBe(3);
    expect(Number(ghost.ch_failed)).toBe(1);
    expect(Number(ghost.ch_timeouts)).toBe(1);
    expect(Number(ghost.ch_last_seconds)).toBe(150);
    expect(Number(ghost.ch_max_seconds)).toBe(200);
    const short = rows.find((r) => r.ch_jobname === "short")!;
    expect(short).toMatchObject({ ch_timeout: null, ch_last_status: null });
    expect(Number(short.ch_runs)).toBe(0);
    expect(Object.keys(ghost).sort(), "never the command text or a message").toEqual(
      ["ch_active", "ch_failed", "ch_jobname", "ch_last_seconds", "ch_last_start", "ch_last_status", "ch_max_seconds", "ch_runs", "ch_schedule", "ch_timeout", "ch_timeouts"]);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.get_cron_health(5000)")).rows[0].n, "the window is clamped, not refused").toBe(JOBS.length);
  });

  it("anon may call it; the file says so in its own check", async () => {
    const db = await boot();
    await db.exec(SQL);
    const r = await db.query<{ ok: boolean }>("SELECT has_function_privilege('anon', 'public.get_cron_health(integer)', 'EXECUTE') AS ok");
    expect(r.rows[0].ok).toBe(true);
  });
});
