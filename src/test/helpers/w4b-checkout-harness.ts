/**
 * THE CHECKOUTS, RUN WITH ONLY THEIR NETWORK FAKED (wave 4 round 2,
 * checkout-catalogue). One Stripe world, one FakeDb, one auth server whose
 * answers a test chooses, and the shipped handlers of create-checkout,
 * create-product-checkout, create-subscription-checkout,
 * create-scan-pack-checkout, create-test-checkout, check-subscription and
 * create-portal-session.
 */
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./edge-harness";
import { SELLER_NAMED_STUB } from "./w4b-seller-named";

export const W4B_ENV: Record<string, string | undefined> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
  SUPABASE_ANON_KEY: "anon_harness_key",
  STRIPE_SECRET_KEY: "sk_test_harness",
  RESEND_API_KEY: undefined,
};

export type StripeWorld = {
  customers: Record<string, Array<{ id: string; email?: string }>>;
  subs: Record<string, Array<Record<string, unknown>>>;
  invoices: Record<string, Array<Record<string, unknown>>>;
  sessions: Record<string, unknown>;
  created: Array<Record<string, unknown>>;
  portals: Array<Record<string, unknown>>;
  touched: string[];
};

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__w4bStripe;
    const touch = (x) => w().touched.push(x);
    this.customers = {
      list: async ({ email }) => { touch("customers.list"); return { data: w().customers[email] ?? [], has_more: false }; },
      retrieve: async (id) => { touch("customers.retrieve"); return { id, email: null }; },
    };
    this.subscriptions = { list: async ({ customer, status }) => {
      touch("subscriptions.list");
      const all = w().subs[customer] ?? [];
      return { data: status && status !== "all" ? all.filter((s) => s.status === status) : all, has_more: false };
    } };
    this.invoices = { list: async ({ subscription, status }) => {
      touch("invoices.list");
      const all = w().invoices[subscription] ?? [];
      return { data: status ? all.filter((i) => i.status === status) : all, has_more: false };
    } };
    this.promotionCodes = { list: async () => ({ data: [] }) };
    this.checkout = { sessions: {
      create: async (p) => { touch("sessions.create"); w().created.push(p); return { id: "cs_test_w4b" + String(w().created.length).padStart(4, "0"), url: "https://checkout.stripe.com/c/cs_test_w4b", amount_total: 500, currency: p.line_items?.[0]?.price_data?.currency ?? "usd", mode: p.mode }; },
      retrieve: async (id) => { const s = w().sessions[id]; if (!s) throw new Error("No such checkout.session"); return s; },
      expire: async (id) => { touch("sessions.expire:" + id); return {}; },
    } };
    this.billingPortal = { sessions: { create: async (p) => { touch("portal.create"); w().portals.push(p); return { url: "https://billing.stripe.com/p/session/x" }; } } };
  }
}`;
const SERVER = "export function serve(h) { globalThis.__edgeHandler = h; }";
// A proxy, so a client a function builds at module load (create-checkout) reads
// the world of the test that runs, not the one that existed when it loaded.
const LIVE_CLIENT = "new Proxy({}, { get: (_t, p) => globalThis.__w4bClient[p] })";
const CLIENT = `export function createClient() { return ${LIVE_CLIENT}; }`;

export const W4B_STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": SERVER,
  "https://deno.land/std@0.168.0/http/server.ts": SERVER,
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "_shared/supabase-client.ts": `export const getServiceClient = () => ${LIVE_CLIENT};`,
};

export type User = { id: string; email: string };

export interface W4bWorld {
  db: FakeDb;
  stripe: StripeWorld;
  users: Record<string, User>;
  /** Make the auth server fail (a transport or 5xx error) instead of answering. */
  authDown: boolean;
  /** Every fetch the handler made (the ipinfo lookup). */
  fetches: string[];
  /** What the fake ipinfo answers, by address. */
  ipCountry: Record<string, string>;
}

export function freshWorld(users: Record<string, User> = {}): W4bWorld {
  const db = new FakeDb({ pro_subscribers: ["email"], used_stripe_sessions: ["session_id"] });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.record_checkout_start = () => ({ data: true, error: null });
  db.rpcs.pro_entitlement_rows = () => ({ data: [], error: null });
  const world: W4bWorld = {
    db,
    stripe: { customers: {}, subs: {}, invoices: {}, sessions: {}, created: [], portals: [], touched: [] },
    users,
    authDown: false,
    fetches: [],
    ipCountry: {},
  };
  const g = globalThis as Record<string, unknown>;
  g.__w4bStripe = world.stripe;
  g.__w4bClient = {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (jwt?: string) => {
        if (world.authDown) return { data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" } };
        const u = jwt ? world.users[jwt] : undefined;
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { name: "AuthApiError", status: 403, message: "bad jwt" } };
      },
    },
  };
  g.fetch = async (url: string | URL) => {
    const href = String(url);
    world.fetches.push(href);
    const m = /^https:\/\/ipinfo\.io\/([^?]+)\?/.exec(href);
    if (m) {
      const country = world.ipCountry[decodeURIComponent(m[1])];
      return new Response(JSON.stringify(country ? { country } : {}), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };
  return world;
}

export function installDeno(env: Record<string, string | undefined> = W4B_ENV): void {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
}

/**
 * The handlers, by default with a seller named (w4b-seller-named.ts), so a
 * test of what a checkout does once it sells is not answered by the seller
 * gate. `{ seller: "as-shipped" }` loads them with the shipped, empty
 * identity, for the tests of the gate itself.
 */
export async function loadCheckouts(fns: string[], opts: { seller?: "named" | "as-shipped" } = {}): Promise<Record<string, EdgeHandler>> {
  const stubs = opts.seller === "as-shipped" ? W4B_STUBS : { ...W4B_STUBS, ...SELLER_NAMED_STUB };
  const out: Record<string, EdgeHandler> = {};
  for (const fn of fns) out[fn] = await loadEdgeHandler(fn, stubs);
  return out;
}

export function post(h: EdgeHandler, fn: string, body: unknown, opts: { bearer?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  return h(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "198.51.100.8",
      origin: "https://resumebooster.work",
      authorization: `Bearer ${opts.bearer ?? W4B_ENV.SUPABASE_ANON_KEY}`,
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify(body),
  }));
}
