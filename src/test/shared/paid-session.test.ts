import { describe, it, expect } from "vitest";
import { assertPaidSession, CLAIMS_NAMED_FROM, unnamedClaimRefusal } from "../../../supabase/functions/_shared/paid-session";

// Fake Supabase client whose used_stripe_sessions lookup returns a fixed result.
const clientReturning = (result: { data: unknown; error: { message?: string } | null }) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
});

describe("assertPaidSession", () => {
  it("rejects a missing/blank/non-string sessionId (no purchase proof)", async () => {
    const c = clientReturning({ data: { session_id: "x" }, error: null });
    expect(await assertPaidSession(c, undefined)).toContain("requires a completed purchase");
    expect(await assertPaidSession(c, "")).toContain("requires a completed purchase");
    expect(await assertPaidSession(c, 123)).toContain("requires a completed purchase");
  });

  it("passes when the session was claimed (paid session present)", async () => {
    const c = clientReturning({ data: { session_id: "cs_test_123" }, error: null });
    expect(await assertPaidSession(c, "cs_test_123")).toBeNull();
  });

  it("rejects when the session was never claimed (unpaid / not found)", async () => {
    const c = clientReturning({ data: null, error: null });
    expect(await assertPaidSession(c, "cs_fake")).toContain("couldn't confirm");
  });

  it("fails closed on a lookup error (never hands out content on infra failure)", async () => {
    const c = clientReturning({ data: null, error: { message: "timeout" } });
    expect(await assertPaidSession(c, "cs_test_123")).toContain("couldn't verify");
  });

  // ---- WHICH product was bought, not merely that one was ----
  //
  // The gate asked only whether the session id existed, and the table it queried
  // had no product column — so a session minted by the $2 scan pack was
  // byte-for-byte as good as one that bought the $59 package. Buy the cheapest
  // item, keep the id from the success-page URL, and every paid generator
  // answered for as long as the row lived. Which is forever: the claim is
  // permanent by design so a real buyer can refresh.

  it("refuses a session that bought a DIFFERENT product", async () => {
    const c = clientReturning({ data: { session_id: "cs_1", product_type: "scan_pack" }, error: null });
    expect(await assertPaidSession(c, "cs_1", ["premium_package"])).toContain("does not include this tool");
  });

  it("accepts the product the generator actually sells", async () => {
    const c = clientReturning({ data: { session_id: "cs_1", product_type: "premium_package" }, error: null });
    expect(await assertPaidSession(c, "cs_1", ["premium_package"])).toBeNull();
  });

  it("accepts any of several allowed products", async () => {
    const c = clientReturning({ data: { session_id: "cs_1", product_type: "cover_letter" }, error: null });
    expect(await assertPaidSession(c, "cs_1", ["premium_package", "cover_letter"])).toBeNull();
  });

  it("lets through an unnamed claim only when it may be an older buyer's: no address, from before products were named", async () => {
    // Every row claimed before the product column existed has NULL, and a real
    // buyer's row is reused on every refresh -- rejecting all of them would
    // 402 people who paid. 20261110140000 names the ones our records can; the
    // rest is accepted only where the row itself cannot rule a generator out
    // (M-S14-057).
    const c = clientReturning({ data: { session_id: "cs_live_old", product_type: null, ip_address: null, used_at: "2026-08-01T00:00:00Z" }, error: null });
    expect(await assertPaidSession(c, "cs_live_old", ["premium_package"])).toBeNull();
  });

  it("refuses an unnamed claim the row rules out: test mode, an address, a date after products were named, or columns it did not read", async () => {
    const rows: Array<[string, Record<string, unknown>]> = [
      ["cs_test_old", { product_type: null, ip_address: null, used_at: "2026-08-01T00:00:00Z" }],
      ["cs_live_scan", { product_type: null, ip_address: "203.0.113.9", used_at: "2026-08-01T00:00:00Z" }],
      ["cs_live_new", { product_type: null, ip_address: null, used_at: "2026-09-01T00:00:00Z" }],
      ["cs_live_boundary", { product_type: null, ip_address: null, used_at: "2026-08-27T18:00:00Z" }],
      ["cs_live_noaddr", { product_type: null, used_at: "2026-08-01T00:00:00Z" }],
      ["cs_live_nodate", { product_type: null, ip_address: null }],
    ];
    for (const [id, row] of rows) {
      const c = clientReturning({ data: { session_id: id, ...row }, error: null });
      expect(await assertPaidSession(c, id, ["premium_package"]), id).toContain("does not include this tool");
    }
  });

  it("reads the address and the date with the product, so the rule has what it needs", async () => {
    let selected = "";
    const c = { from: () => ({ select: (cols: string) => { selected = cols; return { eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }; } }) };
    await assertPaidSession(c, "cs_1", ["premium_package"]);
    expect(selected.split(",").map((s) => s.trim()).sort()).toEqual(["ip_address", "product_type", "session_id", "used_at"]);
  });

  it("the unnamed-claim rule says why, and says nothing for an older buyer's claim", () => {
    expect(unnamedClaimRefusal("cs_live_old", { ip_address: null, used_at: "2026-08-27T17:59:59Z" })).toBeNull();
    expect(unnamedClaimRefusal("cs_live_old", { ip_address: null, used_at: CLAIMS_NAMED_FROM })).toMatch(/after claims began/);
    expect(unnamedClaimRefusal("cs_test_x", { ip_address: null, used_at: "2026-01-01T00:00:00Z" })).toMatch(/test-mode/);
    expect(unnamedClaimRefusal("cs_live_x", { ip_address: "unknown", used_at: "2026-01-01T00:00:00Z" })).toMatch(/address/);
    expect(unnamedClaimRefusal("pro_1", { ip_address: null, used_at: "not a date" })).toMatch(/date/);
  });

  it("a named claim is judged by its name whatever its address or date", async () => {
    const c = clientReturning({ data: { session_id: "cs_test_n", product_type: "premium_package", ip_address: "unknown", used_at: "2026-10-01T00:00:00Z" }, error: null });
    expect(await assertPaidSession(c, "cs_test_n", ["premium_package"])).toBeNull();
    expect(await assertPaidSession(c, "cs_test_n", ["cover_letter"])).toContain("does not include this tool");
  });

  it("behaves exactly as before when no product list is given", async () => {
    // Endpoints whose product mapping is not one-to-one keep the existence
    // check; passing no list must not change their behaviour.
    const c = clientReturning({ data: { session_id: "cs_1", product_type: "scan_pack" }, error: null });
    expect(await assertPaidSession(c, "cs_1")).toBeNull();
    expect(await assertPaidSession(c, "cs_1", [])).toBeNull();
  });

  it("still fails closed before it ever looks at the product", async () => {
    const c = clientReturning({ data: null, error: { message: "timeout" } });
    expect(await assertPaidSession(c, "cs_1", ["premium_package"])).toContain("couldn't verify");
  });
});
