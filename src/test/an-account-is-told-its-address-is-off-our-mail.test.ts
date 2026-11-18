// @vitest-environment node
/**
 * AN ACCOUNT IS TOLD ITS ADDRESS IS OFF OUR MAIL (S14X-107, the default half;
 * the page's half is an-account-is-told-its-address-is-off-our-mail-on-its-page).
 *
 * WHAT WAS WRONG. An address on suppressed_emails (its own "stop all emails",
 * a deleted account's note, a bounce, a spam report) gets no saved-search
 * alert, scan report or pulse, and account-settings said nothing about it, so
 * /account showed every mail switch as if it worked.
 *
 * WHAT HOLDS NOW, on the shipped handler with the database faked: 'read'
 * answers mailStopped {reason, accountDeleted} for the PROVEN address on the
 * list, null for one that is not; an unproven address reads no list at all
 * (mailStopped null, suppressed_emails not asked); a read that fails answers
 * null and never fails the page.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const USER_ID = "00000000-0000-4000-8000-0000000c0107";
const EMAIL = "owner@example.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const SESSION = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }] })}.sig`;

let handler: EdgeHandler;
let db: FakeDb;
let asked: string[] = [];

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__s107Settings = () => ({
    from: (t: string) => { asked.push(t); return db.from(t); },
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: { getUser: async (token: string) => (token === SESSION ? { data: { user: { id: USER_ID, email: EMAIL, identities: [] } }, error: null } : { data: { user: null }, error: { message: "no" } }) },
  });
  g.fetch = async (u: string) => { throw new Error(`unexpected fetch ${u}`); };
  handler = await loadEdgeHandler("account-settings", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__s107Settings(...a); }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  asked = [];
  db.rows("account_mailbox_proofs").push({ id: 1, user_id: USER_ID, email: EMAIL });
});

const read = async () => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/account-settings", {
    method: "POST", headers: { authorization: `Bearer ${SESSION}`, "content-type": "application/json" }, body: JSON.stringify({ action: "read" }),
  }));
  return { status: res.status, json: await res.json() as Record<string, unknown> };
};

describe("read", () => {
  it("says the proven address asked us to stop all mail", async () => {
    db.rows("suppressed_emails").push({ email: EMAIL, reason: "unsubscribe", metadata: null });
    const r = await read();
    expect(r.status).toBe(200);
    expect(r.json.mailStopped, "the page was never told").toEqual({ reason: "unsubscribe", accountDeleted: false });
  });

  it("names a deleted account's note, a bounce and a spam report as such", async () => {
    db.rows("suppressed_emails").push({ email: EMAIL, reason: "unsubscribe", metadata: { source: "account_deleted", at: "2026-10-12T00:00:00Z" } });
    expect((await read()).json.mailStopped).toEqual({ reason: "unsubscribe", accountDeleted: true });
    db.tables.suppressed_emails = [{ email: EMAIL, reason: "bounce", metadata: { type: "email.bounced" } }];
    expect((await read()).json.mailStopped).toEqual({ reason: "bounce", accountDeleted: false });
    db.tables.suppressed_emails = [{ email: EMAIL, reason: "complaint", metadata: null }];
    expect((await read()).json.mailStopped).toEqual({ reason: "complaint", accountDeleted: false });
  });

  it("an address on no list reads null, and the rest of the answer is unchanged", async () => {
    db.rows("suppressed_emails").push({ email: "someone-else@example.com", reason: "unsubscribe", metadata: null });
    const r = await read();
    expect(r.json).toMatchObject({ mailStopped: null, mailboxProven: true, mail: { marketPulse: [] }, connectors: [] });
  });

  it("an unproven address is never looked up", async () => {
    db.tables.account_mailbox_proofs = [];
    db.rows("suppressed_emails").push({ email: EMAIL, reason: "unsubscribe", metadata: null });
    const r = await read();
    expect(r.json).toMatchObject({ mailStopped: null, mailboxProven: false, mail: null });
    expect(asked, "the do-not-mail list was read for an address the account has not proven").not.toContain("suppressed_emails");
  });

  it("a list that cannot be read says nothing, and the page still loads", async () => {
    db.faults.push({ table: "suppressed_emails", op: "select", error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const r = await read();
    expect(r.status).toBe(200);
    expect(r.json.mailStopped).toBeNull();
  });
});
