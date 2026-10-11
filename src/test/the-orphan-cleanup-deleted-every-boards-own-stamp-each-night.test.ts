// @vitest-environment node
/**
 * THE ORPHAN CLEANUP DELETED EVERY BOARD'S OWN STAMP EACH NIGHT (S10-018).
 *
 * job-board .91 (n428) stamps a board on a shared token under its own key,
 * `source:token`, so a deferred twin ages to the 48-hour sweep instead of
 * riding its twin's reads. The nightly job-board-verif-orphan-cleanup
 * (20260720164549) deleted every stamp whose company_token matched no
 * posting's, and no posting's company_token is ever 'greenhouse:lush'. So every
 * keyed stamp went at 03:51, seedBoardStamps re-seeded it from the twin's fresh
 * bare stamp, and a deferred board never aged: greenhouse:lush at 47 h was
 * 0.1 h the next morning.
 *
 * 20261009100400 resolves a keyed stamp to its board (source before the first
 * ':', token after it) and keeps it while that vendor's posting on that token
 * exists. Run here in pglite: the old command as the defect, the new one as the
 * fix, the real stampPlan for the morning after, and the in-place,
 * re-runnable, no-cron cases.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stampPlan } from "../../supabase/functions/job-board/verification-stamp.ts";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const ORIGINAL = read("supabase/migrations/20260720164549_938ef6ac-aba3-4d04-a9a6-73a585ccf638.sql");
const FIX = read("supabase/migrations/20261009100400_the_orphan_cleanup_keeps_a_boards_own_stamp_while_its_postings_exist.sql");

const CRON = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
    WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
    UPDATE cron.job SET command = COALESCE(alter_job.command, cron.job.command), schedule = COALESCE(alter_job.schedule, cron.job.schedule) WHERE jobid = job_id $$;
`;
const TABLES = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, verified_at timestamptz NOT NULL);
  CREATE TABLE public.job_board_postings (id text PRIMARY KEY, source text, company_token text, missing_since timestamptz);
`;
const POSTINGS = `
  INSERT INTO public.job_board_postings (id, source, company_token) VALUES
    ('greenhouse:lush:1', 'greenhouse', 'lush'), ('personio:lush:1', 'personio', 'lush'),
    ('greenhouse:fresh:1', 'greenhouse', 'fresh');
`;
/** [key, hours old] */
const STAMPS: Array<[string, number]> = [
  ["lush", 0.1],              // bare, postings on the token: kept by both commands
  ["personio:lush", 0.1],     // the reading twin's own stamp, its postings exist
  ["greenhouse:lush", 47],    // the deferred twin's own stamp, its postings exist: the n428 key
  ["workable:lush", 30],      // a key for a vendor with no posting on the token: an orphan
  ["ashby:ghost", 10],        // a key whose token has no posting at all: an orphan
  ["oldco", 80],              // bare, no posting: an orphan
  ["fresh", 1],               // bare, postings: kept
];
const stampSql = (rows: Array<[string, number]>) =>
  rows.map(([k, h]) => `INSERT INTO public.job_board_verifications VALUES ('${k}', now() - interval '${h * 3600} seconds');`).join("\n");

async function boot(withCron = true): Promise<PGlite> {
  const db = new PGlite();
  await db.exec((withCron ? CRON : "") + TABLES + POSTINGS + stampSql(STAMPS));
  await db.exec(ORIGINAL); // the job as production has it: '51 3 * * *', the company_token-only DELETE
  return db;
}
const command = async (db: PGlite) => (await db.query<{ command: string }>("SELECT command FROM cron.job WHERE jobname = 'job-board-verif-orphan-cleanup'")).rows[0].command;
const left = async (db: PGlite) => (await db.query<{ company_token: string }>("SELECT company_token FROM public.job_board_verifications ORDER BY company_token")).rows.map((r) => r.company_token);

