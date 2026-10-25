// @vitest-environment node
/**
 * R1 HOTFIX S13-017: THE LIVE DRAIN JOB IS RE-SCHEDULED SO A PROVIDER COOLDOWN
 * NO LONGER HOLDS SIGN-IN MAIL (migration 20261014120000).
 *
 * WHAT WAS WRONG. rb-auth-mail-drain, scheduled by 20261014100000, returns at
 * once while email_send_state.retry_after_until is in the future, and the
 * process-email-queue build live with it set that cooldown from a Lovable 429
 * on sign-in mail (Retry-After: an hour). One throttle held every reset mail
 * past its 15-minute code into the dead-letter queue. The first hotfix edited
 * 20261014100000 in place, but that file is LIVE (applied outside the staged
 * runner; docs/deploy-ledger.json appliedOutsideDrizzle), so the edit would
 * never have reached production: the ledger skips an applied stamp, and the
 * live job would have gone on waiting every cooldown out.
 *
 * WHAT HOLDS NOW, applying the real files to pglite with stand-ins for
 * pg_cron, pgmq, the vault and pg_net, and RUNNING the job's stored command:
 *   - 20261014100000 is the text that was applied (its command still reads
 *     the cooldown: the live job, shown posting nothing during one);
 *   - 20261014120000, applied over it, replaces the command in place (same
 *     job id, every 10 seconds), and the new command posts during a
 *     60-minute cooldown, with the vault bearer and the cron key, naming the
 *     auth queue only; it keeps every read-back the old command had;
 *   - it is safe to run twice; it schedules the job when someone removed it;
 *     it refuses a job of that name that neither R1 file wrote, and a queue
 *     wrapper open to clients, changing nothing; Lovable's own job is left
 *     byte for byte;
 *   - its self-check fails a command that reads the cooldown again;
 *   - (second fixer round) its command begins SET statement_timeout = '10s',
 *     which get_cron_health reports as ch_timeout (the live command sets
 *     none), so verify section 94 can tell from outside whether this file
 *     applied; its self-check refuses a command without that trace.
 */
import { describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootEmailOpsDb, migration, rows } from "./helpers/email-ops-db";
import { CRON_STAND_IN } from "./helpers/mail-door-db";
import { sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000 });

const LIVE = "20261014100000";
const FILE = "20261014120000";
const JOB = "rb-auth-mail-drain";
const CRON_KEY = "k".repeat(64);
const BEARER = "svc.jwt.from-the-vault";
const STAND_INS = `
  CREATE TABLE public.email_send_state (id int PRIMARY KEY DEFAULT 1, retry_after_until timestamptz);
  INSERT INTO public.email_send_state (id) VALUES (1);
  CREATE SCHEMA pgmq;
  CREATE TABLE pgmq.q_auth_emails (msg_id bigserial PRIMARY KEY, vt timestamptz NOT NULL DEFAULT now(), message jsonb);
  CREATE TABLE pgmq.q_transactional_emails (msg_id bigserial PRIMARY KEY, vt timestamptz NOT NULL DEFAULT now(), message jsonb);
  CREATE FUNCTION pgmq.metrics(p_queue text)
    RETURNS TABLE(queue_name text, queue_length bigint, newest_msg_age_sec int, oldest_msg_age_sec int, total_messages bigint, scrape_time timestamptz)
    LANGUAGE plpgsql AS $$ BEGIN
      RETURN QUERY EXECUTE format('SELECT %L::text, count(*)::bigint, NULL::int, NULL::int, count(*)::bigint, now() FROM pgmq.%I', p_queue, 'q_' || p_queue);
    END $$;
  CREATE SCHEMA vault;
  CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
  CREATE SCHEMA net;
  CREATE TABLE net.calls (id serial PRIMARY KEY, url text, headers jsonb, body jsonb);
  CREATE TABLE net._http_response (id bigserial PRIMARY KEY, status_code integer, content text, timed_out boolean, created timestamptz NOT NULL DEFAULT now());
  CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
                                headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds int DEFAULT 5000)
    RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, headers, body) VALUES ($1, $4, $2) RETURNING id::bigint $$;
`;
const SECRETS = `INSERT INTO vault.decrypted_secrets VALUES ('email_cron_key', '${CRON_KEY}'), ('email_queue_service_role_key', '${BEARER}');`;
const COOLDOWN = "UPDATE public.email_send_state SET retry_after_until = now() + interval '60 minutes'";

