import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export function Footer() {
  const { t } = useTranslation();
  
  return (
    <footer className="py-12 border-t border-border" role="contentinfo">
      <div className="container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          <nav className="flex items-center gap-4 sm:gap-6 flex-wrap justify-center" aria-label="Footer navigation">
            <Link 
              to="/privacy" 
              className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:text-primary min-h-[44px] flex items-center touch-manipulation"
            >
              {t('footer.privacy')}
            </Link>
            <Link 
              to="/terms" 
              className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:text-primary min-h-[44px] flex items-center touch-manipulation"
            >
              {t('footer.terms')}
            </Link>
            <a 
              href="mailto:support@resumebooster.com" 
              className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:text-primary min-h-[44px] flex items-center touch-manipulation"
              aria-label="Contact us via email"
            >
              {t('footer.contact')}
            </a>
            <LanguageSwitcher variant="compact" />
          </nav>
        </div>
      </div>
    </footer>
  );
}
