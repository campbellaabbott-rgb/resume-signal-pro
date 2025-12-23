import { Sparkles, CreditCard, Package, Shield } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ScanPackPurchase } from "@/components/ScanPackPurchase";
import { ScanCreditsCounter } from "@/components/ScanCreditsCounter";
import { ProductSelectionModal } from "@/components/ProductSelectionModal";

export function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
        {/* Beta Banner */}
        <div className="bg-primary text-primary-foreground text-center py-1.5 text-xs font-medium tracking-wide">
          🚀 Currently in Beta — We'd love your feedback!
        </div>
        <header className="bg-background border-b border-border/50" role="banner">
        <div className="container">
        <nav className="flex items-center justify-between h-16" aria-label="Main navigation">
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
              aria-label="Resume Booster - Home"
            >
              <Logo className="w-8 h-8" />
              <span className="font-bold text-lg tracking-tight">
                Resume <span className="text-primary">Booster</span>
              </span>
            </Link>
            
            <div className="hidden sm:flex items-center">
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                <Link to="/methodology">How It Works</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                <Link to="/pricing">Pricing</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Link to="/trust">
                  <Shield className="w-3.5 h-3.5" />
                  Trust
                </Link>
              </Button>
            </div>
          </div>
          
          {/* Right: Actions */}
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher variant="compact" />
            <ScanCreditsCounter />
            <Button 
              variant="default" 
              size="sm" 
              onClick={scrollToUpload}
              className="gap-2 shadow-lg shadow-primary/20 min-h-[44px] min-w-[44px] touch-manipulation"
              aria-label="Get started - scroll to upload section"
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
