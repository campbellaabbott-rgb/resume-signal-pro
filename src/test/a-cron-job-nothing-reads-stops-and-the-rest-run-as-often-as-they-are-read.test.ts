// @vitest-environment node
/**
 * A CRON JOB NOTHING READS STOPS, AND THE REST RUN AS OFTEN AS THEY ARE READ.
 *
 * The db-cadence lane of the 2026-11-08 cost audit, run against pglite with a
 * stand-in cron schema (pglite has no pg_cron). Every file is applied to a
 * catalogue shaped like production's -- the jobs under their live names and
 * schedules, their commands as 20261004010000 left them -- and then applied
 * AGAIN, because a migration the staged runner may replay must change nothing
 * the second time. It holds that:
 *
 *   - the recency ladder and the explore role rows stop, by name or by a
 *     command that calls them under another name, and their functions stay;
 *   - the facets job keeps its quarter-hour ticks off minute 7, its timeout
 *     and its id, and its command rebuilds the row only when no caller wrote
 *     it in the last 40 minutes -- run here against a fresh, a stale and a
 *     missing row;
 *   - the rollup moves to every half hour and the ghost index to minute 15,
 *     each keeping its id, its active flag and its timeout;
 *   - the nightly purge loses only the report-cache delete the hourly job
 *     repeats, in either spelling, gains a timeout, and is left whole when the
 *     hourly job is absent;
 *   - each duplicate index gets a one-statement concurrent dropper only
 *     against a proven twin; the dropper's statement runs outside a
 *     transaction; the watcher unschedules each dropper once its index is
 *     gone, refuses to let a dropper outlive its twin, and then unschedules
 *     itself; and no job ever names an index the file keeps;
 *   - the explore refresh writes only the parts the page reads, carries a
 *     failed grid forward, and its new body has no call to the three callees
 *     it dropped.
 *
 * Each file's own self-check block runs inside it, so a file that applies
 * here also proved its end state to itself.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const file = (stamp: string): string => {
  const f = readdirSync(MIG).find((x) => x.startsWith(stamp) && x.endsWith(".sql"));
  if (!f) throw new Error(`no migration ${stamp}`);
  return readFileSync(resolve(MIG, f), "utf8");
};
const LADDER = file("20261109100000");
const EXPLORE = file("20261109110000");
const FACETS = file("20261109120000");
const ROLLUP = file("20261109121000");
const GHOST = file("20261109122000");
const INDEXES = file("20261109130000");
const PURGE = file("20261109131000");

/** pg_cron's catalogue and the four calls these files make, as pg_cron 1.6 shapes them. */
const CRON = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (
    jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
    database text NOT NULL DEFAULT 'postgres', username text NOT NULL DEFAULT 'postgres',
    active boolean NOT NULL DEFAULT true, jobname text UNIQUE
  );
  CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command
    RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $$
  BEGIN
    DELETE FROM cron.job WHERE jobname = job_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name; END IF;
    RETURN true;
  END $$;
  CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE plpgsql AS $$
  BEGIN
    DELETE FROM cron.job WHERE jobid = job_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job %', job_id; END IF;
    RETURN true;
  END $$;
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
                                 database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobid = job_id) THEN
      RAISE EXCEPTION 'Job % does not exist', job_id;
    END IF;
    UPDATE cron.job j SET
      schedule = coalesce(alter_job.schedule, j.schedule),
      command = coalesce(alter_job.command, j.command),
      database = coalesce(alter_job.database, j.database),
      username = coalesce(alter_job.username, j.username),
      active = coalesce(alter_job.active, j.active)
     WHERE j.jobid = job_id;
  END $$;
