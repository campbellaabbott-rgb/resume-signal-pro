// @vitest-environment node
//
// Node, not jsdom: the scan-credits handler is bundled with esbuild
// (helpers/edge-harness.ts).
/**
 * AN ADDRESS ON A SESSION IS NOT PROOF OF ITS MAILBOX.
 *
 * Review of claude/w1-scan-ai (2026-10-05): the project auto-confirms
 * password sign-ups (/auth/v1/settings: mailer_autoconfirm = true), so an
 * attacker could sign up as a guest buyer's address, get a session at once,
 * read that address's scan-credit balance from scan-credits and spend it in
 * the scanner (2.07 and 1.26 reopened through the JWT), or scan without limit
 * as a Pro subscriber's address. With auto-confirm on, an address CHANGE is
 * applied at once as well, so even a session that began with an emailed link
 * proves nothing about the address the account carries now.
 *
 * Run, not read:
 *   - supabase/functions/_shared/mailbox-proof.ts, the rule itself: a Google
 *     or Apple sign-in for the provider-verified address; or, only after the
 *     owner switched confirmation on AND the auth server itself says it no
 *     longer auto-confirms, a confirmation or an emailed sign-in after that
 *     moment;
 *   - the shipped scan-credits handler: a password sign-up as a buyer's
 *     address is shown none of that address's credits; a Google-proven
 *     owner is; a held purchase presented while signed in is claimed for the
 *     account.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import {
  autoconfirmIsOff,
  confirmedSinceEnforcement,
  provenMailbox,
  resetAutoconfirmCache,
  sessionAuthMethods,
  verifiedByProvider,
} from "../../supabase/functions/_shared/mailbox-proof";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (sub: string, amr: unknown) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", amr })}.sig`;
const now = () => Math.floor(Date.now() / 1000);
const google = (email: string, verified: unknown = true) => [{ provider: "google", identity_data: { email, email_verified: verified } }];

const USER_ID = "00000000-0000-4000-8000-0000000000d1";
const settings = (autoconfirm: unknown, status = 200) =>
  (async () => new Response(JSON.stringify({ mailer_autoconfirm: autoconfirm }), { status })) as unknown as typeof fetch;

describe("the rule", () => {
  beforeEach(() => resetAutoconfirmCache());

  it("reads the session's sign-in methods in both shapes, and nothing from a token that is not one", () => {
    expect(sessionAuthMethods(token("x", [{ method: "oauth", timestamp: 1700000000 }]))).toEqual([{ method: "oauth", at: 1700000000 }]);
    expect(sessionAuthMethods(token("x", ["otp"]))).toEqual([{ method: "otp", at: null }]);
    expect(sessionAuthMethods("anon_key_not_a_jwt")).toEqual([]);
    expect(sessionAuthMethods("a.%%%.c")).toEqual([]);
  });

  it("a Google sign-in proves the address Google verified, and only that one", () => {
    const jwt = token(USER_ID, [{ method: "oauth", timestamp: now() }]);
    expect(verifiedByProvider({ id: USER_ID, email: "Owner@Example.com", identities: google("owner@example.com") }, jwt)).toBe(true);
    // The account's address was changed away from Google's (auto-confirm applies a change at once).
    expect(verifiedByProvider({ id: USER_ID, email: "victim@example.com", identities: google("owner@example.com") }, jwt)).toBe(false);
    // Google did not verify it.
    expect(verifiedByProvider({ id: USER_ID, email: "owner@example.com", identities: google("owner@example.com", false) }, jwt)).toBe(false);
    // A provider that does not verify addresses for us.
    expect(verifiedByProvider({ id: USER_ID, email: "owner@example.com", identities: [{ provider: "azure", identity_data: { email: "owner@example.com", email_verified: true } }] }, jwt)).toBe(false);
  });

  it("the proof is the session, not the account: a password session on a Google-linked account proves nothing", () => {
    const password = token(USER_ID, [{ method: "password", timestamp: now() }]);
    expect(verifiedByProvider({ id: USER_ID, email: "owner@example.com", identities: google("owner@example.com") }, password)).toBe(false);
  });

  it("a confirmation counts only at or after the moment the owner switched confirmation on", () => {
    const since = "2026-10-06T12:00:00Z";
    const password = token(USER_ID, [{ method: "password", timestamp: now() }]);
    expect(confirmedSinceEnforcement({ id: USER_ID, email: "a@b.co", email_confirmed_at: "2026-10-06T12:00:01Z" }, password, since)).toBe(true);
    // Auto-confirmed before it: unproven, however the account signs in by password.
    expect(confirmedSinceEnforcement({ id: USER_ID, email: "a@b.co", email_confirmed_at: "2026-10-01T00:00:00Z" }, password, since)).toBe(false);
    // ...until it signs in through a link sent to the address after that moment.
    const link = token(USER_ID, [{ method: "otp", timestamp: Date.parse("2026-10-07T00:00:00Z") / 1000 }]);
    expect(confirmedSinceEnforcement({ id: USER_ID, email: "a@b.co", email_confirmed_at: "2026-10-01T00:00:00Z" }, link, since)).toBe(true);
    const oldLink = token(USER_ID, [{ method: "magiclink", timestamp: Date.parse("2026-10-02T00:00:00Z") / 1000 }]);
    expect(confirmedSinceEnforcement({ id: USER_ID, email: "a@b.co", email_confirmed_at: "2026-10-01T00:00:00Z" }, oldLink, since)).toBe(false);
    // No flag, no confirmation proof at all.
    expect(confirmedSinceEnforcement({ id: USER_ID, email: "a@b.co", email_confirmed_at: "2026-10-09T00:00:00Z" }, password, null)).toBe(false);
  });

  it("the auth server must say auto-confirm is off; any failure to read it is 'still on'", async () => {
    const env = { supabaseUrl: "https://p.supabase.co", anonKey: "anon" };
    expect(await autoconfirmIsOff({ ...env, fetchImpl: settings(false) })).toBe(true);
    resetAutoconfirmCache();
    expect(await autoconfirmIsOff({ ...env, fetchImpl: settings(true) })).toBe(false);
    resetAutoconfirmCache();
    expect(await autoconfirmIsOff({ ...env, fetchImpl: settings(undefined) })).toBe(false);
    resetAutoconfirmCache();
    expect(await autoconfirmIsOff({ ...env, fetchImpl: settings(false, 500) })).toBe(false);
    resetAutoconfirmCache();
    expect(await autoconfirmIsOff({ ...env, fetchImpl: (async () => { throw new Error("down"); }) as unknown as typeof fetch })).toBe(false);
  });

  it("provenMailbox: the flag with auto-confirm still on proves nothing; with it off, a later confirmation does", async () => {
    const user = { id: USER_ID, email: "buyer@example.com", email_confirmed_at: new Date().toISOString() };
    const jwt = token(USER_ID, [{ method: "password", timestamp: now() }]);
    const base = { confirmedSince: new Date(Date.now() - 3600_000).toISOString(), supabaseUrl: "https://p.supabase.co", anonKey: "anon" };
    expect(await provenMailbox(user, jwt, { ...base, fetchImpl: settings(true) })).toBeNull();
    resetAutoconfirmCache();
    expect(await provenMailbox(user, jwt, { ...base, fetchImpl: settings(false) })).toBe("buyer@example.com");
    resetAutoconfirmCache();
    // Today's live setting, no flag: a fresh password sign-up proves nothing.
    expect(await provenMailbox(user, jwt, { supabaseUrl: base.supabaseUrl, fetchImpl: settings(true) })).toBeNull();
    expect(await provenMailbox(null, jwt, base)).toBeNull();
  });
});

// ── the shipped scan-credits handler ─────────────────────────────────────────
type Args = Record<string, unknown>;
let handler: EdgeHandler;
let rpcLog: Array<[string, Args]>;
let claims: Map<string, string>;
const VICTIM_POOL = 9;
const SQUATTER = "00000000-0000-4000-8000-0000000000e1";
const OWNER = "00000000-0000-4000-8000-0000000000e2";
const JWT = {
  squatter: token(SQUATTER, [{ method: "password", timestamp: now() }]),
  ownerGoogle: token(OWNER, [{ method: "oauth", timestamp: now() }]),
  ownerPassword: token(OWNER, [{ method: "password", timestamp: now() }]),
};
const USERS: Record<string, unknown> = {
  [JWT.squatter]: { id: SQUATTER, email: "victim@example.com", email_confirmed_at: new Date().toISOString() },
  [JWT.ownerGoogle]: { id: OWNER, email: "owner@example.com", identities: google("owner@example.com") },
  [JWT.ownerPassword]: { id: OWNER, email: "owner@example.com", identities: google("owner@example.com") },
};
const HELD = "cs_test_ownerbuysthreecredits";
let heldHash = "";

function client() {
  const rpc = async (name: string, args: Args = {}) => {
    rpcLog.push([name, args]);
    switch (name) {
      case "check_rate_limit": return { data: true, error: null };
      case "scan_credit_balance": {
        const pools: Record<string, number> = { "victim@example.com": VICTIM_POOL, "owner@example.com": 4 };
        const own = args.p_email ? pools[String(args.p_email)] ?? 0 : 0;
        const held = (args.p_session_hashes as string[] | null)?.includes(heldHash) || claims.get(heldHash) === args.p_user_id ? 3 : 0;
        return { data: own + (args.p_email === "owner@example.com" ? 0 : held), error: null };
      }
      case "scan_credit_grants_bought": return { data: (args.p_session_hashes as string[]).includes(heldHash) ? 3 : 0, error: null };
      case "scan_credit_grant_claim": {
        for (const h of args.p_session_hashes as string[]) if (!claims.has(h)) claims.set(h, String(args.p_user_id));
        return { data: 1, error: null };
      }
      default: return { data: null, error: null };
    }
  };
  const from = (table: string) => {
    const q: Record<string, unknown> = {
      select: () => q,
      in: () => q,
      then: (ok: (r: unknown) => unknown) =>
        Promise.resolve(table === "scan_credit_session_grants"
          ? { data: [{ session_hash: heldHash, email: "owner@example.com" }], error: null }
          : { data: [], error: null }).then(ok),
    };
    return q;
  };
  return { rpc, from, auth: { getUser: async (jwt: string) => ({ data: { user: USERS[jwt] ?? null }, error: null }) } };
}

beforeAll(async () => {
  const { sessionHash } = await import("../../supabase/functions/_shared/scan-credits");
  heldHash = await sessionHash(HELD);
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness",
    SUPABASE_ANON_KEY: "anon_harness",
    STRIPE_SECRET_KEY: "sk_test_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string) => {
    if (String(url).endsWith("/auth/v1/settings")) return new Response(JSON.stringify({ mailer_autoconfirm: true }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  handler = await loadEdgeHandler("scan-credits", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__creditsClient;",
  });
}, 180_000);

beforeEach(() => {
  rpcLog = [];
  claims = new Map();
  (globalThis as Record<string, unknown>).__creditsClient = client();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function ask(jwt: string, sessions: string[] = []) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/scan-credits", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}`, "cf-connecting-ip": "198.51.100.7" },
    body: JSON.stringify({ sessions }),
  }));
  return { status: res.status, build: res.headers.get("x-fn-build"), json: await res.json() as Record<string, unknown> };
}

describe("the scan-credits handler", () => {
  it("a password sign-up as a buyer's address is shown none of that address's credits", async () => {
    const r = await ask(JWT.squatter);
    expect(r.status).toBe(200);
    expect(r.json.credits).toBe(0);
    expect(r.json.mailboxProven).toBe(false);
    const asked = rpcLog.find(([n]) => n === "scan_credit_balance")?.[1];
    expect(asked?.p_email).toBeNull();
    expect(asked?.p_user_id).toBe(SQUATTER);
  });

  it("the owner signed in with Google for that address is shown the address's pool", async () => {
    const r = await ask(JWT.ownerGoogle);
    expect(r.json.credits).toBe(4);
    expect(r.json.mailboxProven).toBe(true);
    expect(buildIsAtLeast(r.build, "scan-credits", "2026-10-08"), `build ${r.build}`).toBe(true);
  });

  it("a held purchase presented while signed in by password is claimed for the account, and then needs no id", async () => {
    const withId = await ask(JWT.ownerPassword, [HELD]);
    expect(withId.json.mailboxProven).toBe(false);
    expect(withId.json.credits).toBe(3);
    expect(claims.get(heldHash)).toBe(OWNER);
    // Another device, same account, nothing held: the claim still counts; the pool behind it does not.
    const elsewhere = await ask(JWT.ownerPassword, []);
    expect(elsewhere.json.credits).toBe(3);
  });

  it("no session and no account: zero, without a database call", async () => {
    const r = await ask("anon_harness");
    expect(r.json).toMatchObject({ credits: 0, signedIn: false, mailboxProven: false });
    expect(rpcLog).toEqual([]);
  });
});

// ── the shipped get-account-data handler (the Account page's credits and purchases) ──
describe("the get-account-data handler", () => {
  let accountHandler: EdgeHandler;
  let purchaseReads: Array<[string, unknown]>;
  let balanceArgs: Args[];

  const accountClient = () => ({
    auth: { getUser: async (jwt: string) => ({ data: { user: USERS[jwt] ?? null }, error: USERS[jwt] ? null : { message: "bad jwt" } }) },
    rpc: async (name: string, args: Args) => {
      if (name !== "scan_credit_balance") return { data: null, error: null };
      balanceArgs.push(args);
      const pools: Record<string, number> = { "victim@example.com": VICTIM_POOL, "owner@example.com": 4 };
      return { data: (args.p_email ? pools[String(args.p_email)] ?? 0 : 0) + (args.p_user_id === OWNER ? 3 : 0), error: null };
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (_c: string, v: unknown) => { purchaseReads.push([table, v]); return q; },
        order: () => q,
        limit: () => Promise.resolve({ data: [{ product_name: "Premium Resume Package", created_at: "2026-09-30T10:00:00Z" }], error: null }),
      };
      return q;
    },
  });

  beforeAll(async () => {
    accountHandler = await loadEdgeHandler("get-account-data", {
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__accountClient;",
    });
  }, 180_000);

  beforeEach(() => {
    purchaseReads = [];
    balanceArgs = [];
    (globalThis as Record<string, unknown>).__accountClient = accountClient();
  });

  const account = async (jwt: string) => {
    const res = await accountHandler(new Request("https://harness.supabase.co/functions/v1/get-account-data", {
      method: "POST", headers: { authorization: `Bearer ${jwt}` },
    }));
    return { status: res.status, build: res.headers.get("x-fn-build"), json: await res.json() as Record<string, unknown> };
  };

  it("a password sign-up as a buyer's address sees none of that address's credits or purchases", async () => {
    const r = await account(JWT.squatter);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ credits: 0, purchases: [], mailboxProven: false });
    // The one read it makes is the mailbox switch row, never a purchase.
    expect(purchaseReads.filter(([t]) => t === "purchased_content")).toEqual([]);
    expect(balanceArgs[0]).toMatchObject({ p_email: null, p_user_id: SQUATTER });
  });

  it("a password session still sees what its account claimed", async () => {
    const r = await account(JWT.ownerPassword);
    expect(r.json).toMatchObject({ credits: 3, purchases: [], mailboxProven: false });
  });

  it("a Google-proven owner sees the address's pool, its claims and its purchases", async () => {
    const r = await account(JWT.ownerGoogle);
    expect(r.json.credits).toBe(7);
    expect(r.json.mailboxProven).toBe(true);
    expect(r.json.purchases).toEqual([{ product: "Premium Resume Package", date: "2026-09-30T10:00:00Z" }]);
    expect(purchaseReads).toEqual([["purchased_content", "owner@example.com"]]);
    expect(buildIsAtLeast(r.build, "get-account-data", "2026-10-08"), `build ${r.build}`).toBe(true);
  });

  it("no valid session: 401", async () => {
    expect((await account("not-a-session")).status).toBe(401);
  });
});
