// @vitest-environment node
//
// Node, not jsdom: the SQL runs in pglite.
/**
 * THE ERROR SPIKE CHECK POSTS ONLY WHEN A VISITOR HAS FIVE ERRORS IN ITS
 * WINDOW (CW2-HO1, cost wave 2 item HO-1).
 *
 * WHAT WAS WRONG. check-error-spikes (20261008128000) posted to its function
 * every 15 minutes whether or not anything could be a spike. The function
 * mails, and logs its spike row, only for a visitor with at least five errors
 * in the last 15 minutes (detect_user_error_spikes(5, 15, 24), HAVING
 * COUNT(*) >= 5), so every quiet quarter hour bought an edge call, a key check
 * and three reads for nothing: up to 96 a day.
 *
 * WHAT HOLDS NOW, on pglite with stand-ins for pg_cron, pg_net and the key
 * store, running the job's stored command itself:
 *   - before the migration a quiet quarter hour posts (the defect);
 *   - after it, applied twice, a quiet quarter hour posts nothing, and so do
 *     four errors, five old errors and five errors with no visitor; five from
 *     one visitor post once, and a missing key row still stops the post;
 *   - the new command is the old one with the gate and a statement_timeout
 *     inserted, character for character, on the same schedule;
 *   - the migration raises on a command it cannot gate in one place, and its
 *     self-check raises when the job moved off its schedule.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR);
const WRITTEN = readFileSync(resolve(DIR, FILES.find((f) => f.startsWith("20261008128000_"))!), "utf8");
/** This round's file, found by what it does, so the integrator's final stamp does not move the test. */
const FILE = FILES.find((f) => /^2026111312\d{4}_the_error_spike_check_posts_only_when_a_visitor_has_five_errors/.test(f));
const fix = () => {
  expect(FILE, "no 20261113 migration gates check-error-spikes on a possible spike").toBeTruthy();
  return readFileSync(resolve(DIR, FILE!), "utf8");
};
const PRED = "EXISTS (SELECT 1 FROM public.error_telemetry e WHERE e.created_at > now() - interval '15 minutes' AND e.visitor_id IS NOT NULL GROUP BY e.visitor_id HAVING count(*) >= 5)";

const STANDINS = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
    WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$
    UPDATE cron.job j SET schedule = COALESCE(alter_job.schedule, j.schedule), command = COALESCE(alter_job.command, j.command), active = COALESCE(alter_job.active, j.active)
    WHERE j.jobid = alter_job.job_id $$;
  CREATE SCHEMA net;
  CREATE TABLE net.posted (id serial PRIMARY KEY, url text, headers jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}'::jsonb, body jsonb DEFAULT '{}'::jsonb) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO net.posted (url, headers) VALUES (url, headers) RETURNING id::bigint $$;
  CREATE SCHEMA vault;
  CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
  INSERT INTO vault.decrypted_secrets VALUES ('alerts_cron_key', 'k-0123456789abcdef0123456789abcdef');
  CREATE TABLE public.error_telemetry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
    error_type text NOT NULL DEFAULT 'api', error_code text NOT NULL DEFAULT 'X', visitor_id text);
