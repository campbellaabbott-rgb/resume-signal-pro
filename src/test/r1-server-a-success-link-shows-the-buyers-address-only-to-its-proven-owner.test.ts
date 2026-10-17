// @vitest-environment node
//
// Node, not jsdom: verify-product-purchase is bundled with esbuild
// (helpers/edge-harness.ts).
/**
 * R1: A SUCCESS LINK SHOWS THE BUYER'S ADDRESS ONLY TO ITS PROVEN OWNER
 * (plan review item "Privacy: the success URL discloses the buyer's address";
 * contract 4 of the R1 plan).
 *
 * verify-product-purchase answered anyone holding a success link (a Stripe
 * session id, which travels in mail and in a host's analytics) with the
 * buyer's full address. Run against the shipped handler, with Stripe and the
 * database faked:
 *   - no session, the publishable key, a session whose account has not proven
 *     that address, a connector's token, a proof for a different address:
 *     masked (first character, ***, @domain) and customerEmailMasked true;
 *   - a website session whose account proved that exact address: the full
 *     address and customerEmailMasked false;
 *   - nothing else in the answer changes shape, a purchase with no address
 *     stays null, and the address is never written to the function's logs.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { maskEmail } from "../../supabase/functions/_shared/mailbox-proof";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": `export default class Stripe {
    constructor() { this.checkout = { sessions: { retrieve: async (id) => { const s = globalThis.__maskWorld[id]; if (!s) throw new Error("No such checkout.session"); return s; } } }; }
  }`,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__maskClient;",
};

const env: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_test_harness",
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
  SUPABASE_ANON_KEY: "anon_harness",
};

const USER = "8d3e2a1b-1111-4222-8333-944445555666";
const OTHER = "9d3e2a1b-1111-4222-8333-944445555666";
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tok = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.sig`;
const sessionFor = (sub: string, extra: Record<string, unknown> = {}) =>
  tok({ sub, role: "authenticated", aud: "authenticated", session_id: "5d3e2a1b-1111-4222-8333-944445555666", ...extra });

let verify: EdgeHandler;
const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
const world: Record<string, unknown> = {};
/** jwt -> the user the auth server answers for it. */
const users = new Map<string, { id: string; email: string }>();
const logged: string[] = [];
const mails: Array<Record<string, unknown>> = [];

const client = {
  from: (t: string) => db.from(t),
  rpc: (name: string, args: Record<string, unknown> = {}) => db.rpc(name, args),
  auth: {
    getUser: async (jwt: string) => {
      const u = users.get(jwt);
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
    },
  },
};

const paid = (id: string, email: string | null, over: Record<string, unknown> = {}) => ({
  id, mode: "payment", payment_status: "paid", amount_total: 600, currency: "usd",
  customer_email: null, customer_details: { email }, metadata: { product_type: "scan_pack", product_name: "Scan Pack", credits: "30" }, ...over,
});

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.__maskClient = client;
  g.__maskWorld = world;
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/functions/v1/send-product-email")) {
      mails.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  verify = await loadEdgeHandler("verify-product-purchase", STUBS);
}, 120_000);

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  db.tables = {};
  db.writes = [];
  db.faults = [];
  users.clear();
  for (const k of Object.keys(world)) delete world[k];
  db.rpcs = {
    check_rate_limit: () => ({ data: true, error: null }),
    add_scan_credits: () => ({ data: true, error: null }),
    save_purchased_content: () => ({ data: "pc-1", error: null }),
    log_delivery_step: () => ({ data: "pd-1", error: null }),
  };
  logged.length = 0;
  mails.length = 0;
  logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
});
afterEach(() => { logSpy.mockRestore(); });

async function post(sessionId: string, authorization?: string) {
  const res = await verify(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.40", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify({ sessionId }),
  }));
  return { status: res.status, headers: res.headers, json: await res.json() as Record<string, unknown> };
}

describe("the mask", () => {
  it("keeps the first character and the domain, and shows nothing of a value that is not an address", () => {
    expect(maskEmail("Jane.Doe@Gmail.com")).toBe("j***@gmail.com");
    expect(maskEmail(" j@x.io ")).toBe("j***@x.io");
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("")).toBeNull();
    expect(maskEmail("no-at-sign")).toBe("***");
    expect(maskEmail("@nolocal.com")).toBe("***");
    expect(maskEmail("trailing@")).toBe("***");
  });
});

