// @vitest-environment node
/**
 * A PULSE GOES ONLY TO AN ADDRESS THAT CLICKED.
 *
 * WHAT WAS WRONG (defect sweep 2026-10-02, 1.59 and 2.23).
 *   - The "monthly market pulse" box under a scan report was pre-ticked (and
 *     the compact capture, which shows no box, sent it ticked), any third party
 *     could enrol any address, and the pulse then said "You asked for market
 *     updates". Pre-ticked boxes are not consent.
 *   - POST {action:"send"} answered anyone, never read suppressed_emails, and
 *     throttled with a read-then-write: N concurrent posts mailed every due
 *     subscriber N times from our verified domain.
 *
 * WHAT HOLDS NOW, proved two ways:
 *   1. The SQL (migration 20261004100000) is APPLIED to pglite over the tables
 *      it meets in production, and its functions are called: a request records
 *      at most one confirmation mail per address per week and three in any 90
 *      days (a window, so a stranger's three requests cannot shut the address
 *      out for good), a suppressed address gets none, a busy day serves only
 *      networks that have not asked yet and a full one serves nobody,
 *      confirmation is single-use, and the claim returns confirmed,
 *      unsuppressed, due rows only -- stamped in the same statement, so a
 *      second claim gets nothing. Rows from before the file stay unconfirmed
 *      and are never claimed. The file's self-check refuses a copy whose claim
 *      would mail an unconfirmed or suppressed row, or whose tables a client
 *      role could write.
 *   2. The shipped send-market-pulse handler is RUN with Resend and the
 *      database faked: the batch refuses every caller without the cron key or
 *      the service role, the confirmation goes only to the address given with
 *      a link whose token hash is what was stored, and the answer is the same
 *      whatever that address's state.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { MAIL_DOOR_VERIFY, bootMailDoorDb, h64, rows } from "./helpers/mail-door-db";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ── 1. the SQL ───────────────────────────────────────────────────────────────

type Db = PGlite;
const request = (db: Db, email: string, token: string, net: string | null = "net-a") =>
  rows<{ pc_send: boolean; pc_reason: string }>(db, "SELECT * FROM public.market_pulse_request_confirm($1, 'technology', 70, $2, $3)", [email, token, net]).then((r) => r[0]);
const confirm = (db: Db, token: string) =>
  rows<{ cf_confirmed: boolean; cf_reason: string }>(db, "SELECT * FROM public.market_pulse_confirm($1)", [token]).then((r) => r[0]);
const claim = (db: Db) =>
  rows<{ cl_email: string; cl_prev_sent_at: string | null }>(db, "SELECT * FROM public.market_pulse_claim_batch(200)");
const age = (db: Db, email: string, col: string, days: number) =>
  db.query(`UPDATE public.market_pulse_subscribers SET ${col} = now() - interval '${days} days' WHERE email = $1`, [email]);

// ONE database for the SQL half (a pglite boot costs seconds), every test in
// its own transaction, rolled back after it: no test sees another's rows.
// The two rows seeded here exist BEFORE the migration runs, as today's
// subscribers do.
let pg: Db;
const SEED = "INSERT INTO public.market_pulse_subscribers (email, industry) VALUES ('ticked@example.com', 'technology'), ('typed-by-a-stranger@example.com', 'finance');";

describe("the SQL, applied to the tables it meets", () => {
  beforeAll(async () => { pg = await bootMailDoorDb({ cron: true, seed: SEED }); }, 120_000);
  beforeEach(async () => { await pg.exec("BEGIN"); });
  afterEach(async () => { await pg.exec("ROLLBACK"); });

describe("the pulse list holds only people who confirmed", () => {
  it("every row from before the migration stays unconfirmed and is never claimed", async () => {
    const db = pg;
    expect(await rows(db, "SELECT email FROM public.market_pulse_subscribers WHERE confirmed_at IS NOT NULL")).toEqual([]);
    expect(await claim(db)).toEqual([]);
  });

  it("a request records a confirmation mail at most once a week, and three times in 90 days while unconfirmed", async () => {
    const db = pg;
    expect(await request(db, " Jane@Example.com ", h64("a"))).toEqual({ pc_send: true, pc_reason: "sent" });
    expect(await request(db, "jane@example.com", h64("b"))).toEqual({ pc_send: false, pc_reason: "recently_sent" });
    await age(db, "jane@example.com", "confirm_sent_at", 8);
    expect((await request(db, "jane@example.com", h64("c"))).pc_send).toBe(true);
    await age(db, "jane@example.com", "confirm_sent_at", 8);
    expect((await request(db, "jane@example.com", h64("d"))).pc_send).toBe(true);
    await age(db, "jane@example.com", "confirm_sent_at", 8);
    expect(await request(db, "jane@example.com", h64("e")), "a fourth unconfirmed mail to the same address").toEqual({ pc_send: false, pc_reason: "recently_sent" });
    // Requests never subscribe anyone.
    expect(await claim(db)).toEqual([]);
  });

  it("three requests from a stranger cannot stop the address's owner from ever subscribing: the cap is a 90-day window", async () => {
    const db = pg;
    for (const t of ["a", "b", "c"]) {
      expect((await request(db, "owner@example.com", h64(t), "net-stranger")).pc_send, t).toBe(true);
      await age(db, "owner@example.com", "confirm_sent_at", 8);
    }
    expect((await request(db, "owner@example.com", h64("d"), "net-owner")).pc_send, "inside the window the cap holds").toBe(false);
    await age(db, "owner@example.com", "confirm_window_start", 91);
    expect(await request(db, "owner@example.com", h64("e"), "net-owner"), "once the window has passed, the owner's own request is mailed").toEqual({ pc_send: true, pc_reason: "sent" });
    expect((await confirm(db, h64("e"))).cf_confirmed).toBe(true);
  });

  it("a suppressed address (bounce, complaint, or an unsubscribe) is never sent a confirmation", async () => {
    const db = pg;
    await db.query("INSERT INTO public.suppressed_emails (email, reason) VALUES ('Gone@Example.com', 'unsubscribe')");
    expect(await request(db, "gone@example.com", h64("a"))).toEqual({ pc_send: false, pc_reason: "suppressed" });
  });

  it("an address already confirmed is not mailed again; one that unsubscribed may ask again", async () => {
    const db = pg;
    await request(db, "on@example.com", h64("a"));
    expect((await confirm(db, h64("a"))).cf_confirmed).toBe(true);
    await age(db, "on@example.com", "confirm_sent_at", 30);
    expect(await request(db, "on@example.com", h64("b"))).toEqual({ pc_send: false, pc_reason: "already_confirmed" });
    await db.query("UPDATE public.market_pulse_subscribers SET unsubscribed_at = now() WHERE email = 'on@example.com'");
    expect((await request(db, "on@example.com", h64("c"))).pc_send).toBe(true);
  });

  it("a confirmation restarts the unconfirmed-mail count, so a person who left can ask again", async () => {
    const db = pg;
    await request(db, "back@example.com", h64("a"));
    expect((await confirm(db, h64("a"))).cf_confirmed).toBe(true);
    expect((await rows<{ confirm_sends: number }>(db, "SELECT confirm_sends FROM public.market_pulse_subscribers WHERE email = 'back@example.com'"))[0].confirm_sends).toBe(0);
    await db.query("UPDATE public.market_pulse_subscribers SET unsubscribed_at = now() WHERE email = 'back@example.com'");
    for (const t of ["b", "c", "d"]) {
      await age(db, "back@example.com", "confirm_sent_at", 8);
      expect((await request(db, "back@example.com", h64(t))).pc_send, t).toBe(true);
    }
    await age(db, "back@example.com", "confirm_sent_at", 8);
    expect((await request(db, "back@example.com", h64("e"))).pc_send, "a fourth unconfirmed mail").toBe(false);
  });

  it("confirmation is single-use, expires after seven days, and a wrong token confirms nothing", async () => {
    const db = pg;
    await request(db, "a@example.com", h64("a"));
    expect((await confirm(db, h64("f"))).cf_confirmed).toBe(false);
    expect((await confirm(db, h64("a"))).cf_confirmed).toBe(true);
    expect((await confirm(db, h64("a"))).cf_confirmed, "the same link confirmed twice").toBe(false);
    await request(db, "b@example.com", h64("b"));
    await age(db, "b@example.com", "confirm_sent_at", 8);
    expect((await confirm(db, h64("b"))).cf_confirmed, "an expired link confirmed").toBe(false);
  });

  it("the claim takes confirmed, unsuppressed, due rows, stamps them in the same statement, and a second claim gets nothing", async () => {
    const db = pg;
    for (const [e, t] of [["due@example.com", "a"], ["suppressed@example.com", "b"], ["recent@example.com", "c"], ["left@example.com", "d"]] as const) {
      await request(db, e, h64(t));
      await confirm(db, h64(t));
    }
    await db.query("INSERT INTO public.suppressed_emails (email, reason) VALUES ('SUPPRESSED@example.com', 'complaint')");
    await age(db, "recent@example.com", "last_sent_at", 3);
    await age(db, "due@example.com", "last_sent_at", 29);
    await db.query("UPDATE public.market_pulse_subscribers SET unsubscribed_at = now() WHERE email = 'left@example.com'");
    const first = await claim(db);
    expect(first.map((r) => r.cl_email)).toEqual(["due@example.com"]);
    expect(first[0].cl_prev_sent_at, "the claim must hand back the previous stamp so a failed send can release it").not.toBeNull();
    expect(await claim(db), "a second trigger in the same window mailed the same subscriber").toEqual([]);
  });

  it("past 100 a day only a network that has not asked today is served; at 400 nobody is", async () => {
    const db = pg;
    await db.query(`INSERT INTO public.market_pulse_subscribers (email, confirm_sent_at, confirm_sends, confirm_window_start, confirm_net)
                    SELECT 'bulk' || g || '@example.com', now(), 1, now(), 'net-flood-' || (g % 20) FROM generate_series(1, 100) g`);
    expect(await request(db, "next@example.com", h64("a"), "net-flood-3"), "a network that already asked today").toEqual({ pc_send: false, pc_reason: "shed" });
    expect(await request(db, "real@example.com", h64("b"), "net-fresh"), "a network that has not").toEqual({ pc_send: true, pc_reason: "sent" });
    expect(await request(db, "again@example.com", h64("c"), "net-fresh"), "and only its first request").toEqual({ pc_send: false, pc_reason: "shed" });
    expect((await request(db, "nonet@example.com", h64("d"), null)).pc_reason, "an unnamed network is not a fresh one").toBe("shed");
    await db.query("INSERT INTO public.suppressed_emails (email, reason) VALUES ('quiet@example.com', 'unsubscribe')");
    expect((await request(db, "quiet@example.com", h64("f"), "net-flood-3")).pc_reason, "a suppressed address from a shed network is shed like any other").toBe("shed");
    await db.query(`INSERT INTO public.market_pulse_subscribers (email, confirm_sent_at, confirm_sends, confirm_window_start, confirm_net)
                    SELECT 'more' || g || '@example.com', now(), 1, now(), 'net-wide-' || g FROM generate_series(1, 300) g`);
    expect(await request(db, "late@example.com", h64("e"), "net-another-fresh")).toEqual({ pc_send: false, pc_reason: "paused" });
  });

  it("no client role can execute any of it, and the tables are closed to them by name", async () => {
    const db = pg;
    const r = await rows<{ fn: string; anon: boolean; auth: boolean; svc: boolean }>(db, `
      SELECT f AS fn, has_function_privilege('anon', f, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', f, 'EXECUTE') AS auth,
             has_function_privilege('service_role', f, 'EXECUTE') AS svc
        FROM unnest(ARRAY['public.market_pulse_request_confirm(text,text,integer,text,text)', 'public.market_pulse_confirm(text)',
                          'public.market_pulse_claim_batch(integer)', 'public.email_cron_key_matches(text)']) f`);
    for (const x of r) expect(x, x.fn).toMatchObject({ anon: false, auth: false, svc: true });
    const t = await rows<{ sel: boolean }>(db, "SELECT has_table_privilege('anon', 'public.market_pulse_subscribers', 'SELECT') AS sel");
    expect(t[0].sel).toBe(false);
  });
});

describe("the schedule carries the cron key, and the self-check refuses a copy that does not", () => {
  it("the job is the same minute it always ran, with x-email-cron read from the vault", async () => {
    const db = pg;
    const j = await rows<{ schedule: string; command: string }>(db, "SELECT schedule, command FROM cron.job WHERE jobname = 'send-market-pulse'");
    expect(j).toHaveLength(1);
    expect(j[0].schedule).toBe("47 15 * * *");
    expect(j[0].command).toMatch(/'x-email-cron', \(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name = 'email_cron_key'/);
    expect(j[0].command).toMatch(/WHERE EXISTS \(SELECT 1 FROM vault\.decrypted_secrets WHERE name = 'email_cron_key'\)/);
  });

  it("a command the staged runner edited back to no header fails the self-check", async () => {
    const db = pg;
    await db.query("UPDATE cron.job SET command = 'SELECT net.http_post(url := ''x'')' WHERE jobname = 'send-market-pulse'");
    await expect(db.exec(MAIL_DOOR_VERIFY)).rejects.toThrow(/does not carry the email cron key/);
  });

  it("a claim rewritten to mail unconfirmed rows fails the self-check, by behaviour rather than by catalogue", async () => {
    const db = pg;
    await db.exec(`CREATE OR REPLACE FUNCTION public.market_pulse_claim_batch(p_limit integer)
      RETURNS TABLE (cl_email text, cl_industry text, cl_last_score integer, cl_confirmed_at timestamptz, cl_prev_sent_at timestamptz)
      LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $f$
        UPDATE public.market_pulse_subscribers m SET last_sent_at = now()
         WHERE m.unsubscribed_at IS NULL
        RETURNING m.email, m.industry, m.last_score, m.confirmed_at, NULL::timestamptz $f$;
      REVOKE ALL ON FUNCTION public.market_pulse_claim_batch(integer) FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.market_pulse_claim_batch(integer) TO service_role;`);
    await expect(db.exec(MAIL_DOOR_VERIFY)).rejects.toThrow(/market_pulse_claim_batch claimed \[.*unconfirmed/);
  });

  it("so does a claim that forgot suppressed_emails", async () => {
    const db = pg;
    await db.exec(`CREATE OR REPLACE FUNCTION public.market_pulse_claim_batch(p_limit integer)
      RETURNS TABLE (cl_email text, cl_industry text, cl_last_score integer, cl_confirmed_at timestamptz, cl_prev_sent_at timestamptz)
      LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $f$
        UPDATE public.market_pulse_subscribers m SET last_sent_at = now()
         WHERE m.confirmed_at IS NOT NULL AND m.unsubscribed_at IS NULL
        RETURNING m.email, m.industry, m.last_score, m.confirmed_at, NULL::timestamptz $f$;`);
    await expect(db.exec(MAIL_DOOR_VERIFY)).rejects.toThrow(/claimed \[.*suppressed/);
  });

  it("the behavioural probe leaves nothing behind: no probe row, no suppression, no real row stamped", async () => {
    const db = pg;
    await request(db, "real-due@example.com", h64("a"));
    await confirm(db, h64("a"));
    await expect(db.exec(MAIL_DOOR_VERIFY)).resolves.toBeTruthy();
    expect(await rows(db, "SELECT email FROM public.market_pulse_subscribers WHERE email LIKE '%self-check%'")).toEqual([]);
    expect(await rows(db, "SELECT email FROM public.suppressed_emails WHERE email LIKE '%self-check%'")).toEqual([]);
    expect(await rows(db, "SELECT last_sent_at FROM public.market_pulse_subscribers WHERE email = 'real-due@example.com'"), "the probe's claim stamped a real subscriber").toEqual([{ last_sent_at: null }]);
  });

  it("a write grant a later edit gave a client role fails the self-check, not only a read grant", async () => {
    for (const [tbl, verb] of [["market_pulse_subscribers", "INSERT"], ["api_key_requests", "UPDATE"], ["mail_door_counts", "DELETE"]]) {
      await pg.exec("SAVEPOINT g");
      await pg.exec(`GRANT ${verb} ON public.${tbl} TO anon`);
      await expect(pg.exec(MAIL_DOOR_VERIFY), `${verb} on ${tbl}`).rejects.toThrow(new RegExp(`anon holds ${verb} on public\\.${tbl}`));
      await pg.exec("ROLLBACK TO SAVEPOINT g");
    }
  });

  it("and the untouched file passes its own self-check", async () => {
    await expect(pg.exec(MAIL_DOOR_VERIFY)).resolves.toBeTruthy();
  });
});
});

describe("a database without pg_cron", () => {
  it("applies the file cleanly (its own boot, so its own budget)", async () => {
    await expect(bootMailDoorDb({ cron: false })).resolves.toBeTruthy();
  }, 60_000);
});

// ── 2. the handler ───────────────────────────────────────────────────────────

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const CRON_KEY = "c".repeat(64);
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const failFor = new Set<string>();
const db = new FakeDb();
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let handler: EdgeHandler;

function rpc(name: string, impl: (a: Record<string, unknown>) => unknown) {
  db.rpcs[name] = (args) => { calls.push({ name, args }); return { data: impl(args), error: null }; };
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__pulseSent = sent;
  g.__pulseFail = failFor;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("send-market-pulse", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0":
      "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__pulseSent.push(m); return globalThis.__pulseFail.has(m.to[0]) ? { data: null, error: { message: 'bounced' } } : { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);

afterEach(() => {
  sent.length = 0; calls.length = 0; failFor.clear(); db.tables = {}; db.writes = []; db.rpcs = {};
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/send-market-pulse", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));

describe("the batch send answers the scheduler and our service role, nobody else", () => {
  const due = [
    { cl_email: "one@example.com", cl_industry: "technology", cl_last_score: 70, cl_confirmed_at: "2026-10-04T00:00:00Z", cl_prev_sent_at: null },
    { cl_email: "two@example.com", cl_industry: "finance", cl_last_score: null, cl_confirmed_at: "2026-10-04T00:00:00Z", cl_prev_sent_at: "2026-09-01T00:00:00Z" },
  ];

  it("no key, the publishable key, or a wrong cron key: 401, nothing claimed, nothing sent", async () => {
    rpc("email_cron_key_matches", (a) => a.p_key === CRON_KEY);
    rpc("market_pulse_claim_batch", () => due);
    for (const h of [{}, { authorization: "Bearer anon_publishable_key_0123456789abcdef" }, { "x-email-cron": "d".repeat(64) }, { "x-email-cron": "short" }]) {
      expect((await post({ action: "send" }, h)).status, JSON.stringify(h)).toBe(401);
    }
    expect(calls.filter((c) => c.name === "market_pulse_claim_batch")).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("the cron key or the service role claims, then mails exactly the claimed rows", async () => {
    rpc("email_cron_key_matches", (a) => a.p_key === CRON_KEY);
    rpc("market_pulse_claim_batch", () => due);
    rpc("get_user_score_trend", () => []);
    const res = await post({ action: "send" }, { "x-email-cron": CRON_KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 2, skipped: 0 });
    expect(sent.map((m) => m.to[0])).toEqual(["one@example.com", "two@example.com"]);
    // The footer states the consent record it rests on, not a claim about the scan.
    expect(sent[0].html).toMatch(/You confirmed this monthly pulse on 2026-10-04/);
    expect(sent[0].html).not.toMatch(/You asked for market updates when you emailed yourself/);
    sent.length = 0;
    expect((await post({ action: "send" }, { authorization: `Bearer ${SERVICE}` })).status).toBe(200);
    expect(sent).toHaveLength(2);
  });

  it("a row holding a stranger's industry string never puts that string in a mail", async () => {
    // A row written before 2026-10-04 could carry any industry a caller sent.
    // It is read as one of our own names or not at all: an unknown field has
    // no keyword table, so it is skipped rather than mailed.
    rpc("market_pulse_claim_batch", () => [
      { ...due[0], cl_industry: "Refund pending: call 555-0100" },
      { ...due[1], cl_industry: "finance" },
    ]);
    rpc("get_user_score_trend", () => []);
    const res = await post({ action: "send" }, { authorization: `Bearer ${SERVICE}` });
    expect(await res.json()).toMatchObject({ sent: 1, skipped: 1 });
    expect(sent.map((m) => m.subject)).toEqual(["finance postings shifted — is your resume current?"]);
    for (const m of sent) expect(m.subject + m.html).not.toMatch(/Refund pending|555-0100/);
  });

  it("a failed send gives its claim back, so it is retried rather than skipped for a month", async () => {
    rpc("market_pulse_claim_batch", () => due);
    rpc("get_user_score_trend", () => []);
    db.rows("market_pulse_subscribers").push({ email: "two@example.com", last_sent_at: "2026-10-04T15:47:00Z" });
    failFor.add("two@example.com");
    const res = await post({ action: "send" }, { authorization: `Bearer ${SERVICE}` });
    expect(await res.json()).toMatchObject({ sent: 1, skipped: 1 });
    expect(db.rows("market_pulse_subscribers")[0].last_sent_at).toBe("2026-09-01T00:00:00Z");
  });
});

describe("subscribe sends only a confirmation, only to the address given, and says the same thing whatever its state", () => {
  it("records the request with the hash of the token it mails, and mails nothing else", async () => {
    rpc("mail_door_take", () => true);
    rpc("market_pulse_request_confirm", () => ({ pc_send: true, pc_reason: "sent" }));
    const res = await post({ action: "subscribe", email: " Jane@Example.com ", industry: "data_science", score: 74 }, { "cf-connecting-ip": "203.0.113.9" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, pending: true });
    const req = calls.find((c) => c.name === "market_pulse_request_confirm")!;
    expect(req.args).toMatchObject({ p_email: "jane@example.com", p_industry: "data_science", p_score: 74 });
    const door = calls.find((c) => c.name === "mail_door_take")!;
    expect(req.args.p_net, "the request carries the same network bucket the door counted").toBe(door.args.p_bucket);
    expect(String(req.args.p_net)).toMatch(/^[0-9a-f]{32}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["jane@example.com"]);
    expect(sent[0].subject).toBe("Confirm your monthly market pulse");
    expect(sent[0].html).toMatch(/keywords data science job postings are screening for/);
    const token = /\/market-pulse\/confirm#t=([0-9a-f]{64})"/.exec(sent[0].html)?.[1];
    expect(token, "the mail carries no confirmation link").toBeTruthy();
    expect(sha(token!)).toBe(req.args.p_token_hash);
  });

  it("nothing is mailed when no confirmation is due, and the answer is identical", async () => {
    rpc("mail_door_take", () => true);
    for (const reason of ["recently_sent", "already_confirmed", "suppressed"]) {
      rpc("market_pulse_request_confirm", () => ({ pc_send: false, pc_reason: reason }));
      const res = await post({ action: "subscribe", email: "x@example.com", industry: "finance" });
      expect(res.status, reason).toBe(200);
      expect(await res.json(), reason).toEqual({ success: true, pending: true });
    }
    expect(sent).toEqual([]);
  });

  it("a busy day refuses only networks that already asked (429) and a full day everyone (503); the owner hears once, the address is never mailed", async () => {
    const owner: string[] = [];
    let alertDue = true;
    rpc("mail_door_take", (a) => {
      if (a.p_door !== "owner-alert") return true;
      const due = alertDue; alertDue = false; owner.push(String(a.p_bucket)); return due;
    });
    rpc("market_pulse_request_confirm", () => ({ pc_send: false, pc_reason: "shed" }));
    const shed = await post({ action: "subscribe", email: "a@example.com", industry: "sales" });
    expect(shed.status).toBe(429);
    expect((await shed.json()).error).toMatch(/your network today/);
    rpc("market_pulse_request_confirm", () => ({ pc_send: false, pc_reason: "paused" }));
    const paused = await post({ action: "subscribe", email: "b@example.com", industry: "sales" });
    expect(paused.status).toBe(503);
    expect(owner).toEqual(["send-market-pulse:subscribe", "send-market-pulse:subscribe"]);
    expect(sent.map((m) => m.to[0]), "only the owner's one alert went out").toEqual(["resumeboostersupp@gmail.com"]);
    expect(sent[0].subject).toMatch(/passed its soft ceiling/);
  });

  it("is limited per NETWORK, keyed on the platform's address, never on a hop the caller writes", async () => {
    rpc("mail_door_take", () => false);
    rpc("market_pulse_request_confirm", () => ({ pc_send: true }));
    const a = await post({ action: "subscribe", email: "a@example.com", industry: "sales" }, { "x-forwarded-for": "6.6.6.6, 198.51.100.7" });
    const b = await post({ action: "subscribe", email: "b@example.com", industry: "sales" }, { "x-forwarded-for": "7.7.7.7, 198.51.100.200" });
    expect([a.status, b.status]).toEqual([429, 429]);
    const buckets = calls.filter((c) => c.name === "mail_door_take").map((c) => c.args.p_bucket);
    expect(buckets[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(buckets[1], "two addresses in one /24 must share a bucket, whatever first hop they forge").toBe(buckets[0]);
    expect(calls.some((c) => c.name === "market_pulse_request_confirm"), "a limited caller still reached the request").toBe(false);
    expect(sent).toEqual([]);
  });

  it("offers no pulse for a field it has no keywords for, and a caller's industry string never reaches the mail", async () => {
    rpc("mail_door_take", () => true);
    rpc("market_pulse_request_confirm", () => ({ pc_send: true, pc_reason: "sent" }));
    for (const industry of ["<b>not-an-industry</b>", "general", undefined, "__proto__"]) {
      const res = await post({ action: "subscribe", email: "jane@example.com", industry });
      expect(res.status, String(industry)).toBe(422);
      expect((await res.json()).error).toMatch(/covers technology, finance/);
    }
    expect(calls, "a refused field still reached a counter or the request").toEqual([]);
    expect(sent).toEqual([]);
  });

  it("refuses a malformed address before anything else", async () => {
    expect((await post({ action: "subscribe", email: "not an address" })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("confirm redeems only the token that was mailed", () => {
  it("a malformed token is refused without a lookup; a real one is looked up by its hash", async () => {
    rpc("mail_door_take", () => true);
    rpc("market_pulse_confirm", () => ({ cf_confirmed: true }));
    expect((await post({ action: "confirm", token: "abc" })).status).toBe(400);
    expect(calls.some((c) => c.name === "market_pulse_confirm")).toBe(false);
    const t = "e".repeat(64);
    const res = await post({ action: "confirm", token: t });
    expect(await res.json()).toEqual({ success: true, confirmed: true });
    expect(calls.find((c) => c.name === "market_pulse_confirm")!.args).toEqual({ p_token_hash: sha(t) });
  });

  it("an expired or spent link is a 410, not a success", async () => {
    rpc("mail_door_take", () => true);
    rpc("market_pulse_confirm", () => ({ cf_confirmed: false, cf_reason: "invalid_or_expired" }));
    expect((await post({ action: "confirm", token: "e".repeat(64) })).status).toBe(410);
  });

  it("the preflight answers its build", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/send-market-pulse", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^send-market-pulse\.2026-10-04\.\d+$/);
  });
});
