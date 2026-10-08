// @vitest-environment node
/**
 * A TWIN'S READ KEPT A DEFERRED BOARD'S ROWS OUT OF THE 48-HOUR SWEEP.
 *
 * The verification stamp was one row per company_token, and 139 tokens are
 * carried by two or three vendors. On 2026-10-06 greenhouse:lush was deferred
 * by the byte bound every visit while personio:lush read, so the token's stamp
 * stayed fresh, greenhouse:lush's rows were never swept, and 19 postings
 * already gone from its feed were served with a fresh recheckedAt.
 *
 * .91 stamps such a board under its own key (`source:token`) beside the bare
 * token, seeds a key per shared board from the token's stamp, reads
 * recheckedAt by key, keys the stale lane by board, and 20261008100000 /
 * 20261008100100 teach the sweep and get_stalest_boards to read the key. Each
 * piece is RUN here: the pure module, the shipped attachRecheckedAtInner body
 * against a stub client, and both migrations in pglite.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { laneRows, stampKeyOfJob, stampPlan, stampRows } from "../../supabase/functions/job-board/verification-stamp.ts";
import { keysOf, classifyStale, type StaleRow } from "../../supabase/functions/job-board/stale-lane.ts";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const SHARED = new Set(["lush", "samsara"]);
const LUSH_GH = { source: "greenhouse", token: "lush" };
const LUSH_PE = { source: "personio", token: "lush" };

describe("what a visit stamps, and what a job reads", () => {
  it("a board on a shared token stamps its own key and the bare token; any other board stamps its token", () => {
    expect(stampRows(LUSH_PE, SHARED, { verified_at: "T" })).toEqual([
      { company_token: "personio:lush", verified_at: "T" },
      { company_token: "lush", verified_at: "T" },
    ]);
    expect(stampRows({ source: "greenhouse", token: "stripe" }, SHARED, { verified_at: "T", feed_total: 5 })).toEqual([
      { company_token: "stripe", verified_at: "T", feed_total: 5 },
    ]);
  });

  it("a served job reads its board's key", () => {
    expect(stampKeyOfJob({ source: "greenhouse", token: "lush" }, SHARED)).toBe("greenhouse:lush");
    expect(stampKeyOfJob({ source: "greenhouse", token: "stripe" }, SHARED)).toBe("stripe");
    expect(stampKeyOfJob({ source: "greenhouse" }, SHARED)).toBe("");
  });
});

describe("the per-board stamps follow the catalogue", () => {
  const boards = [LUSH_GH, LUSH_PE, { source: "greenhouse", token: "samsara" }, { source: "pinpoint", token: "samsara" }, { source: "ashby", token: "stripe" }];
  const bare = [{ company_token: "lush", verified_at: "2026-10-06T03:00:00Z" }, { company_token: "samsara", verified_at: "2026-10-06T04:00:00Z" }, { company_token: "stripe", verified_at: "x" }];

  it("seeds every shared board that has no key yet at its token's stamp, and only those", () => {
    const plan = stampPlan(["personio:lush"], bare, boards, SHARED);
    expect(plan.seed).toEqual([
      { company_token: "greenhouse:lush", verified_at: "2026-10-06T03:00:00Z" },
      { company_token: "greenhouse:samsara", verified_at: "2026-10-06T04:00:00Z" },
      { company_token: "pinpoint:samsara", verified_at: "2026-10-06T04:00:00Z" },
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("removes a key whose token is no longer shared, so its aging stamp cannot sweep a board that reads", () => {
    const plan = stampPlan(["personio:lush", "workable:afg"], bare, boards, SHARED);
    expect(plan.remove).toEqual(["workable:afg"]);
  });

  it("the lane drops a shared token's bare row; its boards' own rows stand for them", () => {
    const rows = [{ stale_token: "lush" }, { stale_token: "greenhouse:lush" }, { stale_token: "oldco" }];
    expect(laneRows(rows, SHARED).map((r) => r.stale_token)).toEqual(["greenhouse:lush", "oldco"]);
  });

  it("classifies by board: a failing twin no longer marks the other, a deferred twin's key is its own", () => {
    const row = (k: string): StaleRow => ({ stale_token: k, stale_vendor: k.split(":")[0], stamped_at: "x", age_min: 5000, posting_rows: 3, live_rows: 2, newest_effective: null });
    const verdicts = classifyStale([row("greenhouse:lush"), row("personio:lush")], {
      catalogued: new Set(["greenhouse:lush", "personio:lush"]),
      quarantinedVendors: new Set(),
      oversize: new Set(["greenhouse:lush"]),
      dormant: new Set(),
      failing: keysOf({ "personio:lush": 2 }),
      tries: new Map(),
    });
    expect(verdicts.map((v) => [v.token, v.cls])).toEqual([["greenhouse:lush", "oversize"], ["personio:lush", "failing"]]);
    expect(keysOf({ "greenhouse:lush": 1, stripe: 2 })).toEqual(new Set(["greenhouse:lush", "stripe"]));
  });
});

describe("recheckedAt comes from the job's own board (the shipped attachRecheckedAtInner)", () => {
  const RAW = read("supabase/functions/job-board/index.ts");
  const src = /async function attachRecheckedAtInner\([\s\S]*?\n\}/.exec(RAW)?.[0] ?? "";
  const js = ts.transpileModule(src + "\nreturn attachRecheckedAtInner;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const attach = new Function("withDeadline", "SHARED_TOKENS", "stampKeyOfJob", js)(
    (p: unknown) => p, SHARED, stampKeyOfJob,
  ) as (client: unknown, jobs: Array<Record<string, unknown>>) => Promise<Array<Record<string, unknown>>>;
  const client = (rows: Array<{ company_token: string; verified_at: string }>, asked: string[][]) => ({
    from: () => ({ select: () => ({ in: (_c: string, keys: string[]) => { asked.push(keys); return Promise.resolve({ data: rows.filter((r) => keys.includes(r.company_token)), error: null }); } }) }),
  });

  it("a deferred twin's job shows its own old stamp, not the reading twin's fresh one", async () => {
    expect(src, "attachRecheckedAtInner has moved").toBeTruthy();
    const asked: string[][] = [];
    const jobs = [{ id: "greenhouse:lush:1", source: "greenhouse", token: "lush" }, { id: "personio:lush:9", source: "personio", token: "lush" }, { id: "greenhouse:stripe:2", source: "greenhouse", token: "stripe" }];
    const out = await attach(client([
      { company_token: "lush", verified_at: "2026-10-06T19:00:00Z" },
      { company_token: "personio:lush", verified_at: "2026-10-06T19:00:00Z" },
      { company_token: "greenhouse:lush", verified_at: "2026-10-04T01:00:00Z" },
      { company_token: "stripe", verified_at: "2026-10-06T18:00:00Z" },
    ], asked), jobs);
    expect(out.map((j) => j.recheckedAt)).toEqual(["2026-10-04T01:00:00Z", "2026-10-06T19:00:00Z", "2026-10-06T18:00:00Z"]);
    expect(asked[0].sort()).toEqual(["greenhouse:lush", "personio:lush", "stripe"]);
  });

  it("a shared board with no key of its own shows no stamp rather than its twin's", async () => {
    const out = await attach(client([{ company_token: "lush", verified_at: "2026-10-06T19:00:00Z" }], []), [{ id: "greenhouse:lush:1", source: "greenhouse", token: "lush" }]);
    expect(out[0].recheckedAt).toBeUndefined();
  });
});

// ── the migrations, in pglite ────────────────────────────────────────────────
const SWEEP = read("supabase/migrations/20261008100000_a_twins_read_kept_a_deferred_boards_rows_out_of_the_48h_sweep.sql");
const STALEST = read("supabase/migrations/20261008100100_the_stale_window_reads_a_board_stamp_by_its_board.sql");
const CRON = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
    WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
    UPDATE cron.job SET command = COALESCE(alter_job.command, cron.job.command), schedule = COALESCE(alter_job.schedule, cron.job.schedule) WHERE jobid = job_id $$;
  SELECT cron.schedule('job-board-verification-sweep', '41 3 * * *', 'UPDATE public.job_board_postings p SET missing_since = now() WHERE p.missing_since IS NULL AND EXISTS (SELECT 1 FROM public.job_board_verifications v WHERE v.company_token = p.company_token AND v.verified_at < now() - interval ''48 hours'');');
`;
const TABLES = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, verified_at timestamptz NOT NULL);
  CREATE TABLE public.job_board_postings (id text PRIMARY KEY, source text, company_token text, missing_since timestamptz, effective_posted timestamptz DEFAULT now());
`;
const stamps = (rows: Array<[string, number]>) =>
  rows.map(([k, h]) => `INSERT INTO public.job_board_verifications VALUES ('${k}', now() - interval '${h} hours');`).join("\n");
const postings = `
  INSERT INTO public.job_board_postings (id, source, company_token) VALUES
    ('greenhouse:lush:1', 'greenhouse', 'lush'), ('greenhouse:lush:2', 'greenhouse', 'lush'),
    ('personio:lush:1', 'personio', 'lush'),
    ('greenhouse:oldco:1', 'greenhouse', 'oldco'), ('greenhouse:fresh:1', 'greenhouse', 'fresh');
`;
async function sweepWith(rows: Array<[string, number]>): Promise<string[]> {
  const db = new PGlite();
  await db.exec(CRON + TABLES + postings + stamps(rows));
  await db.exec(SWEEP);
  const cmd = (await db.query<{ command: string }>("SELECT command FROM cron.job WHERE jobname = 'job-board-verification-sweep'")).rows[0].command;
  await db.exec(cmd);
  const out = (await db.query<{ id: string }>("SELECT id FROM public.job_board_postings WHERE missing_since IS NOT NULL ORDER BY id")).rows.map((r) => r.id);
  await db.close();
  return out;
}

describe("20261008100000: the sweep reads a shared board's own stamp", { timeout: 60_000 }, () => {
  it("the deferred twin's rows are swept while the reading twin keeps the token's stamp fresh", async () => {
    expect(await sweepWith([["lush", 1], ["personio:lush", 1], ["greenhouse:lush", 60], ["oldco", 60], ["fresh", 1]]))
      .toEqual(["greenhouse:lush:1", "greenhouse:lush:2", "greenhouse:oldco:1"]);
  });

  it("before .91 wrote any key, or after a rollback left them all past 48h, it reads the bare stamps exactly as before", async () => {
    expect(await sweepWith([["lush", 1], ["oldco", 60], ["fresh", 1]])).toEqual(["greenhouse:oldco:1"]);
    expect(await sweepWith([["lush", 1], ["personio:lush", 70], ["greenhouse:lush", 70], ["oldco", 60], ["fresh", 1]])).toEqual(["greenhouse:oldco:1"]);
  });

  it("after a rollback, a board whose own key crossed 48h is not swept while .90's read keeps its token's stamp fresh, though another key is newer", async () => {
    // .91 last wrote personio:lush 10h ago and greenhouse:lush 50h ago; .90 read
    // greenhouse:lush 2h ago and moved the bare stamp alone. A key on another
    // token written an hour ago (.91 still serving elsewhere, or a later lap)
    // must not make lush's aging keys count.
    expect(await sweepWith([["lush", 2], ["greenhouse:lush", 50], ["personio:lush", 10], ["samsara", 1], ["pinpoint:samsara", 1], ["oldco", 60], ["fresh", 1]]))
      .toEqual(["greenhouse:oldco:1"]);
  });

  it("judges each token by its own writer: a token .90 has read falls back, a token .91 last stamped keeps its keys", async () => {
    const db = new PGlite();
    await db.exec(CRON + TABLES + postings + `
      INSERT INTO public.job_board_postings (id, source, company_token) VALUES
        ('greenhouse:samsara:1', 'greenhouse', 'samsara'), ('pinpoint:samsara:1', 'pinpoint', 'samsara');
    ` + stamps([["lush", 3], ["greenhouse:lush", 55], ["personio:lush", 20], ["samsara", 5], ["pinpoint:samsara", 5], ["greenhouse:samsara", 70], ["fresh", 1], ["oldco", 1]]));
    await db.exec(SWEEP);
    await db.exec((await db.query<{ command: string }>("SELECT command FROM cron.job")).rows[0].command);
    const out = (await db.query<{ id: string }>("SELECT id FROM public.job_board_postings WHERE missing_since IS NOT NULL ORDER BY id")).rows.map((r) => r.id);
    expect(out).toEqual(["greenhouse:samsara:1"]);
    await db.close();
  });

  it("every board on a stale bare token without a key of its own is swept; a board with a fresh key is not", async () => {
    expect(await sweepWith([["lush", 60], ["personio:lush", 1], ["oldco", 1], ["fresh", 1]])).toEqual(["greenhouse:lush:1", "greenhouse:lush:2"]);
  });

  it("the old command, run on the first fixture, is the defect", async () => {
    const db = new PGlite();
    await db.exec(CRON + TABLES + postings + stamps([["lush", 1], ["personio:lush", 1], ["greenhouse:lush", 60], ["oldco", 60], ["fresh", 1]]));
    const old = (await db.query<{ command: string }>("SELECT command FROM cron.job")).rows[0].command;
    await db.exec(old);
    const out = (await db.query<{ id: string }>("SELECT id FROM public.job_board_postings WHERE missing_since IS NOT NULL ORDER BY id")).rows.map((r) => r.id);
    expect(out, "greenhouse:lush rode personio's stamp").toEqual(["greenhouse:oldco:1"]);
    await db.close();
  });

  it("changes the command in place: same job id, same minute", async () => {
    const db = new PGlite();
    await db.exec(CRON + TABLES);
    const before = (await db.query<{ jobid: number; command: string }>("SELECT jobid, command FROM cron.job")).rows[0];
    await db.exec(SWEEP);
    const after = (await db.query<{ jobid: number; schedule: string; command: string }>("SELECT jobid, schedule, command FROM cron.job")).rows;
    expect(after.length).toBe(1);
    expect(after[0].jobid).toBe(before.jobid);
    expect(after[0].schedule).toBe("41 3 * * *");
    expect(after[0].command, "the command was not replaced").not.toBe(before.command);
    await db.close();
  });

  it("applies as a no-op where there is no pg_cron, and twice in a row", async () => {
    const db = new PGlite();
    await db.exec(TABLES);
    await db.exec(SWEEP);
    await db.close();
    const db2 = new PGlite();
    await db2.exec(CRON + TABLES);
    await db2.exec(SWEEP);
    await db2.exec(SWEEP);
    expect((await db2.query("SELECT 1 FROM cron.job")).rows.length).toBe(1);
    await db2.close();
  });
});

describe("20261008100100: get_stalest_boards resolves a board key to its own vendor's rows", { timeout: 60_000 }, () => {
  it("returns the deferred twin's key with its own counts, and p_exclude takes a key exactly", async () => {
    const db = new PGlite();
    await db.exec(TABLES + postings + `UPDATE public.job_board_postings SET missing_since = now() WHERE id = 'greenhouse:lush:2';`
      + stamps([["lush", 1], ["personio:lush", 1], ["greenhouse:lush", 100], ["oldco", 90], ["gone", 200]]));
    // The function as 20260909222000 left it, then this file over it.
    const prev = read("supabase/migrations/20260909222000_the_stale_window_fills_with_what_it_cannot_fix.sql");
    await db.exec(`CREATE INDEX job_board_verifications_verified_at_idx ON public.job_board_verifications (verified_at);` + prev.slice(prev.indexOf("CREATE OR REPLACE FUNCTION"), prev.indexOf("COMMENT ON FUNCTION")));
    const before = (await db.query<{ stale_token: string }>("SELECT stale_token FROM public.get_stalest_boards(10, 72, '{}')")).rows.map((r) => r.stale_token);
    expect(before, "the old body dropped the per-board stamp: it held no rows by company_token").toEqual(["oldco"]);
    await db.exec(STALEST);
    const rows = (await db.query<{ stale_token: string; stale_vendor: string; posting_rows: number; live_rows: number }>(
      "SELECT stale_token, stale_vendor, posting_rows::int, live_rows::int FROM public.get_stalest_boards(10, 72, '{}')")).rows;
    expect(rows).toEqual([
      { stale_token: "greenhouse:lush", stale_vendor: "greenhouse", posting_rows: 2, live_rows: 1 },
      { stale_token: "oldco", stale_vendor: "greenhouse", posting_rows: 1, live_rows: 1 },
    ]);
    const excl = (await db.query<{ stale_token: string }>("SELECT stale_token FROM public.get_stalest_boards(10, 72, ARRAY['greenhouse:lush'])")).rows.map((r) => r.stale_token);
    expect(excl).toEqual(["oldco"]);
    await db.close();
  });
});
