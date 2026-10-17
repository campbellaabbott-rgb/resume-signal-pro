import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import i18n from "@/i18n";
import { checkoutContext } from "@/lib/track-transport";
import { consentWasRequired, purchaseTerms } from "@/lib/purchase-terms";
import { checkoutRefusalOf } from "@/lib/checkout-refusal";
import { territoryHint } from "@/lib/checkout-territory";

/** How often, and how many times, a buyer back from Stripe is re-checked until the plan reads live. */
export const PRO_CONFIRM_INTERVAL_MS = 3000;
export const PRO_CONFIRM_TRIES = 10;

export interface ProSubscriptionState {
  active: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
  loading: boolean;
  /**
   * Live only through a trial (check-subscription, the one rule in
   * _shared/pro-standing.ts): the plan's ongoing features are on, the paid
   * one-off tools are not included until the first payment.
   */
  trialing: boolean;
  /** The address holds a live plan this account cannot use yet (not linked, mailbox not proven). */
  linkPending: boolean;
  /**
   * The live plan was cancelled at its period end (in Stripe's portal): it
   * stays on until currentPeriodEnd and does not renew (S12-076).
   */
  cancelAtPeriodEnd: boolean;
  /**
   * Which plan the account's standing rests on (check-subscription planTier):
   * "agent" is the retired Apply Agent plan, shown as such and never sold or
   * renewed as Pro (S12-168).
   */
  planTier: "pro" | "agent" | null;
}

const EMPTY: Omit<ProSubscriptionState, "loading"> = {
  active: false, status: null, currentPeriodEnd: null, trialing: false, linkPending: false, cancelAtPeriodEnd: false, planTier: null,
};

/**
 * BACK FROM STRIPE'S BILLING PORTAL (S12-076): create-portal-session returns
 * the subscriber to /account?portal=return, and the first check after it asks
 * Stripe (fresh) instead of a cached row, so a cancel shows at once.
 */
export function backFromPortal(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("portal") === "return";
  } catch {
    return false;
  }
}

/**
 * Resume Booster Pro ($45/month, all tools included).
 * - proStatus: live check against the check-subscription function, using the
 *   signed-in session when available, otherwise the browser-remembered
 *   purchase email.
 * - subscribe(): opens Stripe Checkout in subscription mode.
 * - manage(): opens the Stripe billing portal (signed-in users only).
 */
