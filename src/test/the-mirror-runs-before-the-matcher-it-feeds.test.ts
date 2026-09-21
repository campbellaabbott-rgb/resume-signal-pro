/**
 * THE MIRROR RUNS BEFORE THE MATCHER IT FEEDS.
 *
 * Measured 2026-09-21: the poller had run, the matcher had run, and
 * public.layoff_board_names was empty -- its only writer was an operator
 * script needing a key this machine never holds, so the exact rule had
 * nothing to compare against and two-word filers answered no rows. The fix
 * moved the writer into the deployed function (action "mirror") and added one
 * cron row to kick it. This file pins the row's three properties, each read
 * off comment-stripped SQL and each with a teeth case:
 *
 *   1. ONE row, scheduled a few minutes BEFORE the existing matcher row on the
 *      same daily clock, posting the mirror action with chain:false -- the
 *      matcher row minutes later is what rebuilds; the mirror must not race
 *      it from behind.
 *   2. The same door as every other kick: the layoff-filings function, the
 *      vault-held key in the x-layoff-cron header, the same net.http_post
 *      shape as the matcher migration's rows.
 *   3. The read log admits the kind the function writes for it, proven by
 *      running the migration on pglite against the lane-A table and inserting.
 *
 * The migration is found by the DDL unique to it (the job name it schedules),
 * never by stamp, so a re-stamped copy the deploy emits is checked the same
 * way (project_lovable_deploys: the re-emitted file is the ledger).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, " ");
const stripTs = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

const MIGRATIONS = readdirSync(resolve(ROOT, "supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();

const MIRROR_JOB = "layoff-mirror-daily";
const MATCHER_JOB = "layoff-partition-refresh";
const POLLER = "supabase/functions/layoff-filings/index.ts";

/** Every migration whose CODE schedules the named job, oldest first. */
function scheduling(jobName: string): string[] {
  return MIGRATIONS.filter((n) => new RegExp(`cron\\.schedule\\(\\s*'${jobName}'`).test(stripSql(read(`supabase/migrations/${n}`))));
}

/** The cron expression a migration's CODE schedules under a job name. */
function scheduleOf(sql: string, jobName: string): string {
  const m = new RegExp(`cron\\.schedule\\(\\s*'${jobName}',\\s*'([^']+)'`).exec(stripSql(sql));
  if (!m) throw new Error(`no cron.schedule for ${jobName}`);
  return m[1];
}

/** The $job$ body a migration's CODE schedules under a job name. */
function jobBodyOf(sql: string, jobName: string): string {
  const m = new RegExp(`cron\\.schedule\\(\\s*'${jobName}',\\s*'[^']+',\\s*\\$job\\$([\\s\\S]*?)\\$job\\$`).exec(stripSql(sql));
  if (!m) throw new Error(`no $job$ body for ${jobName}`);
  return m[1];
}

/** Minute of the day for a daily five-field expression; throws on anything that is not `m h * * *`. */
function minuteOfDay(schedule: string): number {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (!m) throw new Error(`${JSON.stringify(schedule)} is not a daily m h * * * expression`);
  return Number(m[2]) * 60 + Number(m[1]);
}

