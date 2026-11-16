// @vitest-environment node
/**
 * TWO SCHEDULED CALLS NOTHING READS STOP, AND THE DATABASE SIZE IS WRITTEN
 * DOWN ONCE A NIGHT (cost wave 2, 2026-11-16, plan items BN-1 and BN-2).
 *
 * Run against pglite with a stand-in cron schema (pglite has no pg_cron), the
 * same stand-in the cost wave's cadence test uses, and Supabase's default
 * grants in force. It holds that:
 *
 *   - 20261115100000 removes warm-up-edge-functions and
 *     scheduled-health-probe-every-5min by name, keeps every other job,
 *     applies a second time as a no-op, applies where pg_cron is absent, and
 *     never prints a job's command (a job made in the dashboard may carry a
 *     key in its text);
 *   - 20261115110000 creates stamp_storage_sizes(), which writes the database
 *     size and the twelve largest relations at the head of a ring that keeps
 *     60 nights, newest first, and nothing else; runs as its caller; is
 *     callable by the service role and by no client role; is scheduled daily
 *     at 11:11 UTC with its timeout in the command; writes the first entry as
 *     it applies; and applies again, or without pg_cron, cleanly;
 *   - both files carry the sub-hourly cron review marker Lovable's agent
 *     asks for, schedule nothing sub-hourly, and name no transaction
 *     statement and none of the words its agent refuses.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const file = (stamp: string): string => {
  const f = readdirSync(MIG).filter((x) => x.startsWith(`${stamp}_`) && x.endsWith(".sql"));
  if (f.length !== 1) throw new Error(`expected one migration ${stamp}, found ${f.length}`);
  return readFileSync(resolve(MIG, f[0]), "utf8");
};
const CALLS = file("20261115100000");
const SIZES = file("20261115110000");

/** pg_cron's catalogue and the calls these files make, as pg_cron 1.6 shapes them. */
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
`;

const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_postings (id bigserial PRIMARY KEY, title text);
  INSERT INTO public.job_board_postings (title) SELECT 'role ' || g FROM generate_series(1, 2000) g;
  CREATE TABLE public.heartbeat_results (id bigserial PRIMARY KEY, function_name text);
`;

/** The jobs as production lists them on 2026-11-16, the two dashboard-made ones with a key in the text. */
const JOBS = `
  INSERT INTO cron.job (jobname, schedule, command) VALUES
    ('warm-up-edge-functions', '*/10 * * * *', 'SELECT net.http_post(url := ''https://x.supabase.co/functions/v1/warm-up'', headers := ''{"Authorization": "Bearer eyJhbGciOi.DASHBOARD_KEY_TEXT"}''::jsonb)'),
    ('scheduled-health-probe-every-5min', '*/5 * * * *', 'SELECT net.http_post(url := ''https://x.supabase.co/functions/v1/scheduled-health-probe'', headers := ''{"Authorization": "Bearer eyJhbGciOi.DASHBOARD_KEY_TEXT"}''::jsonb)'),
    ('scan-heartbeat-sentinel', '*/10 * * * *', 'SELECT 1'),
    ('job-board-refresh-backup', '9-59/10 * * * *', 'SELECT 2'),
    ('refresh-stats-cache', '27 * * * *', 'SET statement_timeout = ''10min''; SELECT 3');
`;

async function boot(withCron = true): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  if (withCron) { await pg.exec(CRON); await pg.exec(JOBS); }
  return pg;
}

const apply = async (pg: PGlite, sql: string): Promise<void> => { await pg.exec(sql); };

const jobs = async (pg: PGlite) =>
  (await pg.query<{ jobname: string; schedule: string; command: string; active: boolean }>(
    "SELECT jobname, schedule, command, active FROM cron.job ORDER BY jobname")).rows;
const ring = async (pg: PGlite) =>
  (await pg.query<{ v: { entries: Array<{ at: string; db_bytes: number; top: Array<{ rel: string; bytes: number }> }>; keep: number } }>(
    "SELECT v FROM public.job_board_meta WHERE k = 'storage_size_ring'")).rows[0]?.v;

