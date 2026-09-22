/**
 * PG_CRON'S OWN LOG IS PRUNED LIKE EVERY OTHER LEDGER.
 *
 * Measured 2026-09-18: cron.job_run_details held 238k rows back to December
 * in 151 MB with no retention anywhere -- every ledger in public has a
 * summarise-then-prune or a retention row; the scheduler's own log had
 * neither. One migration schedules the Supabase-documented cleanup. This file
 * pins what that row must and must not be, read off comment-stripped SQL:
 *
 *   1. Exactly one migration schedules the job, found by the job name in its
 *      CODE (never by stamp: a re-emitted copy is checked the same way).
 *   2. The body is a DELETE from cron.job_run_details on end_time older than
 *      seven days -- the window the ops runbook diagnoses from -- and nothing
 *      else: no VACUUM (25001 inside the runner and a scheduled VACUUM is the
 *      cure that became the disease, 20260830200000), no public table, no
 *      second statement.
 *   3. Its minute does not collide with the other 04:xx retention rows.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, " ");

const MIGRATIONS = readdirSync(resolve(ROOT, "supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
const JOB = "cron-log-retention";

const scheduling = MIGRATIONS.filter((n) => new RegExp(`cron\\.schedule\\(\\s*'${JOB}'`).test(stripSql(read(`supabase/migrations/${n}`))));

function parts(sql: string): { schedule: string; body: string } {
  const m = new RegExp(`cron\\.schedule\\(\\s*'${JOB}',\\s*'([^']+)',\\s*\\$job\\$([\\s\\S]*?)\\$job\\$`).exec(stripSql(sql));
  if (!m) throw new Error(`no cron.schedule row for ${JOB}`);
  return { schedule: m[1], body: m[2].trim() };
}

describe("pg_cron's own log is pruned like every other ledger", () => {
  it("exactly one migration schedules the cleanup", () => {
    expect(scheduling, "one file, found by the job name in its code").toHaveLength(1);
  });

  const sql = scheduling.length ? read(`supabase/migrations/${scheduling[0]}`) : "";
  const code = stripSql(sql);

  it("the body is one DELETE on end_time older than seven days and nothing else", () => {
    const { body } = parts(sql);
    expect(body).toMatch(/^DELETE FROM cron\.job_run_details WHERE end_time < now\(\) - interval '7 days';?$/);
    expect(body.split(";").filter((s) => s.trim()).length, "a single statement").toBe(1);
  });

  it("nothing in the file vacuums, and nothing in it names a public table", () => {
    expect(code, "VACUUM raises 25001 inside the runner and is never scheduled").not.toMatch(/\bVACUUM\b/i);
    expect(code).not.toMatch(/\bpublic\.job_board_/);
  });

  it("runs daily at a minute no other 04:xx retention row uses", () => {
    const { schedule } = parts(sql);
    expect(schedule).toMatch(/^\d{1,2} 4 \* \* \*$/);
    const minute = schedule.split(" ")[0];
    // the other daily rows in that hour, from the live cron.job read of 2026-09-18
    expect(["10", "17", "23"], `04:${minute} collides with an existing daily row`).not.toContain(minute);
  });

  it("is guarded on the cron schema existing, so the pglite harness applies it as a no-op", () => {
    expect(code).toMatch(/IF EXISTS \(SELECT 1 FROM pg_namespace WHERE nspname = 'cron'\)/);
  });

  it("teeth: a body that adds a VACUUM would fail the second property", () => {
    const bad = sql.replace("interval '7 days'; $job$", "interval '7 days'; VACUUM cron.job_run_details; $job$");
    expect(bad).not.toBe(sql);
    const { body } = parts(bad);
    expect(body.split(";").filter((s) => s.trim()).length).toBe(2);
    expect(stripSql(bad)).toMatch(/\bVACUUM\b/i);
  });
});
