// @vitest-environment node
//
// Node, not jsdom: the verifier is bundled with esbuild (helpers/edge-harness).
/**
 * A COMPED SESSION WAS REFUSED, AND A SCAN-PACK VERIFY TOLD ANY ADDRESS ITS
 * BALANCE.
 *
 * WHAT WAS WRONG (sweep 2026-10-08).
 *   S8-053  The webhook settles a 100%-off payment-mode session
 *           (no_payment_required, total 0), but analyze-resume's
 *           fullAnalysisRefusal and the credit reader's grantFromStripe still
 *           required 'paid': an owner comp of the $5 analysis was answered 402
 *           and a $0 scan pack credited the pool while its held session could
 *           spend nothing.
 *   S8-054  verify-scan-pack-purchase answered get_scan_credits(email) on the
 *           first claim and on the already-claimed path. The checkout takes
 *           any typed address without sign-in, so a $0.60 purchase "as"
 *           somebody revealed whether they had bought credits and how many.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { fullAnalysisRefusal } from "../../supabase/functions/_shared/full-analysis";
import { grantFromStripe } from "../../supabase/functions/_shared/scan-credits";

const comp = (metadata: Record<string, string>) => ({ payment_status: "no_payment_required", mode: "payment", amount_total: 0, metadata });

describe("a 100%-off session is as settled for delivery as it is for the webhook (S8-053)", () => {
  it("the full analysis accepts the owner's comp", () => {
    expect(fullAnalysisRefusal(comp({ product_type: "full_analysis" }))).toBeNull();
  });

  it("and still refuses money owed: no_payment_required with a total, or a subscription's $0", () => {
    expect(fullAnalysisRefusal({ ...comp({ product_type: "full_analysis" }), amount_total: 500 })).toMatch(/payment_status/);
    expect(fullAnalysisRefusal({ ...comp({ product_type: "full_analysis" }), mode: "subscription" })).toMatch(/payment_status/);
    expect(fullAnalysisRefusal({ payment_status: "unpaid", mode: "payment", amount_total: 500, metadata: { product_type: "full_analysis" } })).toMatch(/payment_status/);
  });

  it("a comped scan pack is a grant the held session can spend", () => {
    expect(grantFromStripe({ ...comp({ product_type: "scan_pack", credits: "5" }), customer_email: "comp@example.com" }))
      .toEqual({ email: "comp@example.com", productType: "scan_pack", credits: 5 });
  });
});

describe("the scan-pack verifier answers this purchase, never the address's pool (S8-054)", () => {
  let handler: EdgeHandler;
  let db: FakeDb;
  let poolReads: number;

  beforeAll(async () => {
    const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test", SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" };
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => env[k] } };
    handler = await loadEdgeHandler("verify-scan-pack-purchase", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({
        id, payment_status: "paid", mode: "payment", amount_total: 60, customer_details: { email: "victim@example.com" },
        metadata: { product_type: "scan_pack", credits: "3", customer_email: "victim@example.com" },
        line_items: { data: [{ quantity: 3 }] } }) } }; } }`,
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__vspDb;",
    });
  }, 120_000);

  beforeEach(() => {
    db = new FakeDb({ used_stripe_sessions: ["session_id"] });
    poolReads = 0;
    db.rpcs.check_rate_limit = () => ({ data: true, error: null });
    db.rpcs.add_scan_credits = () => ({ data: true, error: null });
    db.rpcs.get_scan_credits = () => { poolReads++; return { data: 250, error: null }; };
    (globalThis as Record<string, unknown>).__vspDb = db;
  });

  const verify = async () => {
    const res = await handler(new Request("https://h.supabase.co/functions/v1/verify-scan-pack-purchase", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.9" },
      body: JSON.stringify({ sessionId: "cs_test_probe_abcdefgh" }),
    }));
    return { status: res.status, json: await res.json() as Record<string, unknown> };
  };

  it("the first claim answers what this purchase added, and no balance", async () => {
    const r = await verify();
    expect(r.status).toBe(200);
    expect(r.json.creditsAdded).toBe(3);
    expect(JSON.stringify(r.json)).not.toContain("250");
    expect(poolReads).toBe(0);
  });

  it("the already-claimed answer is this purchase's count too, not the pool", async () => {
    await verify();
    const again = await verify();
    expect(again.json.alreadyCredited).toBe(true);
    expect(again.json.creditsAdded).toBe(3);
    expect(JSON.stringify(again.json)).not.toContain("250");
    expect(poolReads).toBe(0);
  });
});
