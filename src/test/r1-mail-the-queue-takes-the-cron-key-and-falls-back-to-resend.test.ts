// @vitest-environment node
/**
 * THE QUEUE TAKES THE CRON KEY, AND A SIGN-IN MAIL LOVABLE REFUSES GOES OUT
 * THROUGH RESEND (R1 mail, plan group CP-A item 3; owner decision D1).
 *
 * WHAT WAS WRONG. process-email-queue answered only a service-role bearer, so
 * the scheduler's cron key (the one every other email cron sends) could not
 * run it. And a sign-in mail Lovable refused as a sender (the 403 the dead
 * notify domain produced) went straight to the dead-letter queue: nobody got
 * their code, and nothing tried another way.
 *
 * WHAT HOLDS NOW, by running the shipped handler with Lovable, Resend (fetch)
 * and the database faked:
 *   - the gateway verifies every JWT first (verify_jwt = true, as before R1:
 *     Lovable's own dispatcher posts the vault bearer and must keep working,
 *     lead decision B of the third fixer round), and the function's own check
 *     is the second door: a JWT whose role claim is service_role (the gateway
 *     checked its signature), the service-role key itself, or the vault cron
 *     key in x-email-cron. No key, the publishable key and a wrong cron key
 *     are each refused 403 before the queue is read, the body naming the
 *     function AND whether a cron key was offered (cronKey), which is how the
 *     drain's cron tells its own refusals from another caller's;
 *   - a caller that names no queue drains sign-in mail only (R1): Lovable's
 *     dispatcher names none, and the fix-plan drip waits for CP-G; a caller
 *     that names transactional_emails gets it;
 *   - one message is sent once though two drains run: pgmq's visibility
 *     timeout hides a claimed message from the second drain, a message the
 *     first drain already sent is skipped and deleted when it comes back into
 *     view, and both providers are handed the same idempotency key;
 *   - a Lovable 403 on an auth mail ends in ONE Resend send, from
 *     account@resumebooster.work, with the payload's idempotency key and the
 *     reply address, and in no dead-letter; the send's 'sent' row carries
 *     Resend's id;
 *   - a third transient Lovable failure does the same; the first does not;
 *   - when Resend refuses too, PERMANENTLY, the refused mail dead-letters
 *     naming both; a Resend 429, 5xx or timeout leaves it on the queue for
 *     the next tick (it once dead-lettered after one hiccup), until the code
 *     inside it expires (a sign-in mail is bounded by its TTL, not the retry
 *     count);
 *   - transactional_emails keeps today's behaviour exactly.
 *
 * Lovable's "set up emails" step can regenerate this function; this file is
 * the guard that fails CI when the cron key or the fallback disappears.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const jwt = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
const FORGED_SERVICE_JWT = jwt({ role: "service_role" });
const ANON_JWT = jwt({ role: "anon" });
const SERVICE_KEY = "svc-key-that-is-long-enough-to-compare-0000";
const CRON_KEY = "c".repeat(64);

const db = new FakeDb();
const lovable: Array<Record<string, unknown>> = [];
const resend: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
const dlq: Array<Record<string, unknown>> = [];
const deleted: number[] = [];
const reads: string[] = [];
let verdict: (p: Record<string, unknown>) => { status: number; message: string } | undefined = () => undefined;
let resendAnswer: () => Response = () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
let queues: Record<string, Array<{ msg_id: number; read_ct: number; message: Record<string, unknown> }>> = {};
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_test_key", CUSTOMER_REPLY_TO: "help@example.net",
};
let handler: EdgeHandler;
const g = globalThis as Record<string, unknown>;
const defaultSend = async (p: Record<string, unknown>) => {
  lovable.push(p);
  const v = verdict(p);
  if (v) throw Object.assign(new Error(`HTTP ${v.status}: ${v.message}`), { status: v.status });
  return { success: true };
};

beforeAll(async () => {
  g.__fakeSupabase = db;
  g.__peqSend = defaultSend;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${url}`);
    resend.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body ?? "{}")) });
    return resendAnswer();
  };
  handler = await loadEdgeHandler("process-email-queue", {
    "npm:@lovable.dev/email-js": "export async function sendLovableEmail(p) { return globalThis.__peqSend(p); }",
    "npm:@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
  });
}, 60_000);

afterEach(() => {
  g.__peqSend = defaultSend;
  lovable.length = 0; resend.length = 0; dlq.length = 0; deleted.length = 0; reads.length = 0;
  db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = [];
  verdict = () => undefined;
  resendAnswer = () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
  queues = {};
});

function install() {
  db.rows("email_send_state").push({ id: 1, retry_after_until: null, batch_size: 10, send_delay_ms: 0, auth_email_ttl_minutes: 15, transactional_email_ttl_minutes: 60 });
  db.rpcs.read_email_batch = (a) => { reads.push(String(a.queue_name)); return { data: queues[String(a.queue_name)] ?? [], error: null }; };
  db.rpcs.delete_email = (a) => { deleted.push(Number(a.message_id)); return { data: true, error: null }; };
  db.rpcs.move_to_dlq = (a) => { dlq.push(a); return { data: 1, error: null }; };
  db.rpcs.email_cron_key_matches = (a) => ({ data: a.p_key === CRON_KEY, error: null });
}
const authMsg = (id: number, extra: Record<string, unknown> = {}) => ({
  msg_id: id, read_ct: 1,
  message: {
    message_id: `m-${id}`, run_id: `run-${id}`, idempotency_key: `auth:run-${id}`, to: `u${id}@example.com`,
    from: "Resume Booster <noreply@notify.resumebooster.work>", sender_domain: "notify.resumebooster.work",
    subject: "Your sign-in code", html: "<p>123456</p>", text: "123456", purpose: "transactional", label: "magiclink",
    queued_at: new Date().toISOString(), ...extra,
  },
});
const run = (headers: Record<string, string> = { authorization: `Bearer ${SERVICE_KEY}` }, body?: unknown) =>
  handler(new Request("https://harness.supabase.co/functions/v1/process-email-queue", { method: "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
const rowsFor = (id: string) => db.rows("email_send_log").filter((r) => r.message_id === id).map((r) => r.status);

describe("who may run the drain (behind the gateway's JWT check, this check is the second door)", () => {
  const refusedHere = async (res: Response, cronKey: boolean) => {
    expect(res.status).toBe(403);
    expect(await res.json(), "the refusal must name the drain and say whether a cron key was offered, or its cron cannot tell its own refusals from another caller's")
      .toEqual({ error: "Forbidden", refusedBy: "process-email-queue", cronKey });
  };

  it("no key at all is refused by the function itself, before the queue is read (live, the gateway's 401 comes first)", async () => {
    install();
    await refusedHere(await run({}), false);
    expect(reads).toEqual([]);
  });

  it("the publishable key alone is refused before the queue is read", async () => {
    install();
    queues = { auth_emails: [authMsg(1)] };
    await refusedHere(await run({ authorization: `Bearer ${ANON_JWT}` }), false);
    expect(reads, "the queue was read for a caller who holds only the publishable key").toEqual([]);
    expect(lovable).toEqual([]);
  });

  it("a JWT whose role claim is service_role runs the drain: the gateway verified its signature, so Lovable's dispatcher's vault bearer need not be byte-for-byte the function's own key", async () => {
    install();
    queues = { auth_emails: [authMsg(3)] };
    const res = await run({ authorization: `Bearer ${FORGED_SERVICE_JWT}` });
    expect(res.status).toBe(200);
    expect(lovable.map((p) => p.message_id)).toEqual(["m-3"]);
  });

  it("a wrong cron key is refused, and the refusal says a cron key was offered", async () => {
    install();
    await refusedHere(await run({ "x-email-cron": "w".repeat(64) }), true);
    expect(reads).toEqual([]);
  });

  it("the vault cron key opens it, and a caller that names no queue drains sign-in mail only (Lovable's dispatcher names none)", async () => {
    install();
    queues = { auth_emails: [authMsg(2)], transactional_emails: [authMsg(6, { label: "fix-plan-drip" })] };
    const res = await run({ "x-email-cron": CRON_KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 1 });
    expect(reads, "the fix-plan drip was drained by a caller that named no queue").toEqual(["auth_emails"]);
    expect(lovable.map((p) => p.message_id)).toEqual(["m-2"]);
  });

  it("the cron's body drains sign-in mail only: the drip waits for CP-G", async () => {
    install();
    queues = { auth_emails: [authMsg(4)], transactional_emails: [authMsg(5, { label: "fix-plan-drip" })] };
    const res = await run({ "x-email-cron": CRON_KEY, "content-type": "application/json" }, { source: "cron", queues: ["auth_emails"] });
    expect(await res.json()).toEqual({ processed: 1 });
    expect(reads).toEqual(["auth_emails"]);
    expect(lovable.map((p) => p.message_id)).toEqual(["m-4"]);
  });

  it("a caller that names transactional_emails gets it (CP-G will)", async () => {
    install();
    queues = { auth_emails: [authMsg(7)], transactional_emails: [authMsg(8, { label: "fix-plan-drip" })] };
    await run({ authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }, { queues: ["transactional_emails"] });
    expect(reads).toEqual(["transactional_emails"]);
    expect(lovable.map((p) => p.message_id)).toEqual(["m-8"]);
  });

  it("the service-role key itself still runs it", async () => {
    install();
    expect((await run()).status).toBe(200);
  });
});

describe("one message is sent once though two drains run (Lovable's dispatcher beside our cron)", () => {
  /**
   * pgmq.read (read_email_batch) hands a message to one reader and hides it
   * for `vt` seconds (FOR UPDATE SKIP LOCKED, vt = now() + vt). This stand-in
   * keeps that rule: a message whose vt is in the future is not read.
   */
  function pgmqLike(initial: Array<{ msg_id: number; message: Record<string, unknown> }>) {
    const store = initial.map((m) => ({ ...m, read_ct: 0, vt: 0 }));
    db.rpcs.read_email_batch = (a) => {
      reads.push(String(a.queue_name));
      if (a.queue_name !== "auth_emails") return { data: [], error: null };
      const now = Date.now();
      const out = store.filter((m) => m.vt <= now).slice(0, Number(a.batch_size));
      for (const m of out) { m.vt = now + Number(a.vt) * 1000; m.read_ct++; }
      return { data: out.map(({ msg_id, read_ct, message }) => ({ msg_id, read_ct, message })), error: null };
    };
    db.rpcs.delete_email = (a) => { const i = store.findIndex((m) => m.msg_id === Number(a.message_id)); if (i >= 0) store.splice(i, 1); deleted.push(Number(a.message_id)); return { data: i >= 0, error: null }; };
    return store;
  }

  it("a second drain started while the first holds the claim reads nothing; the claim is a 30-second visibility timeout", async () => {
    install();
    pgmqLike([authMsg(50)]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    g.__peqSend = async (p: Record<string, unknown>) => { lovable.push(p); await gate; return { success: true }; };
    const first = run({ "x-email-cron": CRON_KEY });
    await new Promise((r) => setTimeout(r, 20));
    const second = await run({ authorization: `Bearer ${SERVICE_KEY}` });
    expect(await second.json(), "the second drain found the message the first was sending").toEqual({ processed: 0 });
    release();
    expect(await (await first).json()).toEqual({ processed: 1 });
    expect(lovable.map((p) => p.message_id)).toEqual(["m-50"]);
    expect(reads.filter((q) => q === "auth_emails")).toHaveLength(2);
  });

  it("a message back in view after its claim lapsed, which the first drain already sent, is skipped and deleted, not sent again", async () => {
    install();
    const store = pgmqLike([authMsg(51)]);
    expect(await (await run({ "x-email-cron": CRON_KEY })).json()).toEqual({ processed: 1 });
    // The first drain sent it but its delete was lost (a crash after the send): the claim lapses.
    store.push({ msg_id: 51, message: authMsg(51).message, read_ct: 1, vt: 0 });
    expect(await (await run({ authorization: `Bearer ${SERVICE_KEY}` })).json()).toEqual({ processed: 0 });
    expect(lovable.map((p) => p.message_id), "the same message was handed to the provider twice").toEqual(["m-51"]);
    expect(deleted).toEqual([51, 51]);
  });

  it("every send hands the provider the payload's idempotency key, so even a re-send is one mail", async () => {
    install();
    pgmqLike([authMsg(52)]);
    await run({ "x-email-cron": CRON_KEY });
    expect(lovable[0].idempotency_key).toBe("auth:run-52");
    expect(lovable[0].message_id).toBe("m-52");
  });

  it("the batch read claims each message for 30 seconds", async () => {
    install();
    const vts: number[] = [];
    db.rpcs.read_email_batch = (a) => { vts.push(Number(a.vt)); return { data: [], error: null }; };
    await run({ "x-email-cron": CRON_KEY });
    expect(vts).toEqual([30]);
  });
});

