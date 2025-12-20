import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Mail, Twitter } from "lucide-react";

export function Footer() {
  const { t } = useTranslation();
  
  return (
    <footer className="py-10 sm:py-12 border-t border-border safe-bottom" role="contentinfo">
      <div className="container">
        {/* Support & Social */}
        <div className="flex flex-col items-center gap-3 mb-8 pb-8 border-b border-border/50">
          <p className="text-sm text-muted-foreground">Questions or feedback?</p>
          <div className="flex items-center gap-3">
            <a 
              href="mailto:resumeboostersupp@gmail.com" 
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors font-medium"
            >
              <Mail className="w-4 h-4" />
              resumeboostersupp@gmail.com
            </a>
            <a 
              href="https://x.com/resumeboost3r" 
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors"
              aria-label="Follow us on X (Twitter)"
            >
              <Twitter className="w-4 h-4" />
            </a>
          </div>
        </div>
        
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground px-2 sm:px-0">
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          <nav className="flex items-center gap-4 sm:gap-6 flex-wrap justify-center" aria-label="Footer navigation">
            <Link 
              to="/pricing" 
              className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:text-primary min-h-[44px] flex items-center touch-manipulation font-medium"
            >
              Pricing
            </Link>
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
            <LanguageSwitcher variant="compact" />
          </nav>
        </div>
      </div>
    </footer>
  );
}