/** A database as production is: 20261014100000 applied, its job running. */
async function live(opts: { cron?: boolean; seed?: string; applyLive?: boolean } = {}): Promise<PGlite> {
  const pg = await bootEmailOpsDb({
    apply: ["20261008121000", "20261002104317"],
    seed: STAND_INS + (opts.cron === false ? "" : CRON_STAND_IN) + (opts.seed ?? ""),
  });
  if (opts.applyLive !== false) await pg.exec(migration(LIVE));
  return pg;
}
const apply = (pg: PGlite) => pg.exec(migration(FILE));
const jobNamed = async (pg: PGlite, name: string) =>
  (await rows<{ jobid: number; schedule: string; command: string }>(pg, "SELECT jobid::int AS jobid, schedule, command FROM cron.job WHERE jobname = $1", [name]))[0];
const job = (pg: PGlite) => jobNamed(pg, JOB);
const calls = (pg: PGlite) => rows<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }>(pg, "SELECT url, headers, body FROM net.calls ORDER BY id");
const tick = async (pg: PGlite) => pg.exec((await job(pg)).command);
/** What 20261014120000's command begins with: the timeout get_cron_health reports as ch_timeout, which only this file writes. */
const TRACE = "SET statement_timeout = '10s';";

describe("the live job (20261014100000, the text that was applied)", () => {
  it("is restored to what production runs: its command still waits a provider cooldown out", async () => {
    const pg = await live({ seed: SECRETS });
    expect((await job(pg)).command).toContain("rb-auth-mail-drain 20261014100000");
    await pg.exec(`INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}'); ${COOLDOWN}`);
    await tick(pg);
    expect(await calls(pg), "20261014100000 is not the text production applied").toEqual([]);
  });
});

