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
import { useSyncExternalStore, type RefObject } from "react";
import { TERMS_VERSION } from "@/config/terms";
import { EU_UK_SALES_ON } from "@/config/eu-consumer";
import { getStoredReferralCode } from "@/hooks/use-affiliate-auth";

export type Consent = { withdrawalWaiver: boolean; serviceStartConsent: boolean };
const NO_CONSENT: Consent = Object.freeze({ withdrawalWaiver: false, serviceStartConsent: false });

const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/**
 * WHICH BUTTON THE TERMS BELONG TO. A line covers the buttons inside its own
 * block, the element it sits in. The version (and, with the switch on, the
 * box) is sent only when the press that started the checkout landed in such
 * a block: a line on another card of the same page covers nothing, so the
 * record never says a buyer saw a line their button did not carry.
 *
 * EACH LINE HOLDS ITS OWN BOX (S11-141). The box used to be one value for
 * the whole page: ticked on one card, it counted as consent for a purchase
 * pressed on another, and stayed ticked for every later purchase. Now each
 * line on screen keeps what its own box says, the checkout sends the box of
 * the line whose block holds the press, and that box clears as the checkout
 * starts. A line that leaves the screen takes its box with it.
 */
const lines = new Map<Element, Consent>();
let pressed: Element | null = null;
/**
 * THE BOX A PURCHASE SPENT, KEPT UNTIL THAT PURCHASE IS DONE WITH (review of
 * S11-141). The box clears the moment its purchase reads it, so a "Try again"
 * after a failed first attempt read an empty box and the server refused the
 * retry (withdrawal_waiver_required) though the buyer had ticked it; and a
 * purchase that read it and then started no checkout (the roles question
 * closed, a résumé that could not be stored, a failed call) lost the tick. A
 * retry of the same line sends what its first press sent, and
 * purchaseTermsUnused() gives the box back to a line that started nothing.
 */
let spent: { line: Element; consent: Consent } | null = null;
let retrying = false;

function notePress(e: Event): void {
  const t = (e as Event & { submitter?: Element | null }).submitter ?? e.target;
  if (!(t instanceof Element)) return;
  // A retry continues the purchase its first press started.
  if (t.closest("[data-purchase-retry]")) { retrying = true; return; }
  pressed = t;
  retrying = false;
}
if (typeof document !== "undefined") {
  document.addEventListener("click", notePress, true);
  document.addEventListener("submit", notePress, true);
}

/** Called by PurchaseTerms with its own element while it is on screen. */
export function termsLineMounted(el: Element | null): () => void {
  if (!el) return () => {};
  lines.set(el, NO_CONSENT);
  emit();
  return () => {
    lines.delete(el);
    if (spent?.line === el) spent = null;
    emit();
  };
}

const depth = (el: Element | null): number => {
  let n = 0;
  for (let e = el; e; e = e.parentElement) n++;
  return n;
};

/** The line whose block holds the last press: the innermost when blocks nest. */
function lineOfPress(): Element | null {
  const t = pressed;
  if (!t || !t.isConnected) return null;
  let best: Element | null = null;
  for (const line of lines.keys()) {
    if (!line.isConnected || !line.parentElement?.contains(t)) continue;
    if (!best || depth(line.parentElement) > depth(best.parentElement)) best = line;
  }
  return best;
}

/** True when the last press landed in the block of a Terms line on screen. */
export function pressCarriesTerms(): boolean {
  return lineOfPress() !== null;
}

/** Set by the EU/UK box of one Terms line (PurchaseTerms). */
export function setPurchaseConsent(line: Element | null | undefined, patch: Partial<Consent>): void {
  if (!line || !lines.has(line)) return;
  lines.set(line, { ...lines.get(line)!, ...patch });
  emit();
}

/** What one line's box says, read again whenever any box changes. */
export function usePurchaseConsent(line: RefObject<Element>): Consent {
  const read = () => (line.current ? lines.get(line.current) : undefined) ?? NO_CONSENT;
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * THE SWITCH, AS THE SERVER SAYS IT (S11-142). The server's EU_UK_SALES and
 * the build's VITE_EU_UK_SALES could not flip together: with the secret on
 * and an older bundle live, every checkout answered 400 for a box nobody was
 * shown. The box now ships dormant and shows when the build flag is on OR the
 * server says its switch is on: create-checkout answers that to a GET, asked
 * once per page when the first Terms line mounts, and a refusal that names
 * the box (consentWasRequired) confirms it too. So the owner publishes the
 * page first and flips the secret after (docs/wave3/README.md).
 */
let serverSaysOn = false;
let askedServer = false;
/** The box's wording as the server's refusal carried it, by box. */
const serverWording: Partial<Record<keyof Consent, string>> = {};

export function euUkBoxShown(): boolean {
  return EU_UK_SALES_ON || serverSaysOn;
}

export function useEuUkBoxShown(): boolean {
  return useSyncExternalStore(subscribe, euUkBoxShown, euUkBoxShown);
}

/** The wording the server sent for a box, when a refusal carried one. */
export function serverBoxWording(box: keyof Consent): string | undefined {
  return serverWording[box];
}

function serverConfirmed(): void {
  if (serverSaysOn) return;
  serverSaysOn = true;
  emit();
}

/** Asks create-checkout once whether the switch is on. Never throws. */
export function askServerForEuUkSwitch(): void {
  if (askedServer || EU_UK_SALES_ON) return;
  askedServer = true;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!base || typeof fetch !== "function") return;
  fetch(`${base}/functions/v1/create-checkout`, {
    method: "GET",
    headers: key ? { apikey: key, Authorization: `Bearer ${key}` } : {},
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: unknown) => {
      if (j && typeof j === "object" && (j as { euUkSales?: unknown }).euUkSales === true) serverConfirmed();
    })
    .catch(() => { /* unanswered: the refusal path below still shows the box */ });
}

