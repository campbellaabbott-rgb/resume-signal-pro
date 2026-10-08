// The page the "Start my fix-plan emails" button in a report mail opens.
//
// DOUBLE OPT-IN FOR THE FIX-PLAN SEQUENCE. Ticking "break my fix plan into a
// short email sequence" used to queue four mails to whatever address was
// typed. Now it only puts a button in the report mail, which goes to that
// address, and the sequence is queued when -- and only when -- its owner
// presses the button here. A button, not the page load: mail scanners open
// links on their own, and a sequence a scanner's prefetch could start would
// not be the person's choice.
//
// The signed plan rides in the URL FRAGMENT (#d=...), which browsers never
// send to a server or put in a Referer header. It is removed from the address
// bar once it has been used.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Mail } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { supabase } from "@/integrations/supabase/client";
import { dripTokenFromHash, forgetConfirmFragment } from "@/lib/confirm-link";

type State = "ready" | "confirming" | "done" | "already" | "optedOut" | "invalid" | "error" | "errorFinal" | "missing";

export default function FixPlanConfirm() {
  const { t } = useTranslation();
  const [token] = useState<string | null>(() =>
    typeof window === "undefined" ? null : dripTokenFromHash(window.location.hash));
  const [state, setState] = useState<State>(token ? "ready" : "missing");

  useEffect(() => {
    if (state === "done" || state === "already" || state === "optedOut" || state === "invalid") forgetConfirmFragment();
  }, [state]);

  const confirm = async () => {
    if (!token) return;
    setState("confirming");
    try {
      const { data, error } = await supabase.functions.invoke("send-scan-report", { body: { action: "confirm-drip", token } });
      const d = data as { success?: boolean; queued?: boolean; reason?: string } | null;
      if (!error && d?.success) {
        setState(d.queued ? "done" : d.reason === "opted_out" ? "optedOut" : "already");
        return;
      }
      const ctx = (error as { context?: Response } | null)?.context;
      const status = ctx?.status;
      // A failed start the server could not fully undo: the month's slot is
      // spent, so another press could only answer "already started".
      let retry = true;
      try { retry = ((await ctx?.clone().json()) as { retry?: boolean } | undefined)?.retry !== false; } catch { /* no body */ }
      setState(status === 410 || status === 400 ? "invalid" : retry ? "error" : "errorFinal");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <SEO
        title="Start your fix-plan emails | Resume Booster"
        description="Start the fix-plan email sequence you asked for under your scan report."
        path="/fix-plan/confirm"
        noIndex
      />
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          {state === "done" ? <Check className="w-6 h-6 text-success" /> : <Mail className="w-6 h-6 text-primary" />}
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">
          {t("fixPlanConfirm.title", "Start your fix-plan emails")}
        </h1>

        {(state === "ready" || state === "confirming") && (
          <>
            <p className="text-sm text-muted-foreground mb-5">
              {t("fixPlanConfirm.body", "Four short emails over two weeks: your top fixes on day 2, the rest on day 4, a rescan reminder on day 6, and one question on day 14. Every email has an unsubscribe link.")}
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={state === "confirming"}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {state === "confirming" && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("fixPlanConfirm.button", "Yes, start the emails")}
            </button>
          </>
        )}

        {state === "done" && (
          <p className="text-sm text-foreground">{t("fixPlanConfirm.done", "Done. The first email arrives in two days.")}</p>
        )}
        {state === "already" && (
          <p className="text-sm text-muted-foreground">{t("fixPlanConfirm.already", "A fix-plan sequence already started for this address this month, so nothing more was queued.")}</p>
        )}
        {state === "optedOut" && (
          <p className="text-sm text-muted-foreground">{t("fixPlanConfirm.optedOut", "This address unsubscribed from our emails earlier, so nothing was queued.")}</p>
        )}
        {state === "invalid" && (
          <p className="text-sm text-muted-foreground">{t("fixPlanConfirm.invalid", "This link has expired or is not valid. Email yourself a fresh report from your next scan to get a new one.")}</p>
        )}
        {state === "missing" && (
          <p className="text-sm text-muted-foreground">{t("fixPlanConfirm.missing", "This page needs the button from your report email.")}</p>
        )}
        {state === "error" && (
          <p className="text-sm text-destructive">{t("fixPlanConfirm.error", "Could not start it right now. Try the button again shortly.")}</p>
        )}
        {state === "errorFinal" && (
          <p className="text-sm text-destructive">{t("fixPlanConfirm.errorFinal", "Could not start the whole sequence, and pressing the button again will not restart it this month.")}</p>
        )}

        <p className="mt-6">
          <Link to="/" className="text-sm text-primary hover:underline">{t("fixPlanConfirm.home", "Back to Resume Booster")}</Link>
        </p>
      </div>
    </div>
  );
}
