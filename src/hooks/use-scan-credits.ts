import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { PRODUCTS } from '@/config/products';
import { parseEdgeFunctionError } from '@/lib/edge-function-errors';
import { checkoutContext } from '@/lib/track-transport';

// Calculate price per credit from scan pack
const PRICE_PER_CREDIT_USD = PRODUCTS.scanPack.priceUsd / (PRODUCTS.scanPack.credits || 10);

/**
 * THE PROOF A BROWSER HOLDS FOR CREDITS IT BOUGHT WITHOUT AN ACCOUNT.
 *
 * Credits used to be looked up and spent by a typed email address, which
 * proves nothing: anyone could read or spend anyone's balance (defect sweep
 * 1.26 / 2.07). A signed-in account proves its own address through its
 * session. An anonymous buyer proves a purchase with the Stripe Checkout
 * session id from the success redirect, which only their browser saw; it is
 * kept here and sent to the scanner and to the scan-credits function, which
 * check it with Stripe and let it spend only what that purchase bought.
 *
 * Browser storage can be missing or throw (private windows, blocked site
 * data), so every access is guarded and the absence of storage is simply "no
 * purchases held": the credits stay usable by signing in with the purchase
 * email.
 */
export const CREDIT_SESSIONS_KEY = 'scanCreditsSessions';
/** Fired whenever the credits this browser can prove may have changed. */
export const CREDITS_UPDATED_EVENT = 'scanCreditsUpdated';
const MAX_KEPT = 10;
const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

export function creditSessions(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CREDIT_SESSIONS_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((s): s is string => typeof s === 'string' && SESSION_ID.test(s)).slice(0, MAX_KEPT)
      : [];
  } catch {
    return [];
  }
}

/** Keep a paid credit purchase's session id, newest first, and tell the page. */
export function rememberCreditSession(sessionId: string | null | undefined): void {
  if (!sessionId || !SESSION_ID.test(sessionId)) return;
  try {
    const next = [sessionId, ...creditSessions().filter((s) => s !== sessionId)].slice(0, MAX_KEPT);
    localStorage.setItem(CREDIT_SESSIONS_KEY, JSON.stringify(next));
  } catch { /* no storage: the purchase is still usable after signing in */ }
  try { window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT)); } catch { /* non-browser */ }
}

export type ProvenCredits = {
  /** What this browser can spend: its account's pool plus the held purchases' remainder. */
  credits: number;
  /** Credits the presented purchases bought in total (the success page's "N added"). */
  bought: number;
  signedIn: boolean;
  purchases: number;
  /** The account's address, or the held purchases' when there is exactly one. */
  email: string | null;
};

/**
 * The balance this browser can PROVE: its signed-in account's (the session
 * JWT is attached automatically) plus the purchases it holds. Never a
 * balance for an address someone typed. Null when it could not be read.
 */
export async function fetchProvenCredits(sessions: string[] = creditSessions()): Promise<ProvenCredits | null> {
  try {
    // Nothing to prove, nothing to ask: a visitor who is signed out and holds
    // no purchase has no credits, and the header mounts on every page.
    let signedIn = false;
    try {
      const { data: auth } = await supabase.auth.getSession();
      signedIn = !!auth?.session;
    } catch { /* no auth client: signed out */ }
    if (!signedIn && sessions.length === 0) {
      return { credits: 0, bought: 0, signedIn: false, purchases: 0, email: null };
    }
    const { data, error } = await supabase.functions.invoke('scan-credits', { body: { sessions } });
    if (error || typeof data?.credits !== 'number') return null;
    return {
      credits: data.credits,
      bought: typeof data.bought === 'number' ? data.bought : 0,
      signedIn: data.signedIn === true,
      purchases: typeof data.purchases === 'number' ? data.purchases : 0,
      email: typeof data.email === 'string' ? data.email : null,
    };
  } catch (err) {
    console.error('[useScanCredits] Error reading credits:', err);
    return null;
  }
}

