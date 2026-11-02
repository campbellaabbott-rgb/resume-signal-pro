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

/**
 * THE EVENT A MISSED SESSION IS RE-DELIVERED WITH (S13-028). The webhook's
 * own completed-checkout event, built from the session Stripe just listed and
 * signed with the webhook's secret in Stripe's scheme (`t=<unix seconds>,
 * v1=<hex HMAC-SHA256(secret, "t.body")>`), so stripe-webhook verifies it
 * exactly as it verifies Stripe and runs the delivery it missed: the claim,
 * the order row, the buyer's mail. Everything that block does is safe to run
 * twice for one session. The id names the sweep, so its log rows say who sent it.
 */
export async function redeliveryOf(
  session: { id: string; livemode?: boolean | null },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ body: string; signature: string }> {
  const body = JSON.stringify({
    id: `evt_reconcile_${session.id}`,
    object: "event",
    api_version: "2025-12-15.clover",
    created: nowSeconds,
    livemode: session.livemode !== false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
    data: { object: session },
  });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${nowSeconds}.${body}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return { body, signature: `t=${nowSeconds},v1=${hex}` };
}
