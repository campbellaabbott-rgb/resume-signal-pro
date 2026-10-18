import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import {
  HOME_FREE_REPORT_DAYS,
  HOME_FREE_SCANS_PER_DAY,
  HOME_PAID_REPORT_DAYS,
  HOME_RESUME_TEXT_HOURS,
  HOME_SCAN_SECONDS,
  HOME_SIGNED_IN_SCANS_PER_DAY,
} from "@/lib/home/facts";
import { HomeDetails } from "./HomeDetails";
import { SampleReport } from "./SampleReport";

/**
 * 4.3 THE FREE SCAN, a door to /resume-checker (the scanner's new address).
 * Its button is secondary: the page's one filled button is "Search jobs".
 * ONE SampleReport: closed under 1024px with its text still in the DOM, the
 * right-hand column from 1024px.
 */
export function HomeScanSection() {
  const { t } = useTranslation();
  const trust = <Link to="/trust" className="link" />;
  return (
    <section aria-labelledby="home-scan" className="border-t border-border py-8 sm:py-10 lg:py-16">
      <div className="container grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-14">
        <div className="min-w-0">
          <h2 id="home-scan" className="text-[clamp(1.25rem,5vw,1.875rem)] font-semibold leading-tight md:text-3xl">{t("home.scan.title")}</h2>
          <p className="mt-2.5 max-w-[62ch] text-muted-foreground">{t("home.scan.lede", { seconds: HOME_SCAN_SECONDS })}</p>
          <ul className="mt-4 grid gap-2.5">
            {["checkAts", "checkTerms", "checkBullets"].map((k) => (
              <li key={k} className="flex items-start gap-2.5 text-[15px] leading-[22px]">
                <Check aria-hidden="true" className="mt-[3px] h-4 w-4 shrink-0 text-success" />
                <span>{t(`home.scan.${k}`)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground">
            <span>{t("home.scan.noAccount")}</span>
            <span>{t("home.scan.allowance", { free: HOME_FREE_SCANS_PER_DAY, signedIn: HOME_SIGNED_IN_SCANS_PER_DAY })}</span>
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Link
              to="/resume-checker#upload"
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-border-strong bg-card px-4 py-2 text-center text-sm font-medium text-foreground transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:min-h-11"
            >
              {t("home.scan.cta")}
            </Link>
          </div>
          <p className="mt-3 text-meta text-muted-foreground">
            <Trans
              i18nKey="home.scan.retention"
              values={{ hours: HOME_RESUME_TEXT_HOURS, days: HOME_FREE_REPORT_DAYS, paidDays: HOME_PAID_REPORT_DAYS }}
              components={{ trust }}
            />
          </p>
        </div>
        <HomeDetails
          openFrom={1024}
          summary={t("home.scan.sampleSummary")}
          className="min-w-0"
          summaryClassName="border-y border-border"
          data-testid="home-sample"
        >
          <div className="pb-1 pt-2 lg:p-0">
            <SampleReport />
          </div>
        </HomeDetails>
      </div>
    </section>
  );
}
