import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface ProSubscriptionState {
  active: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
  loading: boolean;
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
  const [pro, setPro] = useState<ProSubscriptionState>({
    active: false,
    status: null,
    currentPeriodEnd: null,
    loading: true,
  });
  const [actionLoading, setActionLoading] = useState(false);

  const knownEmail =
    user?.email ||
    localStorage.getItem("scanCreditsEmail") ||
    localStorage.getItem("rb_last_email") ||
    "";

  const refresh = useCallback(async () => {
    if (!knownEmail) {
      setPro({ active: false, status: null, currentPeriodEnd: null, loading: false });
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("check-subscription", {
        body: { email: knownEmail },
      });
      if (error) throw error;
      setPro({
        active: !!data?.active,
        status: data?.status ?? null,
        currentPeriodEnd: data?.currentPeriodEnd ?? null,
        loading: false,
      });
    } catch {
      setPro((p) => ({ ...p, loading: false }));
    }
  }, [knownEmail]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const subscribe = useCallback(
    async (emailOverride?: string) => {
      const email = (emailOverride || knownEmail).trim().toLowerCase();
      if (!email || !email.includes("@")) {
        toast({
          title: "Email needed",
          description: "Enter your email so we can attach the subscription to your account.",
          variant: "destructive",
        });
        return false;
      }
      setActionLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("create-subscription-checkout", {
          body: { email },
        });
        if (error) throw error;
        if (data?.alreadySubscribed) {
          toast({ title: "You're already a Pro member", description: "Every tool is already unlocked for this email." });
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
        toast({
          title: "Couldn't start checkout",
          description: e instanceof Error ? e.message : "Please try again.",
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
      toast({ title: "Sign in required", description: "Sign in to manage your subscription." });
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
        title: "Couldn't open billing portal",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  }, [session, toast]);

  return { pro, refresh, subscribe, manage, actionLoading, knownEmail };
}
