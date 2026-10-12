// @vitest-environment node
/**
 * THE RESEND WEBHOOK TRUSTS ONLY A FRESH SVIX SIGNATURE, AND A BOUNCE STOPS
 * THE NEXT MAIL (R1 mail, plan group CP-A item 4; register CP-013).
 *
 * WHAT WAS WRONG. Nothing ingested what Resend learned after it accepted a
 * mail: a hard bounce or a spam complaint never reached suppressed_emails, so
 * the next mail went to the same dead or angry address, and the sending
 * domain's reputation paid for it.
 *
 * WHAT HOLDS NOW, by running the shipped resend-webhook with the database
 * faked and real Svix signatures computed here:
 *   - no secret configured: every event is refused (503);
 *   - a bad signature, a missing header, or a correctly signed event whose
 *     timestamp is more than five minutes off (a replay) is refused (401) and
 *     writes nothing;
 *   - a good bounce writes one 'bounced' row under Resend's id and suppresses
 *     the address; the same event delivered again writes nothing new;
 *   - a complaint writes a 'complained' row and suppresses, raising an
 *     unsubscribe already on file; a transient bounce is recorded and does not
 *     suppress;
 *   - delivered and delayed are stamped on the sent row, never written as
 *     rows (email_delivery_health would count them as stuck);
 *   - other event types are acknowledged and ignored.
 */
import { createHmac, randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const db = new FakeDb();
const SECRET_BYTES = randomBytes(32);
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const env: Record<string, string | undefined> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", RESEND_WEBHOOK_SECRET: SECRET };
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("resend-webhook", {
    "npm:@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
  });
}, 60_000);

beforeEach(() => {
  db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = [];
  env.RESEND_WEBHOOK_SECRET = SECRET;
  db.rows("email_send_log").push({
    id: "row-1", message_id: "m-1", template_name: "magiclink", recipient_email: "person@example.com",
    status: "sent", provider_message_id: "re_1", metadata: { provider: "resend" },
  });
});

