/**
 * WHAT A BUY OR SIGN-UP BUTTON SENDS BESIDES ITS PRODUCT (wave 3,
 * payments-account; commercial-readiness plan 2026-10-08 items 12 and 14 and
 * the affiliate line).
 *
 * Every checkout call spreads `...purchaseTerms()` next to
 * `...checkoutContext()`: the Terms version the button's line showed, the
 * affiliate code this browser arrived with (five of six checkouts used to
 * drop it), and, only while the EU/UK switch is on, the box the buyer ticked.
 * The server (supabase/functions/_shared/checkout-policy.ts) reads exactly
 * these names.
 */
import { useSyncExternalStore } from "react";
import { TERMS_VERSION } from "@/config/terms";
import { EU_UK_SALES_ON } from "@/config/eu-consumer";
import { getStoredReferralCode } from "@/hooks/use-affiliate-auth";

type Consent = { withdrawalWaiver: boolean; serviceStartConsent: boolean };

let consent: Consent = { withdrawalWaiver: false, serviceStartConsent: false };
const listeners = new Set<() => void>();

/**
 * How many "By continuing you agree" lines are on screen. The version is sent
 * only while one is, so the record never says a buyer was shown a line that
 * the page they bought from did not render.
 */
let linesShown = 0;
export function termsLineMounted(): () => void {
  linesShown++;
  return () => { linesShown = Math.max(0, linesShown - 1); };
}

/** Set by the EU/UK box beside a buy button (PurchaseTerms). */
export function setPurchaseConsent(patch: Partial<Consent>): void {
  consent = { ...consent, ...patch };
  for (const l of listeners) l();
}

export function usePurchaseConsent(): Consent {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => consent,
    () => consent,
  );
}

export type PurchaseTermsBody = {
  termsVersion?: string;
  referralCode?: string;
  withdrawalWaiver?: boolean;
  serviceStartConsent?: boolean;
};

/** The body fields every checkout carries. Never throws: storage may be blocked. */
export function purchaseTerms(): PurchaseTermsBody {
  const out: PurchaseTermsBody = {};
  if (linesShown > 0) out.termsVersion = TERMS_VERSION;
  try {
    const code = getStoredReferralCode();
    if (code) out.referralCode = code;
  } catch {
    /* blocked storage: no referral, still a checkout */
  }
  if (EU_UK_SALES_ON) {
    out.withdrawalWaiver = consent.withdrawalWaiver;
    out.serviceStartConsent = consent.serviceStartConsent;
  }
  return out;
}

/**
 * True when a checkout refused because the EU/UK box was not ticked: a 400
 * whose body names consentRequired. supabase-js hands a non-2xx body back on
 * error.context (a Response), so it is read from there.
 */
export async function consentWasRequired(error: unknown, data?: unknown): Promise<boolean> {
  const named = (v: unknown) => !!v && typeof v === "object" && typeof (v as { consentRequired?: unknown }).consentRequired === "string";
  if (named(data)) return true;
  const ctx = (error as { context?: { status?: number; clone?: () => { json: () => Promise<unknown> } } } | null)?.context;
  if (!ctx || ctx.status !== 400 || typeof ctx.clone !== "function") return false;
  try {
    return named(await ctx.clone().json());
  } catch {
    return false;
  }
}