`;

/** The tables and functions the files name, with Supabase's default grants in force. */
const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.facets_calls (at timestamptz NOT NULL DEFAULT clock_timestamp());
  CREATE FUNCTION public.refresh_job_board_facets() RETURNS void LANGUAGE plpgsql SET statement_timeout = '10min' AS $$
  BEGIN
    INSERT INTO public.facets_calls DEFAULT VALUES;
    INSERT INTO public.job_board_meta (k, v, updated_at) VALUES ('facets', '{}'::jsonb, now())
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();
  END $$;
  CREATE FUNCTION public.board_recency_ladder(integer, integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
  CREATE FUNCTION public.refresh_recency_ladder() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
  CREATE FUNCTION public.refresh_explore_role_rows() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
  CREATE FUNCTION public.refresh_ghost_stats() RETURNS void LANGUAGE plpgsql SET statement_timeout = '15min' AS $$ BEGIN END $$;
  CREATE TABLE public.grid_fault (on_ boolean NOT NULL);
  INSERT INTO public.grid_fault VALUES (false);
  CREATE FUNCTION public.get_explore_field_grid() RETURNS jsonb LANGUAGE plpgsql SET statement_timeout = '120s' AS $$
  BEGIN
    IF (SELECT on_ FROM public.grid_fault) THEN RAISE EXCEPTION 'grid scan failed'; END IF;
    RETURN '{"fields": {"finance": {"n": 120, "work_mode_n": 40}, "design": {"n": 80, "work_mode_n": 30}}, "at": "2026-11-08T17:07:00Z", "window_days": 30}'::jsonb;
  END $$;
  CREATE FUNCTION public.get_repost_index() RETURNS jsonb LANGUAGE sql SET statement_timeout = '90s' AS $$
    SELECT '{"acme": {"n": 3}, "globex": {"n": 5}}'::jsonb $$;
  CREATE TABLE public.job_board_postings (
    id bigserial PRIMARY KEY, company_token text NOT NULL, source text, posted_at timestamptz,
    description text, missing_since timestamptz);
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, verified_at timestamptz NOT NULL);
  CREATE TABLE public.job_board_stats_rollup (k text PRIMARY KEY, v jsonb, computed_at timestamptz);
  CREATE TABLE public.temp_resume_storage (id bigserial PRIMARY KEY, expires_at timestamptz);
  CREATE TABLE public.ai_response_cache (id bigserial PRIMARY KEY, expires_at timestamptz);
  CREATE INDEX IF NOT EXISTS job_board_postings_company_idx ON public.job_board_postings (company_token);
  CREATE INDEX IF NOT EXISTS job_board_postings_company_token_idx ON public.job_board_postings (company_token);
  CREATE INDEX IF NOT EXISTS job_board_postings_token_serving_idx ON public.job_board_postings (company_token) WHERE missing_since IS NULL;
  CREATE INDEX IF NOT EXISTS idx_temp_resume_expires ON public.temp_resume_storage(expires_at);
  CREATE INDEX IF NOT EXISTS idx_temp_resume_storage_expires_at ON public.temp_resume_storage(expires_at);
  CREATE INDEX IF NOT EXISTS temp_resume_storage_expires_at_idx ON public.temp_resume_storage (expires_at);
  CREATE INDEX idx_ai_cache_expires ON public.ai_response_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expires_at ON public.ai_response_cache(expires_at);
`;

/** The nightly purge as 20260705162706 wrote it (upper case) and as 20260704200000 did (lower case). */
const PURGE_UPPER = `
      DELETE FROM public.scan_report_cache WHERE created_at < now() - interval '7 days';
      DELETE FROM public.rate_limits WHERE window_start < now() - interval '3 days';
      DELETE FROM public.detection_telemetry WHERE created_at < now() - interval '90 days';
      DELETE FROM public.pro_grants WHERE consumed_at IS NOT NULL AND consumed_at < now() - interval '90 days';
      `;
const PURGE_LOWER = `
  delete from public.scan_report_cache where created_at < now() - interval '7 days';
  delete from public.rate_limits where window_start < now() - interval '3 days';
  delete from public.detection_telemetry where created_at < now() - interval '90 days';
  delete from public.pro_grants where consumed_at is not null and consumed_at < now() - interval '90 days';
  `;

