import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PRODUCTS, ProductId } from '@/config/products';
import { useConversionTracking } from '@/hooks/use-conversion-tracking';
import { useFunnelTracking } from '@/hooks/use-funnel-tracking';
import { parseEdgeFunctionError } from '@/lib/edge-function-errors';
import { checkoutContext } from '@/lib/track-transport';
import { consentWasRequired, purchaseTerms, purchaseTermsUnused } from '@/lib/purchase-terms';
import i18n from '@/i18n';
import { loadAuthStrings } from '@/i18n/auth/load';
import { SESSION_ENDED_MARK_KEY } from '@/lib/auth-fragment';
import { useCheckoutPrefetch } from '@/hooks/use-checkout-prefetch';
import { getResumeFromSession } from '@/hooks/use-session-resume';
import { askForTargetRoles, cleanTargetRoles } from '@/lib/target-roles-request';

/** The résumé (and posting) a purchase is made from: what the buyer is looking at. */
export interface PurchaseInputs {
  resumeText: string;
  linkedInText?: string | null;
  jobDescription?: string | null;
}

export interface CheckoutOptions {
  sessionId?: string;
  jobTitle?: string;
  jobCompany?: string;
  ctaSection?: string; // Track which section the CTA was clicked from
  /**
   * The résumé and posting on THIS screen, when it has its own (the Account
   * page's apply kit, a preview card). The purchase is bound to a stored copy
   * of exactly these; without them it is bound to the résumé the tab restores.
   */
  inputs?: PurchaseInputs;
  /** ATS Defense: the roles to target, when the caller already asked (S11-074). */
  targetRoles?: string[];
}

/**
 * THE RÉSUMÉ THIS TAB PRE-STORED, FOR EVERY PURCHASE BUTTON (register L3-03).
 *
 * The homepage stores each scanned résumé server-side (store_temp_resume)
 * so a purchase can be generated, saved and emailed from it. The id lived in
 * Index's React state and reached only one modal: every other purchase
 * button (/pricing, the results page's product cards, the add-ons) sent no
 * id, so the server had nothing to generate from. Nothing was saved, nothing
 * was emailed, and the sale never appeared under Account > Purchases.
 *
 * The id is kept for the tab (sessionStorage, the same lifetime as the résumé
 * the page restores) TOGETHER WITH A DIGEST OF WHAT IT HOLDS, and a purchase
 * uses it only when that digest matches the résumé and posting the buyer is
 * looking at. A bare tab-wide fallback once bound an Apply Assistant bought
 * for a saved posting on the Account page to the homepage's résumé and a
 * different job description, whenever the panel's own store had been refused
 * (review of claude/w1-scan-ai, 2026-10-05). When nothing stored matches, the
 * purchase stores what is on screen first, and refuses to start a checkout it
 * could not deliver.
 *
 * Storage can be missing or throw (private windows, blocked site data): then
 * there is simply no stored copy, and the purchase stores one itself.
 */
export const PRESTORED_RESUME_KEY = 'rb_prestored_resume_session';

/**
 * WHAT A CHECKOUT WAS BOUND TO, FOR "TRY AGAIN" (sweep S8-056). The payment-
 * failed page retried with no inputs, so the retry bound whatever résumé the
 * tab held: an Account apply kit for job X, cancelled and retried, was bought
 * for the homepage scan of job Y. The binding and the job are kept here when
 * the buyer leaves for Stripe; the retry reuses them.
 */
export const CHECKOUT_RETRY_KEY = 'rb_checkout_retry';
export type CheckoutRetry = { productId: string; sessionId?: string; jobTitle?: string; jobCompany?: string; targetRoles?: string[]; path: string; at: number };

