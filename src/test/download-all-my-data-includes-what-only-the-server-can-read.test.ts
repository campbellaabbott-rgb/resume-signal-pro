// @vitest-environment node
/**
 * DOWNLOAD ALL MY DATA INCLUDES WHAT ONLY THE SERVER CAN READ (S14X-100).
 *
 * WHAT WAS WRONG. The download read the sixteen tables the browser may read by
 * the account's own id, plus the credits and a name-and-date purchase list.
 * The documents made for its purchases, the Full Analyses they point to, its
 * Pro grants, its API keys and key requests, its mailbox proofs, its writing
 * tool uses, its checkout records and the lists its address is on are all
 * service-role only, so the file left them out while the card promised all
 * of it. Deleting the account removes exactly those rows.
 *
 * WHAT HOLDS NOW, against the shipped get-account-data with the database faked:
 *   - POST {action:"export"} answers serverRecords: the rows by the account's
 *     user id, and the rows by its address only once that address is proven;
 *   - a key is exported by its prefix and never by its hash;
 *   - a table that fails is named {error}, never an empty list;
 *   - a connector's token is refused;
 *   - the browser half names the server's part as not included, with the
 *     reason, when the call fails or the function answers without it (a
 *     function deployed before this one).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { collectServerExport } from "@/lib/account-export";

const USER_ID = "00000000-0000-4000-8000-0000000e0e01";
const EMAIL = "exporter@example.com";
const GRANT = "cccccccc-3333-4333-8333-000000000001";
const SHARE = "abcdefabcdefabcdefabcdef";
const KEY_HASH = "9f2c1e7d4b8a6f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e";
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
  g.__exportAcct = () => ({
    // The fake builder has no .range(); a page is the whole fake table.
    from: (t: string) => {
      const q = db.from(t) as unknown as Record<string, unknown>;
      q.range = () => q;
      return q;
    },
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (token: string) => (token === SESSION
        ? { data: { user: { id: USER_ID, email: EMAIL, identities: [] } }, error: null }
        : { data: { user: null }, error: { message: "no" } }),
      admin: { signOut: async () => ({ error: null }), updateUserById: async () => ({ error: null }) },
    },
  });
  handler = await loadEdgeHandler("get-account-data", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__exportAcct(...a); }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.scan_credit_balance = () => ({ data: 0, error: null });
  db.rows("checkout_buyers").push({ stripe_session_id: "cs_live_bound0001", user_id: USER_ID });
  db.rows("pro_grants").push({ id: GRANT, user_id: USER_ID, email: EMAIL, product_type: "full_analysis", product_name: "Full Resume Analysis", created_at: "2026-10-01T10:00:00Z", consumed_at: null, revoked_at: null });
  db.rows("purchased_content").push(
    { id: "pc-bound", stripe_session_id: "cs_live_bound0001", customer_email: "typed.at.checkout@example.com", product_type: "cover_letter", generated_content: { letter: "Dear hiring manager" } },
    { id: "pc-address", stripe_session_id: "cs_live_address001", customer_email: EMAIL, product_type: "full_analysis", generated_content: { shareId: SHARE } },
    { id: "pc-grant", stripe_session_id: `pro_${GRANT}`, customer_email: "typed.elsewhere@example.com", product_type: "career_snapshot", generated_content: { text: "snapshot" } },
    { id: "pc-stranger", stripe_session_id: "cs_live_stranger01", customer_email: "stranger@example.com", product_type: "cover_letter", generated_content: { letter: "not yours" } },
  );
  db.rows("resume_analyses").push(
    { id: "ra-mine", share_id: SHARE, analysis_result: { atsScore: { score: 74 } } },
    { id: "ra-other", share_id: "ffffffffffffffffffffffff", analysis_result: { atsScore: { score: 12 } } },
  );
  db.rows("api_keys").push(
    { id: "k-mine", user_id: USER_ID, owner_email: EMAIL, key_prefix: "rbk_live_ab12", key_hash: KEY_HASH, name: "laptop", tier: "trial" },
    { id: "k-address", user_id: null, owner_email: EMAIL, key_prefix: "rbk_live_cd34", key_hash: "1111", name: "older", tier: "trial" },
    { id: "k-stranger", user_id: null, owner_email: "stranger@example.com", key_prefix: "rbk_live_zz99", key_hash: "2222", name: "theirs", tier: "trial" },
  );
  db.rows("api_key_requests").push({ id: "req-1", email: EMAIL, use_case: "research" });
  db.rows("writing_tool_uses").push({ id: "w-1", user_id: USER_ID, tool: "letter", tier: "free", used_at: "2026-10-02T10:00:00Z" });
  db.rows("market_pulse_subscribers").push({ id: "mp-1", email: EMAIL });
  db.rows("free_scan_leads").push({ id: "fl-1", email: EMAIL });
});

const exportAs = async (token = SESSION) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/get-account-data", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "export" }),
  }));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as { serverRecords?: Record<string, any>; mailboxProven?: boolean } };
};
const ids = (rows: unknown) => (Array.isArray(rows) ? rows.map((r) => (r as { id?: string }).id).sort() : rows);

describe("the server's share of the download, for a proven account", () => {
  beforeEach(() => { db.rows("account_mailbox_proofs").push({ id: 1, user_id: USER_ID, email: EMAIL, method: "otp", created_at: "2026-10-01T09:00:00Z" }); });

  it("carries the documents made for its purchases and the analysis a Full Analysis points to", async () => {
    const r = await exportAs();
    expect(r.status).toBe(200);
    const s = r.json.serverRecords!;
    expect(ids(s.purchasedContent)).toEqual(["pc-address", "pc-bound", "pc-grant"]);
    expect(ids(s.fullAnalyses)).toEqual(["ra-mine"]);
    expect(ids(s.proGrants)).toEqual([GRANT]);
    expect(s.checkoutBuyers).toEqual([expect.objectContaining({ stripe_session_id: "cs_live_bound0001" })]);
    expect(s.mailboxProofs).toEqual([expect.objectContaining({ method: "otp", email: EMAIL })]);
    expect(ids(s.writingToolUses)).toEqual(["w-1"]);
    expect(ids(s.apiKeyRequests)).toEqual(["req-1"]);
    expect(ids(s.marketPulseSubscriptions)).toEqual(["mp-1"]);
    expect(ids(s.freeScanLeads)).toEqual(["fl-1"]);
  });

  it("names each key by its prefix, and no hash of a key is anywhere in the answer", async () => {
    const r = await exportAs();
    const keys = r.json.serverRecords!.apiKeys as Array<Record<string, unknown>>;
    expect(keys.map((k) => k.key_prefix).sort()).toEqual(["rbk_live_ab12", "rbk_live_cd34"]);
    expect(r.text).not.toContain("key_hash");
    expect(r.text).not.toContain(KEY_HASH);
  });

  it("a table that fails is named as failed, never handed back as empty", async () => {
    db.faults.push({ table: "api_keys", op: "select", error: { code: "57014", message: "statement timeout" } });
    const r = await exportAs();
    expect(r.status).toBe(200);
    expect(r.json.serverRecords!.apiKeys).toEqual({ error: expect.any(String) });
    expect(ids(r.json.serverRecords!.proGrants)).toEqual([GRANT]);
  });
});

describe("an unproven account", () => {
  it("gets its rows by user id and none by the address", async () => {
    const r = await exportAs();
    expect(r.json.mailboxProven).toBe(false);
    const s = r.json.serverRecords!;
    expect(ids(s.purchasedContent)).toEqual(["pc-bound", "pc-grant"]);
    expect(ids(s.apiKeys)).toEqual(["k-mine"]);
    expect(s.apiKeyRequests).toEqual([]);
    expect(s.marketPulseSubscriptions).toEqual([]);
    expect(s.freeScanLeads).toEqual([]);
    expect(ids(s.writingToolUses)).toEqual(["w-1"]);
  });

  it("a connector's token is refused", async () => {
    expect((await exportAs(jwt({ client_id: "mcp" }))).status).toBe(401);
  });
});

describe("the browser half", () => {
  it("passes the server's records through", async () => {
    const out = await collectServerExport(async () => ({ data: { serverRecords: { apiKeys: [] } }, error: null }));
    expect(out).toEqual({ apiKeys: [] });
  });

  it("names them as not included, with the reason, when the call fails or the answer has none", async () => {
    expect(await collectServerExport(async () => ({ data: null, error: new Error("503") }))).toEqual({ notIncluded: true, reason: expect.stringMatching(/could not/) });
    // A function deployed before the export action answers the ordinary account JSON.
    expect(await collectServerExport(async () => ({ data: { credits: 0, orders: [] }, error: null }))).toEqual({ notIncluded: true, reason: expect.stringMatching(/not/) });
    expect(await collectServerExport(async () => { throw new Error("offline"); })).toEqual({ notIncluded: true, reason: expect.any(String) });
  });
});
