// @vitest-environment node
/**
 * SEND-MAIL NEVER THROWS, READS EVERY REFUSAL, AND LOGS EVERY TRY (R1 mail,
 * the plan's commit-0 _shared/send-mail.ts; register CP-013).
 *
 * WHAT WAS WRONG. Senders called Resend and either ignored a refusal or never
 * wrote it down; a bounce could not be joined to the mail it belonged to, and
 * two senders' worth of mail was all email_send_log ever saw.
 *
 * WHAT HOLDS NOW, calling the shipped module with Resend (fetch) and the
 * database faked:
 *   - a 2xx writes one 'sent' row carrying Resend's id, under the caller's
 *     message id, with the Idempotency-Key and reply_to sent;
 *   - while provider_message_id does not exist yet the row is written without
 *     it (the id stays in metadata), and the send still counts;
 *   - a refusal's body is read and its reason logged ('failed', or
 *     'rate_limited' for a 429); a network error or a timeout is a value,
 *     never a throw; a log write that throws is swallowed;
 *   - suppression: auth mail is never held back; transactional mail only by a
 *     bounce or complaint; marketing by any suppression, and also when the
 *     check cannot be read;
 *   - an unset RESEND_API_KEY sends nothing and writes nothing.
 * Every status written is one the CHECK accepted before 20261014100000.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "./helpers/edge-harness";
import { resetProviderColumnProbe, sendMail, type OutgoingMail } from "../../supabase/functions/_shared/send-mail";

const OLD_STATUSES = ["pending", "sent", "suppressed", "failed", "bounced", "complained", "dlq", "rate_limited"];
let db: FakeDb;
let calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }>;
const answer = (status: number, body: unknown) => async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) });
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
};
const mail = (extra: Partial<OutgoingMail> = {}): OutgoingMail => ({
  cls: "transactional", kind: "purchase", to: "Buyer@Example.com", from: "Resume Booster <account@resumebooster.work>",
  subject: "s", html: "<p>h</p>", text: "h", replyTo: "help@example.net", idempotencyKey: "k-1", messageId: "msg-1", ...extra,
});
const log = () => db.rows("email_send_log");

beforeEach(() => {
  db = new FakeDb();
  calls = [];
  resetProviderColumnProbe();
});

describe("a send Resend accepts", () => {
  it("writes one 'sent' row with Resend's id, sends the key, the reply address and the lower-cased recipient", async () => {
    const r = await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: answer(200, { id: "re_abc" }) as typeof fetch });
    expect(r).toEqual({ ok: true, id: "re_abc", status: 200, error: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].headers["idempotency-key"]).toBe("k-1");
    expect(calls[0].body).toMatchObject({ to: ["buyer@example.com"], reply_to: "help@example.net", text: "h" });
    expect(log().map((x) => [x.message_id, x.status, x.provider_message_id])).toEqual([["msg-1", "sent", "re_abc"]]);
  });

  it("before provider_message_id exists, the row is written without it and the id rides in metadata", async () => {
    db.faults.push({ table: "email_send_log", op: "select", error: { code: "42703", message: "column email_send_log.provider_message_id does not exist" } });
    const r = await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: answer(200, { id: "re_abc" }) as typeof fetch });
    expect(r.ok).toBe(true);
    expect(log()).toHaveLength(1);
    expect(log()[0]).not.toHaveProperty("provider_message_id");
    expect((log()[0].metadata as Record<string, unknown>).provider_message_id).toBe("re_abc");
  });

  it("an insert the database refuses for the column falls back to a row without it", async () => {
    db.faults.push({ table: "email_send_log", op: "insert", error: { code: "PGRST204", message: "Could not find the 'provider_message_id' column" } });
    await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: answer(200, { id: "re_abc" }) as typeof fetch });
    expect(log().map((x) => x.status)).toEqual(["sent"]);
    expect(log()[0]).not.toHaveProperty("provider_message_id");
  });
});

describe("a send Resend refuses, or that never reaches it, is a value and a row", () => {
  it("a 422: the body's reason is read and logged as failed", async () => {
    const r = await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: answer(422, { name: "validation_error", message: "The domain is not verified" }) as typeof fetch });
    expect(r).toMatchObject({ ok: false, status: 422, error: "The domain is not verified" });
    expect(log().map((x) => [x.status, x.error_message])).toEqual([["failed", "resend 422: The domain is not verified"]]);
  });

  it("a 429 is rate_limited", async () => {
    const r = await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: answer(429, "slow down") as typeof fetch });
    expect(r).toMatchObject({ ok: false, status: 429, error: "slow down" });
    expect(log().map((x) => x.status)).toEqual(["rate_limited"]);
  });

  it("a network error never throws", async () => {
    const r = await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: (async () => { throw new TypeError("connection reset"); }) as typeof fetch });
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(String(r.error)).toContain("connection reset");
    expect(log().map((x) => x.status)).toEqual(["failed"]);
  });

  it("a send that outlives its timeout is aborted and reported as timed out", async () => {
    const hang = ((_u: unknown, init?: RequestInit) => new Promise((_, no) => init?.signal?.addEventListener("abort", () => no(new Error("aborted"))))) as typeof fetch;
    const r = await sendMail(mail({ timeoutMs: 500 }), { admin: db, apiKey: "re_k", fetchImpl: hang });
    expect(r).toMatchObject({ ok: false, status: 0, error: "resend timed out" });
  });

  it("a log that throws is swallowed; the send's answer still comes back", async () => {
    const broken = { from: () => { throw new Error("db gone"); } };
    const r = await sendMail(mail({ cls: "auth" }), { admin: broken, apiKey: "re_k", fetchImpl: answer(200, { id: "re_x" }) as typeof fetch });
    expect(r).toEqual({ ok: true, id: "re_x", status: 200, error: null });
  });

  it("an unset key sends nothing and writes nothing", async () => {
    const r = await sendMail(mail(), { admin: db, apiKey: "", fetchImpl: answer(200, { id: "x" }) as typeof fetch });
    expect(r).toMatchObject({ ok: false, status: 0, error: "not_configured" });
    expect(calls).toEqual([]);
    expect(log()).toEqual([]);
  });

  it("no valid recipient is a failed row and no call", async () => {
    const r = await sendMail(mail({ to: "not-an-address" }), { admin: db, apiKey: "re_k", fetchImpl: answer(200, { id: "x" }) as typeof fetch });
    expect(r.error).toBe("invalid_recipient");
    expect(calls).toEqual([]);
    expect(log().map((x) => x.status)).toEqual(["failed"]);
  });
});

describe("suppression, by class", () => {
  const suppress = (reason: string) => db.rows("suppressed_emails").push({ email: "buyer@example.com", reason });
  const send = (cls: OutgoingMail["cls"]) => sendMail(mail({ cls }), { admin: db, apiKey: "re_k", fetchImpl: answer(200, { id: "re_s" }) as typeof fetch });

  it("transactional: a bounce holds it back with a 'suppressed' row; an unsubscribe does not", async () => {
    suppress("bounce");
    expect(await send("transactional")).toMatchObject({ ok: false, suppressed: true });
    expect(calls).toEqual([]);
    expect(log().map((x) => x.status)).toEqual(["suppressed"]);
    db.rows("suppressed_emails")[0].reason = "unsubscribe";
    expect((await send("transactional")).ok).toBe(true);
  });

  it("marketing: any suppression holds it back, and so does a check that cannot be read", async () => {
    suppress("unsubscribe");
    expect(await send("marketing")).toMatchObject({ ok: false, suppressed: true });
    db.tables = {};
    db.faults.push({ table: "suppressed_emails", op: "select", error: { message: "timeout" } });
    expect(await send("marketing")).toMatchObject({ ok: false, error: "suppression_unreadable" });
    expect(calls).toEqual([]);
  });

  it("auth: a sign-in code the person just asked for goes even to a complained address", async () => {
    suppress("complaint");
    expect((await send("auth")).ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("only statuses the CHECK already allowed", () => {
  it("every row any path above writes uses one of them", async () => {
    const f = (s: number, b: unknown) => answer(s, b) as typeof fetch;
    await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: f(200, { id: "a" }) });
    await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: f(500, "x") });
    await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: f(429, "x") });
    await sendMail(mail({ to: "bad" }), { admin: db, apiKey: "re_k", fetchImpl: f(200, {}) });
    db.rows("suppressed_emails").push({ email: "buyer@example.com", reason: "bounce" });
    await sendMail(mail(), { admin: db, apiKey: "re_k", fetchImpl: f(200, {}) });
    const seen = [...new Set(log().map((x) => String(x.status)))].sort();
    expect(seen).toEqual(["failed", "rate_limited", "sent", "suppressed"]);
    for (const s of seen) expect(OLD_STATUSES).toContain(s);
  });
});
