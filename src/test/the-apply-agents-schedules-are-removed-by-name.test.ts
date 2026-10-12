// @vitest-environment node
/**
 * THE APPLY AGENT'S SCHEDULES ARE REMOVED BY NAME (wave 4, the apply pivot).
 *
 * The owner switched the server-side apply agent off on 2026-10-11. The
 * functions refuse to work (the-server-side-apply-agent-is-switched-off);
 * 20261011130000 stops the database calling them. Replayed here in pglite
 * with a stand-in cron schema, over the two schedules exactly as their last
 * migrations wrote them, plus the jobs that must survive and two drifted jobs
 * no migration wrote:
 *   - apply-agent-hourly and agent-runner-nightly are gone;
 *   - a drifted named job and an unnamed one that still post to the agent's
 *     functions (apply-broker included) are gone;
 *   - agent-queue-retention, send-agent-digest, reconcile-stripe and a job
 *     calling a different function whose name merely starts the same way are
 *     exactly as they were;
 *   - a second run is a no-op, a database without pg_cron is left alone, and
 *     an unschedule that removes nothing fails the migration by name.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIG = (f: string) => resolve(ROOT, "supabase/migrations", f);
const FIX = MIG("20261011130000_the_apply_agents_schedules_are_removed_by_name_and_the_removal_checks_itself.sql");
const APPLY_AGENT_LIVE = MIG("20260802171440_f42a1f36-e925-492e-97c9-83724d2847a2.sql");
const RUNNER_LIVE = MIG("20260803160000_agent_runner_needs_a_key.sql");

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
  CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS $$
    ${unscheduleWorks
      ? "WITH d AS (DELETE FROM cron.job WHERE jobid = p_id RETURNING 1) SELECT count(*) > 0 FROM d"
      : "SELECT true"} $$;
`;

const post = (fn: string) => `SELECT net.http_post(url := ''https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/${fn}'', body := ''{}''::jsonb)`;
const KEPT = `
  INSERT INTO cron.job (jobname, schedule, command) VALUES
    ('agent-queue-retention', '40 6 * * *', 'UPDATE public.agent_queue SET status = ''expired'' WHERE status = ''ready'''),
    ('send-agent-digest', '40 6 * * *', '${post("send-agent-digest")}'),
    ('reconcile-stripe', '17 * * * *', '${post("reconcile-stripe")}'),
    ('a-different-function', '5 * * * *', '${post("apply-agent-v2")}');
`;
const DRIFTED = `
  INSERT INTO cron.job (jobname, schedule, command) VALUES
    ('apply-agent-every-15', '*/15 * * * *', '${post("apply-agent")}'),
    (NULL, '*/30 * * * *', '${post("apply-broker")}');
`;

type Job = { jobname: string | null; schedule: string; command: string };
const jobs = async (db: PGlite) =>
  (await db.query<Job>("SELECT jobname, schedule, command FROM cron.job ORDER BY jobname NULLS FIRST")).rows;
const names = async (db: PGlite) => (await jobs(db)).map((j) => j.jobname);

async function production(unscheduleWorks = true): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(cron(unscheduleWorks));
  // The two schedules as production holds them: the last migration to write each.
  await db.exec(readFileSync(APPLY_AGENT_LIVE, "utf8"));
  await db.exec(readFileSync(RUNNER_LIVE, "utf8"));
  await db.exec(KEPT);
  await db.exec(DRIFTED);
  return db;
}

describe("20261011130000: the apply agent's schedules are removed by name", { timeout: 60_000 }, () => {
  it("the migration exists in the retire group's range", () => {
    expect(existsSync(FIX), "no migration removes the apply agent's schedules: the database keeps calling it").toBe(true);
  });

  it("the replay starts from production: both agent schedules post to their functions", async () => {
    const db = await production();
    const all = await jobs(db);
    const hourly = all.find((j) => j.jobname === "apply-agent-hourly");
    const nightly = all.find((j) => j.jobname === "agent-runner-nightly");
    expect(hourly?.schedule).toBe("23 * * * *");
    expect(hourly?.command).toMatch(/functions\/v1\/apply-agent'/);
    expect(nightly?.schedule).toBe("10 6 * * *");
    expect(nightly?.command).toMatch(/functions\/v1\/agent-runner'/);
  });

  it("removes both schedules and every drifted job that still posts to the agent, and nothing else", async () => {
    const db = await production();
    const before = await jobs(db);
    await db.exec(readFileSync(FIX, "utf8"));
    const after = await jobs(db);
    expect(after.map((j) => j.jobname)).toEqual(["a-different-function", "agent-queue-retention", "reconcile-stripe", "send-agent-digest"]);
    // The survivors are byte-for-byte what they were.
    for (const j of after) expect(j).toEqual(before.find((b) => b.jobname === j.jobname));
    // No command left anywhere posts to the three functions.
    for (const j of after) expect(j.command).not.toMatch(/functions\/v1\/(apply-agent|apply-broker|agent-runner)'/);
  });

  it("is safe to re-run, and runs where none of the jobs ever existed", async () => {
    const db = await production();
    await db.exec(readFileSync(FIX, "utf8"));
    await expect(db.exec(readFileSync(FIX, "utf8"))).resolves.toBeDefined();
    expect(await names(db)).toEqual(["a-different-function", "agent-queue-retention", "reconcile-stripe", "send-agent-digest"]);

    const empty = new PGlite();
    await empty.exec(cron());
    await expect(empty.exec(readFileSync(FIX, "utf8"))).resolves.toBeDefined();
    expect(await names(empty)).toEqual([]);
  });

  it("checks itself: an unschedule that removed nothing fails the migration, naming what is left", async () => {
    const db = await production(false);
    await expect(db.exec(readFileSync(FIX, "utf8"))).rejects.toThrow(
      /self-check: 4 pg_cron job\(s\) still run the apply agent: .*apply-agent-hourly.*agent-runner-nightly.*apply-agent-every-15.*job \d+/,
    );
  });

  it("does nothing where pg_cron is not installed", async () => {
    const db = new PGlite();
    await expect(db.exec(readFileSync(FIX, "utf8"))).resolves.toBeDefined();
  });

  it("schedules nothing itself, so no guard reads it as the live definition of either job", () => {
    const sql = readFileSync(FIX, "utf8");
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
  });
});
