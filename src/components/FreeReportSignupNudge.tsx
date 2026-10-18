/**
 * "DON'T LOSE THIS SCORE": THE FREE REPORT'S SIGN-UP LINK (S12-025, the
 * homepage half; wave 4 round 2).
 *
 * The link went to /auth with nowhere to come back to, and the homepage keeps
 * no copy of the report, so a visitor who signed up from it came back to an
 * empty page. It now names the account page as where to land: that page
 * imports the scans this browser ran before the account existed, each with
 * its fix checklist, once per account (src/lib/account-history-import.ts,
 * account-compliance's half of S12-025).
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

/** Where the account page is, as the sign-in page's `next` (src/lib/auth-fragment.ts safeNextPath accepts it). */
export const FREE_REPORT_SIGNUP_NEXT = "/account";

export function FreeReportSignupNudge() {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3" data-free-report-signup>
      <p className="text-xs text-muted-foreground flex-1">
        <span className="font-semibold text-foreground">{t("freeReportSignup.title", "Don't lose this score.")}</span>{" "}
        {t("freeReportSignup.body", "Create a free account to track your progress across scans, keep your fix checklist, and get 15 free scans a day instead of 7.")}
      </p>
      <Link
        to={`/auth?next=${encodeURIComponent(FREE_REPORT_SIGNUP_NEXT)}`}
        className="shrink-0 inline-block px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
      >
        {t("freeReportSignup.cta", "Create free account")}
      </Link>
    </div>
  );
}
