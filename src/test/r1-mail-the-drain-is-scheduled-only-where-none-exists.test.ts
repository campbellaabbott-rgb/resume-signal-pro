// @vitest-environment node
/**
 * OUR DRAIN RUNS BESIDE LOVABLE'S, NEVER IN ITS PLACE, NEVER BEHIND AN OPEN
 * QUEUE, AND POSTS ONLY WHEN MAIL IS WAITING (R1 mail, migration
 * 20261014100000; register CP-002, CP-015, CP-013; lead decision B of the
 * third fixer round, 2026-10-12).
 *
 * WHAT WAS WRONG. Nothing drained auth_emails (get_cron_health, 2026-10-12: 56
 * jobs, none of them process-email-queue), so a queued sign-in mail never left.
 * Restoring a drain blindly had three traps: Lovable's email setup keeps, outside
 * our migrations, a trigger, a dispatcher and a job of its own under the name
 * 'process-email-queue' plus the vault bearer they post, and a file that wrote
 * that name could replace them; a drain behind a queue wrapper anon can still
 * call is a mail relay on our domain; and the log had nowhere to put Resend's id.
 *
 * WHAT HOLDS NOW, applying the real file to pglite with stand-ins for pg_cron,
 * pgmq, the vault and pg_net, and then RUNNING the job's stored command:
 *   - the job is 'rb-auth-mail-drain', every 10 seconds; a job named
 *     'process-email-queue' is left byte for byte and ours is made beside it,
 *     and the file's code never schedules, alters or unschedules that name;
 *   - the file refuses (and changes nothing) while queue_wrapper_exposure()
 *     reports an open wrapper, or, without that reader, while a named wrapper
 *     is executable by anon;
 *   - the command posts only while a sign-in mail is visible in auth_emails
 *     (R1 drains sign-in mail only; the drip waits for CP-G), with the vault
 *     bearer (email_queue_service_role_key) AND the cron key (x-email-cron),
 *     naming {"queues":["auth_emails"]}; a provider cooldown does not hold it
 *     (S13-017: the cooldown is the transactional queue's alone, and one 429
 *     with Retry-After 3600 had held every reset mail past its code);
 *   - a run fails loudly, posting nothing, when the vault holds no bearer or
 *     no cron key, when the drain refused a post THAT OFFERED THE CRON KEY in
 *     the last two minutes (only our posts offer one), or when the gateway
 *     answered a post with its own 401 (a bearer it does not accept); a
 *     refusal of another caller's post never stops ours;
 *   - the gateway's 401 is recognised by the body the LIVE gateway sends: a
 *     STRING code that starts UNAUTHORIZED_ (fixtures below, each with the
 *     date it was read). An earlier draft matched a numeric code, a body the
 *     gateway never sends, so a refused bearer read as a success on every
 *     run while this file's tests passed on a body pinned by hand;
 *   - provider_message_id and its index exist, the status CHECK accepts
 *     delivered and delayed, keeps any value a drifted constraint allowed, and
 *     stays the only check on status; the file is safe to run twice.
 */
import { describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootEmailOpsDb, migration, rows } from "./helpers/email-ops-db";
import { CRON_STAND_IN } from "./helpers/mail-door-db";
import { sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000 });

const FILE = "20261014100000";
const JOB = "rb-auth-mail-drain";
const CRON_KEY = "k".repeat(64);
const BEARER = "svc.jwt.from-the-vault";
/**
 * The gateway's own 401 bodies, exactly as the live gateway sends them for
 * https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/process-email-queue
 * (verify_jwt on). Read-only GETs:
 *   - no Authorization header, 2026-10-17 18:16 UTC (R1 fixer round 4; the
 *     response also carried sb-error-code: UNAUTHORIZED_NO_AUTH_HEADER);
 *   - a bearer that is not a JWT, and a mis-signed HS256 token, 2026-10-17
 *     (the second recheck of R1).
 */
const GATEWAY_401_BODIES = [
  '{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}',
  '{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}',
  '{"code":"UNAUTHORIZED_LEGACY_JWT","message":"Invalid JWT"}',
] as const;
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

async function boot(opts: { cron?: boolean; exposureReader?: boolean; seed?: string } = {}): Promise<PGlite> {
  const pg = await bootEmailOpsDb({
    apply: ["20261008121000", ...(opts.exposureReader === false ? [] : ["20261002104317"])],
    seed: STAND_INS + (opts.cron === false ? "" : CRON_STAND_IN) + (opts.seed ?? ""),
  });
  return pg;
}
const apply = (pg: PGlite) => pg.exec(migration(FILE));
const jobNamed = async (pg: PGlite, name: string) =>
  (await rows<{ schedule: string; command: string }>(pg, "SELECT schedule, command FROM cron.job WHERE jobname = $1", [name]))[0];
