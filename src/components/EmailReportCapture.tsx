// "Email me my report" — sends the scan summary via the send-scan-report edge
// function and captures the address as a lead. Degrades gracefully when the
// email service isn't configured server-side.

import { useState } from "react";
import { Mail, Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";

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
  };
}

export function EmailReportCapture({ payload }: EmailReportCaptureProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [subscribePulse, setSubscribePulse] = useState(true);

  const send = async () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    setStatus("sending");
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-scan-report", {
        body: { email: trimmed, subscribePulse, ...payload },
      });
      if (error || !(data as { success?: boolean })?.success) {
        throw new Error((data as { error?: string })?.error || error?.message || "send failed");
      }
      localStorage.setItem("rb_last_email", trimmed);
      setStatus("sent");
    } catch (e) {
      console.error("[EmailReport] send failed:", e);
      setStatus("error");
      setErrorMsg("Couldn't send right now — the PDF download above works offline.");
    }
  };

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/5 p-4 flex items-center gap-2">
        <Check className="w-4 h-4 text-success shrink-0" />
        <p className="text-sm text-foreground">{t('freeResults.enterprise.emailSent', 'Sent! Check your inbox for your scan summary and fix plan.')}</p>
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
      <p className="text-[10px] text-muted-foreground mt-2">{t('freeResults.enterprise.emailPrivacy', 'Only the analysis results are emailed — never your resume. No spam.')}</p>
    </div>
  );
}
