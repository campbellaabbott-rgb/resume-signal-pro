import { describe, it, expect } from "vitest";
import { assertPaidSession } from "./paid-session";


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

  it("grandfathers a row with no product recorded", async () => {
    
    
    
    
    const c = clientReturning({ data: { session_id: "cs_old", product_type: null }, error: null });
    expect(await assertPaidSession(c, "cs_old", ["premium_package"])).toBeNull();
  });

  it("behaves exactly as before when no product list is given", async () => {
    
    
    const c = clientReturning({ data: { session_id: "cs_1", product_type: "scan_pack" }, error: null });
    expect(await assertPaidSession(c, "cs_1")).toBeNull();
    expect(await assertPaidSession(c, "cs_1", [])).toBeNull();
  });

  it("still fails closed before it ever looks at the product", async () => {
    const c = clientReturning({ data: null, error: { message: "timeout" } });
    expect(await assertPaidSession(c, "cs_1", ["premium_package"])).toContain("couldn't verify");
  });
});