describe("20261115100000: two scheduled calls made in the dashboard stop running", () => {
  it("removes the warm-up and the five-minute probe by name and keeps every other job", async () => {
    const pg = await boot();
    await apply(pg, CALLS);
    expect((await jobs(pg)).map((j) => j.jobname)).toEqual(["job-board-refresh-backup", "refresh-stats-cache", "scan-heartbeat-sentinel"]);
  });

  it("applies a second time as a no-op, and where pg_cron is absent", async () => {
    const pg = await boot();
    await apply(pg, CALLS);
    const after = await jobs(pg);
    await apply(pg, CALLS);
    expect(await jobs(pg)).toEqual(after);
    const bare = await boot(false);
    await expect(apply(bare, CALLS)).resolves.toBeUndefined();
  });

  it("never prints a job's command, which may carry a key", () => {
    const raises = [...CALLS.matchAll(/RAISE\s+(?:NOTICE|WARNING|EXCEPTION)\s+'[^']*'([^;]*);/g)].map((m) => m[1]);
    expect(raises.length).toBeGreaterThan(0);
    for (const args of raises) expect(args, "a RAISE argument").not.toMatch(/command/i);
  });

  it("refuses to finish while either job is still scheduled", async () => {
    const pg = await boot();
    // A stand-in unschedule that removes nothing: the self-check must stop the file.
    await pg.exec(`CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`);
    await expect(apply(pg, CALLS)).rejects.toThrow(/self-check: 2 job\(s\) still scheduled: warm-up-edge-functions, scheduled-health-probe-every-5min/);
  });
});

describe("20261115110000: the database size is written down once a night", () => {
  it("writes the first entry as it applies: the database size and the largest relations, sizes and names only", async () => {
    const pg = await boot();
    await apply(pg, SIZES);
    const v = await ring(pg);
    expect(v.keep).toBe(60);
    expect(v.entries).toHaveLength(1);
    const [e] = v.entries;
    expect(Object.keys(e).sort()).toEqual(["at", "db_bytes", "top"]);
    expect(Number(e.db_bytes)).toBeGreaterThan(0);
    expect(e.top.length).toBeGreaterThan(0);
    expect(e.top.length).toBeLessThanOrEqual(12);
    for (const t of e.top) expect(Object.keys(t).sort()).toEqual(["bytes", "rel"]);
    expect(e.top.map((t) => t.rel)).toContain("public.job_board_postings");
    const sizes = e.top.map((t) => Number(t.bytes));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(e.top.some((t) => /^(pg_catalog|information_schema|pg_toast)/.test(t.rel))).toBe(false);
  });

  it("keeps the last 60 nights, newest first", async () => {
    const pg = await boot();
    await apply(pg, SIZES);
    for (let i = 0; i < 64; i++) await pg.query("SELECT public.stamp_storage_sizes()");
    const v = await ring(pg);
    expect(v.entries).toHaveLength(60);
    const at = v.entries.map((e) => Date.parse(e.at));
    expect(at).toEqual([...at].sort((a, b) => b - a));
  });

  it("starts again from an empty ring when the stored value is not one", async () => {
    const pg = await boot();
    await pg.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('storage_size_ring', '{"entries": "broken"}')`);
    await apply(pg, SIZES);
    expect((await ring(pg)).entries).toHaveLength(1);
  });

  it("is scheduled daily at 11:11 UTC with its timeout in the command, once, after a second apply too", async () => {
    const pg = await boot();
    await apply(pg, SIZES);
    await apply(pg, SIZES);
    const mine = (await jobs(pg)).filter((j) => j.jobname === "storage-size-stamp");
    expect(mine).toEqual([{ jobname: "storage-size-stamp", schedule: "11 11 * * *", command: "SET statement_timeout = '60s'; SELECT public.stamp_storage_sizes();", active: true }]);
    expect((await ring(pg)).entries).toHaveLength(2);
  });

  it("runs as its caller and only the service role may call it, with Supabase's default grants in force", async () => {
    const pg = await boot();
    await apply(pg, SIZES);
    const [p] = (await pg.query<{ definer: boolean; cfg: string[]; anon: boolean; auth: boolean; svc: boolean; pub: boolean }>(`
      SELECT p.prosecdef AS definer, p.proconfig AS cfg,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
             EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub
        FROM pg_proc p WHERE p.oid = 'public.stamp_storage_sizes()'::regprocedure`)).rows;
    expect(p.definer).toBe(false);
    expect(p.cfg).toEqual(expect.arrayContaining(["statement_timeout=60s", "lock_timeout=10s"]));
    expect(p.cfg.some((c) => c.startsWith("search_path="))).toBe(true);
    expect({ anon: p.anon, auth: p.auth, svc: p.svc, pub: p.pub }).toEqual({ anon: false, auth: false, svc: true, pub: false });
  });

  it("applies where pg_cron is absent, and still writes the first entry", async () => {
    const pg = await boot(false);
    await apply(pg, SIZES);
    expect((await ring(pg)).entries).toHaveLength(1);
  });

  it("only warns when the first entry is cancelled, as a statement or lock timeout would, and still schedules the job", async () => {
    // OTHERS never matches query_canceled; a trigger raising it on the ring's
    // write stands in for a timeout firing while the sizes are read.
    const pg = await boot();
    await pg.exec(`
      CREATE FUNCTION public.t_cancel() RETURNS trigger LANGUAGE plpgsql AS $t$
      BEGIN
        IF NEW.k = 'storage_size_ring' THEN RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled'; END IF;
        RETURN NEW;
      END $t$;
      CREATE TRIGGER t_cancel BEFORE INSERT ON public.job_board_meta FOR EACH ROW EXECUTE FUNCTION public.t_cancel();`);
    await expect(apply(pg, SIZES)).resolves.toBeUndefined();
    expect(await ring(pg)).toBeUndefined();
    const jobs = (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM cron.job WHERE jobname = 'storage-size-stamp'`)).rows;
    expect(jobs).toEqual([{ n: 1 }]);
  });
});

describe("both files are ones Lovable's agent applies", () => {
  const code = (sql: string) => sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  for (const [stamp, sql] of [["20261115100000", CALLS], ["20261115110000", SIZES]] as const) {
    it(`${stamp} opens with the review marker and schedules nothing more often than hourly`, () => {
      expect(sql.startsWith("-- SUB-HOURLY CRON REVIEW MARKER: not required.")).toBe(true);
      const minutes = [...code(sql).matchAll(/'+([^'\s]+) \S+ \* \* \*'/g)].map((m) => m[1]);
      for (const m of minutes) expect(m, "a minute field").toMatch(/^\d{1,2}$/);
    });
    it(`${stamp} names no transaction statement and none of the words the agent refuses`, () => {
      expect(sql).not.toMatch(/\b(COMMIT|ROLLBACK)\b/i);
      expect(sql).not.toMatch(/^\s*BEGIN\s*(TRANSACTION|WORK)?\s*;/im);
      expect(sql).not.toMatch(/vault|secret|decrypt/i);
    });
  }
});