/** Production's jobs on 2026-11-08 (get_cron_health), commands as the repo's migrations left them. */
const JOBS: Array<[string, string, string, boolean?]> = [
  ["board-recency-ladder", "2-59/5 * * * *", " SELECT public.refresh_recency_ladder(); "],
  ["refresh-explore-role-rows", "22 */6 * * *", "SET statement_timeout = '10min'; SELECT public.refresh_explore_role_rows();"],
  ["refresh-explore-cache", "7 * * * *", "SET statement_timeout = '15min'; SELECT public.refresh_explore_cache();"],
  ["refresh-board-facets", "7,22,37,52 * * * *", "SET statement_timeout = '10min'; SELECT public.refresh_job_board_facets();"],
  ["job-board-stats-rollup", "*/15 * * * *", "SET statement_timeout = '4min'; select refresh_job_board_stats()"],
  ["refresh-ghost-stats", "5,35 * * * *", "SET statement_timeout = '15min'; SELECT public.refresh_ghost_stats();", false],
  ["scan-cache-and-telemetry-purge", "10 4 * * *", PURGE_UPPER],
  ["scan-report-cache-retention", "13 * * * *", "DELETE FROM public.scan_report_cache WHERE created_at < now() - interval '7 days';"],
  ["unrelated", "1 * * * *", "SELECT 1;"],
];

async function boot(jobs = JOBS): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(CRON + SCHEMA);
  for (const [name, schedule, command, active] of jobs) {
    await db.query("INSERT INTO cron.job (jobname, schedule, command, active) VALUES ($1, $2, $3, $4)", [name, schedule, command, active ?? true]);
  }
  return db;
}
type Job = { jobid: string; jobname: string; schedule: string; command: string; active: boolean };
const jobs = async (db: PGlite): Promise<Record<string, Job>> =>
  Object.fromEntries((await db.query<Job>("SELECT jobid::text, jobname, schedule, command, active FROM cron.job")).rows.map((r) => [r.jobname, r]));
/** Apply twice: the second run must leave the catalogue exactly as the first did. */
async function applyTwice(db: PGlite, sql: string): Promise<void> {
  await db.exec(sql);
  const once = await jobs(db);
  await db.exec(sql);
  expect(await jobs(db)).toEqual(once);
}
const fnExists = async (db: PGlite, sig: string) =>
  (await db.query<{ ok: boolean }>(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, [sig])).rows[0].ok;

describe("the jobs nothing reads stop, and their functions stay", () => {
  it("the recency ladder stops, by its name and under any other name, and both functions stay", async () => {
    const db = await boot([...JOBS, ["ladder-by-hand", "*/5 * * * *", "SELECT public.refresh_recency_ladder ();"]]);
    const before = await jobs(db);
    await applyTwice(db, LADDER);
    const after = await jobs(db);
    expect(after["board-recency-ladder"]).toBeUndefined();
    expect(after["ladder-by-hand"]).toBeUndefined();
    expect(await fnExists(db, "public.refresh_recency_ladder()")).toBe(true);
    expect(await fnExists(db, "public.board_recency_ladder(integer, integer)")).toBe(true);
    // Nothing else moved.
    for (const name of Object.keys(before).filter((n) => !/ladder/.test(n))) expect(after[name]).toEqual(before[name]);
  });

  it("the ladder's self-check refuses to finish while a job still runs it", async () => {
    const db = await boot();
    const check = LADDER.slice(LADDER.lastIndexOf("DO $$"));
    await expect(db.exec(check)).rejects.toThrow(/still refresh the recency ladder: board-recency-ladder/);
  });

  it("the explore role rows stop by name and under any other name, and their writer stays", async () => {
    const db = await boot([...JOBS, ["roles-by-hand", "0 * * * *", "SELECT public.refresh_explore_role_rows();"]]);
    await applyTwice(db, EXPLORE);
    const after = await jobs(db);
    expect(after["refresh-explore-role-rows"]).toBeUndefined();
    expect(after["roles-by-hand"]).toBeUndefined();
    expect(after["refresh-explore-cache"].command).toBe("SET statement_timeout = '15min'; SELECT public.refresh_explore_cache();");
    expect(await fnExists(db, "public.refresh_explore_role_rows()")).toBe(true);
  });

  it("where pg_cron is absent the two stopping files still apply", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(LADDER);
    await db.exec(EXPLORE);
    expect(await fnExists(db, "public.refresh_explore_cache()")).toBe(true);
  });
});

