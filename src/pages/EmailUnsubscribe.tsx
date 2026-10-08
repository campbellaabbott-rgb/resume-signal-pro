// The page every unsubscribe link in our mail opens (register L10-14).
//
// The links used to point at the mailer's own function on supabase.co, which
// unsubscribed on GET and answered HTML that Supabase serves there as plain
// text: people saw raw markup, and corporate link scanners (which open every
// link before a person reads the mail) turned digests off for people who never
// asked. Now the link opens this page on our own domain, which says what will
// stop and acts only when its button is pressed. The parameters ride in the
// fragment (src/lib/unsubscribe-link.ts). A mail client's own unsubscribe
// button still works in one click: the mail carries List-Unsubscribe-Post.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, Loader2, MailX } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { supabase } from "@/integrations/supabase/client";
import { forgetConfirmFragment } from "@/lib/confirm-link";
import { unsubscribeFromHash, type UnsubscribeTarget } from "@/lib/unsubscribe-link";

type State = "ready" | "working" | "done" | "invalid" | "error" | "missing";

export default function EmailUnsubscribe() {
  const { t } = useTranslation();
  const [target] = useState<UnsubscribeTarget | null>(() =>
    typeof window === "undefined" ? null : unsubscribeFromHash(window.location.hash));
  const [state, setState] = useState<State>(target ? "ready" : "missing");

  useEffect(() => {
    if (state === "done" || state === "invalid") forgetConfirmFragment();
  }, [state]);

  const confirm = async () => {
    if (!target) return;
    setState("working");
    try {
      const { data, error } = await supabase.functions.invoke(target.fn, { body: { action: "unsubscribe", ...target.params } });
      if (!error && (data as { unsubscribed?: boolean } | null)?.unsubscribed === true) {
        setState("done");
        return;
      }
      const status = (error as { context?: { status?: number } } | null)?.context?.status;
      setState(status === 400 ? "invalid" : "error");
    } catch {
      setState("error");
    }
  };

  const what = target?.list === "search-digest"
    ? t("emailUnsubscribe.searchDigest", "Stop the digest emails for this saved search. Your other saved searches are not affected.")
    : target?.list === "market-pulse"
      ? t("emailUnsubscribe.marketPulse", "Stop the monthly market pulse emails to this address.")
      : t("emailUnsubscribe.scanReport", "Stop all emails from Resume Booster to this address, including any fix-plan emails still to come.");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <SEO
        title="Unsubscribe | Resume Booster"
        description="Turn off emails from Resume Booster."
        path="/email/unsubscribe"
        noIndex
      />
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          {state === "done" ? <Check className="w-6 h-6 text-success" /> : <MailX className="w-6 h-6 text-primary" />}
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">
          {t("emailUnsubscribe.title", "Turn off these emails")}
        </h1>

        {(state === "ready" || state === "working" || state === "error") && (
          <>
            <p className="text-sm text-muted-foreground mb-5">{what}</p>
            <button
              type="button"
              onClick={confirm}
              disabled={state === "working"}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {state === "working" && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("emailUnsubscribe.button", "Yes, turn them off")}
            </button>
          </>
        )}

        {state === "done" && (
          <p className="text-sm text-foreground">{t("emailUnsubscribe.done", "Done. You will not get these emails again.")}</p>
        )}
        {state === "invalid" && (
          <p className="text-sm text-muted-foreground">{t("emailUnsubscribe.invalid", "This link is not valid. Use the unsubscribe link in the email itself.")}</p>
        )}
        {state === "missing" && (
          <p className="text-sm text-muted-foreground">{t("emailUnsubscribe.missing", "This page needs the unsubscribe link from one of our emails.")}</p>
        )}
        {state === "error" && (
          <p className="text-sm text-destructive">{t("emailUnsubscribe.error", "Could not turn them off right now. Try the button again shortly.")}</p>
        )}

        <p className="mt-6">
          <Link to="/" className="text-sm text-primary hover:underline">{t("emailUnsubscribe.home", "Back to Resume Booster")}</Link>
        </p>
      </div>
    </div>
  );
}
