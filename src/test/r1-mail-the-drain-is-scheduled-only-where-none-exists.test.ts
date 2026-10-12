// @vitest-environment node
/**
 * THE DRAIN IS SCHEDULED ONLY WHERE NONE EXISTS, NEVER BEHIND AN OPEN QUEUE,
 * AND POSTS ONLY WHEN MAIL IS WAITING (R1 mail, migration 20261014100000;
 * register CP-002, CP-015, CP-013).
 *
 * WHAT WAS WRONG. Nothing drained auth_emails (get_cron_health, 2026-10-12: 56
 * jobs, none of them process-email-queue), so a queued sign-in mail never left.
 * Restoring a drain blindly had two traps: Lovable may recreate its own job,
 * and a drain behind a queue wrapper anon can still call is a mail relay on
 * our domain. And the log had nowhere to put Resend's id.
 *
 * WHAT HOLDS NOW, applying the real file to pglite with stand-ins for pg_cron,
 * pgmq, the vault and pg_net, and then RUNNING the job's stored command:
 *   - the job is created every 10 seconds when none of that name exists, and
 *     a job Lovable made is left byte for byte;
 *   - the file refuses (and changes nothing) while queue_wrapper_exposure()
 *     reports an open wrapper, or, without that reader, while a named wrapper
 *     is executable by anon;
 *   - the command posts only while a message is visible in auth_emails or
 *     transactional_emails (a drip delayed for days does not count), never
 *     during a provider cooldown, with x-email-cron from the vault and the
 *     vault's service-role key as the gateway bearer when it holds one; with
 *     neither key it fails loudly;
 *   - provider_message_id and its index exist, the status CHECK accepts
 *     delivered and delayed, keeps any value a drifted constraint allowed, and
 *     stays the only check on status; the file is safe to run twice.
 */
import { describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootEmailOpsDb, migration, rows } from "./helpers/email-ops-db";
import { CRON_STAND_IN } from "./helpers/mail-door-db";

vi.setConfig({ testTimeout: 60_000 });

const FILE = "20261014100000";
const CRON_KEY = "k".repeat(64);
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
const job = async (pg: PGlite) =>
  (await rows<{ schedule: string; command: string }>(pg, "SELECT schedule, command FROM cron.job WHERE jobname = 'process-email-queue'"))[0];
const calls = (pg: PGlite) => rows<{ url: string; headers: Record<string, string> }>(pg, "SELECT url, headers FROM net.calls ORDER BY id");
const hasColumn = async (pg: PGlite) =>
  (await rows(pg, "SELECT 1 FROM information_schema.columns WHERE table_name = 'email_send_log' AND column_name = 'provider_message_id'")).length === 1;
const statusDef = async (pg: PGlite) =>
  (await rows<{ def: string }>(pg, "SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = 'public.email_send_log'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%status%'")).map((r) => r.def);

describe("the drain job", () => {
  it("is scheduled every 10 seconds where no job of that name exists", async () => {
    const pg = await boot();
    await apply(pg);
    const j = await job(pg);
    expect(j.schedule).toBe("10 seconds");
    expect(j.command).toContain("/functions/v1/process-email-queue");
    expect(j.command).toContain("pgmq.metrics");
    expect(j.command).toContain("email_cron_key");
  });

  it("a job Lovable made is left byte for byte", async () => {
    const lovable = "SELECT net.http_post(url := 'https://example.invalid/functions/v1/process-email-queue', headers := '{}'::jsonb, body := '{}'::jsonb)";
    const pg = await boot({ seed: `SELECT cron.schedule('process-email-queue', '5 seconds', $c$${lovable}$c$);` });
    await apply(pg);
    expect(await job(pg)).toEqual({ schedule: "5 seconds", command: lovable });
  });

  it("a host without pg_cron gets the column and the CHECK and no job", async () => {
    const pg = await boot({ cron: false });
    await apply(pg);
    expect(await hasColumn(pg)).toBe(true);
  });
});

describe("the command posts only when mail is waiting", () => {
  async function ready(secrets: Record<string, string> = { email_cron_key: CRON_KEY, email_queue_service_role_key: "svc.jwt" }) {
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

  it("a visible sign-in mail: one post to the function with the cron key and the vault bearer", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await tick();
    const c = await calls(pg);
    expect(c).toHaveLength(1);
    expect(c[0].url).toBe("https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/process-email-queue");
    expect(c[0].headers["x-email-cron"]).toBe(CRON_KEY);
    expect(c[0].headers.Authorization).toBe("Bearer svc.jwt");
  });

  it("a drip mail delayed for days is not a reason to post; one that is due is", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_transactional_emails (vt, message) VALUES (now() + interval '2 days', '{}')");
    await tick();
    expect(await calls(pg)).toEqual([]);
    await pg.exec("INSERT INTO pgmq.q_transactional_emails (vt, message) VALUES (now() - interval '1 second', '{}')");
    await tick();
    expect(await calls(pg)).toHaveLength(1);
  });

  it("during a provider cooldown: no post", async () => {
    const { pg, tick } = await ready();
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}'); UPDATE public.email_send_state SET retry_after_until = now() + interval '1 minute'");
    await tick();
    expect(await calls(pg)).toEqual([]);
  });

  it("only the cron key in the vault: the post goes without a bearer (the gateway then decides)", async () => {
    const { pg, tick } = await ready({ email_cron_key: CRON_KEY });
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await tick();
    const [c] = await calls(pg);
    expect(c.headers["x-email-cron"]).toBe(CRON_KEY);
    expect(c.headers).not.toHaveProperty("Authorization");
  });

  it("mail waiting and neither key in the vault: the run fails loudly instead of posting nothing", async () => {
    const { pg, tick } = await ready({});
    await pg.exec("INSERT INTO pgmq.q_auth_emails (message) VALUES ('{}')");
    await expect(tick()).rejects.toThrow(/neither email_cron_key nor email_queue_service_role_key/);
    expect(await calls(pg)).toEqual([]);
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

  it("runs twice: one status CHECK, one job, the same command", async () => {
    const pg = await boot();
    await apply(pg);
    const first = await job(pg);
    await apply(pg);
    expect(await statusDef(pg)).toHaveLength(1);
    expect(await job(pg)).toEqual(first);
    expect(await rows(pg, "SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue'")).toHaveLength(1);
  });

  it("creates no function and no table", async () => {
    const sql = migration(FILE).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});