const job = (pg: PGlite) => jobNamed(pg, JOB);
const calls = (pg: PGlite) => rows<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }>(pg, "SELECT url, headers, body FROM net.calls ORDER BY id");
const hasColumn = async (pg: PGlite) =>
  (await rows(pg, "SELECT 1 FROM information_schema.columns WHERE table_name = 'email_send_log' AND column_name = 'provider_message_id'")).length === 1;
const statusDef = async (pg: PGlite) =>
  (await rows<{ def: string }>(pg, "SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = 'public.email_send_log'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%status%'")).map((r) => r.def);

describe("the drain job", () => {
  it("is rb-auth-mail-drain, every 10 seconds, posting to the queue function with the bearer and the cron key", async () => {
    const pg = await boot();
    await apply(pg);
    const j = await job(pg);
    expect(j.schedule).toBe("10 seconds");
    expect(j.command).toContain("/functions/v1/process-email-queue");
    expect(j.command).toContain("pgmq.metrics");
    expect(j.command).toContain("email_queue_service_role_key");
    expect(j.command).toContain("email_cron_key");
    expect(await jobNamed(pg, "process-email-queue"), "the file wrote Lovable's job name").toBeUndefined();
  });

  it("a job Lovable made under its own name is left byte for byte, and ours is made beside it", async () => {
    const lovable = "SELECT net.http_post(url := 'https://example.invalid/functions/v1/process-email-queue', headers := '{}'::jsonb, body := '{}'::jsonb)";
    const pg = await boot({ seed: `SELECT cron.schedule('process-email-queue', '5 seconds', $c$${lovable}$c$);` });
    await apply(pg);
    expect(await jobNamed(pg, "process-email-queue")).toEqual({ schedule: "5 seconds", command: lovable });
    expect((await job(pg)).schedule).toBe("10 seconds");
    expect(await rows(pg, "SELECT 1 FROM cron.job")).toHaveLength(2);
  });

  it("the file's code never schedules, alters or unschedules a job named process-email-queue (comments stripped)", () => {
    const code = sqlCodeOf(migration(FILE));
    expect(code).not.toMatch(/cron\.(schedule|unschedule|alter_job)\s*\(\s*'process-email-queue'/);
    expect(code).toMatch(/cron\.schedule\('rb-auth-mail-drain', '10 seconds', v_cmd\)/);
    expect(code).toMatch(/cron\.unschedule\('rb-auth-mail-drain'\)/);
  });

  it("a job of that name an earlier draft of this file wrote fails the self-check instead of being touched", async () => {
    const stale = "DO $d$ BEGIN PERFORM 1; END $d$; -- r1-mail-drain 20261014100000";
    const pg = await boot({ seed: `SELECT cron.schedule('process-email-queue', '10 seconds', $c$${stale}$c$);` });
    await expect(apply(pg)).rejects.toThrow(/a job named process-email-queue carries a marker of ours/);
    expect(await jobNamed(pg, "process-email-queue")).toEqual({ schedule: "10 seconds", command: stale });
  });

  it("a host without pg_cron gets the column and the CHECK and no job", async () => {
    const pg = await boot({ cron: false });
    await apply(pg);
    expect(await hasColumn(pg)).toBe(true);
  });
});

describe("the command posts only when sign-in mail is waiting", () => {
  async function ready(secrets: Record<string, string> = { email_cron_key: CRON_KEY, email_queue_service_role_key: BEARER }) {
    const pg = await boot();
    await apply(pg);
    for (const [name, v] of Object.entries(secrets)) await pg.query("INSERT INTO vault.decrypted_secrets VALUES ($1, $2)", [name, v]);
    const { command } = await job(pg);
    return { pg, tick: () => pg.exec(command) };
  }

  it("empty queues: no post", async () => {
    const { pg, tick } = await ready();
    await tick();
    expect(await calls(pg)).toEqual([]);
  });

  it("a visible sign-in mail: one post with the vault bearer AND the cron key, naming the auth queue only", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await tick();
    const c = await calls(pg);
    expect(c).toHaveLength(1);
    expect(c[0].url).toBe("https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/process-email-queue");
    expect(c[0].headers.Authorization, "the gateway refuses a post with no bearer unheard (verify_jwt is on for Lovable's dispatcher)").toBe(`Bearer ${BEARER}`);
    expect(c[0].headers["x-email-cron"]).toBe(CRON_KEY);
    expect(c[0].body).toEqual({ source: "cron", queues: ["auth_emails"] });
  });

  it("a drip mail, due or not, is no reason to post: R1 drains sign-in mail only (the drip waits for CP-G)", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_transactional_emails (vt, message) VALUES (now() - interval '1 second', '{}')");
    await tick();
    expect(await calls(pg)).toEqual([]);
  });

  it("a sign-in mail not yet visible (being retried) is no reason to post", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_auth_emails (vt, message) VALUES (now() + interval '20 seconds', '{}')");
    await tick();
    expect(await calls(pg)).toEqual([]);
  });

  it("a provider cooldown does not hold sign-in mail: one post (S13-017; the cooldown is the transactional queue's alone)", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}'); UPDATE public.email_send_state SET retry_after_until = now() + interval '60 minutes'");
    await tick();
    const c = await calls(pg);
    expect(c, "a Lovable cooldown held every reset mail past its 15-minute code").toHaveLength(1);
    expect(c[0].body).toEqual({ source: "cron", queues: ["auth_emails"] });
  });

  it("a command that reads the cooldown again fails the file's self-check", async () => {
    const pg = await boot();
    const edited = migration(FILE).replace("BEGIN\n  v_n := 0;", "BEGIN\n  IF EXISTS (SELECT 1 FROM public.email_send_state s WHERE s.retry_after_until > now()) THEN RETURN; END IF;\n  v_n := 0;");
    expect(edited).not.toBe(migration(FILE));
    await expect(pg.exec(edited)).rejects.toThrow(/reads the provider cooldown; sign-in mail must not wait it out/);
  });

  it("no vault bearer: the run fails loudly naming email_queue_service_role_key, and posts nothing the gateway would refuse unheard", async () => {
    const { pg, tick } = await ready({ email_cron_key: CRON_KEY });
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await expect(tick()).rejects.toThrow(/holds no email_queue_service_role_key/);
    expect(await calls(pg)).toEqual([]);
  });

  it("no cron key: the run fails loudly instead of posting", async () => {
    const { pg, tick } = await ready({ email_queue_service_role_key: BEARER });
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await expect(tick()).rejects.toThrow(/holds no email_cron_key/);
    expect(await calls(pg)).toEqual([]);
  });

  it("a refusal of a post that offered the cron key, in the last two minutes, fails the run and posts nothing", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await pg.exec(`INSERT INTO net._http_response (status_code, content, created) VALUES (403, '{"error":"Forbidden","refusedBy":"process-email-queue","cronKey":true}', now() - interval '30 seconds')`);
    await expect(tick()).rejects.toThrow(/the drain refused 1 post\(s\) that offered the cron key in the last two minutes/);
    expect(await calls(pg)).toEqual([]);
  });

  it("a refusal of ANOTHER caller's post (no cron key offered: Lovable's dispatcher, a stray publishable-key post) never stops ours", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await pg.exec(`INSERT INTO net._http_response (status_code, content, created) VALUES
      (403, '{"error":"Forbidden","refusedBy":"process-email-queue","cronKey":false}', now() - interval '10 seconds'),
      (403, '{"error":"Forbidden","refusedBy":"process-email-queue"}', now() - interval '10 seconds')`);
    await tick();
    expect(await calls(pg)).toHaveLength(1);
  });

  it.each(GATEWAY_401_BODIES)("the gateway's own 401 in the last two minutes, in the body the live gateway sends (%s), fails the run and posts nothing", async (body) => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await pg.query("INSERT INTO net._http_response (status_code, content, created) VALUES (401, $1, now() - interval '30 seconds')", [body]);
    await expect(tick()).rejects.toThrow(/the gateway answered 1 post\(s\) with its own 401 in the last two minutes: the vault bearer \(email_queue_service_role_key\) no longer opens it/);
    expect(await calls(pg)).toEqual([]);
  });

  it("an older refusal, or a function's own 401 (no UNAUTHORIZED_ code), does not stop the post", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await pg.query(`INSERT INTO net._http_response (status_code, content, created) VALUES
      (403, '{"error":"Forbidden","refusedBy":"process-email-queue","cronKey":true}', now() - interval '3 minutes'),
      (401, $1, now() - interval '3 minutes'),
      (401, '{"error":"Sign in first.","reason":"not_signed_in"}', now() - interval '10 seconds'),
      (401, '{"error":"Unauthorized"}', now() - interval '10 seconds')`, [GATEWAY_401_BODIES[2]]);
    await tick();
    expect(await calls(pg)).toHaveLength(1);
  });

  it("the read-back names the gateway's string code, never a numeric one the gateway does not send (comments stripped)", () => {
    const code = sqlCodeOf(migration(FILE));
    expect(code).toContain("r.status_code = 401");
    expect(code).toContain(`r.content::text LIKE '%"code":"UNAUTHORIZED_%'`);
    expect(code).not.toMatch(/"code":\s*401/);
  });
});

