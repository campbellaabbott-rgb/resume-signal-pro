// @vitest-environment node
/**
 * A SCAN-PACK SUCCESS LINK READS STRIPE ONLY WHEN IT MUST, AND SHOWS NO
 * ADDRESS (hotfix 2026-11-10: H3, M-S14-007 and C-S14-003's scan-pack half;
 * C-S14-049 for scan-credits).
 *
 * verify-scan-pack-purchase, run (helpers/edge-harness), with Stripe and the
 * database faked:
 *   - any string was read from Stripe with the live key: an id that cannot be
 *     a Checkout session is refused now with no read;
 *   - a pack already credited and recorded is answered from our rows, so a
 *     reload of the success page reads Stripe no more;
 *   - every read is counted under the function's own name, and a count that
 *     cannot be taken refuses: per caller network for an id our records do
 *     not know, and by the purchase for a pack the webhook claimed or the
 *     checkout minted, so strangers on the buyer's network cannot spend the
 *     buyer's reads (review of M-S14-050);
 *   - the reply carried the buyer's whole address to whoever held the link:
 *     it is masked now, and the log no longer carries the session's
 *     metadata, where the address also is (review of C-S14-049).
 * And scan-credits shows a held purchase's address masked; only a signed-in
 * account sees its own address whole (its own test covers that half).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

let handler: EdgeHandler;
let db: FakeDb;
let reads: string[];
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test", SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" };
  g.Deno = { env: { get: (k: string) => env[k] } };
  handler = await loadEdgeHandler("verify-scan-pack-purchase", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => {
      globalThis.__vspReads.push(id);
      return { id, payment_status: "paid", mode: "payment", amount_total: 60, customer_details: { email: "jane.buyer@example.com" },
        metadata: { product_type: "scan_pack", credits: "3", customer_email: "jane.buyer@example.com" },
        line_items: { data: [{ quantity: 3 }] } };
    } } }; } }`,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__vspDb;",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  reads = [];
  g.__vspReads = reads;
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.add_scan_credits = () => ({ data: true, error: null });
  g.__vspDb = db;
});

const verify = async (sessionId: unknown) => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/verify-scan-pack-purchase", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.9" },
    body: JSON.stringify({ sessionId }),
  }));
  return { status: res.status, json: await res.json() as Record<string, unknown> };
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("verify-scan-pack-purchase", () => {
  it.each(["not-a-session", "https://example.com/cs_live_x", `cs_live_${"a".repeat(300)}`, "cs_live_a/b"])(
    "%s is refused before any Stripe read",
    async (id) => {
      const r = await verify(id);
      expect(r.status).toBe(400);
      expect(reads).toEqual([]);
    },
  );

  it("the first claim credits the pack and shows the address masked", async () => {
    const r = await verify("cs_live_pack_first_aaaaaa");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ verified: true, creditsAdded: 3, email: "j***@example.com" });
    expect(JSON.stringify(r.json)).not.toContain("jane.buyer");
  });

  it("the already-claimed answer is masked too", async () => {
    await verify("cs_live_pack_again_aaaaaa");
    const again = await verify("cs_live_pack_again_aaaaaa");
    expect(again.json.alreadyCredited).toBe(true);
    expect(JSON.stringify(again.json)).not.toContain("jane.buyer");
  });

  it("a pack already credited and recorded is answered from our rows with no Stripe read", async () => {
    const id = "cs_live_pack_recorded_aaaa";
    db.rows("used_stripe_sessions").push({ session_id: id, product_type: "scan_pack", ip_address: null });
    db.rows("scan_credit_session_grants").push({ session_hash: sha(id), email: "jane.buyer@example.com", credits_bought: 3, credits_used: 0 });
    const r = await verify(id);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ verified: true, alreadyCredited: true, creditsAdded: 3 });
    expect(reads, "a recorded purchase was read from Stripe again").toEqual([]);
  });

  it("a session claimed for another product is refused with no Stripe read", async () => {
    const id = "cs_live_full_analysis_aaa";
    db.rows("used_stripe_sessions").push({ session_id: id, product_type: "full_analysis", ip_address: null });
    const r = await verify(id);
    expect(r.status).toBe(400);
    expect(reads).toEqual([]);
  });

  it("every read is counted per network under the function's own name, before it is made", async () => {
    const counted: Array<Record<string, unknown>> = [];
    db.rpcs.check_rate_limit = (a) => { counted.push(a); return { data: true, error: null }; };
    await verify("cs_live_pack_counted_aaaa");
    expect(counted).toHaveLength(1);
    expect(counted[0].p_function).toBe("verify-scan-pack-purchase");
    expect(String(counted[0].p_ip)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("a count that cannot be taken refuses; a spent one is told when to come back; neither reads Stripe", async () => {
    db.rpcs.check_rate_limit = () => ({ data: null, error: { code: "57014", message: "timeout" } });
    expect((await verify("cs_live_pack_down_aaaaaa")).status).toBe(503);
    db.rpcs.check_rate_limit = () => ({ data: false, error: null });
    const spent = await verify("cs_live_pack_spent_aaaaa");
    expect(spent.status).toBe(429);
    expect(reads).toEqual([]);
  });

  /** check_rate_limit as the database answers it: the buyer's network spent by strangers, every purchase's own allowance free. */
  function networkSpentByStrangers() {
    const counted: Array<Record<string, unknown>> = [];
    db.rpcs.check_rate_limit = (a) => { counted.push(a); return { data: a.p_function !== "verify-scan-pack-purchase", error: null }; };
    return counted;
  }

  it("a pack create-scan-pack-checkout minted is credited even when strangers on the buyer's network spent the network's reads", async () => {
    const counted = networkSpentByStrangers();
    const id = "cs_live_pack_minted_shared";
    db.rows("checkout_starts").push({ stripe_session_id: id, product_type: "scan_pack", metadata: {} });
    const r = await verify(id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ verified: true, creditsAdded: 3 });
    expect(reads).toEqual([id]);
    expect(counted.map((c) => c.p_function)).toEqual(["verify-scan-pack-purchase:purchase"]);
    expect(String(counted[0].p_ip)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("a pack the webhook claimed but has not recorded yet is read by its own allowance too", async () => {
    const counted = networkSpentByStrangers();
    const id = "cs_live_pack_claimed_shared";
    db.rows("used_stripe_sessions").push({ session_id: id, product_type: "scan_pack", ip_address: null });
    const r = await verify(id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(counted.map((c) => c.p_function)).toEqual(["verify-scan-pack-purchase:purchase"]);
  });

  it("an id our records do not know still spends only its network's allowance", async () => {
    const counted = networkSpentByStrangers();
    const r = await verify("cs_live_pack_invented_aaaa");
    expect(r.status).toBe(429);
    expect(counted.map((c) => c.p_function)).toEqual(["verify-scan-pack-purchase"]);
    expect(reads).toEqual([]);
  });

  it("writes no buyer's address to the function log, the session's metadata included", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
    const errs = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
    try {
      const r = await verify("cs_live_pack_logged_aaaaa");
      expect(r.status).toBe(200);
      await verify("cs_live_pack_logged_aaaaa");
    } finally {
      spy.mockRestore();
      errs.mockRestore();
    }
    expect(logged.some((l) => l.includes("Session retrieved")), "the log line this guards moved").toBe(true);
    expect(logged.filter((l) => l.includes("jane.buyer")), "the buyer's address was logged").toEqual([]);
  });

  it("answers this hotfix's build on the preflight", async () => {
    const res = await handler(new Request("https://h.supabase.co/functions/v1/verify-scan-pack-purchase", { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "verify-scan-pack-purchase", "2026-11-10", 1)).toBe(true);
  });
});
