// @vitest-environment node
/**
 * MAIL-WATCH RINGS WHEN A MAIL CLASS STOPS (critical-path plan, CP-I: CP-013,
 * CP-021, CP-052, CP-003).
 *
 * Nothing alarmed when mail stopped leaving. The new mail-watch function runs
 * every 15 minutes (20261011142000) and checks nine rules; each says ok,
 * alarm or unknown, an alarm mails the owner once per rule per six hours, and
 * healthchecks.io is pinged every run (its /fail on an alarm). R7's canaries
 * go out through R1's shared sender (its log row is what the next run judges)
 * and through auth's sign-in code for the canary account. Run here as it
 * ships, against Postgres (pglite) with the live mail_door_take, Resend, the
 * auth client and DNS-over-HTTPS faked, and the two cron readers fed from
 * fixtures (pglite has no pg_cron and no pg_net).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { liveDefinitionOf } from "./helpers/live-sql";
import { PgSupabase } from "./helpers/pglite-supabase";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVICE = "service_mail_watch_key_0123456789abcdef0123456789";
const CRON_KEY = "cron-key-0123456789abcdef0123456789abcdef";
const CANARY = "canary@example.com";
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon_harness", RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com", OWNER_NOTIFY_EMAIL: "owner@example.com", HC_PING_URL: "https://hc-ping.com/abc-123", CANARY_EMAIL: CANARY,
};

let db: PGlite;
let client: PgSupabase;
let watch: EdgeHandler;
const ownerMails: Array<{ from: string; to: string[]; subject: string }> = [];
/** Everything Resend was asked to send, less the canary itself. */
const alerts = () => ownerMails.filter((m) => !/mail canary/i.test(m.subject));
const canaryMails = () => ownerMails.filter((m) => /mail canary/i.test(m.subject));
const pings: string[] = [];
let ownerStatus = 200;
let dns: Record<string, string[] | null> = {};
const otpRequests: string[] = [];
let otpAnswer: { error: { message: string } | null } = { error: null };

