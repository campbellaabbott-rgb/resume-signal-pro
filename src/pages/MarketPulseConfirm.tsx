// The page a market-pulse confirmation link opens.
//
// DOUBLE OPT-IN (defect sweep 1.59). Ticking the box under a scan report only
// asks: send-market-pulse mails a single-use link to the address, and the
// address is subscribed when -- and only when -- its owner presses the button
// here. A button, not the page load: mail scanners open links on their own,
// and a subscription that a scanner's prefetch could confirm would not be the
// person's choice.
//
// The token rides in the URL FRAGMENT (#t=...), which browsers never send to a
// server or put in a Referer header, so it cannot leak into a log or into
// analytics. It is removed from the address bar once it has been used.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Mail } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { supabase } from "@/integrations/supabase/client";
import { forgetConfirmFragment, pulseTokenFromHash } from "@/lib/confirm-link";

type State = "ready" | "confirming" | "done" | "invalid" | "error" | "missing";

export default function MarketPulseConfirm() {
  const { t } = useTranslation();
  const [token] = useState<string | null>(() =>
    typeof window === "undefined" ? null : pulseTokenFromHash(window.location.hash));
  const [state, setState] = useState<State>(token ? "ready" : "missing");

  useEffect(() => {
    if (state === "done" || state === "invalid") forgetConfirmFragment();
  }, [state]);

  const confirm = async () => {
    if (!token) return;
    setState("confirming");
    try {
      const { data, error } = await supabase.functions.invoke("send-market-pulse", { body: { action: "confirm", token } });
      if (!error && (data as { confirmed?: boolean } | null)?.confirmed) { setState("done"); return; }
      const status = (error as { context?: { status?: number } } | null)?.context?.status;
      setState(status === 410 || status === 400 ? "invalid" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <SEO
        title="Confirm your market pulse | Resume Booster"
        description="Confirm the monthly market pulse email you asked for."
        path="/market-pulse/confirm"
        noIndex
      />
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          {state === "done" ? <Check className="w-6 h-6 text-success" /> : <Mail className="w-6 h-6 text-primary" />}
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">
          {t("pulseConfirm.title", "Confirm your monthly market pulse")}
        </h1>

        {(state === "ready" || state === "confirming") && (
          <>
            <p className="text-sm text-muted-foreground mb-5">
              {t("pulseConfirm.body", "One email a month with the keywords job postings in your field are screening for, and a free rescan link. Every email has a one-click unsubscribe.")}
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={state === "confirming"}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {state === "confirming" && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("pulseConfirm.button", "Yes, send me the pulse")}
            </button>
          </>
        )}

        {state === "done" && (
          <p className="text-sm text-foreground">{t("pulseConfirm.done", "You're subscribed. The first pulse arrives within a day.")}</p>
        )}
        {state === "invalid" && (
          <p className="text-sm text-muted-foreground">{t("pulseConfirm.invalid", "This link has expired or was already used. Tick the box under your next scan report to get a new one.")}</p>
        )}
        {state === "missing" && (
          <p className="text-sm text-muted-foreground">{t("pulseConfirm.missing", "This page needs the link from your confirmation email.")}</p>
        )}
        {state === "error" && (
          <p className="text-sm text-destructive">{t("pulseConfirm.error", "Could not confirm right now. Try the link again shortly.")}</p>
        )}

        <p className="mt-6">
          <Link to="/" className="text-sm text-primary hover:underline">{t("pulseConfirm.home", "Back to Resume Booster")}</Link>
        </p>
      </div>
    </div>
  );
}
