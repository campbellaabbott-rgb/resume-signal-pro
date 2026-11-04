// @vitest-environment node
/**
 * A CONNECTED APP'S TOKEN IS NO ONE AT THE SPEND GATE (S9-001, the line held
 * while free-keyword-scan was in flight).
 *
 * The gate lets a caller who has proven something spend an allowance of its own
 * and the "proven" ceiling, on the word of a signed-in token the auth server
 * accepts. With the access-token hook on, a connector token carries role
 * mcp_client and the role check already turned it away. With the hook off, or
 * for a token minted before it, the token has role authenticated and a
 * client_id, and the auth server answers with the person: a connected app was
 * then counted as that person, and spent that person's allowance. provenCaller
 * now reads a client_id the way websiteTokenRefusal does: the caller is a
 * stranger, counted by address under the strangers' ceiling like anyone holding
 * the publishable key, and the auth server is never asked. Nothing is refused
 * that a stranger would have been allowed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GLOBAL_BUCKET, modelSpendGate, PROVEN_BUCKET, provenCaller } from "../../supabase/functions/_shared/model-spend-gate";

const USER_ID = "4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21";
const EMAIL = "jane@example.com";
const GOOGLE_USER = { id: USER_ID, email: EMAIL, identities: [{ provider: "google", identity_data: { email: EMAIL, email_verified: true } }] };
const CORS = { "Access-Control-Allow-Origin": "*" };

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.c2lnbmF0dXJl`;
const amr = [{ method: "oauth", timestamp: 1760000000 }];
const WEBSITE = jwt({ role: "authenticated", aud: "authenticated", sub: USER_ID, amr });
// The same person's token as the OAuth server mints it with the hook off.
const CONNECTOR_UNHOOKED = jwt({ role: "authenticated", aud: "authenticated", sub: USER_ID, amr, client_id: "mcp-client-1" });
// A client_id with no value is still a client_id, as websiteTokenRefusal reads it.
const CONNECTOR_EMPTY_ID = jwt({ role: "authenticated", aud: "authenticated", sub: USER_ID, amr, client_id: "" });
const CONNECTOR_HOOKED = jwt({ role: "mcp_client", aud: "https://p.supabase.co/functions/v1/agent-mcp", sub: USER_ID, amr, client_id: "mcp-client-1" });

function fakeDb() {
  const buckets: unknown[] = [];
  const asked: string[] = [];
  return {
    buckets,
    asked,
    rpc: async (fn: string, a: Record<string, unknown>) => {
      if (fn === "pro_entitlement_rows") return { data: [], error: null };
      buckets.push(a.p_ip);
      return { data: true, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    auth: { getUser: async (t: string) => { asked.push(t); return { data: { user: GOOGLE_USER }, error: null }; } },
  };
}
const withBearer = (t: string) => new Headers({ authorization: `Bearer ${t}`, "cf-connecting-ip": "203.0.113.9" });
const reqWith = (t: string) => new Request("https://x.test/fn", { method: "POST", headers: withBearer(t) });

let prevDeno: unknown;
beforeEach(() => {
  prevDeno = (globalThis as Record<string, unknown>).Deno;
  (globalThis as Record<string, unknown>).Deno = { env: { get: () => undefined } };
});
afterEach(() => { (globalThis as Record<string, unknown>).Deno = prevDeno; });

describe("who the gate counts as a proven caller", () => {
  it("a website session of a proven mailbox is that person (the control: the door still opens)", async () => {
    const db = fakeDb();
    expect(await provenCaller(db, withBearer(WEBSITE), undefined)).toBe(`user:${USER_ID}`);
    expect(db.asked).toEqual([WEBSITE]);
  });

  it("the same person's connector token, hook off, is no one, and the auth server is not asked", async () => {
    const db = fakeDb();
    expect(await provenCaller(db, withBearer(CONNECTOR_UNHOOKED), undefined)).toBeNull();
    expect(db.asked, "the auth server answers with the person for this token").toEqual([]);
  });

  it("a client_id with an empty value is read the same way", async () => {
    const db = fakeDb();
    expect(await provenCaller(db, withBearer(CONNECTOR_EMPTY_ID), undefined)).toBeNull();
    expect(db.asked).toEqual([]);
  });

  it("the hooked token stays no one", async () => {
    const db = fakeDb();
    expect(await provenCaller(db, withBearer(CONNECTOR_HOOKED), undefined)).toBeNull();
    expect(db.asked).toEqual([]);
  });
});

describe("what a connector token spends at the gate", () => {
  const LIMITS = { perAddress: 20, globalPerHour: 200 };

  it("the strangers' allowance and ceiling, never the person's", async () => {
    const db = fakeDb();
    expect(await modelSpendGate(db, reqWith(CONNECTOR_UNHOOKED), "generate-summary", LIMITS, CORS)).toBeNull();
    expect(db.buckets).toContain("203.0.113.9");
    expect(db.buckets).toContain(GLOBAL_BUCKET);
    expect(db.buckets).not.toContain(`user:${USER_ID}`);
    expect(db.buckets).not.toContain(PROVEN_BUCKET);
  });

  it("the person's own session still spends the person's (the control)", async () => {
    const db = fakeDb();
    expect(await modelSpendGate(db, reqWith(WEBSITE), "generate-summary", LIMITS, CORS)).toBeNull();
    expect(db.buckets).toContain(`user:${USER_ID}`);
    expect(db.buckets).toContain(PROVEN_BUCKET);
    expect(db.buckets).not.toContain(GLOBAL_BUCKET);
  });
});