`;

async function production(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(WRITTEN);
  return db;
}
const job = async (db: PGlite) =>
  (await db.query<{ schedule: string; command: string; active: boolean }>("SELECT schedule, command, active FROM cron.job WHERE jobname = 'check-error-spikes'")).rows[0];
/** Run the job's stored command as pg_cron would, and count what it posted. */
async function tick(db: PGlite): Promise<number> {
  await db.exec("DELETE FROM net.posted");
  await db.exec((await job(db)).command);
  return Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM net.posted")).rows[0].n);
}
async function errors(db: PGlite, rows: Array<{ visitor: string | null; minutesAgo: number }>) {
  await db.exec("DELETE FROM public.error_telemetry");
  for (const r of rows) {
    await db.query("INSERT INTO public.error_telemetry (visitor_id, created_at) VALUES ($1, now() - make_interval(mins => $2))", [r.visitor, r.minutesAgo]);
  }
}
const times = (n: number, visitor: string | null, minutesAgo = 3) => Array.from({ length: n }, () => ({ visitor, minutesAgo }));

describe("the job as 20261008128000 wrote it (the defect, kept as the baseline)", () => {
  it("posts in a quarter hour with no error at all", async () => {
    const db = await production();
    await errors(db, []);
    expect(await tick(db)).toBe(1);
  });
});

describe("after this round's migration, applied twice", () => {
  const gated = async () => {
    const db = await production();
    await db.exec(fix());
    await db.exec(fix());
    return db;
  };

  it("a quiet quarter hour posts nothing", async () => {
    const db = await gated();
    await errors(db, []);
    expect(await tick(db)).toBe(0);
  });

  it("four errors, five old errors, five with no visitor, or three and three post nothing", async () => {
    const db = await gated();
    for (const rows of [times(4, "v1"), times(5, "v1", 20), times(5, null), [...times(3, "v1"), ...times(3, "v2")]]) {
      await errors(db, rows);
      expect(await tick(db), JSON.stringify(rows)).toBe(0);
    }
  });

  it("five errors from one visitor in the window post once, as before", async () => {
    const db = await gated();
    await errors(db, times(5, "v1"));
    expect(await tick(db)).toBe(1);
  });

  it("the key row still decides: a spike with no key row posts nothing", async () => {
    const db = await gated();
    await errors(db, times(5, "v1"));
    await db.exec("DELETE FROM vault.decrypted_secrets");
    expect(await tick(db)).toBe(0);
  });

  it("the command is the old one with the gate and a statement_timeout inserted, on the same schedule", async () => {
    const before = await job(await production());
    const after = await job(await gated());
    expect(after.schedule).toBe("7-59/15 * * * *");
    expect(after.active).toBe(true);
    expect(after.command.split(PRED).length - 1, "the gate is not in the command exactly once").toBe(1);
    expect(after.command.startsWith("SET statement_timeout = '30s'; ")).toBe(true);
    expect(after.command.slice("SET statement_timeout = '30s'; ".length).replace(`${PRED} AND `, "")).toBe(before.command);
  });
});

describe("the migration refuses what it cannot gate, and checks itself", () => {
  it("raises on a command with no WHERE EXISTS to gate, or with two", async () => {
    for (const command of ["SELECT 1", "SELECT a() WHERE EXISTS (SELECT 1) UNION ALL SELECT b() WHERE EXISTS (SELECT 2)"]) {
      const db = await production();
      await db.query("UPDATE cron.job SET command = $1 WHERE jobname = 'check-error-spikes'", [command]);
      await expect(db.exec(fix()), command).rejects.toThrow(/check-error-spikes holds \d+ "\) WHERE EXISTS \("/);
    }
  });

  it("does not add a second statement_timeout to a command that opens with one", async () => {
    const db = await production();
    await db.exec("UPDATE cron.job SET command = 'SET statement_timeout = ''20s''; ' || command WHERE jobname = 'check-error-spikes'");
    await db.exec(fix());
    expect(((await job(db)).command.match(/statement_timeout/g) ?? []).length).toBe(1);
  });

  it("its self-check raises when the job moved off its schedule", async () => {
    const db = await production();
    await db.exec(fix());
    await db.exec("UPDATE cron.job SET schedule = '*/5 * * * *' WHERE jobname = 'check-error-spikes'");
    const verify = /DO \$verify\$[\s\S]*?\$verify\$;/.exec(fix())![0];
    await expect(db.exec(verify)).rejects.toThrow(/no longer active every 15 minutes/);
  });

  it("does nothing where pg_cron is not installed, or where the job is not scheduled", async () => {
    await expect(new PGlite().exec(fix())).resolves.toBeDefined();
    const db = await production();
    await db.exec("DELETE FROM cron.job");
    await expect(db.exec(fix())).resolves.toBeDefined();
  });
});
