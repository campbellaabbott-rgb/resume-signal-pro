// @vitest-environment node
/**
 * A FORGED STRIPE EVENT IS REFUSED BEFORE ANYTHING IS WRITTEN (S11-050).
 *
 * stripe-webhook's signature check is the only thing between the internet and
 * every grant (checkout.session.completed) and every revocation (refunds,
 * disputes). Every fake in the suite accepted any signature, so replacing the
 * check with JSON.parse(body), or deleting the missing-signature 400, left the
 * suite green (mutations M10 and M12 survived 14 webhook files).
 *
 * The shipped handler runs here with a Stripe fake that verifies signatures as
 * Stripe does (helpers/stripe-signature.ts). A wrong signature and a missing
 * header are 400 with no write, no rpc and no outbound call; a missing secret
 * is 500; and the positive control, a correctly signed event, gets through.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { signStripePayload, STRIPE_WEBHOOKS_REAL_SHAPE } from "./helpers/stripe-signature";

const SECRET = "whsec_harness_real_shape";
const env: Record<string, string | undefined> = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_SECRET_KEY: "sk_test_harness",
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness",
  SUPABASE_ANON_KEY: "anon_harness",
};
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() { this.webhooks = ${STRIPE_WEBHOOKS_REAL_SHAPE}; } }`,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__sigDb; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => { globalThis.__sigMail.push(1); return { data: null, error: null }; } }; } }",
};

let handler: EdgeHandler;
let db: FakeDb;
let outbound: string[] = [];
let rpcs: string[] = [];
const pending: Promise<unknown>[] = [];
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.fetch = async (u: string) => { outbound.push(String(u)); return new Response("{}", { status: 200 }); };
  handler = await loadEdgeHandler("stripe-webhook", STUBS);
}, 60_000);
// One client for the file: the webhook keeps it in a module-level singleton.
db = new FakeDb({ used_stripe_sessions: ["session_id"] });
const rpc = db.rpc.bind(db);
db.rpc = ((name: string, args?: Record<string, unknown>) => { rpcs.push(name); return rpc(name, args); }) as typeof db.rpc;
g.__sigDb = db;
beforeEach(() => { db.tables = {}; db.writes = []; outbound = []; rpcs = []; g.__sigMail = []; env.STRIPE_WEBHOOK_SECRET = SECRET; });
afterEach(async () => { await Promise.allSettled(pending.splice(0)); });

/** A checkout.session.completed that would grant a paid product. */
const EVENT = JSON.stringify({
  id: "evt_forged_1", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000),
  data: { object: { id: "cs_forged_1", object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete",
    amount_total: 500, currency: "usd", customer_details: { email: "attacker@example.com" }, customer_email: "attacker@example.com",
    metadata: { product_type: "full_analysis" } } },
});
const post = (headers: Record<string, string>, body = EVENT) =>
  handler(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }));
const nothingHappened = () => {
  expect(db.writes, "a write happened before the signature was checked").toEqual([]);
  expect(rpcs, "an rpc ran before the signature was checked").toEqual([]);
  expect(outbound, "an outbound call left before the signature was checked").toEqual([]);
  expect(g.__sigMail).toEqual([]);
};

describe("stripe-webhook verifies the signature before it does anything", () => {
  it("a signature made with another secret is 400, and nothing is written, called or mailed", async () => {
    const r = await post({ "stripe-signature": signStripePayload(EVENT, "whsec_someone_else") });
    expect(r.status).toBe(400);
    expect(await r.text()).toMatch(/signature verification failed/i);
    nothingHappened();
  });

  it("the harness's old placeholder signature is refused too", async () => {
    const r = await post({ "stripe-signature": "t=1,v1=harness" });
    expect(r.status).toBe(400);
    nothingHappened();
  });

  it("a body changed after signing is 400", async () => {
    const signed = signStripePayload(EVENT, SECRET);
    const r = await post({ "stripe-signature": signed }, EVENT.replace("attacker@example.com", "victim@example.com"));
    expect(r.status).toBe(400);
    nothingHappened();
  });

  it("no stripe-signature header is 400 Missing signature", async () => {
    const r = await post({});
    expect(r.status).toBe(400);
    expect(await r.text()).toBe("Missing signature");
    nothingHappened();
  });

  it("no webhook secret configured is 500, whatever the header says", async () => {
    env.STRIPE_WEBHOOK_SECRET = undefined;
    const r = await post({ "stripe-signature": signStripePayload(EVENT, SECRET) });
    expect(r.status).toBe(500);
    nothingHappened();
  });

  it("positive control: the same event correctly signed is accepted and processed", async () => {
    const r = await post({ "stripe-signature": signStripePayload(EVENT, SECRET) });
    expect(r.status, await r.clone().text()).toBeLessThan(500);
    expect(r.status).not.toBe(400);
    expect(db.writes.length + rpcs.length + outbound.length, "a verified event did nothing at all").toBeGreaterThan(0);
  });
});
