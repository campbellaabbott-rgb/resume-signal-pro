// @vitest-environment node
/**
 * GET-ACCOUNT-DATA SAYS HOW AND WHEN THE ADDRESS WAS PROVEN (Account UX spec
 * 6, Security: "How the address was proven, and when"; plan CP-H, CP-047).
 *
 * WHAT WAS WRONG. Whether the address was proven decided what the account page
 * showed (purchases under the address, the mailing lists), but nothing on the
 * page said whether it was, how, or when: a person whose purchases did not
 * appear could not tell that the address was the reason.
 *
 * WHAT HOLDS NOW.
 *   - get-account-data, run against the shipped handler with the database
 *     faked, answers mailboxProof {how, at} for a proven address: from R1's
 *     proof row (an emailed code -> "code", at the sign-in that proved it),
 *     from a Google identity for that address when no row exists, and null for
 *     an unproven address or when the row cannot be read;
 *   - the Security card's half is w4b-the-security-card-says-how-and-when-the-
 *     address-was-proven.test.tsx.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const USER_ID = "00000000-0000-4000-8000-0000000a0007";
const EMAIL = "member@example.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const SESSION = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const GOOGLE_SESSION = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "oauth", timestamp: 1 }], app_metadata: { provider: "google" } })}.sig`;
const GOOGLE_IDENTITY = { provider: "google", created_at: "2026-09-30T08:00:00Z", identity_data: { email: EMAIL, email_verified: true } };

let handler: EdgeHandler;
let db: FakeDb;
let failProofRead = false;

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__w4bProof = () => ({
    from: (t: string) => {
      if (t === "account_mailbox_proofs" && failProofRead) {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: { message: "boom" } });
        // The proof RULE (R1's hasMailboxProof) reads through the same chain;
        // it fails closed, so only the provider identity can prove here.
        return chain;
      }
      return db.from(t);
    },
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (token: string) => (token === SESSION
        ? { data: { user: { id: USER_ID, email: EMAIL, identities: [{ provider: "email", identity_data: { email: EMAIL } }] } }, error: null }
        : token === GOOGLE_SESSION
          ? { data: { user: { id: USER_ID, email: EMAIL, identities: [GOOGLE_IDENTITY], app_metadata: { provider: "google", providers: ["google"] } } }, error: null }
          : { data: { user: null }, error: { message: "no" } }),
      admin: { signOut: async () => ({ error: null }), updateUserById: async () => ({ error: null }) },
    },
  });
  handler = await loadEdgeHandler("get-account-data", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__w4bProof(...a); }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  failProofRead = false;
  db.rpcs.scan_credit_balance = () => ({ data: 0, error: null });
});

const ask = async (token = SESSION) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/get-account-data", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
  return await res.json() as Record<string, any>;
};

describe("get-account-data says how and when a proven address was proven", () => {
  it("R1's proof row from an emailed code reads as a code, at the sign-in that proved it", async () => {
    db.rows("account_mailbox_proofs").push({ id: 1, user_id: USER_ID, email: EMAIL, method: "otp", amr_at: "2026-10-12T09:30:00Z", created_at: "2026-10-12T09:30:05Z" });
    const r = await ask();
    expect(r.mailboxProven).toBe(true);
    expect(r.mailboxProof).toEqual({ how: "code", at: "2026-10-12T09:30:00Z" });
  });

  it("a Google identity for the address, with no row, reads as a provider sign-in", async () => {
    const r = await ask(GOOGLE_SESSION);
    expect(r.mailboxProven).toBe(true);
    expect(r.mailboxProof).toEqual({ how: "provider", at: "2026-09-30T08:00:00Z" });
  });

  it("an unproven address has no proof to describe", async () => {
    const r = await ask();
    expect(r.mailboxProven).toBe(false);
    expect(r.mailboxProof).toBeNull();
  });

  it("a proof row that cannot be read is said as nothing, never guessed", async () => {
    failProofRead = true;
    const r = await ask(GOOGLE_SESSION);
    expect(r.mailboxProven).toBe(true);
    expect(r.mailboxProof).toBeNull();
  });
});

