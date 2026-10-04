// @vitest-environment node
/**
 * A CRON STATEMENT IS TIMED BY THE SESSION THAT STARTS IT.
 *
 * WHAT WAS WRONG (2026-10-03). refresh_stats_cache's first run with the field
 * fill curve (20260928004823, ten-minute header) was cancelled 120.03s after it
 * began, with fill_curve_error query_canceled / 57014. statement_timeout is
 * armed when a top-level statement starts and has no assign hook, so a
 * function's own SET can never extend the statement pg_cron started in the
 * job owner's two-minute session. The headers only ever governed the PostgREST
 * path. 20261003220000 puts the limit in the cron command itself, read from
 * the function's own header.
 *
 * pglite has no statement timers and no pg_cron, so what this proves is the
 * migration's effect on the catalogue it would meet: a stand-in cron schema,
 * the two functions carrying headers, and the two jobs as 20260928011742 and
 * the explore lane left them. It holds that:
 *   - both commands set the function's own header before the call, on the
 *     same minutes (so the two scans still cannot overlap);
 *   - the value comes from the live header, not a number in the file;
 *   - the self-verify refuses a command the staged runner edited;
 *   - a host without pg_cron applies the file as a no-op.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Every test here boots its own pglite. Under the pre-push gate's parallel
// workers a boot alone can pass the default 5s, and these were the two
// pglite suites without a budget of their own: they failed the gate twice on
// 2026-10-04 by timeout while passing in isolation.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const FILE = "supabase/migrations/20261003220000_a_cron_statement_is_timed_by_the_session_that_starts_it.sql";
const SQL = readFileSync(resolve(ROOT, FILE), "utf8");
const [APPLY, VERIFY] = (() => {
  const i = SQL.indexOf("DO $$", SQL.indexOf("END $$;"));
  return [SQL.slice(0, i), SQL.slice(i)];
})();

const CRON_STAND_IN = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command
    RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
    WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
`;
const FUNCTIONS = (stats: string, explore: string) => `
  CREATE FUNCTION public.refresh_stats_cache() RETURNS void LANGUAGE plpgsql SET statement_timeout = '${stats}' AS $$ BEGIN END $$;
  CREATE FUNCTION public.refresh_explore_cache() RETURNS void LANGUAGE plpgsql SET statement_timeout = '${explore}' AS $$ BEGIN END $$;
`;
const OLD_JOBS = `
  SELECT cron.schedule('refresh-stats-cache', '27 * * * *', ' SELECT public.refresh_stats_cache(); ');
  SELECT cron.schedule('refresh-explore-cache', '7 * * * *', 'SELECT public.refresh_explore_cache();');
`;

async function boot(stats = "10min", explore = "15min"): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(CRON_STAND_IN + FUNCTIONS(stats, explore) + OLD_JOBS);
  return db;
}
const jobs = async (db: PGlite) =>
  Object.fromEntries((await db.query<{ jobname: string; schedule: string; command: string }>(
    "SELECT jobname, schedule, command FROM cron.job ORDER BY jobname")).rows.map((r) => [r.jobname, r]));

describe("the cron command sets the function's own header before the statement starts", () => {
  it("both jobs: the header first, then the call, on the minutes they had", async () => {
    const db = await boot();
    await db.exec(SQL);
    const j = await jobs(db);
    expect(j["refresh-stats-cache"]).toEqual({ jobname: "refresh-stats-cache", schedule: "27 * * * *", command: "SET statement_timeout = '10min'; SELECT public.refresh_stats_cache();" });
    expect(j["refresh-explore-cache"]).toEqual({ jobname: "refresh-explore-cache", schedule: "7 * * * *", command: "SET statement_timeout = '15min'; SELECT public.refresh_explore_cache();" });
  });

  it("the value is read from the live header, so the file cannot drift from it", async () => {
    const db = await boot("7min", "12min");
    await db.exec(SQL);
    const j = await jobs(db);
    expect(j["refresh-stats-cache"].command).toBe("SET statement_timeout = '7min'; SELECT public.refresh_stats_cache();");
    expect(j["refresh-explore-cache"].command).toBe("SET statement_timeout = '12min'; SELECT public.refresh_explore_cache();");
  });

  it("re-applying is idempotent: one job per name, same command", async () => {
    const db = await boot();
    await db.exec(SQL);
    await db.exec(SQL);
    const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM cron.job");
    expect(n.rows[0].n).toBe(2);
  });

  it("the self-verify refuses a command the staged runner edited, and a moved minute", async () => {
    const db = await boot();
    await db.exec(APPLY);
    await db.exec("UPDATE cron.job SET command = 'SELECT public.refresh_stats_cache();' WHERE jobname = 'refresh-stats-cache'");
    await expect(db.exec(VERIFY)).rejects.toThrow(/does not set the function's own 10min/);
    await db.exec(APPLY);
    await db.exec(VERIFY);
    await db.exec("UPDATE cron.job SET schedule = '12 * * * *' WHERE jobname = 'refresh-stats-cache'");
    await expect(db.exec(VERIFY)).rejects.toThrow(/refresh-stats-cache/);
  });

  it("a host without pg_cron applies it as a no-op", async () => {
    const db = new PGlite();
    await db.exec(FUNCTIONS("10min", "15min"));
    await expect(db.exec(SQL)).resolves.toBeDefined();
  });

  it("the file says why, where the next reader looks: the timer is the session's, never the header's", () => {
    expect(SQL).toMatch(/no assign hook/);
    expect(SQL).toMatch(/120\.03/);
  });
});