describe("the explore refresh writes only what the page reads", () => {
  const LIVE_ROW = {
    field_grid: { fields: { finance: { n: 1 } } }, field_curves: { finance: { still_open_30: 0.4 } },
    chip_coverage: { open: 9 }, role_rows: { fields: {}, at: "2026-11-08T12:22:00Z", status: "ok" },
    repost_index: { old: { n: 1 } }, fields: { finance: 1 }, totals: { postings_n: 9, repost_flagged_n: 1 },
    stale_parts: [], computed_at: "2026-11-08T16:07:00Z",
  };
  const row = async (db: PGlite) =>
    (await db.query<{ v: Record<string, unknown> }>("SELECT v FROM public.job_board_meta WHERE k = 'explore_cache'")).rows[0].v;

  it("a run on the new body replaces today's row with the read parts alone", async () => {
    const db = await boot();
    await db.query("INSERT INTO public.job_board_meta (k, v) VALUES ('explore_cache', $1::jsonb)", [JSON.stringify(LIVE_ROW)]);
    await db.exec(EXPLORE);
    // The row is not edited at apply: today's keeps serving until a run.
    expect(Object.keys(await row(db)).sort()).toEqual(Object.keys(LIVE_ROW).sort());
    await db.exec("SELECT public.refresh_explore_cache();");
    const v = await row(db);
    expect(Object.keys(v).sort()).toEqual(["computed_at", "field_grid", "fields", "repost_index", "stale_parts", "totals"]);
    expect(v.fields).toEqual({ finance: 120, design: 80 });
    expect(v.totals).toEqual({ repost_flagged_n: 2 });
    expect(v.stale_parts).toEqual([]);
    expect((v.field_grid as { fields: Record<string, unknown> }).fields).toHaveProperty("design");
  });

  it("a failed grid is carried from the previous row and named, and the fields fall back with it", async () => {
    const db = await boot();
    await db.query("INSERT INTO public.job_board_meta (k, v) VALUES ('explore_cache', $1::jsonb)", [JSON.stringify(LIVE_ROW)]);
    await db.exec(EXPLORE);
    await db.exec("UPDATE public.grid_fault SET on_ = true; SELECT public.refresh_explore_cache();");
    const v = await row(db);
    expect(v.stale_parts).toEqual(["field_grid"]);
    expect(v.field_grid).toEqual(LIVE_ROW.field_grid);
    expect(v.fields).toEqual({ finance: 1 });
  });

  it("the new body calls only the two callees whose parts are read, and is closed to the client roles", async () => {
    const db = await boot();
    await db.exec(EXPLORE);
    const { rows } = await db.query<{ src: string; anon: boolean; auth: boolean }>(
      `SELECT prosrc AS src, has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth
         FROM pg_proc WHERE oid = 'public.refresh_explore_cache()'::regprocedure`);
    const called = [...new Set([...rows[0].src.matchAll(/public\.(get_[a-z_]+)\s*\(/g)].map((m) => m[1]))].sort();
    expect(called).toEqual(["get_explore_field_grid", "get_repost_index"]);
    expect(rows[0].anon).toBe(false);
    expect(rows[0].auth).toBe(false);
  });
});

describe("the facets job rebuilds only a row nobody wrote in forty minutes", () => {
  it("keeps its id, moves off minute 7 to quarter ticks, keeps its timeout and gains the gate", async () => {
    const db = await boot();
    const id = (await jobs(db))["refresh-board-facets"].jobid;
    await applyTwice(db, FACETS);
    const j = (await jobs(db))["refresh-board-facets"];
    expect(j.jobid).toBe(id);
    expect(j.schedule).toBe("2,17,32,47 * * * *");
    expect(j.command.startsWith("SET statement_timeout = '10min'; ")).toBe(true);
    expect(j.active).toBe(true);
  });

  it("runs the rebuild when the row is missing or older than forty minutes, and skips it when the pass wrote it since", async () => {
    const db = await boot();
    await db.exec(FACETS);
    const cmd = (await jobs(db))["refresh-board-facets"].command;
    const calls = async () => Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.facets_calls")).rows[0].n);

    await db.exec(cmd); // no row at all
    expect(await calls()).toBe(1);
    await db.exec(cmd); // the row it just wrote is fresh
    expect(await calls()).toBe(1);
    await db.exec("UPDATE public.job_board_meta SET updated_at = now() - interval '39 minutes' WHERE k = 'facets'");
    await db.exec(cmd); // a pass end 39 minutes ago still holds it off
    expect(await calls()).toBe(1);
    await db.exec("UPDATE public.job_board_meta SET updated_at = now() - interval '41 minutes' WHERE k = 'facets'");
    await db.exec(cmd);
    expect(await calls()).toBe(2);
  });

  it("on quarter ticks the gate keeps the row under the heartbeat's sixty minutes whatever the pass does, and runs at most 32 times a day", () => {
    // The schedule and the gate, read from the job as written, simulated
    // minute by minute over a day: once with the board pass quiet (the most
    // cron runs), then with pass-end writes every P minutes at every offset.
    // scan-heartbeat degrades job_board_facets_cache past 60 minutes.
    const sched = /cron\.alter_job\(v_id, schedule => '([^']+)'/.exec(FACETS)?.[1] ?? "";
    const gate = Number(/interval ''(\d+) minutes''/.exec(FACETS)?.[1]);
    const ticks = sched.split(" ")[0].split(",").map(Number);
    expect(ticks.length, sched).toBe(4);
    expect(ticks, "the explore refresh, the host sweep and the error-spike check start at minute 7").not.toContain(7);
    expect(gate).toBeGreaterThan(0);
    const day = (passEvery: number | null, offset: number) => {
      let written = 0, runs = 0, worst = 0;
      for (let m = 1; m <= 24 * 60; m++) {
        worst = Math.max(worst, m - written);
        if (passEvery !== null && m % passEvery === offset) written = m;
        if (ticks.includes(m % 60) && m - written >= gate) { written = m; runs++; }
      }
      return { runs, worst };
    };
    const quiet = day(null, 0);
    expect(quiet.runs).toBeLessThanOrEqual(32);
    expect(quiet.worst).toBeLessThan(60);
    for (const every of [11, 25, 38, 52, 70, 95, 140]) {
      for (let o = 0; o < every; o++) {
        const d = day(every, o);
        expect(d.worst, `pass end every ${every} min at offset ${o}`).toBeLessThan(60);
        expect(d.runs).toBeLessThanOrEqual(quiet.runs);
      }
    }
    // The hourly form the audit proposed fails the same bound.
    const hourly = (passEvery: number, offset: number) => {
      let written = 0, worst = 0;
      for (let m = 1; m <= 24 * 60; m++) {
        worst = Math.max(worst, m - written);
        if (m % passEvery === offset) written = m;
        if (m % 60 === 52 && m - written >= 45) written = m;
      }
      return worst;
    };
    expect(Math.max(...Array.from({ length: 70 }, (_, o) => hourly(70, o)))).toBeGreaterThan(60);
  });

  it("where the job is missing it is scheduled once, gated", async () => {
    const db = await boot(JOBS.filter(([n]) => n !== "refresh-board-facets"));
    await applyTwice(db, FACETS);
    const j = (await jobs(db))["refresh-board-facets"];
    expect(j.schedule).toBe("2,17,32,47 * * * *");
    expect(j.command).toMatch(/NOT EXISTS/);
  });
});

