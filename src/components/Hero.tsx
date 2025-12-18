import { FileText, Zap, Target, AlertTriangle, Shield, Clock, Star, Eye, Users, Sparkles, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { LiveActivityCounter } from "./LiveActivityCounter";
import { useABTest } from "@/hooks/use-ab-test";


export function Hero() {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  
  // A/B Tests
  const heroCta = useABTest('hero_cta');
  const pricingDisplay = useABTest('pricing_display');
  const freeScanCta = useABTest('free_scan_cta');

  // CTA text variants
  const getCtaText = () => {
    switch (heroCta.variant) {
      case 'urgent': return 'Analyze Now - Limited Spots';
      case 'benefit': return 'Land More Interviews - $25';
      default: return 'Get Your Analysis - $25';
    }
  };

  // Free scan button text variants
  const getFreeScanText = () => {
    switch (freeScanCta.variant) {
      case 'instant': return 'Get Instant Results';
      case 'free_badge': return '✨ FREE Scan Available';
      default: return 'Get Free Resume Score';
    }
  };

  // Pricing display variants
  const getPricingDisplay = () => {
    switch (pricingDisplay.variant) {
      case 'starting_at': return { main: 'Starting at $25', sub: 'One-time' };
      case 'roi_focused': return { main: '$25', sub: '= 1 Interview ROI' };
      default: return { main: t('hero.price'), sub: t('hero.oneTime') };
    }
  };

  const pricing = getPricingDisplay();

  const handleFreeScanClick = () => {
    freeScanCta.trackConversion({ source: 'hero_free_scan' });
    const uploadSection = document.getElementById('upload');
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Fallback: scroll to bottom of hero if upload not found
      window.scrollTo({ top: window.innerHeight, behavior: 'smooth' });
    }
  };

  const features = [
    { icon: FileText, labelKey: "hero.features.atsBullets", descKey: "hero.features.atsBulletsDesc" },
    { icon: Zap, labelKey: "hero.features.actionVerbs", descKey: "hero.features.actionVerbsDesc" },
    { icon: Target, labelKey: "hero.features.keywords", descKey: "hero.features.keywordsDesc" },
    { icon: AlertTriangle, labelKey: "hero.features.redFlags", descKey: "hero.features.redFlagsDesc" },
  ];

  const trustBadges = [
    { icon: Shield, labelKey: "hero.trust.secure" },
    { icon: Clock, labelKey: "hero.trust.results" },
    { icon: Star, labelKey: "hero.trust.approved" },
  ];

  return (
    <section 
      className="relative py-12 sm:py-20 md:py-28 overflow-hidden" 
      aria-labelledby="hero-heading"
    >
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-destructive/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
      </div>
      
      <div className="container relative">
        <div className="max-w-3xl mx-auto text-center">
          {/* Problem Statement - Bold and Alarming */}
          <div className="mb-6 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium mb-6">
              <AlertTriangle className="w-4 h-4" />
              <span>{t('hero.problemBadge', '85% of resumes never reach a human')}</span>
            </div>
            
            <h1 
              id="hero-heading"
              className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4 leading-tight"
            >
              {t('hero.mainHeading', 'Is Your Resume Being')}{" "}
              <span className="text-destructive">{t('hero.mainHeadingHighlight', 'Rejected by ATS?')}</span>
            </h1>
            
            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed">
              {t('hero.mainSubheading', "Find out in 30 seconds. Get your ATS score and see exactly what's costing you interviews.")}
            </p>
          </div>

          {/* Single Primary CTA */}
          <div className="mb-8 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <button
              onClick={handleFreeScanClick}
              className="group relative w-full sm:w-auto inline-flex items-center justify-center gap-3 px-10 py-5 sm:py-6 rounded-2xl bg-gradient-to-r from-success via-success to-emerald-500 text-success-foreground text-lg sm:text-xl font-bold shadow-xl shadow-success/30 hover:shadow-2xl hover:shadow-success/40 active:scale-[0.98] transition-all duration-300 min-h-[64px] touch-manipulation"
            >
              <Sparkles className="w-6 h-6 sm:w-7 sm:h-7" />
              <span>{t('hero.ctaButton', 'Check My Resume Now')}</span>
              <div className="absolute -top-3 -right-2 sm:-right-3 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-lg">
                {t('hero.freeBadge', 'FREE')}
              </div>
            </button>
            
            {/* Minimal trust indicators */}
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-success" />
                {t('hero.noSignup', 'No sign-up required')}
              </span>
              <span className="hidden sm:block w-1 h-1 rounded-full bg-muted-foreground/30" />
              <span className="flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-primary" />
                {t('hero.private', '100% private')}
              </span>
            </div>

            {/* Anonymous testimonial */}
            <div className="mt-6 px-4 py-3 rounded-xl bg-card/40 border border-border/30 max-w-md mx-auto">
              <p className="text-sm text-muted-foreground italic">
                {t('hero.testimonial', '"This is a very wonderful product. I have just gone through the freemium features & I can confidently say it\'s going to be a big success."')}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2">— {t('hero.testimonialAuthor', 'Recent user')}</p>
            </div>
          </div>

          {/* Live counter as social proof */}
          <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <LiveActivityCounter />
          </div>

          {/* Trusted by companies */}
          <div className="mt-8 animate-fade-in" style={{ animationDelay: "0.18s" }}>
            <p className="text-xs text-muted-foreground/60 mb-4">{t('hero.trustedBy', 'Trusted by professionals at')}</p>
            <div className="flex flex-wrap justify-center items-center gap-x-6 sm:gap-x-8 gap-y-3">
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Google</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Microsoft</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Amazon</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Apple</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Meta</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Netflix</span>
            </div>
          </div>

          {/* What you'll discover - brief preview */}
          <div className="mt-10 pt-8 border-t border-border/30 animate-fade-in" style={{ animationDelay: "0.2s" }}>
            <p className="text-sm text-muted-foreground mb-4">{t('hero.freeScanReveals', 'Your free scan reveals:')}</p>
            <div className="flex flex-wrap justify-center gap-3">
              {[
                t('hero.reveal.atsScore', 'ATS Score'),
                t('hero.reveal.keywords', 'Missing Keywords'), 
                t('hero.reveal.redFlags', 'Red Flags'),
                t('hero.reveal.quickFixes', 'Quick Fixes')
              ].map((item) => (
                <span 
                  key={item}
                  className="px-3 py-1.5 rounded-full bg-card/60 border border-border/50 text-xs sm:text-sm text-foreground"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
