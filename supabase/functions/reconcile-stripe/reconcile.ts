// Pure reconciliation core (unit-testable; all Stripe/DB/email I/O lives in
// index.ts). An orphan is a paid session with no fulfilment marker.

export interface ReconcileSession {
  id: string;
  email: string | null;
  amountCents: number | null;
  currency: string;
  product: string | null;
  createdIso: string;
}

/**
 * Given the paid sessions Stripe reported and the set of session ids that DO have
 * a used_stripe_sessions marker, return the paid sessions that were never marked
 * fulfilled — the dropped-webhook orphans a customer paid for but never received.
 */
export function findOrphanSessions(
  paid: readonly ReconcileSession[],
  markers: ReadonlySet<string>,
): ReconcileSession[] {
  return paid.filter((s) => !markers.has(s.id));
}