describe("the rollup runs every half hour and the ghost index once an hour, before the :27 copy", () => {
  it("the rollup keeps its id, active flag and timeout on */30", async () => {
    const db = await boot();
    const before = (await jobs(db))["job-board-stats-rollup"];
    await applyTwice(db, ROLLUP);
    const j = (await jobs(db))["job-board-stats-rollup"];
    expect(j).toEqual({ ...before, schedule: "*/30 * * * *" });
  });

  it("the ghost index keeps its id, its PAUSED flag and its timeout at minute 15", async () => {
    const db = await boot();
    const before = (await jobs(db))["refresh-ghost-stats"];
    expect(before.active).toBe(false);
    await applyTwice(db, GHOST);
    expect((await jobs(db))["refresh-ghost-stats"]).toEqual({ ...before, schedule: "15 * * * *" });
  });

  it("a command that lost its timeout gets it back", async () => {
    const db = await boot(JOBS.map(([n, s, c, a]) =>
      n === "refresh-ghost-stats" ? [n, s, "SELECT public.refresh_ghost_stats();", a] :
      n === "job-board-stats-rollup" ? [n, s, "select refresh_job_board_stats()", a] : [n, s, c, a]));
    await db.exec(ROLLUP);
    await db.exec(GHOST);
    const j = await jobs(db);
    expect(j["refresh-ghost-stats"].command).toBe("SET statement_timeout = '15min'; SELECT public.refresh_ghost_stats();");
    expect(j["job-board-stats-rollup"].command).toBe("SET statement_timeout = '4min'; SELECT public.refresh_job_board_stats();");
  });

  it("the ghost run finishes before the stats cache copies it", () => {
    const minute = Number(/schedule => '(\d+) \* \* \* \*'/.exec(GHOST)?.[1]);
    // 16.1 s was the longest run over seven days; the copy is at :27.
    expect(minute).toBeLessThan(27);
    expect(27 - minute).toBeGreaterThanOrEqual(10);
  });
});

