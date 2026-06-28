import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { FileText, Zap, Target, AlertTriangle, Shield, Clock, Star, Users, Sparkles, CheckCircle2, Info, X, ArrowRight, Package, TrendingUp, Award, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { useIsMobile } from "@/hooks/use-mobile";
import { PRODUCTS } from "@/config/products";
import { useABTest } from "@/hooks/use-ab-test";
import { SampleReportPreview } from "./SampleReportPreview";
import { useTodayScanCount } from "@/hooks/use-shared-data";

// Animated result preview component - shows what users get
function AnimatedResultPreview() {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const steps = [
    { label: t('hero.preview.atsScore'), value: "72%", color: "text-warning" },
    { label: t('hero.reveal.keywords'), value: t('hero.preview.found', { count: 8 }), color: "text-destructive" },
    { label: t('hero.reveal.quickFixes'), value: t('hero.preview.ready', { count: 5 }), color: "text-success" },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-card/80 border border-border/50 backdrop-blur-sm">
      <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
      <div className="flex items-center gap-2 min-w-[140px]">
        <span className="text-sm text-muted-foreground">{steps[currentStep].label}:</span>
        <span className={`text-sm font-bold ${steps[currentStep].color} transition-all duration-300`}>
          {steps[currentStep].value}
        </span>
      </div>
    </div>
  );
}

// Hero stats bar - immediate social proof with inflated live count
function HeroStatsBar() {
  const { inflatedCount } = useTodayScanCount();
  const [displayCount, setDisplayCount] = useState<number>(inflatedCount);
  const [isAnimating, setIsAnimating] = useState(false);

  // Sync with shared data
  useEffect(() => {
    setDisplayCount(inflatedCount);
  }, [inflatedCount]);

  useEffect(() => {
    // Slow increment every 8-15 seconds to simulate real-time activity
    const incrementInterval = setInterval(() => {
      setDisplayCount(prev => {
        setIsAnimating(true);
        setTimeout(() => setIsAnimating(false), 600);
        return prev + 1;
      });
    }, Math.random() * 7000 + 8000); // Random interval between 8-15 seconds

    return () => {
      clearInterval(incrementInterval);
    };
  }, []);

  const { t } = useTranslation();
  
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 py-3 px-4 rounded-2xl bg-gradient-to-r from-card/80 via-card/60 to-card/80 border border-border/40 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-success/20">
          <TrendingUp className="w-4 h-4 text-success" />
        </div>
        <div className="text-left">
          <p className={`text-lg sm:text-xl font-bold text-foreground transition-all duration-300 ${isAnimating ? 'scale-110 text-success' : ''}`}>
            {displayCount.toLocaleString()}+
          </p>
          <p className="text-xs text-muted-foreground">{t('hero.stats.scannedToday', 'Scanned today')}</p>
        </div>
      </div>
      <div className="w-px h-10 bg-border/50 hidden sm:block" />
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-warning/20">
          <Star className="w-4 h-4 text-warning" />
        </div>
        <div className="text-left">
          <p className="text-lg sm:text-xl font-bold text-foreground">4.9/5</p>
          <p className="text-xs text-muted-foreground">{t('hero.stats.userRating', 'User rating')}</p>
        </div>
      </div>
      <div className="w-px h-10 bg-border/50 hidden sm:block" />
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/20">
          <Award className="w-4 h-4 text-primary" />
        </div>
        <div className="text-left">
          <p className="text-lg sm:text-xl font-bold text-foreground">89%</p>
          <p className="text-xs text-muted-foreground">{t('hero.stats.gotInterviews', 'Got interviews')}</p>
        </div>
      </div>
    </div>
  );
}

// Quick benefit chips - now includes add-ons mention
function BenefitChips() {
  const { t } = useTranslation();
  const benefits = [
    { icon: Clock, text: t('hero.chips.scan', '30-second scan') },
    { icon: Shield, text: t('hero.chips.private', '100% private') },
    { icon: Zap, text: t('hero.chips.fixes', 'Instant fixes') },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {benefits.map((benefit, i) => (
        <div 
          key={i}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border/30 text-sm"
        >
          <benefit.icon className="w-3.5 h-3.5 text-success" />
          <span className="text-muted-foreground">{benefit.text}</span>
        </div>
      ))}
    </div>
  );
}

