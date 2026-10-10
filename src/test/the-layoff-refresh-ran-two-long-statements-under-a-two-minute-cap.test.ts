// @vitest-environment node
/**
 * THE LAYOFF REFRESH RAN TWO LONG STATEMENTS UNDER A TWO-MINUTE CAP (S8-049).
 *
 * WHAT WAS WRONG. layoff-partition-refresh runs layoff_matches_rebuild()
 * then refresh_layoff_partition(), whose headers ask for 5 and 10 minutes. A
 * function's SET never extends a pg_cron run, and 20261004010000 skipped
 * multi-statement jobs, so this one ran under the session's 2 minutes.
 *
 * WHAT HOLDS NOW, applying 20261009142000 to pglite with a stand-in cron
 * schema: the job's command begins with a ten-minute SET and still runs both
 * statements, its schedule and active flag are unchanged, a database without
 * the job gets it at 05:10, and re-applying changes nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20261009142000_the_layoff_refresh_job_gets_the_ten_minutes_its_functions_ask_for.sql"), "utf8");
const OLD_COMMAND = " SELECT public.layoff_matches_rebuild(); SELECT public.refresh_layoff_partition(); ";
const STAND_IN = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
                         active boolean NOT NULL DEFAULT true, jobname text UNIQUE);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL) RETURNS void
  LANGUAGE plpgsql AS $$ BEGIN
    UPDATE cron.job j SET schedule = coalesce(alter_job.schedule, j.schedule), command = coalesce(alter_job.command, j.command)
     WHERE j.jobid = job_id;
  END $$;
`;
const job = async (db: PGlite) =>
  (await db.query<{ schedule: string; command: string; active: boolean }>("SELECT schedule, command, active FROM cron.job WHERE jobname = 'layoff-partition-refresh'")).rows;

describe("20261009142000", () => {
  it("gives the live job its ten minutes, keeps its schedule and flag, and re-applies to the same", async () => {
    const db = new PGlite();
    await db.exec(STAND_IN);
    await db.exec(`INSERT INTO cron.job (jobname, schedule, command, active) VALUES ('layoff-partition-refresh', '10 5 * * *', '${OLD_COMMAND}', false)`);
    const before = await job(db);
    expect(before[0].command.trim().startsWith("SET statement_timeout"), "the stand-in is not the shipped command").toBe(false);
    await db.exec(SQL);
    const once = await job(db);
    expect(once).toHaveLength(1);
    expect(once[0].command).toMatch(/^SET statement_timeout = '10min'; SELECT public\.layoff_matches_rebuild\(\); SELECT public\.refresh_layoff_partition\(\);$/);
    expect(once[0].schedule).toBe("10 5 * * *");
    expect(once[0].active, "the migration changed whether the job runs").toBe(false);
    await db.exec(SQL);
    expect(await job(db)).toEqual(once);
  });

  it("a database without the job gets it at 05:10, with the SET", async () => {
    const db = new PGlite();
    await db.exec(STAND_IN);
    await db.exec(SQL);
    const rows = await job(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].schedule).toBe("10 5 * * *");
    expect(rows[0].command.startsWith("SET statement_timeout = '10min';")).toBe(true);
  });

  it("a database without pg_cron applies cleanly and schedules nothing", async () => {
    const db = new PGlite();
    await expect(db.exec(SQL)).resolves.toBeTruthy();
  });
});