/** THE PROPERTY, as a routine the teeth cases can hand a doctored copy to. */
function assertRow(mirrorSql: string, matcherSql: string, pollerTs: string): void {
  const code = stripSql(mirrorSql);
  const calls = code.match(/cron\.schedule\(/g) ?? [];
  if (calls.length !== 1) throw new Error(`the mirror migration schedules ${calls.length} jobs; it adds ONE row`);
  if (/CREATE (OR REPLACE )?FUNCTION/i.test(code)) throw new Error("the mirror migration creates a function; none was expected");

  const body = jobBodyOf(mirrorSql, MIRROR_JOB);
  if (!/body := '\{"action":"mirror","chain":false\}'::jsonb/.test(body)) throw new Error("the row must post action mirror with chain:false");
  if (!/functions\/v1\/layoff-filings'/.test(body)) throw new Error("the row must post to the layoff-filings function");
  if (!/'x-layoff-cron', \(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name = 'layoff_cron_key' LIMIT 1\)/.test(body)) {
    throw new Error("the row must carry the vault-held key as x-layoff-cron");
  }
  if (!/WHERE EXISTS \(SELECT 1 FROM vault\.decrypted_secrets WHERE name = 'layoff_cron_key'\)/.test(body)) {
    throw new Error("the row must post nothing when the key is absent");
  }
  // The same door, shaped the same way: url and headers equal the matcher migration's edgar row, whitespace aside.
  const shape = (s: string) => s.replace(/body := '[^']+'::jsonb/, "body := <b>").replace(/\s+/g, " ").trim();
  const theirs = jobBodyOf(matcherSql, "layoff-edgar-atom");
  if (shape(body) !== shape(theirs)) throw new Error(`the row's http_post shape differs from the edgar row's:\n${shape(body)}\n${shape(theirs)}`);

  const mine = minuteOfDay(scheduleOf(mirrorSql, MIRROR_JOB));
  const matcher = minuteOfDay(scheduleOf(matcherSql, MATCHER_JOB));
  if (mine >= matcher) throw new Error(`${MIRROR_JOB} at minute ${mine} does not precede ${MATCHER_JOB} at minute ${matcher}`);
  if (matcher - mine > 30) throw new Error(`${MIRROR_JOB} runs ${matcher - mine} minutes before ${MATCHER_JOB}; a few minutes, not a different hour`);

  // The function honours the row: "mirror" dispatches and chain gates on strict true, so chain:false leaves the rebuild to the matcher row.
  const poller = stripTs(pollerTs);
  if (!/case "mirror":/.test(poller)) throw new Error("the poller does not dispatch the mirror action");
  if (!/const chain = body\.chain === true;/.test(poller)) throw new Error("the poller's chain gate is not strict true");
  if (!/type LogKind = [^;]*"mirror"/.test(poller)) throw new Error("the poller's read-log kind union does not name mirror");
}

const MIRROR_FILES = scheduling(MIRROR_JOB);
const MIRROR_MIG = MIRROR_FILES[MIRROR_FILES.length - 1];
const MATCHER_FILES = scheduling(MATCHER_JOB);
const MATCHER_MIG = MATCHER_FILES[MATCHER_FILES.length - 1];
const MIRROR_SQL = MIRROR_MIG ? read(`supabase/migrations/${MIRROR_MIG}`) : "";
const MATCHER_SQL = MATCHER_MIG ? read(`supabase/migrations/${MATCHER_MIG}`) : "";
const POLLER_TS = read(POLLER);

describe("the cron row", () => {
  it("exists once, stamped 2026-09-21, and is the only migration scheduling the job", () => {
    expect(MIRROR_FILES).toHaveLength(1);
    expect(MIRROR_MIG).toMatch(/^20260921\d{6}_/);
    expect(MATCHER_MIG).toBeDefined();
  });

  it("is one row, the same door as the other kicks, a few minutes before the matcher row, honoured by the poller", () => {
    expect(() => assertRow(MIRROR_SQL, MATCHER_SQL, POLLER_TS)).not.toThrow();
  });

  it("names its schedule and the matcher's: 05:00 before 05:10 UTC", () => {
    expect(scheduleOf(MIRROR_SQL, MIRROR_JOB)).toBe("0 5 * * *");
    expect(scheduleOf(MATCHER_SQL, MATCHER_JOB)).toBe("10 5 * * *");
  });
});

describe("the read log admits the kind the function writes (pglite)", () => {
  let db: PGlite;
  const laneA = MIGRATIONS.find((n) => n.startsWith("20260918100000"));
  /** The lane-A CREATE TABLE for the read log, lifted from its migration so the check being widened is the real one. */
  const readLogDdl = (): string => {
    const sql = stripSql(read(`supabase/migrations/${laneA}`));
    const m = /CREATE TABLE IF NOT EXISTS public\.layoff_read_log \([\s\S]*?\);/.exec(sql);
    if (!m) throw new Error("lane A's read-log DDL not found");
    return m[0];
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    await db.exec(readLogDdl());
    // The lane-A check refuses the kind before the migration runs.
    await expect(db.query("INSERT INTO public.layoff_read_log (kind, ok) VALUES ('mirror', true)")).rejects.toThrow(/check/i);
    await db.exec(MIRROR_SQL);
  });
  afterAll(async () => { await db?.close(); });

  it("after the migration a mirror row inserts and an unknown kind is still refused", async () => {
    await db.query("INSERT INTO public.layoff_read_log (kind, fetched, kept, new_rows, ok, ms, note) VALUES ('mirror', 44663, 44663, 44663, true, 1200, 'pruned=0')");
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.layoff_read_log WHERE kind = 'mirror'");
    expect(rows[0].n).toBe(1);
    await expect(db.query("INSERT INTO public.layoff_read_log (kind, ok) VALUES ('bogus', true)")).rejects.toThrow(/check/i);
    for (const k of ["edgar_atom", "edgar_fts_audit", "edgar_backfill", "warn", "matcher", "partition"]) {
      await db.query("INSERT INTO public.layoff_read_log (kind, ok) VALUES ($1, true)", [k]);
    }
  });

  it("applies twice without error (idempotent on the constraint; pg_cron absent here is a notice, not a failure)", async () => {
    await db.exec(MIRROR_SQL);
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.layoff_read_log'::regclass AND contype = 'c'",
    );
    expect(rows[0].n).toBe(1);
  });

  it("TEETH: with the widening removed, the migration's own self-check raises", async () => {
    const cut = MIRROR_SQL.replace(/ALTER TABLE public\.layoff_read_log\s+ADD CONSTRAINT layoff_read_log_kind_check\s+CHECK \([^;]*\);/, "");
    expect(cut).not.toBe(MIRROR_SQL);
    const fresh = new PGlite();
    await fresh.exec(readLogDdl());
    await expect(fresh.exec(cut)).rejects.toThrow(/does not admit the mirror kind/);
    await fresh.close();
  });
});