export type PurchaseTermsBody = {
  termsVersion?: string;
  referralCode?: string;
  withdrawalWaiver?: boolean;
  serviceStartConsent?: boolean;
};

/**
 * The body fields every checkout carries. Never throws: storage may be blocked.
 *
 * It reads the LAST press on the page, so call it in the press's own handler
 * before the first await and keep the result: a tap during a later await (on
 * the checkout overlay, or anywhere) becomes the last press, and the buyer
 * who pressed a covered button would be recorded as having seen no Terms.
 */
export function purchaseTerms(): PurchaseTermsBody {
  const out: PurchaseTermsBody = {};
  const line = lineOfPress();
  if (line) out.termsVersion = TERMS_VERSION;
  try {
    const code = getStoredReferralCode();
    if (code) out.referralCode = code;
  } catch {
    /* blocked storage: no referral, still a checkout */
  }
  // The box is part of the line: only the box beside the pressed button is
  // consent to this purchase, and it is spent by it. A retry of that purchase
  // sends what the first press sent.
  if (euUkBoxShown()) {
    let c = (line && lines.get(line)) || NO_CONSENT;
    const ticked = (x: Consent) => x.withdrawalWaiver || x.serviceStartConsent;
    if (retrying && line && spent?.line === line && !ticked(c)) c = spent.consent;
    out.withdrawalWaiver = c.withdrawalWaiver;
    out.serviceStartConsent = c.serviceStartConsent;
    if (line && ticked(c)) {
      spent = { line, consent: c };
      if (ticked(lines.get(line) ?? NO_CONSENT)) {
        lines.set(line, NO_CONSENT);
        emit();
      }
    }
  }
  return out;
}

/**
 * The purchase that last read a box started no checkout: give that box back
 * to its line, unless the line has left the screen or was ticked again since.
 * Called where a checkout ends before the server returned its URL.
 */
export function purchaseTermsUnused(): void {
  const s = spent;
  spent = null;
  if (!s || !lines.has(s.line)) return;
  const now = lines.get(s.line)!;
  if (now.withdrawalWaiver || now.serviceStartConsent) return;
  lines.set(s.line, s.consent);
  emit();
}

/**
 * True when a checkout refused because the EU/UK box was not ticked: a 400
 * whose body names consentRequired. supabase-js hands a non-2xx body back on
 * error.context (a Response), so it is read from there. Such a refusal is the
 * server saying its switch is on: the box shows beside the button from then.
 */
export async function consentWasRequired(error: unknown, data?: unknown): Promise<boolean> {
  const named = (v: unknown) => !!v && typeof v === "object" && typeof (v as { consentRequired?: unknown }).consentRequired === "string";
  const learn = (v: unknown) => {
    const b = v as { consentBox?: unknown; consentText?: unknown };
    if ((b.consentBox === "withdrawalWaiver" || b.consentBox === "serviceStartConsent") && typeof b.consentText === "string" && b.consentText.trim()) {
      serverWording[b.consentBox] = b.consentText.slice(0, 400);
    }
    serverConfirmed();
    return true;
  };
  if (named(data)) return learn(data);
  const ctx = (error as { context?: { status?: number; clone?: () => { json: () => Promise<unknown> } } } | null)?.context;
  if (!ctx || ctx.status !== 400 || typeof ctx.clone !== "function") return false;
  try {
    const body = await ctx.clone().json();
    return named(body) ? learn(body) : false;
  } catch {
    return false;
  }
}

/** For tests: forget every box and the server's answer. */
export function resetPurchaseTermsForTests(): void {
  for (const line of lines.keys()) lines.set(line, NO_CONSENT);
  spent = null;
  retrying = false;
  serverSaysOn = false;
  askedServer = false;
  for (const k of Object.keys(serverWording)) delete serverWording[k as keyof Consent];
  emit();
}
