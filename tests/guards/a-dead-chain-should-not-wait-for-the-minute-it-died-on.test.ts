import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A DEAD CHAIN SHOULD NOT WAIT FOR THE MINUTE IT DIED ON.
 *
 * The refresh rotation is a self-kicking chain; pg_cron only restarts it when
 * it dies. 20260714170000 added a "backup" cron for that restart and promised
 * offset minutes (4,14,... vs 9,19,...), but scheduled it at '9-59/10' -- the
 * same minutes the live primary fires on (measured 2026-09-03: every revival
 * landed on a :x9). A backup on the primary's minute is declined at the slice
 * lock and adds nothing; a dead chain still waited up to ten minutes.
 *
 * 20260909219000 moves the backup into the gap. These guards pin the PROPERTIES
 * of that migration -- offset schedules, only the two refresh rows touched, the
 * job body unchanged, guarded and idempotent, and TWO active kicks at the end
 * even when the primary had no active row (20260817222227 deactivated four
 * jobids by number; a lone backup moved from :x9 to :x4 is the same ten-minute
 * wait with a NOTICE that says "moved") -- against comment-stripped SQL, and
 * prove their teeth against the pre-fix block in 20260715015753, which pins
 * '9-59/10' unconditionally and must FAIL the offset property, and against the
 * lane's first draft, which let a lone backup pass the self-check.
 *
 * Guards read the migration text because there is no cron.job to query from a
 * test; the self-verifying DO block at the bottom of the migration is the
 * runtime half of the same rule.
 */
const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const NEW = "20260909219000_a_dead_chain_should_not_wait_for_the_minute_it_died_on.sql";
const PRE_FIX = "20260715015753_22939311-3e47-4143-ab33-814989ceb61f.sql";
const BACKUP = "job-board-refresh-backup";
const PRIMARY = "job-board-refresh";
/** The schedule every measured revival landed on (memory: rotation cadence, 2026-09-03). */
const MEASURED_PRIMARY = "9-59/10 * * * *";
/** The schedule the migration folder records for the primary (20260711144159). */
const FOLDER_PRIMARY = "4-59/10 * * * *";

const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), "utf8");

/** Guards assert against code, never against comments (memory: guard literals). */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** Every 'N-59/10 * * * *' literal in the text, in order of appearance. */
function scheduleLiterals(sql: string): string[] {
  return [...sql.matchAll(/'(\d+-59\/10 \* \* \* \*)'/g)].map((m) => m[1]);
}

/** The minute anchor of an 'N-59/10' schedule. */
const anchor = (s: string) => Number(/^(\d+)-59\/10/.exec(s)?.[1]);

/**
 * Evaluate the schedule the migration would hand cron.schedule for a given
 * live primary schedule. The new migration decides with a CASE on the primary's
 * row; a migration with no CASE (the pre-fix block) schedules its one literal
 * unconditionally.
 */
function backupTargetFor(code: string, primarySched: string | null): string | null {
  const c = /CASE\s+WHEN\s+primary_sched\s*=\s*'([^']+)'\s+THEN\s+'([^']+)'\s+ELSE\s+'([^']+)'\s+END/.exec(code);
  if (c) return primarySched === c[1] ? c[2] : c[3];
  const s = /cron\.schedule\(\s*'job-board-refresh-backup',\s*'([^']+)'/.exec(code);
  return s ? s[1] : null;
}

/** THE PROPERTY: for every primary the migration can meet, the backup lands on a different minute. */
function backupIsOffsetFromPrimary(code: string): boolean {
  for (const primary of [MEASURED_PRIMARY, FOLDER_PRIMARY, null]) {
    const target = backupTargetFor(code, primary);
    if (!target) return false;
    if (primary !== null && anchor(target) === anchor(primary)) return false;
    // No active primary: the live kicks are still on :x9, so the backup must not be.
    if (primary === null && anchor(target) === anchor(MEASURED_PRIMARY)) return false;
  }
  return true;
}