describe("20261014120000 over the live job", () => {
  it("replaces the command in place, and the new command posts during a 60-minute cooldown with the bearer and the cron key, naming the auth queue only", async () => {
    const pg = await live({ seed: SECRETS });
    const before = await job(pg);
    await apply(pg);
    const after = await job(pg);
    expect(after.jobid, "the job was re-created instead of replaced in place (its run history would be lost)").toBe(before.jobid);
    expect(after.schedule).toBe("10 seconds");
    expect(after.command).toContain("rb-auth-mail-drain 20261014120000");
    expect(after.command).not.toContain("email_send_state");
    expect(await rows(pg, "SELECT 1 FROM cron.job WHERE jobname = $1", [JOB])).toHaveLength(1);

    await pg.exec(`INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}'); ${COOLDOWN}`);
    await tick(pg);
    const c = await calls(pg);
    expect(c, "a provider cooldown still held sign-in mail past its code").toHaveLength(1);
    expect(c[0].url).toBe("https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/process-email-queue");
    expect(c[0].headers.Authorization).toBe(`Bearer ${BEARER}`);
    expect(c[0].headers["x-email-cron"]).toBe(CRON_KEY);
    expect(c[0].body).toEqual({ source: "cron", queues: ["auth_emails"] });
  });

  it("the new command is the live one with only the cooldown read and the marker changed, behind the SET that leaves its trace", () => {
    const body = (sql: string) => sql.split("$cmd$")[1];
    const old = body(migration(LIVE));
    const now = body(migration(FILE));
    const expected = TRACE + old
      .replace("rb-auth-mail-drain 20261014100000 refusedBy", "rb-auth-mail-drain 20261014120000 refusedBy")
      .replace("  IF EXISTS (SELECT 1 FROM public.email_send_state s WHERE s.retry_after_until > now()) THEN\n    RETURN;\n  END IF;\n", "");
    expect(expected, "the live command's text moved: re-derive this file's command from it").not.toBe(TRACE + old);
    expect(now).toBe(expected);
  });

  it("leaves a trace production can read after the deploy: get_cron_health's ch_timeout reads '10s' from the new command and nothing from the live one (second fixer round)", async () => {
    const pg = await live({ seed: SECRETS });
    const reader = /substring\(j\.command FROM ('(?:[^']|'')*')\)/.exec(migration("20261004010000"))?.[1];
    expect(reader, "get_cron_health's ch_timeout expression moved: re-read it from its migration").toBeTruthy();
    const chTimeout = async () => (await rows<{ t: string | null }>(pg, `SELECT substring($1 FROM ${reader}) AS t`, [(await job(pg)).command]))[0].t;
    expect(await chTimeout(), "the live job already carries a timeout, so the trace would prove nothing").toBeNull();
    await apply(pg);
    expect(await chTimeout(), "nothing anon can read tells the re-scheduled job from the live one (section 94 could only print INFO)").toBe("10s");
    await pg.exec(`INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}'); ${COOLDOWN}`);
    await tick(pg);
    expect(await calls(pg), "the SET in front of the command stopped it posting").toHaveLength(1);
  });

  it("its self-check fails a command without the trace (a runner that edited the file could strip it)", async () => {
    const pg = await live();
    const edited = migration(FILE).replace("$cmd$" + TRACE, "$cmd$");
    expect(edited).not.toBe(migration(FILE));
    await expect(pg.exec(edited)).rejects.toThrow(/does not begin with this file's SET statement_timeout = '10s'/);
  });

  it("keeps every read-back: empty queue, no bearer, a refusal of its own post and the gateway's 401 each post nothing", async () => {
    const pg = await live();
    await apply(pg);
    await tick(pg);
    expect(await calls(pg), "an empty queue was posted").toEqual([]);
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await expect(tick(pg)).rejects.toThrow(/rb-auth-mail-drain 20261014120000 refusedBy\): sign-in mail is waiting and the vault holds no email_queue_service_role_key/);
    await pg.exec(SECRETS);
    await pg.exec(`INSERT INTO net._http_response (status_code, content, created) VALUES (403, '{"error":"Forbidden","refusedBy":"process-email-queue","cronKey":true}', now() - interval '30 seconds')`);
    await expect(tick(pg)).rejects.toThrow(/the drain refused 1 post\(s\) that offered the cron key/);
    await pg.exec("DELETE FROM net._http_response");
    await pg.exec(`INSERT INTO net._http_response (status_code, content, created) VALUES (401, '{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}', now() - interval '30 seconds')`);
    await expect(tick(pg)).rejects.toThrow(/the gateway answered 1 post\(s\) with its own 401/);
    expect(await calls(pg)).toEqual([]);
  });

  it("runs twice: the second run changes nothing", async () => {
    const pg = await live();
    await apply(pg);
    const first = await job(pg);
    await apply(pg);
    expect(await job(pg)).toEqual(first);
    expect(await rows(pg, "SELECT 1 FROM cron.job WHERE jobname = $1", [JOB])).toHaveLength(1);
  });

  it("with the job removed by hand, it schedules it", async () => {
    const pg = await live({ seed: SECRETS });
    await pg.exec(`SELECT cron.unschedule('${JOB}')`);
    await apply(pg);
    const j = await job(pg);
    expect(j.schedule).toBe("10 seconds");
    expect(j.command).toContain("rb-auth-mail-drain 20261014120000");
  });

  it("a job of our name that neither R1 file wrote is refused and left as it is", async () => {
    const pg = await live({ applyLive: false, seed: `SELECT cron.schedule('${JOB}', '1 minute', 'SELECT 1');` });
    await expect(apply(pg)).rejects.toThrow(/a job named rb-auth-mail-drain exists that neither 20261014100000 nor this file wrote/);
    expect(await job(pg)).toMatchObject({ schedule: "1 minute", command: "SELECT 1" });
  });

  it("Lovable's own process-email-queue job is left byte for byte, and the file's code never writes that name (comments stripped)", async () => {
    const lovable = "SELECT net.http_post(url := 'https://example.invalid/functions/v1/process-email-queue', headers := '{}'::jsonb, body := '{}'::jsonb)";
    const pg = await live({ seed: `SELECT cron.schedule('process-email-queue', '5 seconds', $c$${lovable}$c$);` });
    await apply(pg);
    expect(await jobNamed(pg, "process-email-queue")).toMatchObject({ schedule: "5 seconds", command: lovable });
    const code = sqlCodeOf(migration(FILE));
    expect(code).not.toMatch(/cron\.(schedule|unschedule|alter_job)\s*\(\s*'process-email-queue'/);
    expect(code).toMatch(/cron\.schedule\('rb-auth-mail-drain', '10 seconds', v_cmd\)/);
  });

  it("a queue wrapper open to clients refuses the file, and the live command stays", async () => {
    const pg = await live();
    const before = await job(pg);
    await pg.exec(`CREATE FUNCTION public.enqueue_email_later(q text, p jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN pgmq.send(q, p); END $$;`);
    await expect(apply(pg)).rejects.toThrow(/queue_wrapper_exposure\(\) reports 1/);
    expect(await job(pg)).toEqual(before);
  });

  it("a host without pg_cron gets no error and no job", async () => {
    const pg = await live({ cron: false });
    await apply(pg);
    expect(await rows(pg, "SELECT 1 FROM pg_namespace WHERE nspname = 'cron'")).toHaveLength(0);
  });

  it("its self-check fails a command that reads the cooldown again", async () => {
    const pg = await live();
    const edited = migration(FILE).replace("BEGIN\n  v_n := 0;", "BEGIN\n  IF EXISTS (SELECT 1 FROM public.email_send_state s WHERE s.retry_after_until > now()) THEN RETURN; END IF;\n  v_n := 0;");
    expect(edited).not.toBe(migration(FILE));
    await expect(pg.exec(edited)).rejects.toThrow(/reads the provider cooldown; sign-in mail must not wait it out/);
  });

  it("creates no function and no table", () => {
    const code = sqlCodeOf(migration(FILE));
    expect(code).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(code).not.toMatch(/CREATE\s+TABLE/i);
  });
});
