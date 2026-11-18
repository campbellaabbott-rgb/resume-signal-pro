// @vitest-environment node
//
// Node, not jsdom: the SQL runs in pglite.
/**
 * THE AGENT DIGEST STOPS, BY NAME, ONLY ON THE OWNER'S YES (S14X-225).
 *
 * The apply agent is retired and nothing fills the shortlist, yet
 * send-agent-digest and send-agent-digest-morning (a job production holds
 * that no migration wrote) still fire every day. 20261112153000, which ships
 * only with the owner's explicit yes, removes both by name and nothing else,
 * applies cleanly where neither exists or pg_cron is absent, and refuses to
 * finish while either is still scheduled.
 *
 * Run against a pg_cron stand-in that starts from Supabase's default grants.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DIR = resolve(__dirname, "../../supabase/migrations");
const M = readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith("20261112153000_"))!), "utf8");

const BASE = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;
/** pg_cron's job table and its two unschedule forms; `removes` false stands in for one that removes nothing. */
const cron = (removes = true) => `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true, jobname text UNIQUE);
  CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $$
  BEGIN ${removes ? "DELETE FROM cron.job WHERE jobname = job_name;" : ""} RETURN true; END $$;
  CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE plpgsql AS $$
  BEGIN ${removes ? "DELETE FROM cron.job WHERE jobid = job_id;" : ""} RETURN true; END $$;
`;
const JOBS = `
  INSERT INTO cron.job (jobname, schedule, command) VALUES
    ('send-agent-digest', '40 6 * * *', 'SELECT net.http_post(''/functions/v1/send-agent-digest'')'),
    ('send-agent-digest-morning', '0 7 * * *', 'SELECT net.http_post(''/functions/v1/send-agent-digest'')'),
    ('send-search-digest', '30 6 * * *', 'SELECT net.http_post(''/functions/v1/send-search-digest'')'),
    ('agent-queue-retention', '15 4 * * *', 'SELECT 1');
`;
const names = async (db: PGlite) => (await db.query<{ jobname: string }>("SELECT jobname FROM cron.job ORDER BY jobname")).rows.map((r) => r.jobname);

describe("20261112153000", () => {
  it("removes both agent digest jobs by name and leaves every other job, and a second run is clean", async () => {
    const db = new PGlite();
    await db.exec(BASE + cron() + JOBS);
    await db.exec(M);
    expect(await names(db)).toEqual(["agent-queue-retention", "send-search-digest"]);
    await db.exec(M);
    expect(await names(db)).toEqual(["agent-queue-retention", "send-search-digest"]);
    await db.close();
  });

  it("removes the production-only morning job when the repo's job is already gone", async () => {
    const db = new PGlite();
    await db.exec(BASE + cron() + JOBS + "DELETE FROM cron.job WHERE jobname = 'send-agent-digest';");
    await db.exec(M);
    expect(await names(db)).toEqual(["agent-queue-retention", "send-search-digest"]);
    await db.close();
  });

  it("applies cleanly where neither job exists, and where pg_cron is not installed", async () => {
    const none = new PGlite();
    await none.exec(BASE + cron());
    await expect(none.exec(M)).resolves.toBeDefined();
    await none.close();
    const bare = new PGlite();
    await bare.exec(BASE);
    await expect(bare.exec(M)).resolves.toBeDefined();
    await bare.close();
  });

  it("refuses to finish while either job is still scheduled", async () => {
    const db = new PGlite();
    await db.exec(BASE + cron(false) + JOBS);
    await expect(db.exec(M)).rejects.toThrow(/agent digest is still scheduled after its removal: send-agent-digest, send-agent-digest-morning/);
    await db.close();
  });
});