describe("20261009100400: the nightly cleanup judges a board's own stamp by its board", { timeout: 60_000 }, () => {
  it("the old command is the defect: it deletes the keyed stamps of boards whose postings exist", async () => {
    const db = await boot();
    await db.exec(await command(db));
    const kept = await left(db);
    expect(kept, "the old command kept a keyed stamp").not.toContain("greenhouse:lush");
    expect(kept).not.toContain("personio:lush");
    expect(kept).toEqual(["fresh", "lush"]);
    await db.close();
  });

  it("the new command keeps a keyed stamp while its vendor's posting on its token exists, and deletes the orphans", async () => {
    const db = await boot();
    await db.exec(FIX);
    await db.exec(await command(db));
    expect(await left(db)).toEqual(["fresh", "greenhouse:lush", "lush", "personio:lush"]);
    // the deferred twin's stamp kept its age
    const age = (await db.query<{ h: number }>("SELECT extract(epoch FROM now() - verified_at) / 3600 AS h FROM public.job_board_verifications WHERE company_token = 'greenhouse:lush'")).rows[0].h;
    expect(Number(age)).toBeGreaterThan(46.9);
    await db.close();
  });

  it("the morning after, stampPlan seeds nothing over the kept key, so the deferred board ages; after the old command it re-seeded it fresh", async () => {
    const SHARED = new Set(["lush"]);
    const boards = [{ source: "greenhouse", token: "lush" }, { source: "personio", token: "lush" }];
    const morning = async (db: PGlite) => {
      const have = (await db.query<{ company_token: string }>("SELECT company_token FROM public.job_board_verifications WHERE company_token LIKE '%:%'")).rows.map((r) => r.company_token);
      const bare = (await db.query<{ company_token: string; verified_at: string }>("SELECT company_token, verified_at::text AS verified_at FROM public.job_board_verifications WHERE company_token = 'lush'")).rows;
      return stampPlan(have, bare, boards, SHARED);
    };
    const fixed = await boot();
    await fixed.exec(FIX);
    await fixed.exec(await command(fixed));
    expect((await morning(fixed)).seed).toEqual([]);
    await fixed.close();

    const old = await boot();
    await old.exec(await command(old));
    const plan = await morning(old);
    expect(plan.seed.map((s) => s.company_token).sort(), "the old cleanup handed the deferred board its twin's fresh stamp").toEqual(["greenhouse:lush", "personio:lush"]);
    await old.close();
  });

  it("changes the command in place: same job id, same minute, its own statement_timeout", async () => {
    const db = await boot();
    const before = (await db.query<{ jobid: number; command: string }>("SELECT jobid, command FROM cron.job WHERE jobname = 'job-board-verif-orphan-cleanup'")).rows[0];
    await db.exec(FIX);
    const after = (await db.query<{ jobid: number; schedule: string; command: string }>("SELECT jobid, schedule, command FROM cron.job WHERE jobname = 'job-board-verif-orphan-cleanup'")).rows;
    expect(after).toHaveLength(1);
    expect(after[0].jobid).toBe(before.jobid);
    expect(after[0].schedule).toBe("51 3 * * *");
    expect(after[0].command).not.toBe(before.command);
    expect(after[0].command.startsWith("SET statement_timeout = '5min';")).toBe(true);
    await db.close();
  });

  it("applies twice in a row, schedules the job where it is missing, and is a no-op without pg_cron", async () => {
    const db = await boot();
    await db.exec(FIX);
    await db.exec(FIX);
    expect((await db.query("SELECT 1 FROM cron.job WHERE jobname = 'job-board-verif-orphan-cleanup'")).rows).toHaveLength(1);
    await db.exec("DELETE FROM cron.job");
    await db.exec(FIX);
    expect((await db.query<{ schedule: string }>("SELECT schedule FROM cron.job WHERE jobname = 'job-board-verif-orphan-cleanup'")).rows[0].schedule).toBe("51 3 * * *");
    await db.close();

    const bare = new PGlite();
    await bare.exec(TABLES);
    await bare.exec(FIX);
    await bare.close();
  });

  it("its self-check refuses a command that lost the board's vendor", async () => {
    const db = await boot();
    await db.exec(FIX);
    const verify = FIX.slice(FIX.indexOf("DO $verify$"));
    await db.exec(`UPDATE cron.job SET command = replace(command, 'AND (strpos(v.company_token, '':'') = 0 OR p.source = split_part(v.company_token, '':'', 1))', '') WHERE jobname = 'job-board-verif-orphan-cleanup'`);
    await expect(db.exec(verify)).rejects.toThrow(/does not resolve a source:token stamp/);
    await db.close();
  });
});