export function useProSubscription() {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const [pro, setPro] = useState<ProSubscriptionState>({ ...EMPTY, loading: true });
  // Read once per mount: only the first check after the portal skips the cache.
  const [freshOnce] = useState(() => ({ pending: backFromPortal() }));
  const [actionLoading, setActionLoading] = useState(false);

  const knownEmail =
    user?.email ||
    localStorage.getItem("scanCreditsEmail") ||
    localStorage.getItem("rb_last_email") ||
    "";

  // THE CHECKOUT THE BUYER JUST COMPLETED (sweep S8-055). Stripe sends a new
  // subscriber back with ?pro=success&session_id=cs_...; check-subscription
  // answers that session live instead of the "inactive" row cached when
  // /pricing was opened before they paid, which it served for five minutes.
  const heldSession = (() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const id = q.get("session_id") ?? "";
      return q.get("pro") === "success" && /^cs_[A-Za-z0-9_]{8,250}$/.test(id) ? id : null;
    } catch {
      return null;
    }
  })();

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!knownEmail && !heldSession) {
      setPro({ ...EMPTY, loading: false });
      return false;
    }
    try {
      const fresh = freshOnce.pending;
      freshOnce.pending = false;
      const { data, error } = await supabase.functions.invoke("check-subscription", {
        body: {
          ...(knownEmail ? { email: knownEmail } : {}),
          ...(heldSession ? { sessionId: heldSession } : {}),
          ...(fresh ? { fresh: true } : {}),
        },
      });
      if (error) throw error;
      setPro({
        active: !!data?.active,
        status: data?.status ?? null,
        currentPeriodEnd: data?.currentPeriodEnd ?? null,
        loading: false,
        trialing: data?.trialing === true,
        linkPending: data?.linkPending === true,
        cancelAtPeriodEnd: data?.cancelAtPeriodEnd === true,
        planTier: data?.planTier === "agent" || data?.planTier === "pro" ? data.planTier : null,
      });
      return !!data?.active;
    } catch {
      setPro((p) => ({ ...p, loading: false }));
      return false;
    }
  }, [knownEmail, heldSession, freshOnce]);

  // The asks ran out with the plan still not live (a late webhook, a payment
  // left incomplete, an old success link): the card stops saying it is
  // confirming and offers the button again (the checkout answers
  // alreadySubscribed for a plan that is live).
  const [confirmGaveUp, setConfirmGaveUp] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Just back from Stripe: ask again until the plan reads live (the webhook
    // may land a few seconds after the redirect), at most PRO_CONFIRM_TRIES.
    const run = async (left: number) => {
      const live = await refresh();
      if (stopped || !heldSession || live) return;
      if (left > 1) timer = setTimeout(() => void run(left - 1), PRO_CONFIRM_INTERVAL_MS);
      else setConfirmGaveUp(true);
    };
    void run(heldSession ? PRO_CONFIRM_TRIES : 1);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [refresh, heldSession]);

  const subscribe = useCallback(
    async (emailOverride?: string) => {
      const email = (emailOverride || knownEmail).trim().toLowerCase();
      if (!email || !email.includes("@")) {
        toast({
          title: i18n.t("proPlan.toast.emailNeededTitle", "Email needed"),
          description: i18n.t("proPlan.toast.emailNeededBody", "Enter your email so we can attach the subscription to your account."),
          variant: "destructive",
        });
        return false;
      }
      setActionLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("create-subscription-checkout", {
          // The page's language: Stripe shows the renewal terms in it.
          body: { email, language: i18n.language, ...checkoutContext(), ...purchaseTerms(), ...territoryHint() },
        });
        if (await consentWasRequired(error, data)) {
          toast({ title: i18n.t("purchaseTerms.consentNeeded"), variant: "destructive" });
          return false;
        }
        // The territory's 451 (S12-059) carries a sentence for the buyer.
        const refusal = error ? await checkoutRefusalOf(error) : null;
        if (refusal) {
          toast({ title: i18n.t("proPlan.checkoutRefusedTitle", "Couldn't start checkout"), description: refusal.message, variant: "destructive" });
          return false;
        }
        if (error) throw error;
        if (data?.alreadySubscribed) {
          toast({ title: i18n.t("proPlan.toast.alreadyMemberTitle", "You're already a Pro member"), description: i18n.t("proPlan.toast.alreadyMemberBody", "Your plan is already active on this account.") });
          await refresh();
          return true;
        }
        if (data?.url) {
          localStorage.setItem("scanCreditsEmail", email);
          window.location.href = data.url;
          return true;
        }
        throw new Error(data?.error || "No checkout URL returned");
      } catch (e) {
        const raw = e instanceof Error ? e.message : "";
        toast({
          title: i18n.t("proPlan.checkoutRefusedTitle", "Couldn't start checkout"),
          description: /edge function|failed to send|fetch/i.test(raw)
            ? i18n.t("proPlan.toast.briefOutage", "Subscriptions are briefly unavailable — please try again in a few minutes.")
            : raw || i18n.t("proPlan.toast.tryAgain", "Please try again."),
          variant: "destructive",
        });
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [knownEmail, refresh, toast],
  );

  const manage = useCallback(async () => {
    if (!session) {
      toast({ title: i18n.t("proPlan.toast.signInTitle", "Sign in required"), description: i18n.t("proPlan.toast.signInBody", "Sign in to manage your subscription.") });
      return;
    }
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-portal-session", { body: {} });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error(data?.error || "No portal URL returned");
    } catch (e) {
      toast({
        title: i18n.t("proPlan.toast.portalFailedTitle", "Couldn't open billing portal"),
        description: e instanceof Error ? e.message : i18n.t("proPlan.toast.tryAgain", "Please try again."),
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  }, [session, toast]);

  return {
    pro, refresh, subscribe, manage, actionLoading, knownEmail,
    justSubscribed: heldSession !== null && !confirmGaveUp,
    notConfirmedYet: heldSession !== null && confirmGaveUp && !pro.active,
  };
}
