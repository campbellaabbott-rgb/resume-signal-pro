// The page the "Start my fix-plan emails" button in a report mail opened.
//
// THE FIX-PLAN SEQUENCE IS WITHDRAWN (S14X-012, the owner's option B,
// 2026-11-15). Its four mails were queued where nothing sent them, so the
// page's "Done. The first email arrives in two days" was never true. Report
// mails no longer carry the button; a button from a mail already sent opens
// this page, which says plainly that nothing was started and asks the server
// nothing. send-scan-report answers a press from an older copy of this page
// with queued: false and the reason "withdrawn", and queues nothing.
//
// The signed plan rode in the URL FRAGMENT (#d=...), which browsers never
// send to a server; it is removed from the address bar on arrival.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { dripTokenFromHash, forgetConfirmFragment } from "@/lib/confirm-link";
import { stashedFragment, takeStashed } from "@/lib/auth-fragment";

export default function FixPlanConfirm() {
  const { t } = useTranslation();
  const [hadLink] = useState<boolean>(() =>
    typeof window !== "undefined" && dripTokenFromHash(stashedFragment(window.location.hash)) !== null);

  useEffect(() => {
    if (hadLink) { forgetConfirmFragment(); takeStashed("fragment"); }
  }, [hadLink]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <SEO
        title="Fix-plan emails | Resume Booster"
        description="The fix-plan email sequence is no longer sent."
        path="/fix-plan/confirm"
        noIndex
      />
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Mail className="w-6 h-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">
          {t("mailPrefs.fixPlanWithdrawnTitle", "Fix-plan emails")}
        </h1>
        <p className="text-sm text-muted-foreground" data-fix-plan="withdrawn">
          {t("mailPrefs.fixPlanWithdrawn", "We no longer send the fix-plan emails, so this link starts nothing and no emails will follow from it.")}
        </p>
        <p className="mt-6">
          <Link to="/" className="text-sm text-primary hover:underline">{t("fixPlanConfirm.home", "Back to Resume Booster")}</Link>
        </p>
      </div>
    </div>
  );
}
