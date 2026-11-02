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

/** The columns of a product_deliveries row a re-delivery is judged by. */
export interface DeliveryRow {
  status?: string | null;
  email_sent_at?: string | null;
  email_success?: boolean | null;
  generation_error?: string | null;
  email_error?: string | null;
}

export type RedeliveryState = "delivered" | "in_progress" | "failed" | "no_order_row";

/**
 * WHAT A RE-DELIVERY DID, READ FROM THE ORDER ROW (the fixer's review of
 * S13-028). stripe-webhook writes the used_stripe_sessions marker FIRST, before
 * it reads the résumé or generates anything, and generation is deferred: a
 * marker proves the webhook claimed the session, nothing more. A 30-hour-old
 * cover letter whose stored résumé had expired (24h) was claimed, then failed,
 * and the owner was told it was delivered. The state is the session's
 * product_deliveries rows':
 *   delivered     a row says delivered, or its purchase-link mail went out
 *                 (the $5 analysis runs when the buyer opens that link);
 *   failed        a row says generation_failed or email_failed (refund, or
 *                 send it by hand);
 *   in_progress   claimed and still generating (the retry sweep finishes it);
 *   no_order_row  claimed, with no order row at all (check by hand).
 */
export function redeliveryStateOf(rows: readonly DeliveryRow[]): { state: RedeliveryState; why: string | null } {
  if (rows.length === 0) return { state: "no_order_row", why: null };
  if (rows.some((r) => r.status === "delivered" || (!!r.email_sent_at && r.email_success !== false))) return { state: "delivered", why: null };
  const failed = rows.find((r) => r.status === "generation_failed" || r.status === "email_failed");
  if (failed) return { state: "failed", why: String(failed.generation_error || failed.email_error || failed.status).slice(0, 160) };
  return { state: "in_progress", why: null };
}

/** The owner's line for one claimed re-delivery. */
export function redeliveryOutcomeLine(s: { state: RedeliveryState; why: string | null }): string {
  switch (s.state) {
    case "delivered": return "re-delivered: its order row says delivered";
    case "failed": return `claimed by the webhook, then failed (${s.why}): refund it or send it by hand`;
    case "in_progress": return "claimed by the webhook and still generating: not delivered yet (the retry sweep finishes it; check product_deliveries)";
    default: return "claimed by the webhook, but no order row was written: check it by hand";
  }
}
