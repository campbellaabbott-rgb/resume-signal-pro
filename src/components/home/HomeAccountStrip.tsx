import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, FileText, ListChecks, PenLine, type LucideIcon } from "lucide-react";

/**
 * 4.2 THE FREE ACCOUNT, as a secondary door. Fit itself needs no account
 * (job-fit has no sign-in check; review P5): what the account adds is the
 * résumé kept for fit on any device. "Alerts" is printed only while the
 * digest's mail can be sent (G6, src/lib/home/sale-gates.ts).
 */
export function HomeAccountStrip({ alertsStatable }: { alertsStatable: boolean }) {
  const { t } = useTranslation();
  const items: Array<{ key: string; icon: LucideIcon; title: string; body: string }> = [
    alertsStatable
      ? { key: "saved", icon: Bell, title: t("home.account.savedAlerts"), body: t("home.account.savedAlertsBody") }
      : { key: "saved", icon: Bell, title: t("home.account.saved"), body: t("home.account.savedBody") },
    { key: "tracker", icon: ListChecks, title: t("home.account.tracker"), body: t("home.account.trackerBody") },
    { key: "resume", icon: FileText, title: t("home.account.resume"), body: t("home.account.resumeBody") },
    { key: "writing", icon: PenLine, title: t("home.account.writing"), body: t("home.account.writingBody") },
  ];

  return (
    <section aria-labelledby="home-account" className="rounded-lg border border-border-strong bg-card px-4 py-[18px] lg:col-span-2 lg:px-6 lg:py-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 id="home-account" className="text-lg font-semibold">{t("home.account.title")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("home.account.sub")}</p>
        </div>
        <Link
          to="/auth?next=%2Fjobs"
          className="inline-flex min-h-10 w-full shrink-0 items-center justify-center rounded-md border border-border-strong bg-card px-4 py-2 text-center text-sm font-medium text-foreground transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:min-h-11 sm:w-auto"
        >
          {t("home.account.cta")}
        </Link>
      </div>
      <ul className="mt-3.5 grid grid-cols-1 gap-x-3 gap-y-2.5 min-[400px]:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {items.map(({ key, icon: Icon, title, body }) => (
          <li key={key} className="flex min-w-0 items-start gap-2.5 text-sm">
            <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block font-semibold text-foreground">{title}</span>
              <span className="hidden text-muted-foreground sm:block">{body}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-subtle-foreground">{t("home.account.note")}</p>
    </section>
  );
}