describe("the nightly purge stops repeating the hourly report-cache delete", () => {
  const purge = async (db: PGlite) => (await jobs(db))["scan-cache-and-telemetry-purge"].command;
  for (const [spelling, cmd] of [["upper case", PURGE_UPPER], ["lower case", PURGE_LOWER]] as const) {
    it(`in ${spelling}, only the report-cache delete goes, and the command gains its timeout`, async () => {
      const db = await boot(JOBS.map(([n, s, c, a]) => (n === "scan-cache-and-telemetry-purge" ? [n, s, cmd, a] : [n, s, c, a])));
      const id = (await jobs(db))["scan-cache-and-telemetry-purge"].jobid;
      await applyTwice(db, PURGE);
      const after = await purge(db);
      expect(after).not.toMatch(/scan_report_cache/i);
      expect(after.startsWith("SET statement_timeout = '2min'; ")).toBe(true);
      const kept = cmd.split(";").map((s) => s.trim()).filter((s) => s && !/scan_report_cache/i.test(s));
      expect(kept).toHaveLength(3);
      // The three kept deletes, byte for byte and in their order.
      let at = 0;
      for (const s of kept) { const i = after.indexOf(s, at); expect(i, s).toBeGreaterThan(-1); at = i + s.length; }
      expect((await jobs(db))["scan-cache-and-telemetry-purge"].jobid).toBe(id);
      expect((await jobs(db))["scan-report-cache-retention"].command).toMatch(/scan_report_cache/);
    });
  }

  it("without the hourly job the nightly delete is the only one, and is kept", async () => {
    const db = await boot(JOBS.filter(([n]) => n !== "scan-report-cache-retention"));
    await db.exec(PURGE);
    expect(await purge(db)).toBe(PURGE_UPPER);
  });
});

