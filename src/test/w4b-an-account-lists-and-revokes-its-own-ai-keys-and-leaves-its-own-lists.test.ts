// @vitest-environment node
/**
 * AN ACCOUNT LISTS AND REVOKES ITS OWN AI KEYS, AND LEAVES ITS OWN LISTS
 * (plan CP-H "Connected AIs" and "Email preferences"; account-settings).
 *
 * A key minted for a person's AI could only be replaced by minting another,
 * and the account page never said one existed; the market pulse could only be
 * left from one of its mails. Run here as shipped, with the database faked:
 *   - read lists this account's live keys (prefix, name, dates, never a key)
 *     and, only for a PROVEN address, its market pulse rows;
 *   - revoke_connector stops this account's key now; another account's key,
 *     or one already revoked, answers 404 and changes nothing;
 *   - pulse_off stops every pulse row under the proven address, and is
 *     refused (403) while the address is unproven;
 *   - a connector's token is refused.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const USER_ID = "00000000-0000-4000-8000-0000000c0051";
const OTHER_ID = "00000000-0000-4000-8000-0000000c0052";
const EMAIL = "owner@example.com";
const MY_KEY = "11111111-1111-4111-8111-111111111111";
const OLD_KEY = "22222222-2222-4222-8222-222222222222";
const THEIR_KEY = "33333333-3333-4333-8333-333333333333";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (extra: Record<string, unknown> = {}) =>
  `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }], ...extra })}.sig`;
const SESSION = jwt();

let handler: EdgeHandler;
let db: FakeDb;

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__w4bSettings = () => ({
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: { getUser: async (token: string) => (token === SESSION ? { data: { user: { id: USER_ID, email: EMAIL, identities: [] } }, error: null } : { data: { user: null }, error: { message: "no" } }) },
  });
  g.fetch = async (u: string) => { throw new Error(`unexpected fetch ${u}`); };
  handler = await loadEdgeHandler("account-settings", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__w4bSettings(...a); }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  db.rows("account_mailbox_proofs").push({ id: 1, user_id: USER_ID, email: EMAIL });
  db.rows("api_keys").push(
    { id: MY_KEY, user_id: USER_ID, key_hash: "h1", key_prefix: "rb_live_ab12cd34", name: "Connected agent", owner_email: EMAIL, created_at: "2026-10-10T09:00:00Z", last_used_at: "2026-10-12T08:00:00Z", revoked_at: null },
    { id: OLD_KEY, user_id: USER_ID, key_hash: "h2", key_prefix: "rb_live_00000000", name: "Connected agent", owner_email: EMAIL, created_at: "2026-10-01T09:00:00Z", last_used_at: null, revoked_at: "2026-10-10T09:00:00Z" },
    { id: THEIR_KEY, user_id: OTHER_ID, key_hash: "h3", key_prefix: "rb_live_ffffffff", name: "Connected agent", owner_email: "them@example.com", created_at: "2026-10-10T09:00:00Z", last_used_at: null, revoked_at: null },
  );
  db.rows("market_pulse_subscribers").push(
    { email: EMAIL, industry: "technology", confirmed_at: "2026-10-02T00:00:00Z", unsubscribed_at: null },
    { email: "them@example.com", industry: "healthcare", confirmed_at: "2026-10-02T00:00:00Z", unsubscribed_at: null },
  );
});

const ask = async (body: Record<string, unknown>, token = SESSION) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/account-settings", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as Record<string, unknown>, build: res.headers.get("x-fn-build") };
};

describe("read", () => {
  it("lists this account's live keys without the key, and the pulse rows of its proven address", async () => {
    const r = await ask({ action: "read" });
    expect(r.status).toBe(200);
    expect(r.build).toBe("account-settings.2026-10-14.25");
    expect(r.json.connectors).toEqual([{ id: MY_KEY, prefix: "rb_live_ab12cd34", name: "Connected agent", createdAt: "2026-10-10T09:00:00Z", lastUsedAt: "2026-10-12T08:00:00Z" }]);
    expect(JSON.stringify(r.json)).not.toContain("key_hash");
    expect(r.json.mail).toEqual({ marketPulse: [{ industry: "technology", state: "subscribed" }] });
    expect(r.json.mailboxProven).toBe(true);
  });

  it("an unproven address reads no list at all", async () => {
    db.tables.account_mailbox_proofs = [];
    const r = await ask({ action: "read" });
    expect(r.json.mail).toBeNull();
    expect(r.json.mailboxProven).toBe(false);
    expect((r.json.connectors as unknown[]).length).toBe(1);
  });
});

describe("revoke_connector", () => {
  it("stops this account's key now", async () => {
    const r = await ask({ action: "revoke_connector", keyId: MY_KEY });
    expect(r.json).toEqual({ revoked: true });
    expect(db.rows("api_keys").find((k) => k.id === MY_KEY)?.revoked_at).toBeTruthy();
    expect((await ask({ action: "read" })).json.connectors).toEqual([]);
  });

  it("another account's key, or one already revoked, answers 404 and changes nothing", async () => {
    expect((await ask({ action: "revoke_connector", keyId: THEIR_KEY })).status).toBe(404);
    expect(db.rows("api_keys").find((k) => k.id === THEIR_KEY)?.revoked_at).toBeNull();
    expect((await ask({ action: "revoke_connector", keyId: OLD_KEY })).status).toBe(404);
    expect(db.rows("api_keys").find((k) => k.id === OLD_KEY)?.revoked_at).toBe("2026-10-10T09:00:00Z");
    expect((await ask({ action: "revoke_connector", keyId: "not-a-key" })).status).toBe(400);
  });
});

describe("pulse_off", () => {
  it("stops every pulse row under the proven address and no other", async () => {
    const r = await ask({ action: "pulse_off" });
    expect(r.json).toEqual({ unsubscribed: 1 });
    expect(db.rows("market_pulse_subscribers").find((p) => p.email === EMAIL)?.unsubscribed_at).toBeTruthy();
    expect(db.rows("market_pulse_subscribers").find((p) => p.email === "them@example.com")?.unsubscribed_at).toBeNull();
    expect((await ask({ action: "read" })).json.mail).toEqual({ marketPulse: [{ industry: "technology", state: "off" }] });
  });

  it("is refused while the address is unproven", async () => {
    db.tables.account_mailbox_proofs = [];
    const r = await ask({ action: "pulse_off" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("address_unproven");
    expect(db.rows("market_pulse_subscribers").find((p) => p.email === EMAIL)?.unsubscribed_at).toBeNull();
  });
});

describe("refusals", () => {
  it("a connector's token can neither list nor revoke", async () => {
    expect((await ask({ action: "read" }, jwt({ client_id: "mcp" }))).status).toBe(401);
    expect((await ask({ action: "revoke_connector", keyId: MY_KEY }, jwt({ client_id: "mcp" }))).status).toBe(401);
    expect(db.rows("api_keys").find((k) => k.id === MY_KEY)?.revoked_at).toBeNull();
  });
  it("an unknown action is a 400", async () => {
    expect((await ask({ action: "drop_everything" })).status).toBe(400);
  });
});
