/**
 * WHAT A BUY OR SIGN-UP BUTTON SENDS BESIDES ITS PRODUCT (wave 3,
 * payments-account; commercial-readiness plan 2026-10-08 items 12 and 14 and
 * the affiliate line).
 *
 * Every checkout call spreads `...purchaseTerms()` next to
 * `...checkoutContext()`: the Terms version the pressed button's line showed, the
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
 * WHICH BUTTON THE TERMS BELONG TO. A line covers the buttons inside its own
 * block, the element it sits in. The version (and, with the switch on, the
 * box) is sent only when the press that started the checkout landed in such
 * a block: a line on another card of the same page covers nothing, so the
 * record never says a buyer saw a line their button did not carry.
 */
const lines = new Set<Element>();
let pressed: Element | null = null;

function notePress(e: Event): void {
  const t = (e as Event & { submitter?: Element | null }).submitter ?? e.target;
  if (!(t instanceof Element)) return;
  // A retry continues the purchase its first press started.
  if (t.closest("[data-purchase-retry]")) return;
  pressed = t;
}
if (typeof document !== "undefined") {
  document.addEventListener("click", notePress, true);
  document.addEventListener("submit", notePress, true);
}

/** Called by PurchaseTerms with its own element while it is on screen. */
export function termsLineMounted(el: Element | null): () => void {
  if (!el) return () => {};
  lines.add(el);
  return () => { lines.delete(el); };
}

/** True when the last press landed in the block of a Terms line on screen. */
export function pressCarriesTerms(): boolean {
  const t = pressed;
  if (!t || !t.isConnected) return false;
  for (const line of lines) {
    if (line.isConnected && line.parentElement?.contains(t)) return true;
  }
  return false;
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
  const covered = pressCarriesTerms();
  if (covered) out.termsVersion = TERMS_VERSION;
  try {
    const code = getStoredReferralCode();
    if (code) out.referralCode = code;
  } catch {
    /* blocked storage: no referral, still a checkout */
  }
  // The box is part of the line: a box ticked on another card is not consent
  // to this purchase.
  if (EU_UK_SALES_ON) {
    out.withdrawalWaiver = covered && consent.withdrawalWaiver;
    out.serviceStartConsent = covered && consent.serviceStartConsent;
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