const sign = (id: string, ts: number, body: string, key: Buffer = SECRET_BYTES) =>
  `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
const now = () => Math.floor(Date.now() / 1000);
function post(event: Record<string, unknown>, opt: { id?: string; ts?: number; signature?: string; drop?: string } = {}) {
  const body = JSON.stringify(event);
  const id = opt.id ?? `msg_${randomBytes(6).toString("hex")}`;
  const ts = opt.ts ?? now();
  const headers: Record<string, string> = {
    "content-type": "application/json", "svix-id": id, "svix-timestamp": String(ts), "svix-signature": opt.signature ?? sign(id, ts, body),
  };
  if (opt.drop) delete headers[opt.drop];
  return handler(new Request("https://harness.supabase.co/functions/v1/resend-webhook", { method: "POST", headers, body }));
}
const bounced = (type = "Permanent") => ({
  type: "email.bounced", created_at: "2026-10-14T10:00:00.000Z",
  data: { email_id: "re_1", to: ["Person@Example.com"], subject: "Your sign-in code", bounce: { type, subType: "General", message: "550 mailbox does not exist" } },
});
const statuses = () => db.rows("email_send_log").map((r) => r.status);

describe("only a fresh, correct Svix signature is trusted", () => {
  it("no secret configured: refused with 503, nothing written", async () => {
    env.RESEND_WEBHOOK_SECRET = undefined;
    const res = await post(bounced());
    expect(res.status).toBe(503);
    expect(db.writes).toEqual([]);
  });

  it("a signature made with another key is refused", async () => {
    const res = await post(bounced(), { signature: sign("x", now(), "{}", randomBytes(32)) });
    expect(res.status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it("a body changed after signing is refused", async () => {
    const id = "msg_tamper"; const ts = now();
    const res = await post(bounced(), { id, ts, signature: sign(id, ts, JSON.stringify(bounced("Transient"))) });
    expect(res.status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it("a missing svix header is refused", async () => {
    expect((await post(bounced(), { drop: "svix-signature" })).status).toBe(401);
    expect((await post(bounced(), { drop: "svix-timestamp" })).status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it("a correctly signed event replayed ten minutes later, or dated ten minutes ahead, is refused", async () => {
    expect((await post(bounced(), { ts: now() - 600 })).status).toBe(401);
    expect((await post(bounced(), { ts: now() + 600 })).status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it("one valid signature among several (a key rotation) is enough", async () => {
    const id = "msg_rot"; const ts = now(); const body = JSON.stringify(bounced());
    const res = await post(bounced(), { id, ts, signature: `v1,bm90LXRoaXMtb25l ${sign(id, ts, body)}` });
    expect(res.status).toBe(200);
  });

  it("the preflight names this build", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/resend-webhook", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toBe("resend-webhook.2026-10-14.1");
    expect(res.headers.get("access-control-expose-headers")).toBe("x-fn-build");
    expect((await handler(new Request("https://harness.supabase.co/functions/v1/resend-webhook"))).status).toBe(405);
  });
});

describe("what a verified event records", () => {
  it("a hard bounce: one 'bounced' row under Resend's id on the same message, and the address suppressed; delivered again, nothing new", async () => {
    const id = "msg_bounce_1"; const ts = now();
    const first = await post(bounced(), { id, ts });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, event: "bounced", hard: true, inserted: 1, suppressed: 1 });
    const again = await post(bounced(), { id, ts });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ inserted: 0, suppressed: 0 });
    const rows = db.rows("email_send_log").filter((r) => r.status === "bounced");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ message_id: "m-1", provider_message_id: "re_1", recipient_email: "person@example.com", error_message: "550 mailbox does not exist" });
    expect(db.rows("suppressed_emails").map((r) => [r.email, r.reason])).toEqual([["person@example.com", "bounce"]]);
  });

  it("a transient bounce is recorded and suppresses nothing", async () => {
    const res = await post(bounced("Transient"));
    expect(await res.json()).toMatchObject({ hard: false, inserted: 1, suppressed: 0 });
    expect(db.rows("suppressed_emails")).toEqual([]);
  });

  it("a complaint is recorded and suppresses, raising an unsubscribe already on file", async () => {
    db.rows("suppressed_emails").push({ email: "person@example.com", reason: "unsubscribe" });
    const res = await post({ type: "email.complained", created_at: "2026-10-14T10:00:00.000Z", data: { email_id: "re_1", to: ["person@example.com"] } });
    expect(res.status).toBe(200);
    expect(statuses()).toEqual(["sent", "complained"]);
    expect(db.rows("suppressed_emails").map((r) => [r.email, r.reason])).toEqual([["person@example.com", "complaint"]]);
  });

  it("a bounce for a mail we never logged still suppresses and is recorded under its id", async () => {
    const res = await post({ type: "email.bounced", data: { email_id: "re_other", to: ["Stranger <gone@example.org>"], bounce: { type: "Permanent", message: "no such user" } } });
    expect(res.status).toBe(200);
    expect(db.rows("email_send_log").find((r) => r.provider_message_id === "re_other")).toMatchObject({ status: "bounced", template_name: "resend:bounced", recipient_email: "gone@example.org", message_id: null });
    expect(db.rows("suppressed_emails").map((r) => r.email)).toEqual(["gone@example.org"]);
  });

  it("delivered and delayed are stamped on the sent row and never become rows of their own", async () => {
    await post({ type: "email.delivery_delayed", created_at: "2026-10-14T10:01:00.000Z", data: { email_id: "re_1", to: ["person@example.com"] } });
    const res = await post({ type: "email.delivered", created_at: "2026-10-14T10:05:00.000Z", data: { email_id: "re_1", to: ["person@example.com"] } });
    expect(await res.json()).toMatchObject({ ok: true, event: "delivered", matched: 1, stamped: 1 });
    expect(statuses(), "a delivered or delayed ROW would read as stuck in email_delivery_health").toEqual(["sent"]);
    expect(db.rows("email_send_log")[0].metadata).toMatchObject({ provider: "resend", delayed_at: "2026-10-14T10:01:00.000Z", delivered_at: "2026-10-14T10:05:00.000Z", last_event: "delivered_at" });
    const again = await post({ type: "email.delivered", created_at: "2026-10-14T11:00:00.000Z", data: { email_id: "re_1" } });
    expect(await again.json()).toMatchObject({ stamped: 0 });
    expect((db.rows("email_send_log")[0].metadata as Record<string, unknown>).delivered_at).toBe("2026-10-14T10:05:00.000Z");
  });

  it("other event types are acknowledged and write nothing", async () => {
    const res = await post({ type: "email.opened", data: { email_id: "re_1" } });
    expect(await res.json()).toEqual({ ok: true, ignored: "email.opened" });
    expect(db.writes).toEqual([]);
  });

  it("a write that fails answers 500, so Svix delivers the event again", async () => {
    db.faults.push({ table: "email_send_log", op: "insert", error: { message: "db down" } });
    const res = await post(bounced());
    expect(res.status).toBe(500);
  });
});
