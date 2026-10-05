import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PRODUCTS, ProductId } from '@/config/products';
import { useConversionTracking } from '@/hooks/use-conversion-tracking';
import { useFunnelTracking } from '@/hooks/use-funnel-tracking';
import { parseEdgeFunctionError } from '@/lib/edge-function-errors';
import { checkoutContext } from '@/lib/track-transport';
import { getStoredReferralCode } from '@/hooks/use-affiliate-auth';
import { useCheckoutPrefetch } from '@/hooks/use-checkout-prefetch';
import { getResumeFromSession } from '@/hooks/use-session-resume';

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

type StoredCopy = { id: string; resume: string; linkedIn: string; jd: string };

function readStoredCopy(): StoredCopy | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PRESTORED_RESUME_KEY) ?? 'null');
    if (raw && typeof raw.id === 'string' && UUID.test(raw.id) && typeof raw.resume === 'string'
      && typeof raw.linkedIn === 'string' && typeof raw.jd === 'string') {
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
    // Handle backwards compatibility - if options is a string, treat it as sessionId
    const opts: CheckoutOptions = typeof options === 'string' 
      ? { sessionId: options } 
      : options || {};

    const product = PRODUCTS[productId];
    if (!product) {
      toast({
        title: "Invalid Product",
        description: "The selected product is not available.",
        variant: "destructive"
      });
      return null;
    }

    setIsLoading(true);
    setCurrentProduct(productId);
    
    // Track button click for conversion analytics with section metadata
    trackButtonClick(productId, opts.ctaSection || 'product_checkout');
    
    // Track in funnel
    trackProductClicked(productId, product.name, product.priceUsd);

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
          // Known email lets the server include the product free for active
          // Pro subscribers (and prefills Stripe checkout otherwise).
          email: localStorage.getItem('scanCreditsEmail') || localStorage.getItem('rb_last_email') || undefined,
          sessionId: binding.sessionId,
          jobTitle: opts.jobTitle,
          jobCompany: opts.jobCompany,
          referralCode: getStoredReferralCode(),
          // Generation happens server-side from the webhook, which has no
          // access to the browser's i18n state — has to be captured now.
          language: localStorage.getItem('i18nextLng') || 'en',
          // The visitor and the page, so the start the server records joins
          // back to this browser's landing (checkout_starts.visitor_id).
          ...checkoutContext(),
        }
      });

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
        
        toast(data.proIncluded
          ? {
              title: "Included with Pro",
              description: "No charge — this tool is part of your subscription. Preparing it now…",
            }
          : {
              title: "Redirecting to Checkout",
              description: "Taking you to Stripe checkout…",
            });
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
