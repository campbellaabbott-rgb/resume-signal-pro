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
  /**
   * "inline" (the default) prints its own "Work at X? Claim this profile"
   * link. "menu" prints no link: the company header's ⋯ menu opens the form
   * through `open`, so the phone header keeps one compact actions row. Both
   * still handle the emailed confirm link and show the verified chip.
   */
  variant?: "inline" | "menu";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CompanyClaim({ companyToken, companyName, variant = "inline", open: openProp, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [verified, setVerified] = useState<boolean | null>(null);
  const [website, setWebsite] = useState<string | null>(null);
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => { setOpenState(v); onOpenChange?.(v); };
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // The link's token, held for a click (S8-097): a mail scanner that runs
  // the page's script must not complete a stranger's claim.
  const [pendingVerify, setPendingVerify] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as {
          rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_company_claim_status", { p_token: companyToken });
        const status = data as { verified?: boolean; website?: string | null } | null;
        if (!cancelled) {
          setVerified(Boolean(status?.verified));
          setWebsite(typeof status?.website === "string" && /^https?:\/\//.test(status.website) ? status.website : null);
        }
      } catch {
        if (!cancelled) setVerified(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyToken]);

  // Email-link landing: /jobs/company/:token?claim_verify=<uuid>. The token
  // is read and taken out of the address bar; nothing is sent until the
  // visitor presses the confirm button (every other confirmation in this
  // lane works the same way, because mail scanners open links).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("claim_verify");
    if (!token) return;
    params.delete("claim_verify");
    const qs = params.toString();
    // Keeps the entry's state: the board stamps its own entries (see Jobs).
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    setPendingVerify(token);
  }, [companyToken]);

  const confirmVerify = async () => {
    if (!pendingVerify || confirming) return;
    setConfirming(true);
    try {
      const { data, error } = await supabase.functions.invoke("company-claim", {
        body: { action: "verify", token: pendingVerify },
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
    } finally {
      setConfirming(false);
      setPendingVerify(null);
    }
  };

  const confirmBox = pendingVerify ? (
    <div className="rounded-lg border border-primary bg-primary-tint p-3 max-w-md mb-2">
      <p className="text-meta text-foreground mb-2">
        {t("jobsPage.claim.confirmPrompt", "You opened a link to confirm your claim of {{company}}. Press the button to finish.", { company: companyName })}
      </p>
      <button
        type="button"
        onClick={confirmVerify}
        disabled={confirming}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {confirming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
        {t("jobsPage.claim.confirmButton", "Confirm my claim")}
      </button>
    </div>
  ) : null;

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
      <>
      {confirmBox}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          className="inline-flex min-h-6 items-center gap-1 rounded-sm border border-border-strong bg-card text-foreground text-xs font-medium px-2"
          title={t("jobsPage.claim.verifiedTip", "A contact at this company verified a work email at its domain. Verification confirms identity only — it never changes the hiring data shown here.")}
        >
          <BadgeCheck className="w-3.5 h-3.5 text-success" aria-hidden="true" />
          {t("jobsPage.claim.verifiedChip", "Verified employer")}
        </span>
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-meta text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
          >
            {t("jobsPage.claim.websiteLink", "Website (employer-provided)")}
          </a>
        )}
      </div>
      </>
    );
  }

  // The menu variant prints nothing until the header's ⋯ menu opens the form
  // (or an emailed confirm link lands here).
  if (variant === "menu" && !open && !confirmBox) return null;

  return (
    <div className="mb-2" data-company-claim={variant}>
      {confirmBox}
      {!open ? (
        variant === "menu" ? null : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-6 items-center gap-1.5 text-meta text-muted-foreground hover:text-primary transition-colors"
          >
            <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
            {t("jobsPage.claim.cta", "Work at {{company}}? Claim this profile", { company: companyName })}
          </button>
        )
      ) : sent ? (
        <p className="text-meta text-muted-foreground max-w-md">
          {t("jobsPage.claim.sentNote", "Check your inbox — we sent a verification link to {{email}}. Open it and press Confirm to finish the claim.", { email: email.trim() })}
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card p-3 max-w-md">
          <p className="text-meta text-muted-foreground mb-2">
            {t("jobsPage.claim.boundary", "Verify a work email at {{company}}'s domain to show a Verified employer badge here. Verification proves identity only — it never changes the hiring data we compute.", { company: companyName })}{" "}
            <Link to="/trust" className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
              {t("jobsPage.claim.policyLink", "Why?")}
            </Link>
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              aria-label={t("companyProfile.claim.emailLabel", "Work email")}
              placeholder={t("jobsPage.claim.emailPlaceholder", "you@company.com")}
              className="min-w-0 flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || !email.trim()}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 hover:bg-primary-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
