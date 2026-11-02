// @vitest-environment node
/**
 * A PAID ORDER THE WEBHOOK MISSED IS RE-DELIVERED, NOT SENT TO A RECOVERY
 * THAT CANNOT FIND IT (audit 2026-10-31, S13-028; reconcile-stripe
 * 2026-11-03.1).
 *
 * WHAT WAS WRONG. reconcile-stripe found a paid session with no delivery
 * marker and told the owner "Recover each via the recover-purchase function".
 * That function reads only purchased_content, which an order the webhook
 * never saw does not have: it answered {found:false}, and the buyer was never
 * mailed.
 *
 * WHAT HOLDS NOW (the shipped handler; Stripe, Resend and the network faked;
 * the webhook's signature checked in Stripe's own scheme):
 *   - each orphan's completed-checkout event is posted to stripe-webhook,
 *     signed so the webhook's own check accepts it, carrying Stripe's copy of
 *     the session; it counts as re-delivered only once its marker is there;
 *   - a webhook that does not answer 2xx gives the session's door back, so
 *     the next run tries again, and the owner is told the manual remedy;
 *   - a session already re-sent is not re-sent again inside its door;
 *   - with no webhook secret nothing is posted and the owner still hears;
 *   - the owner's mail never names recover-purchase as the remedy.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { STRIPE_WEBHOOKS_REAL_SHAPE } from "./helpers/stripe-signature";
import { redeliveryOf } from "../../supabase/functions/reconcile-stripe/reconcile";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const SECRET = "whsec_harness_0123456789";
const env: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_live_harness", SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", ADMIN_EMAIL: "owner@example.com",
  STRIPE_WEBHOOK_SECRET: SECRET,
};
const SESSION = {
  id: "cs_live_orphanpaidsession01", object: "checkout.session", livemode: true, status: "complete", payment_status: "paid",
  mode: "payment", amount_total: 500, currency: "usd", customer_details: { email: "buyer@example.com" },
  metadata: { product_type: "full_analysis", product_name: "Full Analysis" }, created: Math.floor(Date.now() / 1000),
};

type Post = { url: string; signature: string; body: string };
let posts: Post[];
let mails: Array<{ subject: string; html: string }>;
let webhookStatus: number;
let webhookMarks: boolean;
let doorRefuses: boolean;
let db: FakeDb;
let reconcile: EdgeHandler;
let verify: (body: string, header: string, secret: string) => Promise<{ type: string; data: { object: { id: string } } }>;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.__rr = { db: () => db, mails: () => mails, session: SESSION };
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    posts.push({ url, signature: headers.get("stripe-signature") ?? "", body: String(init?.body ?? "") });
    if (webhookStatus === 200 && webhookMarks) db.rows("used_stripe_sessions").push({ session_id: SESSION.id });
    return new Response(JSON.stringify({ received: true }), { status: webhookStatus });
  };
  verify = new Function(`return (${STRIPE_WEBHOOKS_REAL_SHAPE}).constructEventAsync;`)();
  reconcile = await loadEdgeHandler("reconcile-stripe", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() { this.checkout = { sessions: {
      list: async () => ({ has_more: false, data: [globalThis.__rr.session] }) } }; } }`,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__rr.db();",
    "https://esm.sh/resend@2.0.0": `export class Resend { constructor() { this.emails = { send: async (m) => {
      globalThis.__rr.mails().push({ subject: m.subject, html: m.html }); return { data: { id: "re_1" }, error: null };
    } }; } }`,
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  posts = [];
  mails = [];
  webhookStatus = 200;
  webhookMarks = true;
  doorRefuses = false;
  db.rpcs.mail_door_take = (a) => {
    if (doorRefuses) return { data: false, error: null };
    db.rows("mail_door_counts").push({ door: a.p_door, bucket: a.p_bucket });
    return { data: true, error: null };
  };
  env.STRIPE_WEBHOOK_SECRET = SECRET;
});

const run = async () => (await reconcile(new Request("https://harness.supabase.co/functions/v1/reconcile-stripe", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
}))).json();

describe("a paid session with no marker is re-delivered through the webhook", () => {
  it("posts one completed-checkout event the webhook's own signature check accepts, with Stripe's copy of the session", async () => {
    const r = await run();
    expect(r).toMatchObject({ orphans: 1, redelivered: 1, alerted: true });
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("https://harness.supabase.co/functions/v1/stripe-webhook");
    const event = await verify(posts[0].body, posts[0].signature, SECRET);
    expect(event.type).toBe("checkout.session.completed");
    expect(event.data.object).toEqual(SESSION);
    await expect(verify(posts[0].body, posts[0].signature, "whsec_someone_else")).rejects.toThrow();
  });

  it("tells the owner it was re-delivered, and never names recover-purchase as the remedy", async () => {
    await run();
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/1 re-delivered/);
    expect(mails[0].html).toMatch(/re-delivered: the webhook has now claimed and delivered it/);
    expect(mails[0].html).not.toMatch(/recover-purchase/);
  });

  it("counts nothing re-delivered when the webhook answered but wrote no marker", async () => {
    webhookMarks = false;
    const r = await run();
    expect(r.redelivered).toBe(0);
    expect(mails[0].html).toMatch(/still no delivery marker/);
  });
});

describe("a re-delivery that did not take", () => {
  it("gives the session's door back so the next run tries again, and names the Dashboard resend", async () => {
    webhookStatus = 500;
    const r = await run();
    expect(r.redelivered).toBe(0);
    expect(db.rows("mail_door_counts")).toEqual([]);
    expect(mails[0].html).toMatch(/re-delivery failed \(500\)/);
    expect(mails[0].html).toMatch(/Developers, then Events/);
  });

  it("is not re-sent again while its door is shut", async () => {
    doorRefuses = true;
    const r = await run();
    expect(posts).toEqual([]);
    expect(r).toMatchObject({ orphans: 1, redelivered: 0, alerted: true });
    expect(mails[0].html).toMatch(/re-sent before and still not delivered/);
  });

  it("posts nothing without the webhook's secret, and the owner still hears", async () => {
    delete env.STRIPE_WEBHOOK_SECRET;
    const r = await run();
    expect(posts).toEqual([]);
    expect(r).toMatchObject({ orphans: 1, redelivered: 0, alerted: true });
    expect(mails[0].html).toMatch(/STRIPE_WEBHOOK_SECRET is not set/);
  });
});

describe("the signed event", () => {
  it("is Stripe's scheme over the exact body, live unless the session says test", async () => {
    const t = Math.floor(Date.now() / 1000);
    const { body, signature } = await redeliveryOf({ id: "cs_live_x", livemode: true }, SECRET, t);
    expect(signature).toMatch(new RegExp(`^t=${t},v1=[0-9a-f]{64}$`));
    expect(JSON.parse(body)).toMatchObject({ id: "evt_reconcile_cs_live_x", livemode: true, type: "checkout.session.completed" });
    expect(JSON.parse((await redeliveryOf({ id: "cs_test_y", livemode: false }, SECRET, t)).body).livemode).toBe(false);
  });
});
