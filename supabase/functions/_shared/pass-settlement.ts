// WHEN A PASS CHECKOUT SESSION COUNTS AS SETTLED — one answer for the webhook
// and the success-page repair, so the two can never disagree.
//
// A pass is a one-time charge: settled means payment_status 'paid'. One
// exception, for the pass only: create-pass-checkout allows promotion codes,
// and a 100%-off code (the owner's own e2e path, create-test-coupon) leaves a
// payment-mode session with amount_total 0 and no PaymentIntent. Stripe's
// reference pins 'no_payment_required' to setup mode and billing-cycle
// anchors; the no-cost-orders guide says only to fulfil on
// checkout.session.completed. The observed shape for a $0 payment-mode
// session is 'no_payment_required' (the same value the $99 trial answers,
// recorded in stripe-webhook), so it is accepted here — narrowly: payment
// mode, a zero total, the pass product type — and never for a non-zero total,
// where 'no_payment_required' would mean money is still owed. No money is at
// risk either way: a $0 session exists only through a coupon the owner made.
import { PASS_PRODUCT_TYPE } from "./pass.ts";

export type PassSessionShape = {
  payment_status?: string | null;
  mode?: string | null;
  amount_total?: number | null;
  metadata?: Record<string, string | undefined> | null;
};

export function passSessionSettled(session: PassSessionShape): boolean {
  if (session.payment_status === "paid") return true;
  return session.payment_status === "no_payment_required"
    && session.mode === "payment"
    && (session.amount_total ?? 0) === 0
    && session.metadata?.product_type === PASS_PRODUCT_TYPE;
}
