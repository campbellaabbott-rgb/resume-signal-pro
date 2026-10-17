// @vitest-environment node
/**
 * A pg_cron job named 'check-error-spikes-every-15-min' runs in production that
 * no migration defines, every 15 minutes beside 20261008128000's
 * 'check-error-spikes'. 20261009100500 unschedules it by name, leaves the
 * written job alone, is safe to re-run, and refuses to finish while the
 * drifted job survives. Run here in pglite with a stand-in cron schema.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const WRITTEN = resolve(ROOT, "supabase/migrations/20261008128000_the_error_spike_check_runs_on_a_schedule_and_mails_only_a_spike.sql");
const FIX = resolve(ROOT, "supabase/migrations/20261009100500_a_second_error_spike_job_nobody_wrote_down_is_unscheduled.sql");

const cron = (unscheduleWorks = true) => `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
    ${unscheduleWorks
      ? "WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT count(*) > 0 FROM d"
      : "SELECT true"} $$;
`;
const DRIFTED = `INSERT INTO cron.job (jobname, schedule, command) VALUES ('check-error-spikes-every-15-min', '*/15 * * * *', 'select net.http_post(url:=''https://x/functions/v1/check-error-spikes'')');`;

const jobs = async (db: PGlite) =>
  (await db.query<{ jobname: string; schedule: string; command: string }>("SELECT jobname, schedule, command FROM cron.job ORDER BY jobname")).rows;

async function production(unscheduleWorks = true): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(cron(unscheduleWorks));
  await db.exec(readFileSync(WRITTEN, "utf8"));
  await db.exec(DRIFTED);
  return db;
}

describe("20261009100500: the drifted error-spike job is unscheduled by name", { timeout: 60_000 }, () => {
  it("the migration exists in this wave's range", () => {
    expect(existsSync(FIX), "no migration removes check-error-spikes-every-15-min: the function keeps being called twice a quarter hour").toBe(true);
  });

  it("removes the drifted job and leaves the written one exactly as it was", async () => {
    const db = await production();
    const before = await jobs(db);
    expect(before.map((j) => j.jobname)).toEqual(["check-error-spikes", "check-error-spikes-every-15-min"]);
    await db.exec(readFileSync(FIX, "utf8"));
    const after = await jobs(db);
    expect(after.map((j) => j.jobname)).toEqual(["check-error-spikes"]);
    expect(after[0]).toEqual(before[0]);
  });

  it("is safe to re-run, and runs where the drifted job never existed", async () => {
    const db = await production();
    await db.exec(readFileSync(FIX, "utf8"));
    await expect(db.exec(readFileSync(FIX, "utf8"))).resolves.toBeDefined();
    expect((await jobs(db)).map((j) => j.jobname)).toEqual(["check-error-spikes"]);
  });

  it("checks itself: an unschedule that removed nothing fails the migration", async () => {
    const db = await production(false);
    await expect(db.exec(readFileSync(FIX, "utf8"))).rejects.toThrow(/self-check: 1 pg_cron job\(s\) named check-error-spikes-every-15-min still scheduled/);
  });

  it("does nothing where pg_cron is not installed", async () => {
    const db = new PGlite();
    await expect(db.exec(readFileSync(FIX, "utf8"))).resolves.toBeDefined();
  });
});
