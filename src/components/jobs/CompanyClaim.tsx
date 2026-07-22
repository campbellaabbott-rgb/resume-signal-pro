// Claim-your-profile surface on the company lander. Verified companies show a
// "Verified employer" chip; unverified ones get a quiet "work here?" claim CTA
// that opens a one-field form (work email). The boundary is stated in the form
// itself: verification is identity only — it never changes the hiring data we
// show. Also handles the ?claim_verify= email-link landing for this company.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Building2, Loader2, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Props {
  companyToken: string;
  companyName: string;
}

export function CompanyClaim({ companyToken, companyName }: Props) {
  const { t } = useTranslation();
  const [verified, setVerified] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as {
          rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_company_claim_status", { p_token: companyToken });
        if (!cancelled) setVerified(Boolean((data as { verified?: boolean } | null)?.verified));
      } catch {
        if (!cancelled) setVerified(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyToken]);

  // Email-link landing: /jobs/company/:token?claim_verify=<uuid>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("claim_verify");
    if (!token) return;
    params.delete("claim_verify");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("company-claim", {
          body: { action: "verify", token },
        });
        const status = (data as { status?: string } | null)?.status;
        if (!error && status === "verified") {
          setVerified(true);
          toast({ title: t("jobsPage.claim.verifyOk", "Claim verified — {{company}} now shows as a verified employer.", { company: companyName }) });
        } else if (!error && status === "email_confirmed") {
          toast({ title: t("jobsPage.claim.verifyPending", "Email confirmed. Your domain doesn't obviously match this company, so we'll review the claim by hand — usually within a day.") });
        } else {
          toast({ title: t("jobsPage.claim.verifyFail", "That verification link didn't work — it may be stale. Request a fresh one below."), variant: "destructive" });
        }
      } catch {
        toast({ title: t("jobsPage.claim.verifyFail", "That verification link didn't work — it may be stale. Request a fresh one below."), variant: "destructive" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyToken]);

  const submit = async () => {
    if (sending || !email.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("company-claim", {
        body: { action: "request", companyToken, companyName, workEmail: email.trim() },
      });
      const err = error ? t("jobsPage.claim.sendFail", "Could not send the verification email — please try again.") : (data as { error?: string } | null)?.error;
      if (err) {
        toast({ title: err, variant: "destructive" });
      } else if ((data as { status?: string } | null)?.status === "verified") {
        setVerified(true);
      } else {
        setSent(true);
      }
    } catch {
      toast({ title: t("jobsPage.claim.sendFail", "Could not send the verification email — please try again."), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  if (verified) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-success/10 border border-success/30 text-success text-[12px] font-medium px-2.5 py-1 mb-2"
        title={t("jobsPage.claim.verifiedTip", "A contact at this company verified a work email at its domain. Verification confirms identity only — it never changes the hiring data shown here.")}
      >
        <BadgeCheck className="w-3.5 h-3.5" />
        {t("jobsPage.claim.verifiedChip", "Verified employer")}
      </span>
    );
  }

  return (
    <div className="mb-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-primary transition-colors"
        >
          <Building2 className="w-3.5 h-3.5" />
          {t("jobsPage.claim.cta", "Work at {{company}}? Claim this profile", { company: companyName })}
        </button>
      ) : sent ? (
        <p className="text-[12px] text-muted-foreground max-w-md">
          {t("jobsPage.claim.sentNote", "Check your inbox — we sent a verification link to {{email}}. Click it and the claim is done.", { email: email.trim() })}
        </p>
      ) : (
        <div className="rounded-xl border border-border bg-card p-3 max-w-md">
          <p className="text-[12px] text-muted-foreground mb-2">
            {t("jobsPage.claim.boundary", "Verify a work email at {{company}}'s domain to show a Verified employer badge here. Verification proves identity only — it never changes the hiring data we compute.", { company: companyName })}{" "}
            <Link to="/trust" className="text-primary hover:underline">
              {t("jobsPage.claim.policyLink", "Why?")}
            </Link>
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder={t("jobsPage.claim.emailPlaceholder", "you@company.com")}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || !email.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-3 py-1.5 hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {t("jobsPage.claim.send", "Send link")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