const GOOD_DNS = {
  "send.resumebooster.work": ['"v=spf1 include:amazonses.com ~all"'],
  "resend._domainkey.resumebooster.work": ['"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ"'],
  "_dmarc.resumebooster.work": ['"v=DMARC1; p=quarantine; adkim=r; aspf=r"'],
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.email_send_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id text, template_name text, recipient_email text,
      status text, error_message text, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now(), provider_message_id text);
    CREATE TABLE public.email_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
      email_type text NOT NULL, recipient text NOT NULL, subject text, status text NOT NULL DEFAULT 'pending', error_message text, metadata jsonb);
    CREATE TABLE public.product_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
      stripe_session_id text NOT NULL, product_type text NOT NULL, status text NOT NULL DEFAULT 'payment_received', email_sent_at timestamptz,
      email_success boolean, generation_error text);
    CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz);
    CREATE TABLE public.mail_door_counts (door text NOT NULL, bucket text NOT NULL, window_start timestamptz NOT NULL DEFAULT now(),
      hits integer NOT NULL DEFAULT 1, PRIMARY KEY (door, bucket));
    CREATE TABLE public.suppressed_emails (email text PRIMARY KEY, reason text, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.cron_fixture (jobname text, active boolean, last_start timestamptz);
    CREATE TABLE public.http_fixture (server_errors int, timed_out int);
    CREATE FUNCTION public.email_cron_key_matches(p_key text) RETURNS boolean LANGUAGE sql AS $$ SELECT p_key = '${CRON_KEY}' $$;
    CREATE FUNCTION public.get_cron_health(p_hours integer DEFAULT 24)
      RETURNS TABLE (ch_jobname text, ch_active boolean, ch_last_start timestamptz) LANGUAGE sql AS
      $$ SELECT jobname, active, last_start FROM public.cron_fixture $$;
    CREATE FUNCTION public.cron_http_refusals(p_minutes integer DEFAULT 60)
      RETURNS TABLE (available boolean, server_errors integer, timed_out integer) LANGUAGE sql AS
      $$ SELECT true, coalesce(sum(server_errors), 0)::int, coalesce(sum(timed_out), 0)::int FROM public.http_fixture $$;
  `);
  await db.exec(`CREATE OR REPLACE ${liveDefinitionOf("mail_door_take").body}\n$$;`);
  client = new PgSupabase(db);
  // The same stub answers createClient for the service role and the anon key; the anon client's auth is the sign-in canary's door.
  (client as unknown as Record<string, unknown>).auth = {
    signInWithOtp: async (p: { email: string; options?: { shouldCreateUser?: boolean } }) => {
      otpRequests.push(`${p.email}:${p.options?.shouldCreateUser === false ? "existing" : "any"}`);
      return otpAnswer;
    },
  };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__mailWatchClient = client;
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://api.resend.com/emails") {
      ownerMails.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: ownerStatus });
    }
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      const name = new URL(url).searchParams.get("name")!;
      const answer = dns[name];
      if (answer === null) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ Status: 0, Answer: (answer ?? []).map((data) => ({ data })) }), { status: 200 });
    }
    if (url.startsWith("https://hc-ping.com/")) { pings.push(url); return new Response("OK", { status: 200 }); }
    throw new Error(`unexpected network call: ${url}`);
  };
  watch = await loadEdgeHandler("mail-watch", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__mailWatchClient;",
  });
}, 180_000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec("TRUNCATE public.email_send_log, public.email_logs, public.product_deliveries, public.job_board_meta, public.mail_door_counts, public.cron_fixture, public.http_fixture, public.suppressed_emails");
  await db.exec("INSERT INTO public.cron_fixture VALUES ('scan-heartbeat-sentinel', true, now() - interval '5 minutes')");
  ownerMails.length = 0;
  pings.length = 0;
  ownerStatus = 200;
  dns = { ...GOOD_DNS };
  otpRequests.length = 0;
  otpAnswer = { error: null };
  env.CANARY_EMAIL = CANARY;
});

const run = async (headers: Record<string, string> = { "x-email-cron": CRON_KEY }) => {
  const res = await watch(new Request("https://harness.supabase.co/functions/v1/mail-watch", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }));
  return { status: res.status, build: res.headers.get("x-fn-build"), json: await res.json() as { rules: Array<{ id: string; state: string; detail: string }>; alarms: string[]; alerted: string[]; pinged: boolean | null } };
};
const stateOf = (r: Awaited<ReturnType<typeof run>>, id: string) => r.json.rules.find((x) => x.id === id)?.state;

describe("who may run it", () => {
  it("answers the cron key and the service role, and nobody else", async () => {
    expect((await run({})).status).toBe(401);
    expect((await run({ "x-email-cron": "w".repeat(40) })).status).toBe(401);
    expect((await run({ authorization: "Bearer anon_key" })).status).toBe(401);
    expect((await run({ authorization: `Bearer ${SERVICE}` })).status).toBe(200);
    const ok = await run();
    expect(ok.status).toBe(200);
    expect(ok.build).toMatch(/^mail-watch\.2026-10-11\.\d+$/);
  });
});

describe("a quiet, healthy day", () => {
  it("every rule is ok, the owner is mailed nothing, healthchecks.io is pinged, and the stamp carries states only", async () => {
    await db.exec("INSERT INTO public.email_logs (email_type, recipient, status) VALUES ('product_full_analysis', 'buyer@example.com', 'sent')");
    await db.exec("INSERT INTO public.product_deliveries (stripe_session_id, product_type, status) VALUES ('cs_live_x', 'full_analysis', 'payment_received')");
    const r = await run();
    expect(r.json.rules.map((x) => [x.id, x.state])).toEqual([["R1", "ok"], ["R2", "ok"], ["R3", "ok"], ["R4", "ok"], ["R5", "ok"], ["R6", "ok"], ["R7", "ok"], ["R8", "ok"], ["R9", "ok"]]);
    expect(alerts()).toEqual([]);
    expect(pings).toEqual(["https://hc-ping.com/abc-123"]);
    const stamp = (await db.query<{ v: Record<string, unknown> }>("SELECT v FROM public.job_board_meta WHERE k = 'mail_watch_run'")).rows[0].v;
    expect(stamp).toMatchObject({ alarms: 0, build: r.build });
    expect(JSON.stringify(stamp), "the anon-readable stamp carries an address").not.toMatch(/@/);
  });
});

describe("each rule rings for what it watches", () => {
  it("R1: a purchase mail refused three times in an hour rings once, and not again within six hours", async () => {
    for (let i = 0; i < 3; i++) await db.exec("INSERT INTO public.email_logs (email_type, recipient, status, error_message) VALUES ('product_full_analysis', 'b@example.com', 'failed', 'domain not verified')");
    const first = await run();
    expect(stateOf(first, "R1")).toBe("alarm");
    expect(first.json.alerted).toContain("R1");
    expect(ownerMails.filter((m) => /Mail watch R1/.test(m.subject))).toHaveLength(1);
    expect(alerts()[0].from).toContain("@resumebooster.work");
    expect(pings.at(-1)).toBe("https://hc-ping.com/abc-123/fail");
    await run();
    expect(ownerMails.filter((m) => /Mail watch R1/.test(m.subject)), "the owner was mailed every 15 minutes").toHaveLength(1);
  });

  it("R2: paid orders with not one purchase mail sent ring", async () => {
    await db.exec("INSERT INTO public.product_deliveries (stripe_session_id, product_type) VALUES ('cs_live_a', 'full_analysis'), ('cs_live_b', 'freelance_boost')");
    expect(stateOf(await run(), "R2")).toBe("alarm");
  });

  it("R2 counts no subscription and no retired sale as an order owed a mail", async () => {
    await db.exec("INSERT INTO public.product_deliveries (stripe_session_id, product_type, generation_error) VALUES ('cs_live_p', 'pro_subscription', null), ('cs_live_r', 'apply_assistant', 'undeliverable_retired: x')");
    expect(stateOf(await run(), "R2")).toBe("ok");
  });

  it("R4: a message the sign-in drain gave up on rings", async () => {
    await db.exec("INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, error_message) VALUES ('m9', 'auth_emails', 'x@example.com', 'dlq', 'gave up after 5 tries')");
    const r = await run();
    expect(stateOf(r, "R4")).toBe("alarm");
    expect(r.json.rules.find((x) => x.id === "R4")?.detail).toMatch(/auth_emails/);
  });

  it("R3: a send pending for over two minutes with nothing after it rings; one that was settled does not", async () => {
    await db.exec("INSERT INTO public.email_send_log (message_id, template_name, status, created_at) VALUES ('m1', 'magiclink', 'pending', now() - interval '5 minutes')");
    expect(stateOf(await run(), "R3")).toBe("alarm");
    await db.exec("INSERT INTO public.email_send_log (message_id, template_name, status) VALUES ('m1', 'magiclink', 'sent')");
    expect(stateOf(await run(), "R3")).toBe("ok");
  });

  it("R5: three bounces against few sends ring", async () => {
    await db.exec("INSERT INTO public.email_send_log (message_id, status) SELECT 's' || g, 'sent' FROM generate_series(1, 10) g");
    await db.exec("INSERT INTO public.email_send_log (message_id, status) VALUES ('b1', 'bounced'), ('b2', 'bounced'), ('b3', 'complained')");
    expect(stateOf(await run(), "R5")).toBe("alarm");
  });

  it("R6: an SPF that no longer names Amazon SES rings; a lookup that failed is unknown, never ok", async () => {
    dns["send.resumebooster.work"] = ['"v=spf1 include:dc-fd741b8612._spfm.send.resumebooster.work ~all"'];
    const drift = await run();
    expect(stateOf(drift, "R6")).toBe("alarm");
    expect(drift.json.rules.find((x) => x.id === "R6")?.detail).toMatch(/amazonses/);
    dns["send.resumebooster.work"] = null;
    expect(stateOf(await run(), "R6")).toBe("unknown");
  });

  it("R7: the first run sends the canary and asks for the sign-in code; a run minutes later finds both and is ok; a day later it sends again", async () => {
    const first = await run();
    expect(stateOf(first, "R7")).toBe("ok");
    expect(canaryMails().map((m) => [m.from, m.to])).toEqual([["Resume Booster Alerts <alerts@resumebooster.work>", [CANARY]]]);
    expect(otpRequests).toEqual([`${CANARY}:existing`]);
    const logged = (await db.query<{ template_name: string; recipient_email: string; status: string }>(
      "SELECT template_name, recipient_email, status FROM public.email_send_log")).rows;
    expect(logged).toEqual([{ template_name: "canary-transactional", recipient_email: CANARY, status: "sent" }]);
    const stamp = (await db.query<{ v: Record<string, unknown> }>("SELECT v FROM public.job_board_meta WHERE k = 'mail_watch_canary'")).rows[0].v;
    expect(JSON.stringify(stamp), "the canary stamp carries an address").not.toMatch(/@/);

    const second = await run();
    expect(stateOf(second, "R7")).toBe("ok");
    expect(canaryMails(), "the canary was sent again within the day").toHaveLength(1);
    expect(otpRequests, "the sign-in code was asked for again within the day").toHaveLength(1);

    await db.exec("UPDATE public.job_board_meta SET v = jsonb_build_object('mail_sent_at', (now() - interval '25 hours')::text, 'auth_requested_at', (now() - interval '25 hours')::text) WHERE k = 'mail_watch_canary'");
    await db.exec("INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, created_at) VALUES ('a1', 'auth_emails', $$" + CANARY + "$$, 'sent', now() - interval '24 hours')");
    const third = await run();
    expect(stateOf(third, "R7")).toBe("ok");
    expect(canaryMails()).toHaveLength(2);
    expect(otpRequests).toHaveLength(2);
  });

  it("R7: a sign-in code whose mail never left in ten minutes rings; one that was logged sent does not", async () => {
    await run();
    await db.exec("UPDATE public.job_board_meta SET v = jsonb_build_object('mail_sent_at', (now() - interval '11 minutes')::text, 'auth_requested_at', (now() - interval '11 minutes')::text) WHERE k = 'mail_watch_canary'");
    const late = await run();
    expect(stateOf(late, "R7")).toBe("alarm");
    expect(late.json.rules.find((x) => x.id === "R7")?.detail).toMatch(/sign-in canary requested 11 minutes ago has no sent mail/);
    expect(otpRequests, "the code was asked for again instead of judged").toHaveLength(1);
    await db.exec("INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, created_at) VALUES ('a2', 'auth_emails', $$" + CANARY + "$$, 'sent', now() - interval '9 minutes')");
    expect(stateOf(await run(), "R7")).toBe("ok");
  });

  it("R7: a canary Resend refused rings, and a canary whose log row reads failed rings on the next run", async () => {
    ownerStatus = 503;
    const refused = await run();
    expect(stateOf(refused, "R7")).toBe("alarm");
    expect(refused.json.rules.find((x) => x.id === "R7")?.detail).toMatch(/transactional canary was refused/);
    ownerStatus = 200;
    await db.exec("TRUNCATE public.job_board_meta, public.email_send_log");
    await run();
    await db.exec("UPDATE public.email_send_log SET status = 'failed' WHERE template_name = 'canary-transactional'");
    const next = await run();
    expect(stateOf(next, "R7")).toBe("alarm");
    expect(next.json.rules.find((x) => x.id === "R7")?.detail).toMatch(/transactional canary is failed/);
  });

  it("R7: without CANARY_EMAIL nothing is sent and the rule is unknown; a sign-in code that could not be requested is unknown, never ok", async () => {
    delete env.CANARY_EMAIL;
    const none = await run();
    expect(stateOf(none, "R7")).toBe("unknown");
    expect(canaryMails()).toEqual([]);
    expect(otpRequests).toEqual([]);
    env.CANARY_EMAIL = CANARY;
    otpAnswer = { error: { message: "Signups not allowed for otp" } };
    const noAccount = await run();
    expect(stateOf(noAccount, "R7")).toBe("unknown");
    expect(noAccount.json.rules.find((x) => x.id === "R7")?.detail).toMatch(/canary account must exist/);
    expect(noAccount.json.alerted).not.toContain("R7");
  });

  it("R8: an order delivered an hour ago whose mail never left rings", async () => {
    await db.exec("INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at) VALUES ('cs_live_d', 'cover_letter', 'delivered', now() - interval '1 hour')");
    await db.exec("INSERT INTO public.email_logs (email_type, recipient, status) VALUES ('product_cover_letter', 'x@example.com', 'sent')");
    expect(stateOf(await run(), "R8")).toBe("alarm");
  });

  it("R9: a heartbeat cron that stopped, or crons answered 5xx, ring", async () => {
    await db.exec("UPDATE public.cron_fixture SET last_start = now() - interval '2 hours'");
    expect(stateOf(await run(), "R9")).toBe("alarm");
    await db.exec("UPDATE public.cron_fixture SET last_start = now()");
    await db.exec("INSERT INTO public.http_fixture VALUES (2, 1)");
    const r = await run();
    expect(stateOf(r, "R9")).toBe("alarm");
    expect(r.json.rules.find((x) => x.id === "R9")?.detail).toMatch(/3 cron call/);
  });
});

describe("its schedule (20261011142000)", () => {
  it("schedules one active job, safe twice, posting with the vault's key and writing no key into the job", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dir = resolve(__dirname, "../../supabase/migrations");
    const sql = readFileSync(resolve(dir, readdirSync(dir).find((f) => f.startsWith("20261011142000_"))!), "utf8");
    const pg = new PGlite();
    // pg_cron's surface, as the migration uses it.
    await pg.exec(`
      CREATE SCHEMA cron;
      CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
      CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
        $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid::bigint $$;
      CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS
        $$ DELETE FROM cron.job WHERE jobname = p_name RETURNING true $$;
    `);
    await pg.exec(sql);
    await pg.exec(sql);
    const { rows } = await pg.query<{ schedule: string; command: string; active: boolean }>("SELECT schedule, command, active FROM cron.job WHERE jobname = 'mail-watch'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ schedule: "*/15 * * * *", active: true });
    expect(rows[0].command).toContain("/functions/v1/mail-watch");
    expect(rows[0].command).toContain("'email_cron_key'");
    expect(rows[0].command).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    await pg.close();
  });
});

describe("the owner's mail", () => {
  it("an alarm both senders refused gives its door back, so the next run mails it", async () => {
    // Only R2 rings here: with no CANARY_EMAIL the refused Resend does not also ring R7.
    delete env.CANARY_EMAIL;
    ownerStatus = 503;
    await db.exec("INSERT INTO public.product_deliveries (stripe_session_id, product_type) VALUES ('cs_live_a', 'full_analysis')");
    const r = await run();
    expect(r.json.alerted).toEqual([]);
    expect(alerts().map((m) => m.from)).toEqual(["Resume Booster Alerts <alerts@resumebooster.work>", "Resume Booster Alerts <onboarding@resend.dev>"]);
    expect((await db.query("SELECT 1 FROM public.mail_door_counts WHERE door = 'owner-alert:mail-watch'")).rows).toHaveLength(0);
    ownerStatus = 200;
    expect((await run()).json.alerted).toEqual(["R2"]);
  });
});
