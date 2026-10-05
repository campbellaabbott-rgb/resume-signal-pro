// The credit picker's bounds. MIRRORS MIN_CREDITS / MAX_CREDITS in
// supabase/functions/create-scan-pack-checkout/index.ts, which is what
// charges: Stripe's minimum USD charge is $0.50, so at $0.20 a credit one or
// two credits can never be bought. The pickers offered both, and Stripe
// refused every such checkout as a generic failure (platform sweep L6-11).
// src/test/the-smallest-credit-pack-is-one-stripe-will-charge reads both.
export const MIN_SCAN_CREDITS = 3;
export const MAX_SCAN_CREDITS = 100;

export function clampScanCredits(n: number): number {
  return Math.max(MIN_SCAN_CREDITS, Math.min(MAX_SCAN_CREDITS, Number.isFinite(n) ? Math.floor(n) : MIN_SCAN_CREDITS));
}
