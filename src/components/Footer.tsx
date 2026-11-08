import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Mail } from "lucide-react";
import { SellerIdentity } from "@/components/SellerIdentity";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { FOOTER_BOTTOM, FOOTER_RESOURCES } from "@/lib/site-links";

/**
 * The footer: support address, the resources index, legal links, language.
 *
 * The resources links matter for crawlers (a page reachable only from the
 * sitemap ranks far worse than one linked from every page) and for phones,
 * where the header's links sit behind the menu button. The lists live in
 * src/lib/site-links.ts, which the bake's own footer renders too, so the
 * footer a crawler reads cannot drift from this one (B04). Every label is a
 * locale key. The theme switch renders only behind the QA flag
 * (src/lib/theme.ts).
 */

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
          {FOOTER_RESOURCES.map((r) => (
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
            {FOOTER_BOTTOM.map((r) => (
              <Link key={r.to} to={r.to} className={r.to === "/pricing" ? `${linkClass} font-medium` : linkClass}>
                {t(r.key, r.fallback)}
              </Link>
            ))}
            <LanguageSwitcher variant="default" />
            <ThemeSwitch />
          </nav>
        </div>
      </div>
    </footer>
  );
}
