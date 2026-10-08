/**
 * WHAT EVERY CHECKOUT ASKS STRIPE FOR, BESIDES THE PRICE (wave 3,
 * payments-account; commercial-readiness plan 2026-10-08 items 1, 11, 12, 14
 * and the "Later" affiliate line; sweep S8-060).
 *
 * Seven functions mint Stripe sessions and each spelled these choices for
 * itself, so each got them differently: three fell back to a host we do not
 * own for the return address, none asked Stripe to send a receipt, none
 * recorded which Terms the buyer was shown, one carried the affiliate's code
 * and five dropped it. Each function now asks this module.
 *
 * NO IMPORTS: vitest imports this file directly and runs every rule below.
 */

/** The site's own address: the return address whenever the caller's Origin is not one of ours. */
export const SITE_ORIGIN = "https://resumebooster.work";

/** Hosts we own. Not *.lovable.app: resumebooster.lovable.app is another company's product. */
const OWN_HOSTS: ReadonlySet<string> = new Set([
  "resumebooster.work",
  "www.resumebooster.work",
  "resume-signal-pro.lovable.app",
]);

type Env = (name: string) => string | undefined;

/**
 * WHERE STRIPE SENDS THE BUYER BACK (S8-060). The Origin header is the
 * caller's to write, so a forged one turned a real checkout.stripe.com page
 * into a redirect, after payment and with the session id, to a host the
 * forger chose. Only our hosts, a local development server, or an exact origin
 * the owner lists in CHECKOUT_EXTRA_ORIGINS (comma-separated, for the Lovable
 * preview) are returned; anything else is the site itself.
 */
export function checkoutOrigin(originHeader: string | null | undefined, env?: Env): string {
  const raw = String(originHeader ?? "").trim();
  if (!raw) return SITE_ORIGIN;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return SITE_ORIGIN;
  }
  const origin = `${u.protocol}//${u.host}`;
  if (u.protocol === "https:" && OWN_HOSTS.has(u.hostname) && !u.port) return origin;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return origin;
  const extra = String(env?.("CHECKOUT_EXTRA_ORIGINS") ?? "")
    .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter((s) => /^https:\/\/[a-z0-9.-]+$/i.test(s));
  if (extra.includes(origin)) return origin;
  return SITE_ORIGIN;
}

/**
 * THE TERMS A BUYER WAS SHOWN (item 12). The date the Terms page's text last
 * changed; src/config/terms.ts holds the same string and a test holds the two
 * equal. Every buy button carries "By continuing you agree to the Terms" and
 * sends this version; the checkout writes it on the Stripe session and on the
 * start record (checkout_starts, kept indefinitely), so a purchase joins to
 * the Terms it was made under. A body without it (an old cached page) is
 * recorded as not shown, never refused.
 */
export const TERMS_VERSION = "2026-07-10";

export function termsVersionOf(body: unknown): string | null {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return b.termsVersion === TERMS_VERSION ? TERMS_VERSION : null;
}

/** An affiliate's code as the affiliate page mints it: hex, at most 20 characters. */
export function referralCodeOf(body: unknown): string {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return typeof b.referralCode === "string" ? b.referralCode.slice(0, 20).replace(/[^a-f0-9]/gi, "") : "";
}

/**
 * THE EU/UK SWITCH (owner decision 3, 2026-10-08). Off unless EU_UK_SALES is
 * exactly "on", and it stays off until the owner has registered for VAT.
 * While off, nothing below changes a session: no tax, no waiver.
 */
export function euUkSalesOn(env?: Env): boolean {
  return env?.("EU_UK_SALES") === "on";
}

/** The waiver wording's version: the checkbox's text, src/config/eu-consumer.ts. */
export const WITHDRAWAL_WAIVER_VERSION = "2026-10-09";

/** What the buyer ticked, read only while the switch is on. */
export function euConsentOf(body: unknown): { waiver: boolean; serviceStart: boolean } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return { waiver: b.withdrawalWaiver === true, serviceStart: b.serviceStartConsent === true };
}

/**
 * Why a checkout may not start yet, or null. With the switch on, a one-time
 * digital product needs the buyer's express request for delivery now and
 * their acknowledgement that the 14-day right to withdraw ends with it
 * (Directive 2011/83/EU art. 16(m)); a subscription needs the request that the
 * service start inside the withdrawal period (art. 7(3)). Off: never.
 */
