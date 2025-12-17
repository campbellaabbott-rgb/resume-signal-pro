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
      className="relative py-16 sm:py-24 md:py-36 overflow-hidden" 
      aria-labelledby="hero-heading"
    >
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/8 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 right-0 w-[300px] h-[300px] bg-accent/5 rounded-full blur-[80px]" />
      </div>
      
      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        aria-hidden="true"
        style={{
          backgroundImage: `linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }}
      />
      
      <div className="container relative">
      <div className="max-w-4xl mx-auto text-center">
          {/* Primary CTA - Big and prominent */}
          <div className="mb-6 sm:mb-8 animate-fade-in">
            <button
              onClick={() => document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' })}
              className="group relative w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-5 sm:py-6 rounded-2xl bg-gradient-to-r from-success via-success to-emerald-500 text-success-foreground text-lg sm:text-xl font-bold shadow-xl shadow-success/30 hover:shadow-2xl hover:shadow-success/40 active:scale-[0.98] transition-all duration-300 min-h-[64px] touch-manipulation animate-pulse-subtle"
            >
              <Sparkles className="w-6 h-6 sm:w-7 sm:h-7" />
              <span>{getFreeScanText()}</span>
              {freeScanCta.variant !== 'free_badge' && (
                <div className="absolute -top-3 -right-2 sm:-right-3 px-3 py-1 rounded-full bg-destructive text-destructive-foreground text-xs font-bold animate-bounce shadow-lg">
                  FREE
                </div>
              )}
            </button>
            {/* Zero-friction messaging */}
            <div className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/30 text-success font-medium text-sm">
              <span>Free</span>
              <span className="w-1 h-1 rounded-full bg-success/50" />
              <span>No signup</span>
              <span className="w-1 h-1 rounded-full bg-success/50" />
              <span>30 seconds</span>
            </div>
            <div className="mt-3 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                No credit card needed
              </span>
              <span className="hidden sm:block w-1 h-1 rounded-full bg-muted-foreground/30" />
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-primary" />
                Your resume stays private
              </span>
            </div>
            <div className="mt-4">
              <LiveActivityCounter />
            </div>
          </div>

          {/* Badge */}
          <div className="flex justify-center mb-6 animate-fade-in" style={{ animationDelay: "0.05s" }}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm text-primary backdrop-blur-sm" role="status">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              {t('hero.badge')}
            </div>
          </div>
          
          {/* Heading */}
          <h1 
            id="hero-heading"
            className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-4 sm:mb-6 animate-fade-in leading-tight" 
            style={{ animationDelay: "0.1s" }}
          >
            {t('hero.heading')}{" "}
            <span className="text-gradient-primary block sm:inline">{t('hero.headingHighlight')}</span>
          </h1>
          
          {/* Subheading */}
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 sm:mb-12 animate-fade-in leading-relaxed px-2" style={{ animationDelay: "0.2s" }}>
            {t('hero.subheading')}
          </p>
          
          {/* Feature cards */}
          <ul 
            className="grid grid-cols-2 gap-2 sm:gap-3 md:gap-4 mb-8 sm:mb-12 animate-fade-in list-none p-0" 
            style={{ animationDelay: "0.3s" }}
            aria-label="Key features"
          >
            {features.map((feature) => (
              <li
                key={feature.labelKey}
                className="group relative p-3 sm:p-4 rounded-xl bg-card/50 border border-border/50 backdrop-blur-sm hover:border-primary/30 hover:bg-card/80 transition-all duration-300 focus-within:ring-2 focus-within:ring-primary active:scale-[0.98] touch-manipulation"
              >
                <div className="flex flex-col items-center text-center gap-1.5 sm:gap-2">
                  <div className="p-1.5 sm:p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors" aria-hidden="true">
                    <feature.icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <span className="text-xs sm:text-sm font-medium text-foreground leading-tight">{t(feature.labelKey)}</span>
                  <span className="text-[10px] sm:text-xs text-muted-foreground hidden md:block">{t(feature.descKey)}</span>
                </div>
              </li>
            ))}
          </ul>
          
          {/* Price + CTA */}
          <div className="animate-fade-in space-y-5" style={{ animationDelay: "0.4s" }}>
            <div className="inline-flex flex-col items-center p-6 rounded-2xl bg-gradient-to-b from-card/80 to-card/40 border border-border/50 backdrop-blur-sm">
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl md:text-5xl font-bold text-foreground">{pricing.main}</span>
                <span className="text-muted-foreground">{pricing.sub}</span>
              </div>
              {isLocalCurrency && (
                <p className="text-sm text-primary/80 font-medium">
                  ≈ {formatPrice(25)}
                </p>
              )}
              <p className="text-sm text-muted-foreground">{t('hero.nofees')}</p>
              <p className="text-xs text-primary mt-2 font-medium">{t('hero.roi')}</p>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30 text-sm text-muted-foreground">
                <Users className="w-4 h-4 text-primary" />
                <span>{t('hero.trusted')} <span className="font-semibold text-foreground">10,000+</span> {t('hero.jobSeekers')}</span>
              </div>
            </div>
            
            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
              <button
                onClick={() => document.getElementById('preview')?.scrollIntoView({ behavior: 'smooth' })}
                className="inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-full bg-primary/10 border border-primary/30 text-primary font-medium hover:bg-primary/20 hover:border-primary/50 active:scale-[0.98] transition-all duration-300 min-h-[48px] touch-manipulation"
              >
                <Eye className="w-5 h-5" />
                <span>{t('hero.seeSample')}</span>
              </button>
              <button
                onClick={() => document.getElementById('comparison')?.scrollIntoView({ behavior: 'smooth' })}
                className="inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-full bg-accent/20 border border-accent/40 text-accent-foreground font-medium hover:bg-accent/30 hover:border-accent/60 active:scale-[0.98] transition-all duration-300 min-h-[48px] touch-manipulation"
              >
                <Zap className="w-5 h-5 text-yellow-400" />
                <span>{t('hero.whyBetter')}</span>
              </button>
            </div>
            
            {/* Trust badges */}
            <ul className="flex flex-wrap justify-center gap-4 sm:gap-6 pt-2 list-none p-0" aria-label="Trust indicators">
              {trustBadges.map((badge) => (
                <li key={badge.labelKey} className="flex items-center gap-1.5 sm:gap-2 text-muted-foreground">
                  <badge.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary/70" aria-hidden="true" />
                  <span className="text-xs sm:text-sm">{t(badge.labelKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      
      {/* Scroll indicator */}
      <div 
        className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce hidden md:block" 
        aria-hidden="true"
      >
        <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex justify-center pt-2">
          <div className="w-1 h-2 rounded-full bg-muted-foreground/50" />
        </div>
      </div>
    </section>
  );
}