// Add-ons teaser for Hero section
function AddOnsTeaser() {
  return (
    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card/60 border border-border/40">
      <span className="text-xs text-muted-foreground">Includes free:</span>
      <span className="text-xs font-medium text-foreground">Resume Roast 🔥</span>
      <span className="text-muted-foreground/50">•</span>
      <span className="text-xs font-medium text-foreground">Interview Coach</span>
      <span className="text-muted-foreground/50">•</span>
      <span className="text-xs font-medium text-foreground">Career Path</span>
    </div>
  );
}

export function Hero() {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const isMobile = useIsMobile();
  const [showAtsInfo, setShowAtsInfo] = useState(false);
  
  const { variant: socialProofVariant, trackConversion: trackSocialProof } = useABTest('social_proof_placement');
  const { variant: layoutVariant, trackConversion: trackLayout } = useABTest('hero_layout');

  const fullAnalysisPrice = PRODUCTS.fullAnalysis.priceUsd;

  const handleFreeScanClick = () => {
    // Track both tests on CTA click
    trackSocialProof({ action: 'free_scan_cta_click' });
    trackLayout({ action: 'free_scan_cta_click', layout: layoutVariant });
    
    const uploadSection = document.getElementById('upload');
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: window.innerHeight, behavior: 'smooth' });
    }
  };

  // Layout variants
  const isCompactLayout = layoutVariant === 'compact';
  const isUltraCompact = layoutVariant === 'ultra_compact';
  const isOriginalLayout = layoutVariant === 'original';
  const isSocialFirst = layoutVariant === 'social_first';
  const isBenefitLed = layoutVariant === 'benefit_led';

  // Determine padding based on variant
  const getSectionPadding = () => {
    if (isUltraCompact) return 'py-4 sm:py-6 md:py-10';
    if (isSocialFirst) return 'py-4 sm:py-8 md:py-12';
    if (isBenefitLed) return 'py-5 sm:py-8 md:py-14';
    if (isCompactLayout) return 'py-6 sm:py-10 md:py-16';
    return 'py-10 sm:py-16 md:py-24'; // original
  };

  // Render the CTA button (reused across variants)
  const renderCTA = (size: 'sm' | 'md' | 'lg' = 'md') => {
    const sizeClasses = {
      sm: 'px-6 py-3 sm:px-8 sm:py-4 text-base sm:text-lg min-h-[48px] sm:min-h-[56px]',
      md: 'px-8 py-4 sm:px-10 sm:py-5 text-base sm:text-lg md:text-xl min-h-[56px] sm:min-h-[64px]',
      lg: 'px-10 py-5 sm:py-6 text-lg sm:text-xl min-h-[64px]',
    };
    const iconSize = {
      sm: 'w-4 h-4 sm:w-5 sm:h-5',
      md: 'w-5 h-5 sm:w-6 sm:h-6',
      lg: 'w-6 h-6 sm:w-7 sm:h-7',
    };
    const badgeClasses = {
      sm: '-top-1.5 -right-1 px-1.5 py-0.5 text-[9px] sm:text-[10px]',
      md: '-top-2 -right-1 sm:-top-3 sm:-right-3 px-2 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-xs',
      lg: '-top-3 -right-2 sm:-right-3 px-3 py-1 text-xs',
    };

    return (
      <button
        onClick={handleFreeScanClick}
        className={`group relative w-full sm:w-auto inline-flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-success via-success to-emerald-500 text-success-foreground font-bold shadow-xl shadow-success/30 hover:shadow-2xl hover:shadow-success/40 active:scale-[0.98] transition-all duration-300 touch-manipulation ${sizeClasses[size]}`}
      >
        <Sparkles className={iconSize[size]} />
        <span>{t('hero.ctaButton', 'Check My Resume Now')}</span>
        <div className={`absolute rounded-full bg-primary text-primary-foreground font-bold shadow-lg animate-pulse ${badgeClasses[size]}`}>
          {t('hero.freeBadge', 'FREE')}
        </div>
      </button>
    );
  };

  // Render trust indicators
  const renderTrustIndicators = (compact = false) => (
    <div className={`flex flex-wrap items-center justify-center text-muted-foreground ${
      compact ? 'mt-2 gap-x-2 gap-y-1 text-[10px] sm:text-xs' : 'mt-3 gap-x-3 gap-y-1 text-xs sm:text-sm'
    }`}>
      <span className="flex items-center gap-1">
        <Check className={compact ? "w-2.5 h-2.5 text-success" : "w-3 h-3 sm:w-4 sm:h-4 text-success"} />
        {t('hero.noSignup', 'No sign-up required')}
      </span>
      <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
      <span className="flex items-center gap-1">
        <Check className={compact ? "w-2.5 h-2.5 text-success" : "w-3 h-3 sm:w-4 sm:h-4 text-success"} />
        {t('hero.private')}
      </span>
    </div>
  );

  // ============================================
  // VARIANT: SOCIAL_FIRST
  // Lead with prominent social proof, then headline + CTA
  // ============================================
  if (isSocialFirst) {
    return (
      <section className={`relative overflow-hidden ${getSectionPadding()}`} aria-labelledby="hero-heading">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-success/5 rounded-full blur-[150px]" />
        </div>
        
        <div className="container relative">
          <div className="max-w-3xl mx-auto text-center">
            
            {/* PROMINENT SOCIAL PROOF - Large and eye-catching */}
            <div className="mb-5 animate-fade-in">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/30 mb-4">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-sm font-medium text-success">{t('hero.socialFirst.joinThousands')}</span>
              </div>
              <HeroStatsBar />
            </div>

            {/* Headline - slightly smaller to emphasize social proof */}
            <div className="mb-4 animate-fade-in" style={{ animationDelay: "0.05s" }}>
              <h1 id="hero-heading" className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight mb-3 leading-tight">
                {t('hero.headline.get', 'Get')}{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-success via-emerald-400 to-success">
                  {t('hero.headline.recruiterGrade', 'Recruiter-Grade')}
                </span>{" "}
                {t('hero.headline.feedback', 'Resume Feedback in 60 Seconds')}
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
                {t('hero.socialFirst.subheading')}
              </p>
            </div>

            {/* CTA */}
            <div className="mb-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              {renderCTA('md')}
              {renderTrustIndicators()}
            </div>

            {/* Mini testimonial for extra social proof */}
            <div className="animate-fade-in flex justify-center" style={{ animationDelay: "0.15s" }}>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card/60 border border-border/40">
                <div className="flex -space-x-2">
                  {['JD', 'MK', 'AS'].map((initials, i) => (
                    <div key={i} className="w-6 h-6 rounded-full bg-gradient-to-br from-primary/30 to-success/30 flex items-center justify-center border-2 border-background text-[8px] font-bold text-foreground">
                      {initials}
                    </div>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{t('hero.socialFirst.recentActivityCount', { count: 142 })}</span> {t('hero.socialFirst.recentActivityText')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ============================================
  // VARIANT: BENEFIT_LED
  // Lead with pain point, then solution + CTA
  // ============================================
  if (isBenefitLed) {
    return (
      <section className={`relative overflow-hidden ${getSectionPadding()}`} aria-labelledby="hero-heading">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-destructive/5 rounded-full blur-[150px]" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-success/5 rounded-full blur-[100px]" />
        </div>
        
        <div className="container relative">
          <div className="max-w-3xl mx-auto text-center">
            
            {/* PAIN POINT - Attention-grabbing problem statement */}
            <div className="mb-4 animate-fade-in">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive/10 border border-destructive/30 mb-3">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                <span className="text-sm font-medium text-destructive">{t('hero.benefitLed.painBadge')}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground mb-2">
                {t('hero.benefitLed.painHeadingPrefix')} <span className="text-destructive">{t('hero.benefitLed.painHeadingHighlight')}</span>
              </h2>
              <p className="text-sm sm:text-base text-muted-foreground">
                {t('hero.benefitLed.painSubheading')}
              </p>
            </div>

            {/* SOLUTION - The fix */}
            <div className="mb-4 animate-fade-in" style={{ animationDelay: "0.05s" }}>
              <div className="inline-flex items-center gap-2 mb-3">
                <div className="w-8 h-[2px] bg-muted-foreground/30" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">{t('hero.benefitLed.solutionLabel')}</span>
                <div className="w-8 h-[2px] bg-muted-foreground/30" />
              </div>
              <h1 id="hero-heading" className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight mb-2 leading-tight">
                {t('hero.headline.get', 'Get')}{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-success via-emerald-400 to-success">
                  {t('hero.benefitLed.solutionHeadingHighlight')}
                </span>{" "}
                {t('hero.benefitLed.solutionHeadingSuffix')}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-lg mx-auto">
                {t('hero.benefitLed.solutionSubheading')}
              </p>
            </div>

            {/* CTA */}
            <div className="mb-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              {renderCTA('md')}
              {renderTrustIndicators()}
            </div>

            {/* Social proof as validation */}
            <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
              <HeroStatsBar />
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ============================================
  // VARIANTS: COMPACT, ULTRA_COMPACT, ORIGINAL
  // (Original implementation)
  // ============================================
  return (
    <section 
      className={`relative overflow-hidden ${getSectionPadding()}`}
      aria-labelledby="hero-heading"
    >
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-success/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
      </div>
      
      <div className="container relative">
        <div className="max-w-3xl mx-auto text-center">
          
          {/* IMMEDIATE SOCIAL PROOF - Hide in ultra-compact above fold */}
          {!isUltraCompact && (
            <div className={`animate-fade-in ${isCompactLayout ? 'mb-4' : 'mb-6'}`}>
              <HeroStatsBar />
            </div>
          )}

          {/* VALUE-FIRST HEADLINE - Always show */}
          <div className={`animate-fade-in ${isUltraCompact ? 'mb-3' : isCompactLayout ? 'mb-4 sm:mb-6' : 'mb-8'}`} style={{ animationDelay: "0.05s" }}>
            <h1
              id="hero-heading"
              className={`font-bold tracking-tight leading-tight ${
                isUltraCompact 
                  ? 'text-xl sm:text-2xl md:text-3xl lg:text-4xl mb-2 sm:mb-3' 
                  : isCompactLayout 
                    ? 'text-2xl sm:text-3xl md:text-4xl lg:text-5xl mb-3 sm:mb-4' 
                    : 'text-2xl sm:text-3xl md:text-4xl lg:text-5xl mb-5'
              }`}
            >
              {t('hero.headline.get', 'Get')}{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-success via-emerald-400 to-success">
                {t('hero.headline.recruiterGrade', 'Recruiter-Grade')}
              </span>{" "}
              {t('hero.headline.feedback', 'Resume Feedback in 60 Seconds')}
            </h1>
            
            {/* Description - shorter for ultra-compact */}
            {isUltraCompact ? (
              <p className="text-xs sm:text-sm text-muted-foreground max-w-xl mx-auto">
                {t('hero.ultraCompactDescription')}
              </p>
            ) : (
              <p className={`text-muted-foreground max-w-2xl mx-auto leading-relaxed ${isCompactLayout ? 'text-sm sm:text-base md:text-lg mb-4' : 'text-base sm:text-lg mb-6'}`}>
                {t('hero.description', 'Upload your resume and get ATS-optimized rewrites, red-flag warnings, and keyword improvements — written the way hiring managers actually review resumes.')}
              </p>
            )}

            {/* Key selling points - hide in ultra-compact */}
            {!isUltraCompact && (
              <>
                {isCompactLayout ? (
                  <>
                    {/* Desktop: show all benefits */}
                    <div className="hidden sm:flex flex-col items-center gap-2 mb-4">
                      <div className="flex items-center gap-2.5 text-sm sm:text-base text-foreground">
                        <Check className="w-4 h-4 text-success flex-shrink-0" />
                        <span>{t('hero.benefits.seniorRoles', 'Built for senior ICs, managers, and competitive roles')}</span>
                      </div>
                      <div className="flex items-center gap-2.5 text-sm sm:text-base text-foreground">
                        <Check className="w-4 h-4 text-success flex-shrink-0" />
                        <span>{t('hero.benefits.atsCompatible', 'Works on all ATS systems (Workday, Greenhouse, Lever & 50+ more)')}</span>
                      </div>
                      <div className="flex items-center gap-2.5 text-sm sm:text-base text-foreground">
                        <Check className="w-4 h-4 text-success flex-shrink-0" />
                        <span>{t('hero.benefits.oneTime', 'One-time payment (no subscription)')}</span>
                      </div>
                      <div className="flex items-center gap-2.5 text-sm sm:text-base text-foreground">
                        <Check className="w-4 h-4 text-success flex-shrink-0" />
                        <span>{t('hero.benefits.private', 'Resumes are never stored or shared')}</span>
                      </div>
                    </div>
                    {/* Mobile: Show only 2 key benefits inline */}
                    <div className="flex sm:hidden flex-wrap justify-center gap-x-4 gap-y-1 mb-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Check className="w-3 h-3 text-success" />
                        {t('hero.worksOnAllAts')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Check className="w-3 h-3 text-success" />
                        {t('hero.private')}
                      </span>
                    </div>
                  </>
                ) : (
                  /* Original layout: show all benefits on all screen sizes */
                  <div className="flex flex-col items-center gap-2.5 mb-6">
                    <div className="flex items-center gap-2.5 text-sm sm:text-base text-foreground">
                      <Check className="w-4 h-4 text-success flex-shrink-0" />
                      <span>{t('hero.benefits.seniorRoles', 'Built for senior ICs, managers, and competitive roles')}</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-sm sm:text-base text-foreground">
                      <Check className="w-4 h-4 text-success flex-shrink-0" />
                      <span>{t('hero.benefits.atsCompatible', 'Works on all ATS systems (Workday, Greenhouse, Lever & 50+ more)')}</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-sm sm:text-base text-foreground">
                      <Check className="w-4 h-4 text-success flex-shrink-0" />
                      <span>{t('hero.benefits.oneTime', 'One-time payment (no subscription)')}</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-sm sm:text-base text-foreground">
                      <Check className="w-4 h-4 text-success flex-shrink-0" />
                      <span>{t('hero.benefits.private', 'Resumes are never stored or shared')}</span>
                    </div>
                  </div>
                )}

                {/* Animated preview of results - only show separately in original layout */}
                {isOriginalLayout && (
                  <div className="flex justify-center">
                    <AnimatedResultPreview />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Animated preview + Benefit chips - hide in ultra-compact */}
          {!isUltraCompact && (
            <>
              {isCompactLayout ? (
                <div className="mb-4 animate-fade-in flex flex-col sm:flex-row items-center justify-center gap-3" style={{ animationDelay: "0.1s" }}>
                  <AnimatedResultPreview />
                  <div className="hidden sm:block">
                    <BenefitChips />
                  </div>
                </div>
              ) : (
                <div className="mb-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
                  <BenefitChips />
                </div>
              )}
            </>
          )}

          {/* PRIMARY CTA - Large and unmissable */}
          <div className={`animate-fade-in ${isUltraCompact ? 'mb-3' : isCompactLayout ? 'mb-4' : 'mb-6'}`} style={{ animationDelay: isUltraCompact ? "0.05s" : "0.15s" }}>
            {renderCTA(isUltraCompact ? 'sm' : isCompactLayout ? 'md' : 'lg')}
            {renderTrustIndicators(isUltraCompact)}
            {!isUltraCompact && isOriginalLayout && (
              <div className="mt-2 flex justify-center">
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Check className="w-4 h-4 text-success" />
                  {t('hero.actionableFixes', 'Actionable fixes included')}
                </span>
              </div>
            )}
          </div>

          {/* Show social proof BELOW the CTA for ultra-compact */}
          {isUltraCompact && (
            <div className="mb-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              <HeroStatsBar />
            </div>
          )}


          {/* TESTIMONIAL - Single powerful quote */}
          <div className="mb-8 animate-fade-in" style={{ animationDelay: "0.25s" }}>
            <div className="max-w-md mx-auto px-5 py-4 rounded-2xl bg-card/60 border border-border/40">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-success/20 flex items-center justify-center">
                  <span className="text-sm font-bold text-foreground">SK</span>
                </div>
                <div className="text-left">
                  <p className="text-sm text-foreground italic leading-relaxed">
                    "{t('hero.testimonialQuote')}"
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <p className="text-xs text-muted-foreground">{t('hero.testimonialAuthorName')}</p>
                    <div className="flex items-center gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-3 h-3 text-warning fill-warning" />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ATS EXPLAINER - Collapsible for curious users */}
          <div className="mb-8 animate-fade-in" style={{ animationDelay: "0.3s" }}>
            <button
              onClick={() => setShowAtsInfo(!showAtsInfo)}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <AlertTriangle className="w-4 h-4 text-destructive/70" />
              <span>{t('hero.atsExplainerToggle')}</span>
              <Info className="w-4 h-4" />
            </button>

            {showAtsInfo && (
              <div className="mt-3 p-4 rounded-xl bg-card border border-border text-left max-w-lg mx-auto animate-fade-in relative">
                <button
                  onClick={() => setShowAtsInfo(false)}
                  className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label={t('common.close')}
                >
                  <X className="w-4 h-4" />
                </button>
                <p className="text-sm text-foreground pr-6">
                  <span className="font-semibold">{t('hero.atsExplainerBoldLead')}</span> {t('hero.atsExplainerRest')}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {t('hero.atsExplainerSystems')}
                </p>
                <Link
                  to="/methodology"
                  className="inline-flex items-center gap-1 mt-3 text-xs text-primary hover:underline"
                >
                  {t('hero.seeMethodology')}
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            )}
          </div>

          {/* Trusted by companies - desktop only */}
          <div className="animate-fade-in hidden sm:block" style={{ animationDelay: "0.35s" }}>
            <p className="text-xs text-muted-foreground/60 mb-4">{t('hero.trustedBy')}</p>
            <div className="flex flex-wrap justify-center items-center gap-x-6 sm:gap-x-8 gap-y-3">
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Google</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Microsoft</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Amazon</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Apple</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Meta</span>
              <span className="text-sm sm:text-base font-semibold text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">Netflix</span>
            </div>
          </div>

          {/* Sample Report Preview */}
          <div className="mt-10 sm:mt-12 pt-8 border-t border-border/30 animate-fade-in" style={{ animationDelay: "0.4s" }}>
            <SampleReportPreview />
          </div>

          {/* Pricing Teaser */}
          <div className="mt-10 animate-fade-in hidden sm:block" style={{ animationDelay: "0.45s" }}>
            <Link 
              to="/pricing"
              className="group inline-flex items-center gap-3 px-6 py-3 rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 hover:border-primary/40 hover:bg-primary/15 transition-all"
            >
              <Package className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-foreground">
                {t('hero.packagesTeaserPrefix')} <span className="text-primary">{t('hero.packagesTeaserHighlight')}</span>
              </span>
              <ArrowRight className="w-4 h-4 text-primary group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          {/* Mobile scroll hint + Pricing teaser */}
          <div className="mt-6 sm:hidden animate-fade-in space-y-4" style={{ animationDelay: "0.4s" }}>
            <button
              onClick={handleFreeScanClick}
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto"
            >
              <span>{t('hero.scrollToUpload')}</span>
              <svg className="w-4 h-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
            
            <Link 
              to="/pricing"
              onClick={() => window.scrollTo(0, 0)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20 active:bg-primary/20 transition-colors mx-auto"
            >
              <Package className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">
                {t('hero.viewAllPackages')}
              </span>
              <ArrowRight className="w-4 h-4 text-primary" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