describe("the checks have teeth", () => {
  it("a row moved to after the matcher, or an hour early, fails by name", () => {
    const late = MIRROR_SQL.replace(/(cron\.schedule\(\s*'layoff-mirror-daily',\s*)'[^']+'/, "$1'20 5 * * *'");
    expect(() => assertRow(late, MATCHER_SQL, POLLER_TS)).toThrow(/does not precede/);
    const early = MIRROR_SQL.replace(/(cron\.schedule\(\s*'layoff-mirror-daily',\s*)'[^']+'/, "$1'0 4 * * *'");
    expect(() => assertRow(early, MATCHER_SQL, POLLER_TS)).toThrow(/a few minutes, not a different hour/);
    const hourly = MIRROR_SQL.replace(/(cron\.schedule\(\s*'layoff-mirror-daily',\s*)'[^']+'/, "$1'0 * * * *'");
    expect(() => assertRow(hourly, MATCHER_SQL, POLLER_TS)).toThrow(/not a daily/);
  });

  it("a row that chains, posts another action, or drops the key fails by name", () => {
    expect(() => assertRow(MIRROR_SQL.replace('"chain":false', '"chain":true'), MATCHER_SQL, POLLER_TS)).toThrow(/chain:false/);
    expect(() => assertRow(MIRROR_SQL.replace('"action":"mirror"', '"action":"matches"'), MATCHER_SQL, POLLER_TS)).toThrow(/action mirror/);
    expect(() => assertRow(MIRROR_SQL.replace("'x-layoff-cron', (SELECT decrypted_secret", "'x-layoff-cron', ('open'"), MATCHER_SQL, POLLER_TS)).toThrow(/vault-held key/);
  });

  it("a second cron row, or a function, in the same file fails by name", () => {
    const twice = MIRROR_SQL.replace("PERFORM cron.schedule(", "PERFORM cron.schedule('other', '* * * * *', $job$ SELECT 1 $job$); PERFORM cron.schedule(");
    expect(() => assertRow(twice, MATCHER_SQL, POLLER_TS)).toThrow(/schedules 2 jobs/);
    const fn = `${MIRROR_SQL}\nCREATE OR REPLACE FUNCTION public.zz() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`;
    expect(() => assertRow(fn, MATCHER_SQL, POLLER_TS)).toThrow(/creates a function/);
  });

  it("a poller that ignores the row's chain:false, or does not dispatch mirror, fails by name", () => {
    expect(() => assertRow(MIRROR_SQL, MATCHER_SQL, POLLER_TS.replace('case "mirror":', 'case "mirrored":'))).toThrow(/does not dispatch/);
    expect(() => assertRow(MIRROR_SQL, MATCHER_SQL, POLLER_TS.replace("const chain = body.chain === true;", "const chain = true;"))).toThrow(/strict true/);
    // A literal in a comment satisfies nothing: the dispatch moved into prose is still missing.
    const prose = POLLER_TS.replace('case "mirror":', 'case "mirrored":') + '\n// case "mirror": return await runMirror(client, body);\n';
    expect(() => assertRow(MIRROR_SQL, MATCHER_SQL, prose)).toThrow(/does not dispatch/);
  });
});
