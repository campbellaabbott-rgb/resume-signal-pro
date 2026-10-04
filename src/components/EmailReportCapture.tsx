// "Email me my report" — sends the scan summary via the send-scan-report edge
// function and captures the address as a lead. Degrades gracefully when the
// email service isn't configured server-side.

import { useState } from "react";
import { Mail, Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { errorBodyOf } from "@/lib/confirm-link";

interface EmailReportCaptureProps {
  payload: {
    verdict?: string;
    score: number;
    projectedScore: number | null;
    scoreBreakdown: { keywords: number; format: number; quantification: number } | null;
    peerPercentile: number | null;
    applicationPassRate: number | null;
    redFlags: Array<{ issue: string }>;
    fixRoadmap: { steps: Array<{ order: number; step: string; minutes: number; scoreImpact: number; projectedScoreAfter: number }>; totalMinutes: number; finalProjectedScore: number } | null;
    industry: string;
    reportId?: string | null;
    scoreBand?: { low: number; high: number } | null;
    findingsSummary?: { critical: number; warnings: number; passed: number } | null;
    keywordSource?: { source: 'job_description' | 'onet' | 'model'; occupation?: string; code?: string } | null;
    /** free-keyword-scan's seal over this report's sentences (reportMeta.mailSeal).
        Without it the server mails the numbers only, never the sentences. */
    mailSeal?: string | null;
  };
  /** "compact" = one-row capture for the top of the report (peak attention). */
  variant?: "full" | "compact";
  /** Hide when we already have this visitor's email — don't nag repeat scanners. */
  hideIfKnown?: boolean;
  /** The email found ON the resume itself. Only ever used to PRE-FILL the
      visible input with a disclosure line — nothing is stored or sent until
      the user clicks Send. Consent is the click. */
  suggestedEmail?: string | null;
}

export function EmailReportCapture({ payload, variant = "full", hideIfKnown = false, suggestedEmail = null }: EmailReportCaptureProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(suggestedEmail ?? "");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // OFF BY DEFAULT, like the drip below. It was pre-ticked -- and the compact
  // variant, which renders no box at all, sent it ticked too -- so the pulse
  // list filled with people who never chose it (defect sweep 1.59). A ticked
  // box now only ASKS: send-market-pulse mails a confirmation link to the
  // address, and nothing is sent to it until that link is clicked.
  const [subscribePulse, setSubscribePulse] = useState(false);
  // What the pulse request came back with: a link was mailed (or one is
  // already due), or the pulse does not cover this field (422).
  const [pulseOutcome, setPulseOutcome] = useState<"pending" | "not_covered" | null>(null);
  // Off by default — the drip is a commitment; defaulting it on would be the
  // dark pattern the rest of the product refuses to be.
  const [dripOptIn, setDripOptIn] = useState(false);

  const send = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    setStatus("sending");
    setErrorMsg(null);
    let refusal: string | null = null;
    try {
      // The report request never carries the pulse choice: send-scan-report's
      // own write to the pulse list enrolled an address with no confirmation.
      const { data, error } = await supabase.functions.invoke("send-scan-report", {
        body: { email: trimmed, dripOptIn, ...payload },
      });
      if (error || !(data as { success?: boolean })?.success) {
        // A refusal says why (an inbox's daily allowance, an address that
        // opted out, the day's ceiling): read it from the non-2xx body, which
        // supabase-js does not put in data.
        const b = error ? await errorBodyOf(error) : (data as { error?: string } | null);
        refusal = typeof b?.error === "string" ? b.error : null;
        throw new Error(refusal || error?.message || "send failed");
      }
      localStorage.setItem("rb_last_email", trimmed);
      if (subscribePulse) {
        // Best effort: the report already went, and a failed pulse request
        // must not turn that into an error. Success means a link was mailed
        // (or one was already due); the address is still not subscribed.
        try {
          const { data: p, error: pErr } = await supabase.functions.invoke("send-market-pulse", {
            body: { action: "subscribe", email: trimmed, industry: payload.industry, score: payload.score },
          });
          if (!pErr && (p as { success?: boolean } | null)?.success) setPulseOutcome("pending");
          else if ((pErr as { context?: { status?: number } } | null)?.context?.status === 422) setPulseOutcome("not_covered");
        } catch { /* the report stands on its own */ }
      }
      setStatus("sent");
    } catch (e) {
      console.error("[EmailReport] send failed:", e);
      setStatus("error");
      setErrorMsg(refusal ?? "Couldn't send right now — the PDF download above works offline.");
    }
  };

  // Placed AFTER the hooks (hooks must run unconditionally).
  if (hideIfKnown && status === "idle") {
    try {
      if (localStorage.getItem("rb_last_email")) return null;
    } catch { /* storage unavailable — show the form */ }
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/5 p-4 flex items-start gap-2">
        <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-foreground">{t('freeResults.enterprise.emailSent', 'Sent! Check your inbox for your scan summary and fix plan.')}</p>
          {/* The server answers the same whatever the address's state (it is
              its owner's business whether it is already confirmed), so this
              line says only what is true in every case. */}
          {pulseOutcome === "pending" && (
            <p className="text-xs text-muted-foreground mt-1">
              {t('freeResults.enterprise.pulseConfirmSent', "If this address isn't confirmed for the monthly market pulse yet, we've emailed it a confirmation link. The pulse starts only after that link is clicked.")}
            </p>
          )}
          {pulseOutcome === "not_covered" && (
            <p className="text-xs text-muted-foreground mt-1">
              {t('freeResults.enterprise.pulseNotCovered', "The monthly market pulse doesn't cover your field yet, so no confirmation was sent.")}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className="rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 mb-4 flex flex-wrap items-center gap-2">
        <Mail className="w-4 h-4 text-primary shrink-0" />
        <p className="text-sm font-medium text-foreground">{t('freeResults.enterprise.emailTitle', 'Email me my report')}</p>
        <div className="flex flex-1 min-w-[230px] gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (errorMsg) setErrorMsg(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="you@example.com"
            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            disabled={status === "sending"}
            aria-label={t('freeResults.enterprise.emailTitle', 'Email me my report')}
          />
          <button
            onClick={send}
            disabled={status === "sending"}
            className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {status === "sending" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
            {t('freeResults.enterprise.emailSend', 'Send')}
          </button>
        </div>
        {errorMsg && <p className="basis-full text-xs text-destructive">{errorMsg}</p>}
        {suggestedEmail && email === suggestedEmail && (
          <p className="basis-full text-[10px] text-primary">{t('freeResults.enterprise.emailSpotted', 'We spotted this address on your resume — nothing is sent unless you click Send.')}</p>
        )}
        <p className="basis-full text-[10px] text-muted-foreground">{t('freeResults.enterprise.emailPrivacy', 'Only the analysis results are emailed — never your resume. No spam.')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Mail className="w-4 h-4 text-primary" />
        <h4 className="font-semibold text-foreground text-sm">{t('freeResults.enterprise.emailTitle', 'Email me my report')}</h4>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {t('freeResults.enterprise.emailDesc', 'Get this summary and your fix plan in your inbox — handy for working through the fixes later.')}
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (errorMsg) setErrorMsg(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="you@example.com"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          disabled={status === "sending"}
        />
        <button
          onClick={send}
          disabled={status === "sending"}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {status === "sending" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
          {t('freeResults.enterprise.emailSend', 'Send')}
        </button>
      </div>
      {errorMsg && <p className="text-xs text-destructive mt-2">{errorMsg}</p>}
      {suggestedEmail && email === suggestedEmail && (
        <p className="text-[10px] text-primary mt-1.5">{t('freeResults.enterprise.emailSpotted', 'We spotted this address on your resume — nothing is sent unless you click Send.')}</p>
      )}
      <label className="flex items-start gap-2 mt-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={subscribePulse}
          onChange={(e) => setSubscribePulse(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span className="text-xs text-muted-foreground">
          {t('freeResults.enterprise.pulseOptIn', 'Also send me a monthly market pulse: the keywords rising in my industry, with a free rescan link. Unsubscribe anytime.')}
        </span>
      </label>
      <label className="flex items-start gap-2 mt-2 cursor-pointer">
        <input
          type="checkbox"
          checked={dripOptIn}
          onChange={(e) => setDripOptIn(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span className="text-xs text-muted-foreground">
          {t('freeResults.enterprise.dripOptIn', 'Break my fix plan into a short email sequence: top fixes on day 2, the rest on day 4, a rescan reminder on day 6 — and one question on day 14: did it get you interviews? Four short emails, cancel anytime.')}
        </span>
      </label>
      <p className="text-[10px] text-muted-foreground mt-2">{t('freeResults.enterprise.emailPrivacy', 'Only the analysis results are emailed — never your resume. No spam.')}</p>
    </div>
  );
}