/** Every $job$ body a migration hands cron.schedule, whitespace-normalised, in order. */
function jobBodies(sql: string): string[] {
  return [...sql.matchAll(/\$job\$([\s\S]*?)\$job\$/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
}
const jobBody = (sql: string) => jobBodies(sql)[0] ?? "";

/**
 * How many ACTIVE refresh kicks the migration leaves behind, given whether the
 * primary had an active row. It re-creates the primary only inside the
 * `IF primary_sched IS NULL THEN` branch; a draft without that branch leaves
 * one kick when the primary is gone, whatever the backup's minute.
 */
function activeKicksAfter(code: string, primaryActive: boolean): number {
  const recreates = /IF primary_sched IS NULL THEN[\s\S]*?PERFORM cron\.schedule\(\s*'job-board-refresh',/.test(code);
  return 1 + (primaryActive || recreates ? 1 : 0);
}

describe("a dead chain should not wait for the minute it died on", () => {
  const raw = read(NEW);
  const code = stripComments(raw);
  const preFixCode = stripComments(read(PRE_FIX));

  it("the backup lands on a minute the primary does not, whatever the primary's live row says", () => {
    expect(backupIsOffsetFromPrimary(code), `${NEW} can leave the backup on the primary's schedule`).toBe(true);
    // Concretely, both branches:
    expect(backupTargetFor(code, MEASURED_PRIMARY)).toBe("4-59/10 * * * *");
    expect(backupTargetFor(code, null)).toBe("4-59/10 * * * *");
    expect(backupTargetFor(code, FOLDER_PRIMARY)).toBe("9-59/10 * * * *");
  });

  it("TEETH: the pre-fix block in 20260715015753 fails the offset property", () => {
    // It pins '9-59/10' with no CASE, which is the primary's measured minute.
    expect(backupTargetFor(preFixCode, MEASURED_PRIMARY)).toBe(MEASURED_PRIMARY);
    expect(backupIsOffsetFromPrimary(preFixCode)).toBe(false);
  });

  it("the only schedules in the file are the two ten-minute lanes, five minutes apart", () => {
    const lits = [...new Set(scheduleLiterals(code))].sort();
    expect(lits).toEqual(["4-59/10 * * * *", "9-59/10 * * * *"]);
    expect(Math.abs(anchor(lits[0]) - anchor(lits[1]))).toBe(5);
    // No other cron expression sneaks in under a different shape.
    const anyCron = [...code.matchAll(/'([\d*,/-]+ [\d*,/-]+ [\d*,/-]+ [\d*,/-]+ [\d*,/-]+)'/g)].map((m) => m[1]);
    expect(anyCron.every((s) => /^\d+-59\/10 \* \* \* \*$/.test(s)), `unexpected cron expression: ${anyCron}`).toBe(true);
  });

  it("leaves two active kicks whether or not the primary had an active row", () => {
    expect(activeKicksAfter(code, true)).toBe(2);
    expect(activeKicksAfter(code, false)).toBe(2);
    // The re-creation is guarded (unschedule an inactive row by name first),
    // sits on the measured minute, and is the ONLY schedule call for that name.
    expect(code).toMatch(
      /IF primary_sched IS NULL THEN\s+IF EXISTS \(SELECT 1 FROM cron\.job j WHERE j\.jobname = 'job-board-refresh'\) THEN\s+PERFORM cron\.unschedule\('job-board-refresh'\);\s+END IF;\s+PERFORM cron\.schedule\(\s*'job-board-refresh',\s*'9-59\/10 \* \* \* \*'/,
    );
    expect(code).toMatch(/primary_sched := '9-59\/10 \* \* \* \*';/);
    // And the self-check refuses a lone kick.
    expect(code).toMatch(/IF primary_sched IS NULL THEN\s+RAISE EXCEPTION/);
  });

  it("TEETH: the lane's first draft -- no re-creation branch -- leaves one kick when the primary is gone", () => {
    const draft = code.replace(/IF primary_sched IS NULL THEN[\s\S]*?RAISE WARNING[^\n]*\n\s*END IF;/, "");
    expect(draft).not.toBe(code);
    expect(backupTargetFor(draft, null)).toBe("4-59/10 * * * *"); // it still "moves"...
    expect(activeKicksAfter(draft, false)).toBe(1); // ...and still waits ten minutes.
    expect(activeKicksAfter(draft, true)).toBe(2);
  });

  it("touches only the two refresh rows and reads nothing else in the cron catalogue", () => {
    const schedules = [...code.matchAll(/cron\.schedule\(\s*'([^']+)'/g)].map((m) => m[1]);
    const unschedules = [...code.matchAll(/cron\.unschedule\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(schedules).toEqual([PRIMARY, BACKUP]);
    expect(unschedules).toEqual([PRIMARY, BACKUP]);
    // Every jobname the file names is one of the two refresh kicks.
    const named = [...code.matchAll(/jobname\s*=\s*'([^']+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect([PRIMARY, BACKUP], `names a third cron row: ${n}`).toContain(n);
    // No blanket or id-addressed edits to the cron catalogue.
    expect(code).not.toMatch(/cron\.alter_job/i);
    expect(code).not.toMatch(/\bjobid\b/i);
    expect(code).not.toMatch(/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO|TRUNCATE)\s+cron\./i);
    // Only schedule / unschedule / a read of cron.job -- no other cron.* call.
    const cronCalls = [...code.matchAll(/cron\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(cronCalls)].sort()).toEqual(["job", "schedule", "unschedule"]);
  });

  it("every job body is byte-for-byte the one 20260715015753 scheduled -- no throughput constant moves", () => {
    const bodies = jobBodies(code);
    expect(bodies).toHaveLength(2); // the re-created primary and the moved backup
    for (const b of bodies) {
      expect(b).not.toBe("");
      expect(b).toBe(jobBody(preFixCode));
      expect(b).toContain('"action":"refresh"');
      expect(b).not.toMatch(/force|boards|budget|concurrency|chain/i);
    }
    // And the migration writes no application table: it is a cron-catalogue change only.
    expect(code).not.toMatch(/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO|ALTER\s+TABLE|CREATE\s+(OR\s+REPLACE\s+)?FUNCTION)\b/i);
    expect(code).not.toMatch(/job_board_meta|slice_stats|refresh_progress/);
  });

  it("is guarded like 20260715015753 and idempotent", () => {
    // The cron namespace may be absent on a local reset.
    expect(code).toMatch(/pg_namespace\s+WHERE\s+nspname\s*=\s*'cron'/);
    // cron.unschedule raises on a missing job: it must sit behind an EXISTS.
    expect(code).toMatch(/IF EXISTS \(SELECT 1 FROM cron\.job j WHERE j\.jobname = 'job-board-refresh-backup'\) THEN\s*PERFORM cron\.unschedule\('job-board-refresh-backup'\)/);
    // A backup already on the offset schedule is left alone.
    expect(code).toMatch(/IF current_sched = target THEN[\s\S]*?RETURN;/);
    // And it refuses to end with both active kicks on one schedule.
    expect(code).toMatch(/primary_sched = backup_sched[\s\S]*?RAISE EXCEPTION/);
  });

  it("documents the lock that prevents a double chain and that no throughput constant moves", () => {
    // Documentation requirements are checked on the raw text, on purpose.
    expect(raw).toMatch(/SLICE_LOCK_MS \(3 min\)/);
    expect(raw).toMatch(/NO THROUGHPUT CONSTANT MOVES/);
    expect(raw).toMatch(/slice size/i);
    expect(raw).toMatch(/concurrency/i);
    expect(raw).toMatch(/budget/i);
    expect(raw).toMatch(/lane/i);
  });
});
