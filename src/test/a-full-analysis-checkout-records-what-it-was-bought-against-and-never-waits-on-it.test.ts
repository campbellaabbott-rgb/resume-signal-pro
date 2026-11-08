// @vitest-environment node
/**
 * A FULL ANALYSIS CHECKOUT RECORDS WHAT IT WAS BOUGHT AGAINST, AND NEVER
 * WAITS ON IT (hotfix 2026-11-10: H4, C-S14-010).
 *
 * create-checkout, run (helpers/edge-harness), with Stripe and the database
 * faked. It kept nothing that tied a $5 session to the stored résumé,
 * posting and LinkedIn text, so a buyer on another device, or back after the
 * page's one-hour pointer had lapsed, was analysed without the posting they
 * paid against. Now:
 *   - the stored copy's id is kept beside the session (checkout_resume_refs,
 *     as create-product-checkout keeps it), never in what Stripe is sent;
 *   - whether the page had a posting is kept with the checkout's start
 *     (hasPosting), so it outlives the 24-hour copy;
 *   - neither can stop a sale: a reference that fails, or does not answer in
 *     two seconds, leaves the checkout answering as it always has, and a body
 *     from today's page (no hasJobDescription) records no flag.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 20_000, hookTimeout: 120_000 });

const TEMP = "8a6f7d3e-1b2c-4d5e-9f00-112233445566";
let handler: (req: Request) => Promise<Response>;
let db: FakeDb;
let starts: Array<Record<string, unknown>>;
let minted: Array<Record<string, unknown>>;
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test_harness" };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => undefined); } };
  // create-checkout takes its client once, when the module loads: it is
  // handed one that answers from each test's own database.
  g.__fakeSupabase = {
    from: (t: string) => db.from(t),
    rpc: (n: string, a?: Record<string, unknown>) => db.rpc(n, a),
  };
  handler = await loadEdgeHandler("create-checkout", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": `export default class Stripe {
      constructor() {
        this.checkout = { sessions: { create: async (params) => {
          globalThis.__minted.push(params);
          const li = params.line_items[0].price_data;
          return { id: "cs_test_bought_against_" + globalThis.__minted.length, url: "https://checkout.stripe.test/x", amount_total: li.unit_amount, currency: li.currency, mode: params.mode };
        } } };
        this.promotionCodes = { list: async () => ({ data: [] }) };
      }
    }`,
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__fakeSupabase;",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb({ checkout_resume_refs: ["stripe_session_id"] });
  starts = [];
  minted = [];
  g.__minted = minted;
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.record_checkout_start = (a) => { starts.push(a); return { data: true, error: null }; };
});

const checkout = (body: Record<string, unknown>) =>
  handler(new Request("https://harness.supabase.co/functions/v1/create-checkout", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", origin: "https://resumebooster.work" },
    body: JSON.stringify(body),
  }));

describe("what a full analysis was bought against", () => {
  it("the stored copy is kept beside the session, and Stripe is sent none of it", async () => {
    const res = await checkout({ currency: "usd", hasLinkedIn: false, hasJobDescription: true, tempSessionId: TEMP });
    expect(res.status).toBe(200);
    const { sessionId } = await res.json() as { sessionId: string };
    expect(db.rows("checkout_resume_refs")).toEqual([expect.objectContaining({ stripe_session_id: sessionId, resume_session_id: TEMP })]);
    expect(JSON.stringify(minted), "the stored copy's id went to Stripe").not.toContain(TEMP);
  });

  it("whether the page had a posting is kept with the checkout's start", async () => {
    await checkout({ currency: "usd", hasJobDescription: true, tempSessionId: TEMP });
    await checkout({ currency: "usd", hasJobDescription: false, tempSessionId: TEMP });
    expect(starts.map((s) => (s.p_metadata as Record<string, unknown>).hasPosting)).toEqual([true, false]);
  });

  it("a body from today's page, with no posting flag, records none and checks out as before", async () => {
    const res = await checkout({ currency: "eur", hasLinkedIn: true, tempSessionId: TEMP });
    expect(res.status).toBe(200);
    expect((await res.json() as { url: string }).url).toBe("https://checkout.stripe.test/x");
    expect(starts[0].p_metadata).not.toHaveProperty("hasPosting");
  });
});

describe("the record never stops a sale", () => {
  it("a reference that cannot be written leaves the checkout answering", async () => {
    db.faults.push({ table: "checkout_resume_refs", op: "insert", error: { code: "57014", message: "statement timeout" } });
    const res = await checkout({ currency: "usd", hasJobDescription: true, tempSessionId: TEMP });
    expect(res.status).toBe(200);
    expect((await res.json() as { url: string }).url).toBe("https://checkout.stripe.test/x");
  });

  it("a reference that never answers is given two seconds, and the buyer still goes to Stripe", async () => {
    const from = db.from.bind(db);
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) =>
      t === "checkout_resume_refs" ? { insert: () => new Promise(() => {}) } : from(t);
    const started = Date.now();
    const res = await checkout({ currency: "usd", hasJobDescription: true, tempSessionId: TEMP });
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect((await res.json() as { url: string }).url).toBe("https://checkout.stripe.test/x");
  });

  it("no stored copy, nothing to record: the checkout is unchanged", async () => {
    const res = await checkout({ currency: "usd" });
    expect(res.status).toBe(200);
    expect(db.rows("checkout_resume_refs")).toEqual([]);
  });

  it("answers this hotfix's build on the preflight", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/create-checkout", { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "create-checkout", "2026-11-10", 1)).toBe(true);
  });
});
