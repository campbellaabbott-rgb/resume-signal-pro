// @vitest-environment node
/**
 * THE APPLY KIT IS SOLD UNDER THE NAME STRIPE CARRIES.
 *
 * WHAT WAS WRONG. generate-apply-package's entitlement gate accepted a paid
 * session whose product_type was one of applyAssistant / premiumPackage /
 * transitionPro -- the frontend's camelCase product KEYS. Stripe metadata
 * carries what create-product-checkout writes: `apply_assistant`. No session
 * any checkout has ever minted could pass, so the $7 Apply Assistant was a 402
 * for every buyer, on the success page and on every server path.
 *
 * THE PROPERTY, run against the shipped handler (helpers/edge-harness): a paid
 * session minted for the Apply Assistant passes the gate and reaches the
 * model; a paid session for a different product, an unpaid one, and a call
 * with no session do not; a Pro grant passes exactly when its claim names a
 * product that includes the kit. "Reaches the model" is observed as a request
 * to the AI gateway, which this harness answers with a 400 so the test stops
 * there -- the gate is what is under test, not the tailoring.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

type Session = { id: string; payment_status: string; metadata: Record<string, string> };

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0":
    "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: (id) => globalThis.__kitStripe(id) } }; } }",
  // The Pro path: no caller here carries a user's JWT, so every token is anonymous.
  "https://esm.sh/@supabase/supabase-js@2":
    "export function createClient() { return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }",
  "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__kitDb;",
};

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end.";

let handler: EdgeHandler;
let db: FakeDb;
const sessions = new Map<string, Session>();
let aiRequests = 0;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: "sk_test_harness",
    LOVABLE_API_KEY: "lovable_harness",
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.__kitStripe = async (id: string) => {
    const s = sessions.get(id);
    if (!s) throw new Error(`No such checkout.session: '${id}'`);
    return JSON.parse(JSON.stringify(s));
  };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiRequests++;
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("generate-apply-package", STUBS);
}, 60_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  (globalThis as Record<string, unknown>).__kitDb = db;
  sessions.clear();
  aiRequests = 0;
});

async function ask(sessionId?: string) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/generate-apply-package", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify({ resumeText: RESUME, jobPostingText: POSTING, language: "en", ...(sessionId ? { sessionId } : {}) }),
  }));
  return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

const sell = (id: string, product_type: string, payment_status = "paid") => {
  sessions.set(id, { id, payment_status, metadata: { product_type } });
  return id;
};

describe("a Stripe session is judged by the product_type the checkout wrote", () => {
  it("a paid Apply Assistant session passes the gate and reaches the model", async () => {
    const r = await ask(sell("cs_live_apply_paid", "apply_assistant"));
    expect(r.status, `a paid apply_assistant session was answered ${r.status}: ${JSON.stringify(r.body).slice(0, 140)}`).not.toBe(402);
    expect(aiRequests, "the gate refused before the model was asked").toBeGreaterThan(0);
  });

  it("a paid session for a different product is refused before any model call", async () => {
    for (const other of ["premium_package", "freelance_transition_pro", "scan_pack", "full_analysis"]) {
      aiRequests = 0;
      const r = await ask(sell(`cs_live_apply_${other}`, other));
      expect(r.status, `${other} bought the apply kit`).toBe(402);
      expect(aiRequests).toBe(0);
    }
  });

  it("the frontend's product keys, which no checkout mints, are not product types", async () => {
    for (const key of ["applyAssistant", "premiumPackage", "transitionPro"]) {
      expect((await ask(sell(`cs_live_key_${key}`, key))).status).toBe(402);
    }
  });

  it("an unpaid Apply Assistant session is refused", async () => {
    expect((await ask(sell("cs_live_apply_unpaid", "apply_assistant", "unpaid"))).status).toBe(402);
    expect(aiRequests).toBe(0);
  });

  it("a call with no session is refused -- which is why every server-side caller must send one", async () => {
    expect((await ask()).status).toBe(402);
    expect(aiRequests).toBe(0);
  });
});

describe("a Pro grant is judged by the claim verify-product-purchase wrote for it", () => {
  it("passes when the claim names the Apply Assistant", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "pro_7d1f", product_type: "apply_assistant" });
    expect((await ask("pro_7d1f")).status).not.toBe(402);
    expect(aiRequests).toBeGreaterThan(0);
  });

  it("is refused when the claim names another product, or there is no claim", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "pro_8e2a", product_type: "premium_package" });
    expect((await ask("pro_8e2a")).status).toBe(402);
    expect((await ask("pro_never_consumed")).status).toBe(402);
    expect(aiRequests).toBe(0);
  });
});
