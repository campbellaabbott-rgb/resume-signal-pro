// @vitest-environment node
//
// Node, not jsdom: the SQL runs in pglite with the live agent triggers.
/**
 * A RUN-OUT PASS CLOSES, AND GIVES BACK WHAT IT NEVER SENT (S14X-083).
 *
 * A pass settles only once it is closed, and every closer was lazy: it closed
 * a run-out pass only when its own buyer came back, and the retired pass gives
 * a buyer no reason to. A released packet under three attempts was "left to
 * finish" by a sender that is switched off. 20261112152000 stales those
 * packets once, closes every run-out pass, and schedules 'agent-pass-close'
 * to close the ones that run out later.
 *
 * Run against the live agent triggers (helpers/agent-db), the settlement
 * chain as it stands live (20261008132000 and the files that rewrote its
 * refund trigger), a pg_cron stand-in, and the file applied twice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, migration } from "./helpers/agent-db";

const M_PASS_GRANT = "20261008131500_a_signed_in_account_reads_its_pass_and_never_writes_it.sql";
const M_SETTLE = "20261008132000_a_closed_pass_gives_back_every_application_it_never_sent.sql";
const M_REFUNDED = "20261009121000_a_refunded_pass_application_is_sent_only_if_it_is_paid_for_again.sql";
const M_UNCERTAIN = "20261009124000_an_unconfirmed_send_counts_as_a_send_and_keeps_its_application.sql";
const M = "20261112152000_a_run_out_pass_closes_and_gives_back_what_it_never_sent.sql";

const RAN_OUT = "00000000-0000-4000-8000-00000000b801";
const LIVE = "00000000-0000-4000-8000-00000000b802";
const SHELF = "00000000-0000-4000-8000-00000000b803";
const CLOSED = "00000000-0000-4000-8000-00000000b804";
const LATER = "00000000-0000-4000-8000-00000000b805";

/** pg_cron's catalogue and the calls the file makes, as pg_cron 1.6 shapes them. */
const CRON = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (
    jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
    database text NOT NULL DEFAULT 'postgres', username text NOT NULL DEFAULT 'postgres',
    active boolean NOT NULL DEFAULT true, jobname text UNIQUE
  );
  CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
                                 database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    UPDATE cron.job j SET
      schedule = coalesce(alter_job.schedule, j.schedule),
      command = coalesce(alter_job.command, j.command),
      active = coalesce(alter_job.active, j.active)
     WHERE j.jobid = job_id;
  END $$;
