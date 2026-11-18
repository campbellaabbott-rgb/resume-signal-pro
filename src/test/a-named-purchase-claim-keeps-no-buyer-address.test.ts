// @vitest-environment node
/**
 * A NAMED PURCHASE CLAIM KEEPS NO BUYER ADDRESS (S14X-042, handed to the
 * full-analysis lane by privacy-retention; bug round 2026-11-12).
 *
 * WHAT WAS WRONG. The claim a purchase leaves on used_stripe_sessions was
 * written with the caller's network address beside the product it names:
 * analyze-resume's deliver() and verify-scan-pack-purchase each stored it, and
 * nothing ever cleared it. The address is read for one thing only, an OLD
 * claim that names no product (_shared/full-analysis.ts priorRedemptionOf:
 * no product and no address is the webhook's payment claim; no product beside
 * an address was the pre-fix analyze-resume's own mark). A claim that names
 * its product is never judged by its address, so storing it kept personal
 * data for no purpose.
 *
 * NOW both writers store ip_address null on a claim that names its product.
 * The column is still read for old unnamed claims, and clearing the rows
 * already written is privacy-retention's (its retention job), not this.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const g = globalThis as Record<string, unknown>;

describe("analyze-resume's claim (deliver)", () => {
  let h: Harness;
  beforeAll(async () => { h = await analyzeResumeHarness(); }, 240_000);

  it("names the Full Analysis and stores no address", async () => {
    h.reset();
    for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
    h.sessions.set("cs_live_claimnoaddress", fullAnalysisSession("cs_live_claimnoaddress"));
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_live_claimnoaddress" });
    expect(r.status).toBe(200);
    const claims = h.db.writes.filter((w) => w.table === "used_stripe_sessions" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ session_id: "cs_live_claimnoaddress", product_type: "full_analysis" });
    expect("ip_address" in claims[0], "the claim no longer says what it holds for the address").toBe(true);
    expect(claims[0].ip_address, "a named claim kept the buyer's address").toBeNull();
    expect(JSON.stringify(h.db.rows("used_stripe_sessions"))).not.toContain("203.0.113.7");
  });
});

describe("verify-scan-pack-purchase's claim", () => {
  let handler: EdgeHandler;
  let db: FakeDb;
  beforeAll(async () => {
    const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test", SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    handler = await loadEdgeHandler("verify-scan-pack-purchase", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => (
        { id, payment_status: "paid", mode: "payment", amount_total: 60, customer_details: { email: "jane.buyer@example.com" },
          metadata: { product_type: "scan_pack", credits: "3", customer_email: "jane.buyer@example.com" }, line_items: { data: [{ quantity: 3 }] } }
      ) } }; } }`,
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__claimDb;",
    });
  }, 120_000);

  it("names the scan pack and stores no address", async () => {
    const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test", SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    db = new FakeDb({ used_stripe_sessions: ["session_id"] });
    db.rpcs.check_rate_limit = () => ({ data: true, error: null });
    db.rpcs.add_scan_credits = () => ({ data: true, error: null });
    g.__claimDb = db;
    for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
    const res = await handler(new Request("https://h.supabase.co/functions/v1/verify-scan-pack-purchase", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.9" },
      body: JSON.stringify({ sessionId: "cs_live_pack_noaddress_aaa" }),
    }));
    expect(res.status).toBe(200);
    const claims = db.writes.filter((w) => w.table === "used_stripe_sessions" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ session_id: "cs_live_pack_noaddress_aaa", product_type: "scan_pack" });
    expect(claims[0].ip_address, "a named claim kept the buyer's address").toBeNull();
    expect(JSON.stringify(db.rows("used_stripe_sessions"))).not.toContain("198.51.100.9");
  });
});
