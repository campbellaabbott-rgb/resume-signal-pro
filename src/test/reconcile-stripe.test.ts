// The reconciliation core: an orphan is a PAID Stripe session with no
// used_stripe_sessions fulfilment marker — a dropped webhook a customer paid for.
import { describe, it, expect } from "vitest";
import { findOrphanSessions, type ReconcileSession } from "../../supabase/functions/reconcile-stripe/reconcile";

const s = (id: string): ReconcileSession => ({
  id, email: `${id}@x.com`, amountCents: 700, currency: "usd", product: "cover_letter", createdIso: "2026-07-14T00:00:00.000Z",
});

describe("findOrphanSessions", () => {
  it("returns paid sessions that have no fulfilment marker", () => {
    const paid = [s("cs_1"), s("cs_2"), s("cs_3")];
    const markers = new Set(["cs_1", "cs_3"]); // cs_2's webhook was dropped
    expect(findOrphanSessions(paid, markers).map((o) => o.id)).toEqual(["cs_2"]);
  });

  it("returns nothing when every paid session was fulfilled", () => {
    const paid = [s("cs_1"), s("cs_2")];
    expect(findOrphanSessions(paid, new Set(["cs_1", "cs_2"]))).toEqual([]);
  });

  it("flags ALL paid sessions when the marker table is empty (total webhook outage)", () => {
    const paid = [s("cs_1"), s("cs_2")];
    expect(findOrphanSessions(paid, new Set()).map((o) => o.id)).toEqual(["cs_1", "cs_2"]);
  });

  it("preserves the recovery details the owner email needs", () => {
    const [orphan] = findOrphanSessions([s("cs_9")], new Set());
    expect(orphan).toMatchObject({ id: "cs_9", email: "cs_9@x.com", amountCents: 700, product: "cover_letter" });
  });
});
