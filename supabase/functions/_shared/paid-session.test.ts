import { describe, it, expect } from "vitest";
import { assertPaidSession } from "./paid-session";

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
});