describe("no drain behind an open queue wrapper", () => {
  it("queue_wrapper_exposure() reports one open: the file refuses and changes nothing", async () => {
    const pg = await boot({
      seed: "",
    });
    await pg.exec(`CREATE FUNCTION public.enqueue_email_later(q text, p jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN pgmq.send(q, p); END $$;`);
    expect((await rows<{ v: { open_to_clients: number } }>(pg, "SELECT public.queue_wrapper_exposure() AS v"))[0].v.open_to_clients).toBe(1);
    await expect(apply(pg)).rejects.toThrow(/queue_wrapper_exposure\(\) reports 1/);
    expect(await hasColumn(pg), "a refused file must leave nothing behind").toBe(false);
    expect(await job(pg)).toBeUndefined();
  });

  it("without that reader, a named wrapper executable by anon refuses the file", async () => {
    const pg = await boot({ exposureReader: false });
    await pg.exec(`CREATE FUNCTION public.enqueue_email(queue_name text, payload jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN pgmq.send(queue_name, payload); END $$;`);
    await expect(apply(pg)).rejects.toThrow(/queue wrappers executable by anon or authenticated: enqueue_email/);
    await pg.exec("REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated");
    await apply(pg);
    expect((await job(pg)).schedule).toBe("10 seconds");
  });
});