interface ScanCreditsState {
  email: string | null;
  credits: number;
  signedIn: boolean;
  /** True once a balance has been read; false while unknown. */
  known: boolean;
  isLoading: boolean;
}

export function useScanCredits() {
  const [state, setState] = useState<ScanCreditsState>({
    email: null,
    credits: 0,
    signedIn: false,
    known: false,
    isLoading: false
  });

  /** Re-read the proven balance. Returns it (0 when unreadable). */
  const refreshCredits = useCallback(async (): Promise<number> => {
    const proven = await fetchProvenCredits();
    if (!proven) return 0;
    setState(prev => ({
      ...prev,
      email: proven.email,
      credits: proven.credits,
      signedIn: proven.signedIn,
      known: true,
    }));
    return proven.credits;
  }, []);

  // Purchase credits (redirects to Stripe checkout)
  const purchaseCredits = useCallback(async (email: string, creditAmount: number) => {
    if (!email || !email.includes('@')) {
      toast({
        title: "Email required",
        description: "Please enter a valid email address to purchase.",
        variant: "destructive"
      });
      return null;
    }

    if (creditAmount < 1 || creditAmount > 100) {
      toast({
        title: "Invalid amount",
        description: "Please select between 1 and 100 credits.",
        variant: "destructive"
      });
      return null;
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const normalizedEmail = email.toLowerCase().trim();
      const { data, error } = await supabase.functions.invoke('create-scan-pack-checkout', {
        body: {
          email: normalizedEmail,
          creditAmount: creditAmount,
          ...checkoutContext(),
        }
      });

      if (error) throw error;

      if (data?.url) {
        // The address is a convenience (sign-in and checkout prefill), never
        // a proof: the success page keeps the Stripe session id for that
        // (register L3-05).
        try { localStorage.setItem('scanCreditsEmail', normalizedEmail); } catch { /* no storage */ }
        // Redirect checkout in the same tab
        window.location.assign(data.url);
        return data.url;
      }

      throw new Error('No checkout URL received');
    } catch (err) {
      console.error('[useScanCredits] Purchase error:', err);
      const parsedError = await parseEdgeFunctionError(err);
      toast({
        title: parsedError.title,
        description: parsedError.description,
        variant: "destructive"
      });
      return null;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Legacy function for backwards compatibility
  const purchaseScanPack = useCallback(async (email: string) => {
    return purchaseCredits(email, 10); // Default to 10 credits
  }, [purchaseCredits]);

  // Verify purchase after returning from Stripe
  const verifyPurchase = useCallback(async (sessionId: string) => {
    if (!sessionId) return null;

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const { data, error } = await supabase.functions.invoke('verify-scan-pack-purchase', {
        body: { sessionId }
      });

      if (error) throw error;

      if (data?.verified) {
        // The session id is this browser's proof of the purchase from now
        // on, and the balance shown is the proven one, not the address's.
        rememberCreditSession(sessionId);
        const proven = await fetchProvenCredits();
        setState(prev => ({
          ...prev,
          email: proven?.email ?? prev.email,
          credits: proven?.credits ?? prev.credits,
          signedIn: proven?.signedIn ?? prev.signedIn,
          known: !!proven || prev.known,
        }));

        const added = Number(data.creditsAdded ?? proven?.bought ?? 0);
        toast({
          title: "Purchase successful!",
          description: added > 0
            ? `${added} credit${added !== 1 ? 's' : ''} added.`
            : "Your scan credits are ready.",
        });

        return data;
      }

      return null;
    } catch (err) {
      console.error('[useScanCredits] Verify error:', err);
      const parsedError = await parseEdgeFunctionError(err);
      toast({
        title: parsedError.title,
        description: parsedError.description,
        variant: "destructive"
      });
      return null;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  return {
    email: state.email,
    credits: state.credits,
    signedIn: state.signedIn,
    known: state.known,
    isLoading: state.isLoading,
    refreshCredits,
    purchaseCredits,
    purchaseScanPack, // Keep for backwards compatibility
    verifyPurchase,
    pricePerCredit: PRICE_PER_CREDIT_USD
  };
}