export function readCheckoutRetry(productId: string): CheckoutRetry | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(CHECKOUT_RETRY_KEY) ?? 'null') as CheckoutRetry | null;
    // An hour: a cancel comes straight back, and the copy it names must still
    // be inside the store's day.
    if (!r || r.productId !== productId || typeof r.at !== 'number' || Date.now() - r.at > 60 * 60 * 1000) return null;
    return r;
  } catch {
    return null;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_RESUME_CHARS = 50; // store_temp_resume's own floor

/**
 * Products generated from the buyer's résumé. These never start a checkout
 * without a stored copy of the résumé on screen. The scan pack and the
 * Freelance Boost tiers are not made from it.
 */
export const MADE_FROM_THE_RESUME: ReadonlySet<ProductId> = new Set<ProductId>([
  'basicKeywordFix', 'coverLetter', 'premiumPackage', 'atsDefense', 'careerSnapshot',
  'graduateGamePlan', 'interviewCoach', 'careerPathSimulator', 'applyAssistant',
]);

/** A short digest of one text, for telling copies apart (cyrb53), never for secrecy. */
function digest(text: string | null | undefined): string {
  const str = (text ?? '').trim();
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}:${str.length}`;
}

type StoredCopy = { id: string; resume: string; linkedIn: string; jd: string; storedAt: number };

/**
 * HOW LONG A STORED COPY IS TRUSTED (sweep S8-057). The temporary store keeps
 * a copy 24 hours (20261004150000) and the retention job deletes it after;
 * a purchase made later in a long-lived tab bound the deleted copy, the
 * checkout logged it 'gone' and went ahead, and the webhook had no résumé to
 * build or mail from. A copy older than this is no match, so a fresh one is
 * stored at the buy. A copy kept before the stamp existed is treated as old.
 */
export const STORED_COPY_MAX_AGE_MS = 23 * 60 * 60 * 1000;

function readStoredCopy(): StoredCopy | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PRESTORED_RESUME_KEY) ?? 'null');
    if (raw && typeof raw.id === 'string' && UUID.test(raw.id) && typeof raw.resume === 'string'
      && typeof raw.linkedIn === 'string' && typeof raw.jd === 'string'
      && typeof raw.storedAt === 'number' && Date.now() - raw.storedAt < STORED_COPY_MAX_AGE_MS) {
      return raw as StoredCopy;
    }
  } catch { /* a bare id from before the digest, or no storage: no stored copy */ }
  return null;
}

/** Keep the id of a stored copy of exactly these inputs (or forget it). */
export function rememberPreStoredResume(sessionId: string | null | undefined, inputs?: PurchaseInputs): void {
  try {
    if (sessionId && UUID.test(sessionId) && inputs?.resumeText) {
      const copy: StoredCopy = {
        id: sessionId,
        resume: digest(inputs.resumeText),
        linkedIn: digest(inputs.linkedInText),
        jd: digest(inputs.jobDescription),
        storedAt: Date.now(),
      };
      sessionStorage.setItem(PRESTORED_RESUME_KEY, JSON.stringify(copy));
    } else {
      sessionStorage.removeItem(PRESTORED_RESUME_KEY);
    }
  } catch { /* no storage: purchases store their own copy */ }
}

export function forgetPreStoredResume(): void {
  rememberPreStoredResume(null);
}

/**
 * The stored copy's id when it holds exactly these inputs: the same résumé
 * and the same posting (none counts as none), and the same LinkedIn text when
 * the caller names one. Otherwise undefined.
 */
export function preStoredResumeFor(inputs: PurchaseInputs): string | undefined {
  const copy = readStoredCopy();
  if (!copy) return undefined;
  if (copy.resume !== digest(inputs.resumeText)) return undefined;
  if (copy.jd !== digest(inputs.jobDescription)) return undefined;
  if (inputs.linkedInText !== undefined && copy.linkedIn !== digest(inputs.linkedInText)) return undefined;
  return copy.id;
}

/** The résumé the tab restores (what /pricing and the results page show), or null. */
function tabInputs(): PurchaseInputs | null {
  const s = getResumeFromSession();
  if (!s.resumeText || s.resumeText.trim().length < MIN_RESUME_CHARS) return null;
  return { resumeText: s.resumeText, linkedInText: s.linkedInText, jobDescription: s.jobDescriptionText };
}

/** Store a copy of these inputs now; its id, or null when the store refused. */
async function storeCopy(inputs: PurchaseInputs): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('store_temp_resume', {
      p_resume: inputs.resumeText.trim(),
      p_linkedin: inputs.linkedInText || null,
      p_job_description: inputs.jobDescription || null,
    } as never);
    if (error || typeof data !== 'string' || !UUID.test(data)) return null;
    rememberPreStoredResume(data, inputs);
    return data;
  } catch {
    return null;
  }
}

/**
 * THE ADDRESS A CHECKOUT IS PREFILLED WITH: THE SIGNED-IN ACCOUNT'S, OR NONE
 * (register CP-012, Account UX spec 9). The checkout used to send whatever
 * address this browser had stored (the scan-pack address, the last sign-in),
 * which on a shared computer is the previous person's: Stripe opened with
 * their address, and the receipt and the purchase went to it. A stored value
 * cannot say whether the person now at the keyboard typed it, so a signed-out
 * checkout sends no address and Stripe asks for one. A Pro member is
 * recognised by their signed-in account, never by a stored address.
 */
export async function checkoutPrefillEmail(): Promise<string | undefined> {
  try {
    const { data } = await supabase.auth.getSession();
    const email = data?.session?.user?.email;
    return typeof email === 'string' && email.includes('@') ? email : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A PRO MEMBER WHOSE SESSION ENDED IS ASKED BEFORE STRIPE CHARGES THEM
 * (register S12-087). A signed-out checkout sends no address (above), so the
 * server cannot recognise a signed-out Pro member and would charge them for a
 * tool their plan includes. Without sending an address that might be someone
 * else's, the page can still ask: when this browser held a SIGNED-IN session
 * that ended without a deliberate sign-out (AuthContext writes
 * SESSION_ENDED_MARK_KEY on that event alone, and clears it on the next
 * sign-in and on a sign-out), the first buy press in the tab says "sign in
 * first if you have Pro" and starts nothing; the next press buys as a guest.
 * Once per tab. The last address (rb_last_email) is NOT the key: it is also
 * written for anyone who asks for their report by email, and those visitors
 * were told their session had ended (lead decision G, third fixer round).
 */
export const PRO_SIGN_IN_ASKED_KEY = 'rb_checkout_signin_asked';
export function askToSignInFirst(signedIn: boolean): boolean {
  if (signedIn) return false;
  try {
    if (!localStorage.getItem(SESSION_ENDED_MARK_KEY)) return false;
    if (sessionStorage.getItem(PRO_SIGN_IN_ASKED_KEY)) return false;
    sessionStorage.setItem(PRO_SIGN_IN_ASKED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export type ResumeBinding = { sessionId?: string; refused?: boolean };

/**
 * Which stored résumé a purchase is delivered from. The caller's own id wins.
 * Otherwise: the résumé and posting on screen (the caller's inputs, else the
 * tab's restored résumé), from the matching stored copy, else stored now. A
 * product made from the résumé is refused when a copy could not be stored;
 * with no résumé anywhere the purchase goes ahead and the success page asks
 * for one, as it always has.
 */
export async function bindPurchaseResume(productId: ProductId, opts: CheckoutOptions): Promise<ResumeBinding> {
  if (opts.sessionId && UUID.test(opts.sessionId)) return { sessionId: opts.sessionId };
  const own = opts.inputs && opts.inputs.resumeText && opts.inputs.resumeText.trim().length >= MIN_RESUME_CHARS
    ? opts.inputs
    : null;
  const inputs = own ?? tabInputs();
  if (!inputs) return {};
  const matched = preStoredResumeFor(inputs);
  if (matched) return { sessionId: matched };
  if (!MADE_FROM_THE_RESUME.has(productId)) return {};
  const stored = await storeCopy(inputs);
  return stored ? { sessionId: stored } : { refused: true };
}

export function useProductCheckout() {
  const [isLoading, setIsLoading] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<ProductId | null>(null);
  const { toast } = useToast();
  const { trackButtonClick } = useConversionTracking();
  const { trackProductClicked, trackCheckoutStarted } = useFunnelTracking();
  const { prefetch: prefetchCheckout, prefetchProps } = useCheckoutPrefetch();

  const purchaseProduct = async (productId: ProductId, options?: CheckoutOptions | string): Promise<string | null> => {
    // The Terms the press carried, read before the first await: a tap during
    // the résumé store below would otherwise be read as the press that
    // started this checkout (review of the integration, 2026-10-10).
    const terms = purchaseTerms();
    // Handle backwards compatibility - if options is a string, treat it as sessionId
    const opts: CheckoutOptions = typeof options === 'string' 
      ? { sessionId: options } 
      : options || {};

    const product = PRODUCTS[productId];
    if (!product) {
      purchaseTermsUnused();
      toast({
        title: "Invalid Product",
        description: "The selected product is not available.",
        variant: "destructive"
      });
      return null;
    }

    const prefillEmail = await checkoutPrefillEmail();
    if (askToSignInFirst(!!prefillEmail)) {
      purchaseTermsUnused();
      // The auth strings load lazily; they are in before the notice is worded.
      await loadAuthStrings();
      toast({
        title: i18n.t("auth.checkout.signInFirstTitle", "Have Pro? Sign in first"),
        description: i18n.t("auth.checkout.signInFirst", "Your session here ended. If you have a Pro plan, sign in and this tool is included at no charge. To buy it without signing in, press the button again."),
      });
      return null;
    }

    // ATS DEFENSE TARGETS THE ROLES ITS BUYER NAMES (S11-074): asked before
    // any checkout starts; closing the question starts none.
    let targetRoles: string[] | undefined = opts.targetRoles ? cleanTargetRoles(opts.targetRoles) : undefined;
    if (productId === 'atsDefense' && !targetRoles?.length) {
      const answered = await askForTargetRoles(opts.jobTitle ? [opts.jobTitle] : []);
      // Closing the question starts no checkout, so the box goes back to its line.
      if (answered === null) { purchaseTermsUnused(); return null; }
      targetRoles = answered;
    }

    setIsLoading(true);
    setCurrentProduct(productId);

    // Track button click for conversion analytics with section metadata
    trackButtonClick(productId, opts.ctaSection || 'product_checkout');
    
    // Track in funnel
    trackProductClicked(productId, product.name, product.priceUsd);

    // Every way out below that is not the checkout URL gives the box back.
    let started = false;
    try {
      // The résumé this purchase is delivered from: the one on screen, never
      // another (see bindPurchaseResume).
      const binding = await bindPurchaseResume(productId, opts);
      if (binding.refused) {
        toast({
          title: "Couldn't prepare your résumé",
          description: "We could not save a copy of your résumé to build this from, so nothing was charged. Please try again in a few minutes.",
          variant: "destructive"
        });
        return null;
      }

      const { data, error } = await supabase.functions.invoke('create-product-checkout', {
        body: {
          productId: productId,
          // The signed-in account's address, or none (see checkoutPrefillEmail).
          email: prefillEmail,
          sessionId: binding.sessionId,
          jobTitle: opts.jobTitle,
          jobCompany: opts.jobCompany,
          ...(targetRoles?.length ? { targetRoles } : {}),
          // Generation happens server-side from the webhook, which has no
          // access to the browser's i18n state — has to be captured now.
          language: localStorage.getItem('i18nextLng') || 'en',
          // The visitor and the page, so the start the server records joins
          // back to this browser's landing (checkout_starts.visitor_id).
          ...checkoutContext(),
          // The referral, the Terms line's version, the EU/UK box.
          ...terms,
        }
      });

      if (await consentWasRequired(error, data)) {
        toast({ title: i18n.t("purchaseTerms.consentNeeded"), variant: "destructive" });
        return null;
      }
      if (error) {
        console.error('Checkout error:', error);
        const parsedError = await parseEdgeFunctionError(error);
        toast({
          title: parsedError.title,
          description: parsedError.description,
          variant: "destructive"
        });
        return null;
      }

      // A PRO SUBSCRIBER WHO IS SIGNED OUT. The grant that makes this product
      // free is now minted from the verified session rather than from the email
      // typed into the form — an email address is a claim, not proof, and
      // keying an entitlement on one let anyone who knew a subscriber's address
      // mint their whole catalogue. The server answers this instead of a
      // checkout URL so we ask them to sign in rather than charging them for
      // something their subscription already includes.
      if (data?.proRequiresSignIn) {
        toast({
          title: "Sign in to use your Pro subscription",
          description: "This tool is included with Pro. Sign in with the email on your subscription and it will be free.",
        });
        return null;
      }

      if (data?.url) {
        // Track in funnel (the product_conversion intent event was retired:
        // see use-conversion-tracking.ts -- the server's checkout_starts row
        // is the record of a session minted)
        trackCheckoutStarted(productId, product.priceUsd);
        try {
          const retry: CheckoutRetry = {
            productId, sessionId: binding.sessionId, jobTitle: opts.jobTitle, jobCompany: opts.jobCompany, targetRoles,
            path: `${window.location.pathname}${window.location.search}`, at: Date.now(),
          };
          sessionStorage.setItem(CHECKOUT_RETRY_KEY, JSON.stringify(retry));
        } catch { /* no storage: a retry goes back to the page instead */ }
        
        toast(data.proIncluded
          ? {
              title: "Included with Pro",
              description: "No charge — this tool is part of your subscription. Preparing it now…",
            }
          : {
              title: "Redirecting to Checkout",
              description: "Taking you to Stripe checkout…",
            });
        started = true;
        window.location.assign(data.url);
        return data.url;
      }

      return null;
    } catch (err) {
      console.error('Purchase error:', err);
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive"
      });
      return null;
    } finally {
      if (!started) purchaseTermsUnused();
      setIsLoading(false);
      setCurrentProduct(null);
    }
  };

  return {
    purchaseProduct,
    isLoading,
    currentProduct,
    products: PRODUCTS,
    // Prefetch utilities for checkout buttons
    prefetchCheckout,
    checkoutPrefetchProps: prefetchProps,
  };
}
