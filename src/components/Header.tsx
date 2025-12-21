import { Sparkles, CreditCard, Package } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ScanPackPurchase } from "@/components/ScanPackPurchase";
import { ScanCreditsCounter } from "@/components/ScanCreditsCounter";
import { ProductSelectionModal } from "@/components/ProductSelectionModal";

export function Header() {
  const { t } = useTranslation();
  const [showScanPackModal, setShowScanPackModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  
  const scrollToUpload = () => {
    const uploadSection = document.getElementById('upload');
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Fallback: scroll to bottom of hero if upload not found
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
          <div className="flex items-center gap-4 sm:gap-6">
            <Link 
              to="/" 
              className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
              aria-label="Resume Booster - Home"
            >
              <Logo className="w-8 h-8" />
              <span className="font-bold text-lg tracking-tight">
                Resume <span className="text-primary">Booster</span>
              </span>
            </Link>
            <nav className="hidden sm:flex items-center gap-6">
              <Link 
                to="/methodology" 
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                How It Works
              </Link>
              <Link 
                to="/pricing" 
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Pricing
              </Link>
            </nav>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
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
