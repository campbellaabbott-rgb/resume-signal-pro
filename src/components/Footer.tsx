import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Mail } from "lucide-react";
import { SellerIdentity } from "@/components/SellerIdentity";
import { ThemeSwitch } from "@/components/ui/theme-switch";

/**
 * The footer: support address, the resources index, legal links, language.
 *
 * The resources links matter for crawlers (a page reachable only from the
 * sitemap ranks far worse than one linked from every page) and for phones,
 * where the header's links sit behind the menu button. Every label is a
 * locale key now: nine of them were English literals on every language's page.
 * The theme switch renders only behind the QA flag (src/lib/theme.ts).
 */
const RESOURCES: Array<{ to: string; key: string; fallback: string }> = [
  { to: "/companies", key: "footer.links.companies", fallback: "Companies hiring" },
  { to: "/trust", key: "footer.links.trust", fallback: "Trust & transparency" },
  { to: "/resume-checker", key: "footer.links.resumeChecker", fallback: "Free resume checker" },
  { to: "/ats-resume-test", key: "footer.links.atsTest", fallback: "ATS resume test" },
  { to: "/resume-score", key: "footer.links.resumeScore", fallback: "Resume score" },
  { to: "/industries", key: "footer.links.industries", fallback: "Resume keywords by industry" },
  { to: "/guides", key: "footer.links.guides", fallback: "Resume & ATS guides" },
  { to: "/ats/workday", key: "footer.links.workday", fallback: "Workday ATS guide" },
  { to: "/ats/greenhouse", key: "footer.links.greenhouse", fallback: "Greenhouse guide" },
  { to: "/ats/lever", key: "footer.links.lever", fallback: "Lever guide" },
  { to: "/ats/icims", key: "footer.links.icims", fallback: "iCIMS guide" },
  { to: "/vs/jobscan", key: "footer.links.vsJobscan", fallback: "vs Jobscan" },
  { to: "/freelance-boost", key: "footer.links.freelanceBoost", fallback: "Freelance Boost" },
  { to: "/builder", key: "footer.links.builder", fallback: "Resume Builder" },
  { to: "/methodology", key: "footer.links.methodology", fallback: "Methodology" },
  { to: "/data-api", key: "footer.links.dataApi", fallback: "Hiring Data & API" },
  { to: "/agents", key: "footer.links.agents", fallback: "Connect your agent" },
  { to: "/pay-transparency", key: "footer.links.payTransparency", fallback: "Pay Transparency Index" },
];

const linkClass =
  "rounded-sm py-1 text-muted-foreground underline-offset-2 transition-colors duration-fast hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border py-10 safe-bottom sm:py-12" role="contentinfo">
      <div className="container">
        <div className="mb-8 flex flex-col items-center gap-2 border-b border-border pb-8">
          <p className="text-sm text-muted-foreground">{t("footer.questions")}</p>
          <a href="mailto:resumeboostersupp@gmail.com" className="link inline-flex items-center gap-2 py-1 text-sm font-medium">
            <Mail aria-hidden="true" className="h-4 w-4" />
            resumeboostersupp@gmail.com
          </a>
        </div>

        <nav
          aria-label={t("footer.resourcesAriaLabel", "Resources")}
          className="mb-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-b border-border pb-8 text-sm"
        >
          {/* First, and spelled out: the one footer path to /explore that a
              phone always renders (explore-claims.test.ts holds it). */}
          <Link to="/explore" className={linkClass}>{t("footer.explore", "Explore by field")}</Link>
          {RESOURCES.map((r) => (
            <Link key={r.to} to={r.to} className={linkClass}>
              {t(r.key, r.fallback)}
            </Link>
          ))}
        </nav>

        <div className="flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground md:flex-row">
          <div className="text-center md:text-left">
            <p>{t("footer.copyright", { year: new Date().getFullYear() })}</p>
            {/* Who sells: nothing until src/config/seller.ts is filled in. */}
            <SellerIdentity variant="footer" className="mt-1 text-xs" />
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1" aria-label={t("footer.navAriaLabel")}>
            <Link to="/pricing" className={`${linkClass} font-medium`}>{t("footer.pricing")}</Link>
            <Link to="/jobs" className={linkClass}>{t("footer.jobs", "Job board")}</Link>
            <Link to="/changelog" className={linkClass}>{t("footer.changelog")}</Link>
            <Link to="/privacy" className={linkClass}>{t("footer.privacy")}</Link>
            <Link to="/terms" className={linkClass}>{t("footer.terms")}</Link>
            <LanguageSwitcher variant="default" />
            <ThemeSwitch />
          </nav>
        </div>
      </div>
    </footer>
  );
}