`;

let db: PGlite;
const one = async <T = Record<string, unknown>>(sql: string): Promise<T> => (await db.query<T>(sql)).rows[0];
type PassRow = { closed: boolean; close_reason: string | null; settled: boolean; used: number };
const pass = (id: string) => one<PassRow>(
  `SELECT closed_at IS NOT NULL AS closed, close_reason, settled_at IS NOT NULL AS settled, applications_used AS used
     FROM public.agent_passes WHERE id = '${id}'`);
type PacketRow = { status: string; given_back: boolean };
const packet = (posting: string) => one<PacketRow>(
  `SELECT status, pass_refunded_at IS NOT NULL AS given_back FROM public.agent_submissions WHERE posting_id = '${posting}'`);

/** A pass, and on it one released packet a worker tried once and no worker holds now. */
async function passWithReleasedPacket(id: string, user: string, clock: string, used: number) {
  await db.exec(`
    INSERT INTO public.agent_passes (id, user_id, applications_used, activated_at, expires_at)
    VALUES ('${id}', '${user}', ${used}, ${clock});
    INSERT INTO public.agent_queue (user_id, posting_id, status, pass_id) VALUES ('${user}', '${id}:released', 'approved', '${id}');
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, pass_id, released_at, attempts, claimed_at, submitted_at, blockers)
    VALUES ('${user}', '${id}:released', 'Released Co', 'ready', '${id}', now() - interval '2 days', 1, NULL, NULL, '[]');`);
}

/** The job's own command, run the way pg_cron runs it: no request claims. */
async function runTheJob() {
  const { command } = await one<{ command: string }>("SELECT command FROM cron.job WHERE jobname = 'agent-pass-close'");
  await db.exec(`SELECT set_config('request.jwt.claims', '', false)`);
  try {
    await db.exec(command);
  } finally {
    await db.exec(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  }
}

beforeAll(async () => {
  const users = [RAN_OUT, LIVE, SHELF, CLOSED, LATER].map((u, i) => `('${u}', 'pass${i}@example.com')`).join(", ");
  db = await agentDb({ seed: `INSERT INTO auth.users (id, email) VALUES ${users};` });
  await db.exec(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  for (const m of [M_PASS_GRANT, M_SETTLE, M_REFUNDED, M_UNCERTAIN]) await db.exec(migration(m));
  await db.exec(CRON);

  // The clock ran out yesterday and nobody came back to close it.
  await passWithReleasedPacket(RAN_OUT, RAN_OUT, "now() - interval '2 days', now() - interval '1 day'", 3);
  // The clock is still running.
  await passWithReleasedPacket(LIVE, LIVE, "now() - interval '1 hour', now() + interval '5 hours'", 3);
  // Never started, and its shelf ran out.
  await db.exec(`INSERT INTO public.agent_passes (id, user_id, shelf_expires_at) VALUES ('${SHELF}', '${SHELF}', now() - interval '1 day')`);
  // Closed and settled before the file, its released packet left to finish.
  await passWithReleasedPacket(CLOSED, CLOSED, "now() - interval '3 days', now() - interval '2 days'", 2);
  await db.exec(`UPDATE public.agent_passes SET closed_at = now() - interval '1 day', close_reason = 'session_ended' WHERE id = '${CLOSED}'`);

  await db.exec(migration(M));
  await db.exec(migration(M));
}, 240_000);

afterAll(async () => { await db?.close(); });

describe("the file closes every run-out pass and gives back what the sender will never send", () => {
  it("a pass whose clock ran out is closed, settled, and its released packet given back once", async () => {
    expect(await pass(RAN_OUT)).toEqual({ closed: true, close_reason: "session_ended", settled: true, used: 2 });
    expect(await packet(`${RAN_OUT}:released`)).toEqual({ status: "stale", given_back: true });
  });

  it("a pass whose shelf ran out before its clock started is closed as shelf_expired and settled", async () => {
    expect(await pass(SHELF)).toEqual({ closed: true, close_reason: "shelf_expired", settled: true, used: 0 });
  });

  it("a pass closed before the file gives back the released packet it had left to finish, once", async () => {
    expect(await pass(CLOSED)).toMatchObject({ closed: true, close_reason: "session_ended", settled: true, used: 1 });
    expect(await packet(`${CLOSED}:released`)).toEqual({ status: "stale", given_back: true });
  });

  it("a pass whose clock has not run out is untouched, and so is its packet", async () => {
    expect(await pass(LIVE)).toEqual({ closed: false, close_reason: null, settled: false, used: 3 });
    expect(await packet(`${LIVE}:released`)).toEqual({ status: "ready", given_back: false });
  });
});

describe("the daily job 'agent-pass-close'", () => {
  it("is scheduled once, active, and sets its own statement_timeout in its command", async () => {
    const jobs = (await db.query<{ active: boolean; command: string; schedule: string }>(
      "SELECT active, command, schedule FROM cron.job WHERE jobname = 'agent-pass-close'")).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].active).toBe(true);
    expect(jobs[0].schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    // The reader get_cron_health uses, so the live health line can show the timeout.
    expect(jobs[0].command).toMatch(/^\s*set\s+statement_timeout\s*=\s*'([^']+)'/i);
  });

  it("closes and settles a pass that runs out after the file, and leaves one still running", async () => {
    await db.exec(`
      INSERT INTO public.agent_passes (id, user_id, applications_used, activated_at, expires_at)
      VALUES ('${LATER}', '${LATER}', 4, now() - interval '7 hours', now() - interval '1 hour');
      INSERT INTO public.agent_queue (user_id, posting_id, status, pass_id) VALUES ('${LATER}', '${LATER}:held', 'approved', '${LATER}');
      INSERT INTO public.agent_submissions (user_id, posting_id, company, status, pass_id, released_at, attempts, blockers)
      VALUES ('${LATER}', '${LATER}:held', 'Held Co', 'ready', '${LATER}', NULL, 0, '[]');`);
    expect((await pass(LATER)).closed).toBe(false);

    await runTheJob();

    // The settle trigger ran: the held packet, never released, is given back.
    expect(await pass(LATER)).toEqual({ closed: true, close_reason: "session_ended", settled: true, used: 3 });
    expect(await packet(`${LATER}:held`)).toEqual({ status: "ready", given_back: true });
    expect((await pass(LIVE)).closed).toBe(false);
  });

  it("a job whose command drifted is given its command back, active, when the file runs again", async () => {
    await db.exec("UPDATE cron.job SET command = 'SELECT 1', active = false WHERE jobname = 'agent-pass-close'");
    await db.exec(migration(M));
    const job = await one<{ active: boolean; command: string }>("SELECT active, command FROM cron.job WHERE jobname = 'agent-pass-close'");
    expect(job.active).toBe(true);
    expect(job.command).toMatch(/^SET statement_timeout = '2min'; UPDATE public\.agent_passes/);
  });

  // The closeout review of 2026-11-16: the file's marker says every job it
  // schedules runs once a day, so a job of this name it finds on another
  // schedule (made elsewhere, or edited) is put back on 03:41 daily, not kept.
  it("a job found on another schedule is put back on its daily one, and the self-check refuses a job left off it", async () => {
    await db.exec("UPDATE cron.job SET schedule = '*/5 * * * *' WHERE jobname = 'agent-pass-close'");
    await db.exec(migration(M));
    const job = await one<{ active: boolean; schedule: string }>("SELECT active, schedule FROM cron.job WHERE jobname = 'agent-pass-close'");
    expect(job).toEqual({ active: true, schedule: "41 3 * * *" });
    // The verify block alone, on a job moved after the closer ran, names the schedule it found.
    await db.exec("UPDATE cron.job SET schedule = '*/5 * * * *' WHERE jobname = 'agent-pass-close'");
    const sql = migration(M);
    const verify = sql.slice(sql.indexOf("DO $verify$"));
    await expect(db.exec(verify)).rejects.toThrow(/runs on \*\/5 \* \* \* \*, not daily at 03:41/);
    await db.exec("UPDATE cron.job SET schedule = '41 3 * * *' WHERE jobname = 'agent-pass-close'");
  });
});