describe("an auth mail Lovable refuses goes out through Resend before anything dead-letters it", () => {
  it("a 403: one Resend send with the payload's idempotency key, from account@, replies to CUSTOMER_REPLY_TO; no dead-letter", async () => {
    install();
    queues = { auth_emails: [authMsg(9)] };
    verdict = () => ({ status: 403, message: "sender domain not verified" });
    const res = await run();
    expect(await res.json()).toEqual({ processed: 1, viaResend: 1 });
    expect(lovable).toHaveLength(1);
    expect(resend).toHaveLength(1);
    const [r] = resend;
    expect(r.url).toBe("https://api.resend.com/emails");
    expect(r.headers["idempotency-key"]).toBe("auth:run-9");
    expect(r.headers.authorization).toBe("Bearer re_test_key");
    expect(r.body).toMatchObject({ from: "Resume Booster <account@resumebooster.work>", to: ["u9@example.com"], subject: "Your sign-in code", html: "<p>123456</p>", text: "123456", reply_to: "help@example.net" });
    expect(dlq, "the refused mail was dead-lettered although Resend sent it").toEqual([]);
    expect(deleted).toEqual([9]);
    expect(rowsFor("m-9")).toEqual(["failed", "sent"]);
    const sent = db.rows("email_send_log").find((r) => r.status === "sent")!;
    expect(sent.provider_message_id).toBe("re_123");
    expect(String(db.rows("email_send_log").find((r) => r.status === "failed")!.error_message)).toContain("notify.resumebooster.work");
  });

  it("a 401 sender refusal takes the same way out", async () => {
    install();
    queues = { auth_emails: [authMsg(10)] };
    verdict = () => ({ status: 401, message: "unauthorized" });
    expect(await (await run()).json()).toEqual({ processed: 1, viaResend: 1 });
    expect(resend.map((r) => r.headers["idempotency-key"])).toEqual(["auth:run-10"]);
    expect(dlq).toEqual([]);
  });

  it("a message queued before the hook set a key is sent with one derived from its message id", async () => {
    install();
    const m = authMsg(11);
    delete (m.message as Record<string, unknown>).idempotency_key;
    queues = { auth_emails: [m] };
    verdict = () => ({ status: 403, message: "refused" });
    await run();
    expect(resend.map((r) => r.headers["idempotency-key"])).toEqual(["auth:m-11"]);
  });

  it("the first transient failure waits for its next try; the third goes through Resend", async () => {
    install();
    queues = { auth_emails: [authMsg(12)] };
    verdict = () => ({ status: 500, message: "upstream error" });
    expect(await (await run()).json()).toEqual({ processed: 0 });
    expect(resend).toEqual([]);
    expect(rowsFor("m-12")).toEqual(["failed"]);
    db.rows("email_send_log").push({ message_id: "m-12", template_name: "magiclink", recipient_email: "u12@example.com", status: "failed" });
    expect(await (await run()).json()).toEqual({ processed: 1, viaResend: 1 });
    expect(resend.map((r) => r.headers["idempotency-key"])).toEqual(["auth:run-12"]);
    expect(dlq).toEqual([]);
  });

  it("when Resend refuses too, the refused mail dead-letters naming both refusals, and Resend's reason is logged", async () => {
    install();
    queues = { auth_emails: [authMsg(13)] };
    verdict = () => ({ status: 403, message: "sender domain not verified" });
    resendAnswer = () => new Response(JSON.stringify({ statusCode: 422, name: "validation_error", message: "The resumebooster.work domain is not verified" }), { status: 422 });
    expect(await (await run()).json()).toEqual({ processed: 0, forbidden: 1, resendFailed: 1 });
    expect(dlq.map((d) => d.message_id)).toEqual([13]);
    const why = String(db.rows("email_send_log").find((r) => r.status === "dlq")!.error_message);
    expect(why).toContain("notify.resumebooster.work");
    expect(why).toContain("domain is not verified");
    expect(String(db.rows("email_send_log").filter((r) => r.status === "failed").pop()!.error_message)).toContain("resend 422");
  });
});

