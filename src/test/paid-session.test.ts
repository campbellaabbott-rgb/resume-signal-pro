// The purchase gate for the public paid streaming generators. It must FAIL CLOSED:
// no session id, an unknown session, or a transient lookup error all reject; only a
// session already present in used_stripe_sessions (claimed by verify-product-purchase
// after Stripe confirmed payment) is allowed through.
import { describe, it, expect } from "vitest";
import { assertPaidSession } from "../../supabase/functions/_shared/paid-session";

// Minimal fake of the supabase-js builder chain the gate uses:
// .from(table).select(cols).eq(col, val).maybeSingle()
function fakeClient(result: { data?: unknown; error?: unknown }) {
  const calls: { table?: string; col?: string; val?: unknown } = {};
  return {
    calls,
    from(table: string) {
      calls.table = table;
      return {
        select() {
          return {
            eq(col: string, val: unknown) {
              calls.col = col;
              calls.val = val;
              return { maybeSingle: async () => result };
            },
          };
        },
      };
    },
  };
}

describe("assertPaidSession", () => {
  it("rejects a missing/empty/non-string session id without touching the DB", async () => {
    for (const bad of [undefined, null, "", 123, {}]) {
      const client = fakeClient({ data: null });
      const err = await assertPaidSession(client, bad);
      expect(err).toBeTruthy();
      // Never even ran a lookup for an obviously-bad id.
      expect(client.calls.table).toBeUndefined();
    }
  });

  it("rejects a session with no matching row (unpaid / direct caller)", async () => {
    const client = fakeClient({ data: null, error: null });
    const err = await assertPaidSession(client, "cs_test_notpaid");
    expect(err).toBeTruthy();
    expect(client.calls.table).toBe("used_stripe_sessions");
    expect(client.calls.val).toBe("cs_test_notpaid");
  });

  it("fails closed on a transient lookup error (does not hand out content)", async () => {
    const client = fakeClient({ data: null, error: { message: "timeout" } });
    const err = await assertPaidSession(client, "cs_test_glitch");
    expect(err).toBeTruthy();
  });

  it("allows a session already claimed in used_stripe_sessions (real buyer)", async () => {
    const client = fakeClient({ data: { session_id: "cs_test_paid" }, error: null });
    const err = await assertPaidSession(client, "cs_test_paid");
    expect(err).toBeNull();
  });
});
