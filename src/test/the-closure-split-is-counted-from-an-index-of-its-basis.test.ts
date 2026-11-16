// @vitest-environment node
/**
 * THE CLOSURE SPLIT IS COUNTED FROM AN INDEX OF ITS BASIS
 * (cost audit 2026-11-08, "Closure population"; migration 20261109141000).
 *
 * The refresh's logsplit CTE read the whole closure log twice an hour because
 * nothing indexed absence_basis. The index is built outside any transaction by
 * the repo's one-shot cron pair. Against a pg_cron stand-in:
 *   - the builder's command is the single concurrent statement (a SET in front
 *     of it would make the build refuse to run), at a quiet minute;
 *   - running it builds the index, and the watcher then unschedules both jobs;
 *   - an INVALID index is dropped only when no build is running, and the third
 *     failed build ends the attempt with both jobs gone and nothing left behind;
 *   - re-applying with the index present schedules nothing;
 *   - with the index in place the split is answered by an index-only scan.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const SQL = readFileSync(resolve(MIG, "20261109141000_the_closure_split_is_counted_from_an_index_of_its_basis.sql"), "utf8");
const BUILDER = "oneshot-closures-absence-basis-idx";
const WATCHER = "oneshot-closures-absence-basis-idx-watch";

const CRON = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (
    jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
    database text NOT NULL DEFAULT 'postgres', username text NOT NULL DEFAULT 'postgres',
    active boolean NOT NULL DEFAULT true, jobname text UNIQUE);
  CREATE TABLE cron.job_run_details (
    runid bigserial PRIMARY KEY, jobid bigint, status text, return_message text,
    start_time timestamptz, end_time timestamptz);
  CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
    RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = job_name) THEN
      RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name;
    END IF;
    DELETE FROM cron.job WHERE jobname = job_name;
    RETURN true;
  END $$;
`;
const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text NOT NULL, company_token text NOT NULL,
    closed_at timestamptz NOT NULL DEFAULT now(), superseded boolean NOT NULL DEFAULT false, suspect boolean,
    absence_basis text, note text);
`;

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });
async function boot(withCron = true): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SCHEMA + (withCron ? CRON : ""));
  return db;
}
type Job = { jobname: string; schedule: string; command: string };
const jobs = async (db: PGlite) =>
  new Map((await db.query<Job>("SELECT jobname, schedule, command FROM cron.job")).rows.map((j) => [j.jobname, j]));
const indexState = async (db: PGlite) =>
  (await db.query<{ valid: boolean }>(
    "SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'job_board_closures_absence_basis_idx'",
  )).rows[0]?.valid ?? null;

describe("the one-shot pair", () => {
  it("schedules a builder that is the single concurrent statement, at :44, and a watcher once an hour at :14, so nothing in the file runs more often than hourly", async () => {
    const db = await boot();
    await db.exec(SQL);
    const j = await jobs(db);
    expect(j.get(BUILDER)?.schedule).toBe("44 * * * *");
    expect(j.get(BUILDER)?.command).toBe(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_closures_absence_basis_idx ON public.job_board_closures (absence_basis)");
    expect(j.get(WATCHER)?.schedule).toBe("14 * * * *");
  });

  // Every-minute and every-n-minutes kicks (a pg_net POST, a one-shot) run at
  // every minute and cannot be avoided; a job pinned to named minutes is an
  // hourly piece of work, and none of those may share :44.
  it("no job pinned to named minutes runs at :44, so the build never waits behind one of ours", () => {
    const minutes = (field: string): Set<number> => {
      const out = new Set<number>();
      for (const part of field.split(",")) {
        const [range, step] = part.split("/");
        const [a, b] = range === "*" ? [0, 59] : range.includes("-") ? range.split("-").map(Number) : [Number(range), step ? 59 : Number(range)];
        for (let m = a; m <= b; m += step ? Number(step) : 1) out.add(m);
      }
      return out;
    };
    // Replayed in filename order, as the scheduler holds them at the end of
    // the folder: a later schedule of the same name replaces the earlier one.
    const live = new Map<string, string>();
    for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = readFileSync(resolve(MIG, f), "utf8");
      for (const m of sql.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) live.set(m[1], m[2]);
    }
    const at44: string[] = [];
    for (const [name, schedule] of live) {
      const [minute, hour] = schedule.split(/\s+/);
      if (!/^[0-9*,/-]+$/.test(minute) || /^\*(\/\d+)?$/.test(minute)) continue;
      if (minutes(minute).has(44) && hour === "*" && name !== BUILDER) at44.push(`${name} ${schedule}`);
    }
    expect(at44).toEqual([]);
  });

  it("the builder builds the index and the watcher then removes both jobs", async () => {
    const db = await boot();
    await db.exec(SQL);
    const j = await jobs(db);
    await db.exec(j.get(BUILDER)!.command);
    expect(await indexState(db)).toBe(true);
    await db.exec(j.get(WATCHER)!.command);
    expect([...(await jobs(db)).keys()]).toEqual([]);
  });

  it("re-applying once the index exists schedules nothing, and the end-state check passes", async () => {
    const db = await boot();
    await db.exec(SQL);
    const j = await jobs(db);
    await db.exec(j.get(BUILDER)!.command);
    await db.exec(j.get(WATCHER)!.command);
    await db.exec(SQL);
    expect([...(await jobs(db)).keys()]).toEqual([]);
  });

  it("an invalid index is dropped so the next hour can try again, and the third failed build ends the attempt", async () => {
    const db = await boot();
    await db.exec(SQL);
    const j = await jobs(db);
    const builderId = (await db.query<{ id: number }>(`SELECT jobid AS id FROM cron.job WHERE jobname = '${BUILDER}'`)).rows[0].id;
    // A cancelled concurrent build leaves the index behind, INVALID.
    await db.exec(j.get(BUILDER)!.command);
    await db.exec("UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.job_board_closures_absence_basis_idx'::regclass");
    await db.query(`INSERT INTO cron.job_run_details (jobid, status, return_message) VALUES ($1, 'failed', 'canceling statement due to statement timeout')`, [builderId]);
    await db.exec(j.get(WATCHER)!.command);
    expect(await indexState(db), "the invalid index is dropped").toBeNull();
    expect([...(await jobs(db)).keys()].sort(), "one failure: the pair stays to try again").toEqual([BUILDER, WATCHER]);

    await db.exec(j.get(BUILDER)!.command);
    await db.exec("UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.job_board_closures_absence_basis_idx'::regclass");
    await db.query(`INSERT INTO cron.job_run_details (jobid, status) VALUES ($1, 'failed'), ($1, 'failed')`, [builderId]);
    await db.exec(j.get(WATCHER)!.command);
    expect(await indexState(db), "nothing is left for writers to maintain").toBeNull();
    expect([...(await jobs(db)).keys()], "three failures: both jobs are gone").toEqual([]);
  });

  it("a database without pg_cron is told what to run by hand and applies cleanly", async () => {
    const db = await boot(false);
    await expect(db.exec(SQL)).resolves.toBeDefined();
    expect(await indexState(db)).toBeNull();
  });
});

describe("what the index buys", () => {
  it("the refresh's split is answered by an index-only scan once the index is valid", async () => {
    const db = await boot();
    await db.exec(`
      INSERT INTO public.job_board_closures (posting_id, company_token, absence_basis, note)
      SELECT 'greenhouse:acme:' || i, 'acme', (ARRAY['full_read', 'lap', 'lap_backfill', NULL])[1 + i % 4], repeat('x', 120)
      FROM generate_series(1, 40000) i;`);
    await db.exec(SQL);
    const j = await jobs(db);
    await db.exec(j.get(BUILDER)!.command);
    await db.exec("VACUUM ANALYZE public.job_board_closures");
    const split = `
      SELECT
        count(*) FILTER (WHERE c.absence_basis = 'full_read')::bigint    AS closures_full_read,
        count(*) FILTER (WHERE c.absence_basis = 'lap')::bigint          AS closures_lap,
        count(*) FILTER (WHERE c.absence_basis = 'lap_backfill')::bigint AS closures_lap_backfill,
        count(*) FILTER (WHERE c.absence_basis IS NULL)::bigint          AS closures_pre_basis
      FROM public.job_board_closures c`;
    // The split as the live refresh writes it, so a reworded CTE fails here.
    const live = readFileSync(resolve(MIG, "20261109140000_a_board_verdict_is_rewritten_only_when_the_board_changed_bucket.sql"), "utf8");
    expect(live.replace(/\s+/g, " ")).toContain(split.replace(/\s+/g, " ").trim());
    const plan = (await db.query<{ "QUERY PLAN": string }>(`EXPLAIN ${split}`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Index Only Scan using job_board_closures_absence_basis_idx/);
    const counts = (await db.query<Record<string, string>>(split)).rows[0];
    expect(Object.values(counts).map(Number)).toEqual([10000, 10000, 10000, 10000]);
  });
});