describe("each duplicate index is dropped concurrently, only against a proven twin", () => {
  const DROPPERS = {
    "oneshot-drop-postings-company-token-idx": "job_board_postings_company_token_idx",
    "oneshot-drop-temp-resume-expires-idx": "idx_temp_resume_expires",
    "oneshot-drop-temp-resume-storage-expires-idx": "idx_temp_resume_storage_expires_at",
    "oneshot-drop-ai-response-cache-expires-idx": "idx_ai_response_cache_expires_at",
  };
  const WATCH = "oneshot-drop-duplicate-indexes-watch";
  const indexes = async (db: PGlite) =>
    (await db.query<{ n: string }>("SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.n);

  it("schedules one single-statement dropper per duplicate and one watcher, once", async () => {
    const db = await boot();
    await applyTwice(db, INDEXES);
    const j = await jobs(db);
    for (const [job, idx] of Object.entries(DROPPERS)) {
      expect(j[job]?.command).toBe(`DROP INDEX CONCURRENTLY IF EXISTS public.${idx}`);
      expect(j[job].command).not.toMatch(/;|\bSET\b/);
    }
    expect(j[WATCH]).toBeTruthy();
  });

  it("the droppers' statements run outside a transaction, the watcher then unschedules every job, and every twin survives", async () => {
    const db = await boot();
    await db.exec(INDEXES);
    const j = await jobs(db);
    for (const job of Object.keys(DROPPERS)) await db.exec(j[job].command);
    await db.exec(j[WATCH].command);
    const left = await jobs(db);
    for (const job of [...Object.keys(DROPPERS), WATCH]) expect(left[job]).toBeUndefined();
    expect(await indexes(db)).toEqual(expect.arrayContaining([
      "idx_ai_cache_expires", "job_board_postings_company_idx", "job_board_postings_token_serving_idx", "temp_resume_storage_expires_at_idx",
    ]));
    for (const idx of Object.values(DROPPERS)) expect(await indexes(db)).not.toContain(idx);
  });

  it("the watcher waits while a duplicate stands, and unschedules a dropper whose twin vanished instead of dropping the last index", async () => {
    const db = await boot();
    await db.exec(INDEXES);
    const j = await jobs(db);
    await db.exec(j[WATCH].command);
    expect(Object.keys(await jobs(db))).toEqual(expect.arrayContaining([...Object.keys(DROPPERS), WATCH]));
    await db.exec("DROP INDEX public.idx_ai_cache_expires;");
    await db.exec(j[WATCH].command);
    const after = await jobs(db);
    expect(after["oneshot-drop-ai-response-cache-expires-idx"]).toBeUndefined();
    expect(await indexes(db)).toContain("idx_ai_response_cache_expires_at");
    expect(after[WATCH]).toBeTruthy();
  });

  it("a pair whose twin differs, is missing or is partial gets no dropper", async () => {
    const db = await boot();
    await db.exec(`
      DROP INDEX public.job_board_postings_company_idx;
      CREATE INDEX job_board_postings_company_idx ON public.job_board_postings (company_token, source);
      DROP INDEX public.idx_ai_cache_expires;
      DROP INDEX public.temp_resume_storage_expires_at_idx;
      CREATE INDEX temp_resume_storage_expires_at_idx ON public.temp_resume_storage (expires_at) WHERE expires_at IS NOT NULL;
    `);
    await applyTwice(db, INDEXES);
    const j = await jobs(db);
    for (const job of Object.keys(DROPPERS)) expect(j[job], job).toBeUndefined();
    expect(j[WATCH]).toBeUndefined();
  });

  it("nothing is scheduled when the duplicates are already gone", async () => {
    const db = await boot();
    for (const idx of Object.values(DROPPERS)) await db.exec(`DROP INDEX public.${idx};`);
    await applyTwice(db, INDEXES);
    const j = await jobs(db);
    for (const job of [...Object.keys(DROPPERS), WATCH]) expect(j[job]).toBeUndefined();
  });

  it("the self-check refuses a dropper that names an index the file keeps", async () => {
    const db = await boot();
    await db.exec("SELECT cron.schedule('rogue', '* * * * *', 'DROP INDEX CONCURRENTLY IF EXISTS public.job_board_postings_company_idx');");
    await expect(db.exec(INDEXES)).rejects.toThrow(/would drop an index this file keeps/);
  });
});