describe("the log can hold what Resend says", () => {
  it("provider_message_id and its index exist; delivered and delayed are accepted, an unknown status is not", async () => {
    const pg = await boot();
    await apply(pg);
    expect(await hasColumn(pg)).toBe(true);
    expect(await rows(pg, "SELECT 1 FROM pg_indexes WHERE indexname = 'idx_email_send_log_provider_message'")).toHaveLength(1);
    for (const s of ["delivered", "delayed", "rate_limited", "pending"]) {
      await pg.query("INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, provider_message_id) VALUES ($1, 't', 'a@example.com', $2, 're_1')", [`m-${s}`, s]);
    }
    await expect(pg.query("INSERT INTO public.email_send_log (template_name, recipient_email, status) VALUES ('t', 'a@example.com', 'bogus')")).rejects.toThrow(/email_send_log_status_check/);
    await expect(pg.query("INSERT INTO public.email_send_log (template_name, recipient_email, status, provider_message_id) VALUES ('t', 'a@example.com', 'sent', repeat('x', 201))")).rejects.toThrow(/provider_message_id_len/);
  });

  it("a drifted live constraint under another name is found by its column, replaced, and its extra value kept", async () => {
    const pg = await boot({
      seed: `ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;`,
    });
    await pg.exec(`ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
      ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check1 CHECK (status IN ('pending', 'sent', 'queued'));`);
    await apply(pg);
    const defs = await statusDef(pg);
    expect(defs).toHaveLength(1);
    for (const s of ["queued", "delivered", "delayed", "rate_limited"]) expect(defs[0]).toContain(`'${s}'`);
  });

  it("an earlier version of this file's own job is replaced by this command", async () => {
    const old = "DO $d$ BEGIN PERFORM 1; END $d$; -- rb-auth-mail-drain 20261014100000 (an older command with no bearer)";
    const pg = await boot({ seed: `SELECT cron.schedule('rb-auth-mail-drain', '10 seconds', $c$${old}$c$);` });
    await apply(pg);
    const j = await job(pg);
    expect(j.command).toContain("'Authorization', 'Bearer ' || v_bearer");
    expect(j.command).toContain('"cronKey":true');
  });

  it("a job of our name that this file did not write is not replaced", async () => {
    const pg = await boot({ seed: `SELECT cron.schedule('rb-auth-mail-drain', '1 minute', 'SELECT 1');` });
    await expect(apply(pg)).rejects.toThrow(/a job named rb-auth-mail-drain exists that this file did not write/);
    expect(await job(pg)).toEqual({ schedule: "1 minute", command: "SELECT 1" });
  });

  it("runs twice: one status CHECK, one job, the same command", async () => {
    const pg = await boot();
    await apply(pg);
    const first = await job(pg);
    await apply(pg);
    expect(await statusDef(pg)).toHaveLength(1);
    expect(await job(pg)).toEqual(first);
    expect(await rows(pg, "SELECT 1 FROM cron.job WHERE jobname = $1", [JOB])).toHaveLength(1);
  });

  it("creates no function and no table", async () => {
    const sql = migration(FILE).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});
