// @vitest-environment node
/**
 * A LEGAL NOTICE IS RESENT WITH THE BODY IT FIRST RENDERED (S12-102, plan K10).
 *
 * WHAT WAS WRONG. sendLegalNotice rendered the notice afresh on every Stripe
 * redelivery and sent it under a 24-hour idempotency key. When the first send
 * went through but its record failed, and anything in the render moved (a
 * promotion read, the portal link), Resend refused every retry with a 409
 * (same key, different body) until the key expired, and then mailed a second
 * copy of a statutory notice.
 *
 * WHAT HOLDS NOW, calling the shipped module with a fake ledger and a fake
 * Resend: the first attempt stores its body before it sends; every retry sends
 * that stored body, byte for byte, whatever the caller rendered this time; a
 * 409 saying the key was already used by another body counts as sent and
 * mails nothing more; a 409 for a request still in flight is retried.
 */
import { describe, expect, it } from "vitest";
import { FakeDb } from "./helpers/edge-harness";
import { noticeKey, sendLegalNotice } from "../../supabase/functions/_shared/subscription-notice";

type Answer = { status: number; body: unknown };
function fakeResend(answers: Answer[]) {
  const calls: Array<{ key: string | null; body: { subject: string; html: string; text: string } }> = [];
  const fetchImpl = (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ key: init.headers["Idempotency-Key"] ?? null, body: JSON.parse(init.body) });
    const a = answers.shift() ?? { status: 200, body: { id: "re_default" } };
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const FIRST = { subject: "Your Resume Booster Pro subscription", html: "<p>You are charged $22.50 with your promotion.</p>", text: "You are charged $22.50 with your promotion." };
const RERENDERED = { subject: "Your Resume Booster Pro subscription", html: "<p>You are charged $45.00 every month.</p>", text: "You are charged $45.00 every month." };
const send = (db: FakeDb, mail: typeof FIRST, fetchImpl: typeof fetch) => sendLegalNotice(db, {
  subscriptionId: "sub_1", kind: "confirmation", to: "Subscriber@Example.com", mail, apiKey: "re_test", replyTo: "help@example.com", fetchImpl,
});

describe("the body is rendered once", () => {
  it("a send whose record failed is retried with the stored body, not the redelivery's new render", async () => {
    const db = new FakeDb();
    const r = fakeResend([{ status: 200, body: { id: "re_1" } }, { status: 200, body: { id: "re_1" } }]);
    db.faults.push({ table: "subscription_notices", op: "update", error: { message: "connection reset" } });
    expect((await send(db, FIRST, r.fetchImpl)).outcome).toBe("failed");
    const row = db.rows("subscription_notices")[0];
    expect(row.sent_at ?? null).toBeNull();
    expect(row.pending_mail).toEqual(FIRST);

    expect(await send(db, RERENDERED, r.fetchImpl)).toEqual({ outcome: "sent", id: "re_1" });
    expect(r.calls).toHaveLength(2);
    expect(r.calls.map((c) => c.key)).toEqual([noticeKey("sub_1", "confirmation"), noticeKey("sub_1", "confirmation")]);
    expect(r.calls[1].body.html, "the retry sent a different body under the same key").toBe(FIRST.html);
    expect(r.calls[1].body.text).toBe(FIRST.text);
    const done = db.rows("subscription_notices")[0];
    expect(done.sent_at).toBeTruthy();
    expect(done.pending_mail).toBeNull();
    expect(done.provider_message_id).toBe("re_1");
  });

  it("once sent, a later redelivery sends nothing", async () => {
    const db = new FakeDb();
    const r = fakeResend([{ status: 200, body: { id: "re_2" } }]);
    expect((await send(db, FIRST, r.fetchImpl)).outcome).toBe("sent");
    expect(await send(db, RERENDERED, r.fetchImpl)).toEqual({ outcome: "already" });
    expect(r.calls).toHaveLength(1);
  });
});

describe("Resend's 409", () => {
  it("'key already used by another body' means an earlier send was accepted: recorded as sent, never mailed again", async () => {
    const db = new FakeDb();
    db.rows("subscription_notices").push({ subscription_id: "sub_1", kind: "confirmation", email: "subscriber@example.com", sent_at: null, pending_mail: null, provider_message_id: "re_earlier" });
    const r = fakeResend([{ status: 409, body: { name: "invalid_idempotent_request", message: "Same idempotency key used with a different request payload." } }]);
    expect(await send(db, RERENDERED, r.fetchImpl)).toEqual({ outcome: "sent", id: "re_earlier" });
    const row = db.rows("subscription_notices")[0];
    expect(row.sent_at).toBeTruthy();
    expect(await send(db, RERENDERED, r.fetchImpl)).toEqual({ outcome: "already" });
    expect(r.calls).toHaveLength(1);
  });

  it("a request still in flight under the key is transient: failed now, retried later", async () => {
    const db = new FakeDb();
    const r = fakeResend([{ status: 409, body: { name: "concurrent_idempotent_requests", message: "in progress" } }, { status: 200, body: { id: "re_3" } }]);
    expect((await send(db, FIRST, r.fetchImpl)).outcome).toBe("failed");
    expect(db.rows("subscription_notices")[0].sent_at ?? null).toBeNull();
    expect(await send(db, RERENDERED, r.fetchImpl)).toEqual({ outcome: "sent", id: "re_3" });
    expect(r.calls[1].body.html).toBe(FIRST.html);
  });
});