describe("a transient Resend failure waits for the next tick (review major: one hiccup dead-lettered a sign-in)", () => {
  it("Lovable 403 then Resend 429: the mail stays on the queue, nothing dead-letters; the next tick sends it", async () => {
    install();
    queues = { auth_emails: [authMsg(40)] };
    verdict = () => ({ status: 403, message: "sender domain not verified" });
    resendAnswer = () => new Response(JSON.stringify({ statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" }), { status: 429 });
    expect(await (await run()).json()).toEqual({ processed: 0, resendFailed: 1 });
    expect(dlq, "a rate-limited fallback dead-lettered a sign-in mail whose code still works").toEqual([]);
    expect(deleted).toEqual([]);
    resendAnswer = () => new Response(JSON.stringify({ id: "re_after" }), { status: 200 });
    expect(await (await run()).json()).toEqual({ processed: 1, viaResend: 1 });
    expect(deleted).toEqual([40]);
    expect(dlq).toEqual([]);
  });

  it("Lovable 401 then Resend 500, or no answer: the mail stays on the queue", async () => {
    install();
    queues = { auth_emails: [authMsg(41)] };
    verdict = () => ({ status: 401, message: "unauthorized" });
    resendAnswer = () => new Response("upstream", { status: 500 });
    expect(await (await run()).json()).toEqual({ processed: 0, resendFailed: 1 });
    expect(dlq).toEqual([]);
    resendAnswer = () => { throw new TypeError("fetch failed"); };
    expect(await (await run()).json()).toEqual({ processed: 0, resendFailed: 1 });
    expect(dlq).toEqual([]);
  });

  it("a sign-in mail is bounded by its expiry, not by the retry count", async () => {
    install();
    for (let i = 0; i < 8; i++) db.rows("email_send_log").push({ message_id: "m-42", template_name: "magiclink", recipient_email: "u42@example.com", status: "failed" });
    queues = { auth_emails: [authMsg(42)] };
    verdict = () => ({ status: 403, message: "sender domain not verified" });
    resendAnswer = () => new Response("busy", { status: 503 });
    await run();
    expect(dlq, "a fresh sign-in mail was dead-lettered by the retry count").toEqual([]);
    queues = { auth_emails: [authMsg(43, { queued_at: new Date(Date.now() - 16 * 60_000).toISOString() })] };
    await run();
    expect(dlq.map((d) => d.message_id)).toEqual([43]);
  });
});

describe("transactional mail keeps today's behaviour (for a caller that names that queue)", () => {
  const drip = () => run({ authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }, { queues: ["transactional_emails"] });

  it("a 403 on a drip mail dead-letters it and never calls Resend", async () => {
    install();
    queues = { transactional_emails: [{ ...authMsg(20, { label: "fix-plan-drip", sender_domain: "notify.resumebooster.work" }) }] };
    verdict = () => ({ status: 403, message: "sender domain not verified" });
    expect(await (await drip()).json()).toEqual({ processed: 0, forbidden: 1 });
    expect(resend).toEqual([]);
    expect(dlq.map((d) => d.message_id)).toEqual([20]);
  });

  it("a 401 on a drip mail is a transient failure, as before", async () => {
    install();
    queues = { transactional_emails: [authMsg(21, { label: "fix-plan-drip" })] };
    verdict = () => ({ status: 401, message: "unauthorized" });
    expect(await (await drip()).json()).toEqual({ processed: 0 });
    expect(resend).toEqual([]);
    expect(dlq).toEqual([]);
    expect(rowsFor("m-21")).toEqual(["failed"]);
  });
});

describe("the build", () => {
  it("the preflight names process-email-queue.2026-10-14.1 and exposes it", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/process-email-queue", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toBe("process-email-queue.2026-10-14.1");
    expect(res.headers.get("access-control-expose-headers")).toBe("x-fn-build");
  });
});