export function euConsentRefusal(env: Env | undefined, mode: "payment" | "subscription", body: unknown): string | null {
  if (!euUkSalesOn(env)) return null;
  const c = euConsentOf(body);
  if (mode === "payment" && !c.waiver) return "withdrawal_waiver_required";
  if (mode === "subscription" && !c.serviceStart) return "service_start_consent_required";
  return null;
}

type Params = Record<string, unknown>;

/**
 * The session fields every checkout adds, by mode:
 *   - a receipt (item 1): a payment whose buyer's address is known names it as
 *     the receipt address, which Stripe mails whatever the dashboard's
 *     receipt setting says; a subscription's invoices follow the dashboard's
 *     billing-email settings (an owner step, named in the deploy note);
 *   - the Stripe checkbox for the Terms when STRIPE_TERMS_CONSENT is "on"
 *     (it needs the Terms URL set in the Stripe dashboard, or Stripe refuses
 *     every session, so it is the owner's switch);
 *   - the renewal terms beside Stripe's pay button (item 11);
 *   - tax and the address it needs, only with the EU/UK switch on; otherwise
 *     automatic tax stays off, as it always was.
 */
export function sessionPolicy(opts: {
  mode: "payment" | "subscription";
  env?: Env;
  receiptEmail?: string | null;
  /** True when the session names an existing Stripe customer (tax then updates its address). */
  hasCustomer?: boolean;
  /** The renewal sentence for a subscription (renewalTerms below). */
  renewal?: string | null;
}): Params {
  const out: Params = {};
  const email = typeof opts.receiptEmail === "string" && opts.receiptEmail.includes("@") ? opts.receiptEmail.trim().toLowerCase() : "";
  if (opts.mode === "payment" && email) out.payment_intent_data = { receipt_email: email };
  const customText: Params = {};
  if (opts.renewal) customText.submit = { message: opts.renewal.slice(0, 1200) };
  if (opts.env?.("STRIPE_TERMS_CONSENT") === "on") {
    out.consent_collection = { terms_of_service: "required" };
    customText.terms_of_service_acceptance = { message: `I agree to the [Terms of Service](${SITE_ORIGIN}/terms).` };
  }
  if (Object.keys(customText).length) out.custom_text = customText;
  if (euUkSalesOn(opts.env)) {
    out.automatic_tax = { enabled: true };
    out.billing_address_collection = "required";
    out.tax_id_collection = { enabled: true };
    if (opts.hasCustomer) out.customer_update = { address: "auto", name: "auto" };
  } else {
    out.automatic_tax = { enabled: false };
  }
  return out;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * THE RENEWAL TERMS, as Stripe shows them beside its pay button and as the
 * confirmation mail repeats them. Computed from the price and the trial the
 * session actually carries, never typed.
 */
export function renewalTerms(priceCents: number, trialDays: number | null): string {
  const cancel = "Cancel any time from your account (Account, then Manage subscription).";
  if (trialDays && trialDays > 0) {
    return `Free for ${trialDays} days, then ${usd(priceCents)} every month until you cancel. Cancel before the trial ends and you will not be charged. ${cancel}`;
  }
  return `${usd(priceCents)} every month, renewing automatically until you cancel. ${cancel}`;
}

/**
 * What the Stripe session and the start record carry about these choices.
 * Stripe keeps metadata for the life of the account, so the version strings
 * only: never what a person typed.
 *
 * THE REFERRAL RIDES EVERY CHECKOUT; THE COMMISSION DOES NOT. Five of six
 * checkouts dropped the affiliate's code, so a referred Pro or Full Analysis
 * sale was invisible. The code is now carried by all of them, and the webhook
 * records the conversion. The affiliate page promises nothing for the Full
 * Resume Analysis, scan credit top-ups, Pro, Morning Queue or the Agent Pass,
 * so those checkouts mark the referral `referral_commission: "none"` and the
 * conversion is recorded at $0: attributed, not paid, until the owner sets a
 * rate (src/config/affiliate-commission.ts says which).
 */
export function policyMetadata(body: unknown, env?: Env, opts: { commissioned?: boolean } = {}): Record<string, string> {
  const md: Record<string, string> = {};
  const shown = termsVersionOf(body);
  if (shown) md.terms_version = shown;
  const referral = referralCodeOf(body);
  if (referral) {
    md.referral_code = referral;
    if (opts.commissioned !== true) md.referral_commission = "none";
  }
  if (euUkSalesOn(env)) {
    const c = euConsentOf(body);
    if (c.waiver) md.withdrawal_waiver = WITHDRAWAL_WAIVER_VERSION;
    if (c.serviceStart) md.service_start_consent = WITHDRAWAL_WAIVER_VERSION;
  }
  return md;
}
