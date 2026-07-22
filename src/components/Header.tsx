import { Sparkles, CreditCard, Package, Shield, Megaphone, BookOpen, Briefcase, Compass } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ScanPackPurchase } from "@/components/ScanPackPurchase";
import { ScanCreditsCounter } from "@/components/ScanCreditsCounter";
import { ProductSelectionModal } from "@/components/ProductSelectionModal";

export function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const location = useLocation();
  const [showScanPackModal, setShowScanPackModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  
  const scrollToUpload = () => {
    // If not on home page, navigate there first with hash
    if (location.pathname !== '/') {
      navigate('/#upload');
      return;
    }
    
    // On home page, scroll to upload section
    const uploadSection = document.getElementById('upload');
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Fallback: scroll past hero
      window.scrollTo({ top: window.innerHeight, behavior: 'smooth' });
    }
  };


    return (
    <>
      <div className="fixed top-0 left-0 right-0 z-[60]">
        <header className="bg-background/70 backdrop-blur-xl border-b border-border/60" role="banner">
        <div className="container">
        <nav className="flex items-center justify-between h-16" aria-label={t('header.mainNavAriaLabel')}>
          {/* Left: Logo + Nav Links */}
          <div className="flex items-center gap-1 sm:gap-2">
            <Link 
              to="/" 
              onClick={(e) => {
                if (window.location.pathname === '/') {
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
              aria-label={t('header.homeAriaLabel')}
            >
              <Logo className="w-8 h-8" />
              <span className="font-bold text-lg tracking-tight">
                Resume <span className="text-primary">Booster</span>
              </span>
            </Link>
            
            <div className="hidden sm:flex items-center">
              {/* How-it-works now lives inside /trust (methodology summary
                  embedded there); its slot goes to the guides library. */}
              {/* Board-first: Jobs leads the nav, styled as the primary
                  destination rather than one muted item among five. */}
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-1.5 text-foreground font-semibold"
              >
                <Link to="/jobs">
                  <Briefcase className="w-3.5 h-3.5" />
                  {t('header.jobs', 'Jobs')}
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Link to="/explore">
                  <Compass className="w-3.5 h-3.5" />
                  {t('header.explore', 'Explore')}
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Link to="/guides">
                  <BookOpen className="w-3.5 h-3.5" />
                  {t('header.guides')}
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                <Link to="/pricing">{t('header.pricing')}</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Link to="/trust">
                  <Shield className="w-3.5 h-3.5" />
                  {t('header.trust')}
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Link to="/changelog">
                  <Megaphone className="w-3.5 h-3.5" />
                  {t('header.changelog')}
                </Link>
              </Button>
            </div>
          </div>
          
          {/* Right: Actions */}
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher variant="compact" />
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="gap-1.5 text-muted-foreground hover:text-foreground min-h-[44px] touch-manipulation"
              aria-label={session ? "Your account" : "Sign in"}
            >
              <Link to={session ? "/account" : "/auth"}>
                <UserIcon className="w-4 h-4" />
                <span className="hidden md:inline">{session ? "Account" : "Sign in"}</span>
              </Link>
            </Button>
            <ScanCreditsCounter />
            <Button 
              variant="default" 
              size="sm" 
              onClick={scrollToUpload}
              className="gap-2 shadow-lg shadow-primary/20 min-h-[44px] min-w-[44px] touch-manipulation"
              aria-label={t('header.getStartedAriaLabel')}
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t('header.getStarted')}</span>
              <span className="sm:hidden">{t('header.start')}</span>
            </Button>
          </div>
        </nav>
      </div>
      
      <ScanPackPurchase 
        open={showScanPackModal} 
        onOpenChange={setShowScanPackModal} 
      />
      
      <ProductSelectionModal 
        open={showProductModal} 
        onOpenChange={setShowProductModal} 
      />
        </header>
      </div>
    </>
  );
}