describe("verify-product-purchase", () => {
  it("names its build, and masks the address for a caller with no session", async () => {
    world.cs_live_mask_1 = paid("cs_live_mask_1", "Jane.Doe@Gmail.com");
    const r = await post("cs_live_mask_1");
    expect(r.status).toBe(200);
    expect(buildIsAtLeast(r.headers.get("x-fn-build"), "verify-product-purchase", "2026-10-14", 1)).toBe(true);
    expect(r.json).toMatchObject({ success: true, verified: true, isFirstUse: true, productType: "scan_pack", customerEmail: "j***@gmail.com", customerEmailMasked: true, emailSent: true });
    // The buyer is still mailed at the real address; only the answer is masked.
    expect(mails.map((m) => m.email)).toEqual(["jane.doe@gmail.com"]);
    expect(logged.join("\n")).not.toContain("jane.doe@gmail.com");
    expect(logged.join("\n").toLowerCase()).not.toContain("jane.doe");
  });

  it("masks for the publishable key, an unproven account, a proof of another address, a proof held by another account, and a connector's token", async () => {
    world.cs_live_mask_2 = paid("cs_live_mask_2", "jane.doe@gmail.com");
    const anonKey = tok({ role: "anon", iss: "supabase" });
    const mine = sessionFor(USER);
    const connector = sessionFor(USER, { client_id: "mcp" });
    const someoneElse = sessionFor(OTHER);
    users.set(mine, { id: USER, email: "jane.doe@gmail.com" });
    users.set(connector, { id: USER, email: "jane.doe@gmail.com" });
    users.set(someoneElse, { id: OTHER, email: "other@example.com" });
    db.rows("account_mailbox_proofs").push({ user_id: USER, email: "different@gmail.com" });
    db.rows("account_mailbox_proofs").push({ user_id: OTHER, email: "jane.doe@gmail.com" });
    for (const auth of [undefined, `Bearer ${anonKey}`, `Bearer ${mine}`, `Bearer ${connector}`, "Bearer not-a-token"]) {
      const r = await post("cs_live_mask_2", auth);
      expect(r.status, String(auth)).toBe(200);
      expect(r.json.customerEmail, String(auth)).toBe("j***@gmail.com");
      expect(r.json.customerEmailMasked, String(auth)).toBe(true);
    }
    // OTHER proved jane's address on THEIR account: they may see it, nobody else through OTHER's proof.
    const r = await post("cs_live_mask_2", `Bearer ${someoneElse}`);
    expect(r.json.customerEmail).toBe("jane.doe@gmail.com");
  });

  it("shows the full address to a website session whose account proved that exact address", async () => {
    world.cs_live_mask_3 = paid("cs_live_mask_3", "Jane.Doe@Gmail.com");
    const mine = sessionFor(USER);
    users.set(mine, { id: USER, email: "jane.doe@gmail.com" });
    db.rows("account_mailbox_proofs").push({ user_id: USER, email: "jane.doe@gmail.com" });
    const first = await post("cs_live_mask_3", `Bearer ${mine}`);
    expect(first.json).toMatchObject({ customerEmail: "jane.doe@gmail.com", customerEmailMasked: false, isFirstUse: true });
    // A refresh of the same link: still verified, still shown to its owner, masked to anyone else.
    const refresh = await post("cs_live_mask_3", `Bearer ${mine}`);
    expect(refresh.json).toMatchObject({ customerEmail: "jane.doe@gmail.com", customerEmailMasked: false, isFirstUse: false });
    const stranger = await post("cs_live_mask_3");
    expect(stranger.json).toMatchObject({ customerEmail: "j***@gmail.com", customerEmailMasked: true, isFirstUse: false });
    expect(logged.join("\n")).not.toContain("jane.doe@gmail.com");
  });

  it("a proof table that cannot be read masks (fails closed), and a purchase with no address stays null and unmasked", async () => {
    world.cs_live_mask_4 = paid("cs_live_mask_4", "jane.doe@gmail.com");
    const mine = sessionFor(USER);
    users.set(mine, { id: USER, email: "jane.doe@gmail.com" });
    db.rows("account_mailbox_proofs").push({ user_id: USER, email: "jane.doe@gmail.com" });
    db.faults.push({ table: "account_mailbox_proofs", op: "select", error: { code: "42P01", message: "relation does not exist" } });
    expect((await post("cs_live_mask_4", `Bearer ${mine}`)).json).toMatchObject({ customerEmail: "j***@gmail.com", customerEmailMasked: true });

    world.cs_live_mask_5 = paid("cs_live_mask_5", null);
    const none = await post("cs_live_mask_5");
    expect(none.status).toBe(200);
    expect(none.json).toMatchObject({ customerEmail: null, customerEmailMasked: false });
  });
});
