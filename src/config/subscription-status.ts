// Which subscription statuses mean "a plan exists but owes money" -- the
// state whose way out is updating the card, never buying a second plan.
//
// MIRRORS supabase/functions/_shared/subscription-standing.ts
// (OWING_SUBSCRIPTION_STATUSES), which is what the two subscription checkouts
// refuse a new plan on. src/test/the-smaller-payment-defects-stay-fixed.test.ts
// ("a plan that owes money is never sold twice") reads both and fails if they
// drift: a card that offered "Go Pro" for a status the checkout then refuses
// would be a dead end, and one that offered "Update payment method" for a
// status the checkout accepts would hide the purchase.
export const OWING_SUBSCRIPTION_STATUSES: readonly string[] = ["past_due", "unpaid", "incomplete", "paused"];

export function isOwingStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && OWING_SUBSCRIPTION_STATUSES.includes(status);
}
