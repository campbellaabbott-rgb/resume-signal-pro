import { useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Zap, Target, AlertTriangle, Shield, Clock, Star, Eye, Users, Sparkles, CheckCircle2, Info, X, ArrowRight, Package } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { LiveActivityCounter } from "./LiveActivityCounter";
import { useIsMobile } from "@/hooks/use-mobile";
import { PRODUCTS } from "@/config/products";
import { useABTest } from "@/hooks/use-ab-test";
import { SampleReportPreview } from "./SampleReportPreview";

// Social proof component for A/B testing placement
function SocialProofBlock({ variant }: { variant: 'compact' | 'full' }) {
  const { t } = useTranslation();
  
  if (variant === 'compact') {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Users className="w-4 h-4 text-success" />
          <span className="font-medium">2,847+</span> resumes scanned today
        </span>
        <span className="hidden sm:block w-1 h-1 rounded-full bg-muted-foreground/30" />
        <span className="flex items-center gap-1.5">
          <Star className="w-4 h-4 text-warning" />
          <span className="font-medium">4.9/5</span> from job seekers
        </span>
      </div>
    );
  }
  
  return (
    <>
      {/* Testimonials */}
      <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
        <div className="px-4 py-3 rounded-xl bg-card/40 border border-border/30">
          <p className="text-sm text-muted-foreground italic">
            {t('hero.testimonial', '"This is a very wonderful product. I have just gone through the freemium features & I can confidently say it\'s going to be a big success."')}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-2">— {t('hero.testimonialAuthor1', 'Sarah K.')}</p>
        </div>
        <div className="px-4 py-3 rounded-xl bg-card/40 border border-border/30">
          <p className="text-sm text-muted-foreground italic">
            "{t('hero.testimonial2', 'Service is super helpful and useful.')}"
          </p>
          <p className="text-xs text-muted-foreground/60 mt-2">— {t('hero.testimonialAuthor2', 'Marcus T.')}</p>
        </div>
      </div>
      
      {/* Live counter */}
      <div className="mt-4">
        <LiveActivityCounter />
      </div>
    </>
  );
}

export function Hero() {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const isMobile = useIsMobile();
  const [showAtsInfo, setShowAtsInfo] = useState(false);
  
  // A/B test for social proof placement
  const { variant: socialProofVariant, trackConversion } = useABTest('social_proof_placement');

  // Price display helper
  const fullAnalysisPrice = PRODUCTS.fullAnalysis.priceUsd;
  const priceDisplay = isLocalCurrency 
    ? `$${fullAnalysisPrice} ≈ ${formatPrice(fullAnalysisPrice)}` 
    : `$${fullAnalysisPrice}`;

  // Winners declared - using control variants
  const getCtaText = () => `Get Your Analysis - ${priceDisplay}`;
  const getFreeScanText = () => 'Get Free Resume Score';
  const getPricingDisplay = () => ({
    main: isLocalCurrency ? `$${fullAnalysisPrice} (≈${formatPrice(fullAnalysisPrice)})` : t('hero.price'),
    sub: t('hero.oneTime')
  });

  const pricing = getPricingDisplay();

  const handleFreeScanClick = () => {
    // Track conversion for A/B test
    trackConversion({ action: 'free_scan_cta_click' });
    
    const uploadSection = document.getElementById('upload');
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
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
            {/* 85% rejection stat with source */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/10 border border-destructive/20 mb-5">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="text-sm font-semibold text-destructive">85% of resumes are rejected by ATS before a human sees them</span>
              <TooltipProvider>
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <span className="cursor-help text-destructive/60 hover:text-destructive transition-colors">
                      <Info className="w-3.5 h-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-sm font-normal">
                    <p>Source: Jobscan ATS research, 2023. Based on analysis of Fortune 500 hiring practices.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            
            <h1
              id="hero-heading"
              className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4 leading-tight"
            >
              {t('hero.mainHeading', 'Is Your Resume Being')}{" "}
              <span className="text-destructive inline-flex items-center gap-1.5 flex-wrap">
                {t('hero.mainHeadingHighlight', 'Rejected by ATS Bots?')}
                {/* Desktop: Hover tooltip */}
                {!isMobile && (
                  <TooltipProvider>
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-help">
                          <Info className="w-5 h-5 sm:w-6 sm:h-6 text-muted-foreground hover:text-foreground transition-colors" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs text-sm font-normal">
                        <p>{t('hero.atsTooltip', 'ATS (Applicant Tracking Systems) are AI bots that scan and filter resumes before a human ever sees them. Over 98% of Fortune 500 companies use them.')}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{t('hero.atsSystemsList', 'We analyze against Workday, Greenhouse, Lever, Taleo, iCIMS & more.')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {/* Mobile: Tap to show/hide */}
                {isMobile && (
                  <button
                    onClick={() => setShowAtsInfo(!showAtsInfo)}
                    className="inline-flex cursor-pointer p-1 -m-1 touch-manipulation"
                    aria-label="What is ATS?"
                  >
                    <Info className="w-5 h-5 text-muted-foreground" />
                  </button>
                )}
              </span>
            </h1>
            
            {/* Mobile ATS info popup */}
            {isMobile && showAtsInfo && (
              <div className="mb-4 p-4 rounded-xl bg-card border border-border text-left relative animate-fade-in">
                <button 
                  onClick={() => setShowAtsInfo(false)}
                  className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
                <p className="text-sm text-foreground pr-6">
                  <span className="font-semibold">ATS (Applicant Tracking Systems)</span> are AI bots that scan and filter resumes before a human ever sees them. Over 98% of Fortune 500 companies use them.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  We analyze against Workday, Greenhouse, Lever, Taleo, iCIMS & more.
                </p>
              </div>
            )}
            
            {/* Urgent hook for mobile - immediate value proposition */}
            <div className="sm:hidden mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/20 text-success text-sm font-semibold">
              <Sparkles className="w-4 h-4" />
              <span>Free ATS Score in 30 Seconds</span>
            </div>
            
            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto mb-2 leading-relaxed">
              {t('hero.mainSubheading', "Find out in 30 seconds. Our AI simulates how ATS systems scan your resume and shows exactly what's costing you interviews.")}
            </p>
            <div className="max-w-lg mx-auto mb-6">
              <TooltipProvider>
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <p className="text-xs sm:text-sm text-muted-foreground/60 cursor-help inline-flex items-center gap-1.5 hover:text-muted-foreground transition-colors">
                      <Info className="w-3.5 h-3.5" />
                      {t('hero.atsSystemsCredibility', 'Based on parsing rules from Workday, Greenhouse, Lever, Taleo, iCIMS & 50+ ATS platforms')}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-sm text-left p-4 bg-popover border border-border shadow-xl">
                    <p className="font-semibold text-foreground mb-2">How We Analyze Your Resume</p>
                    <ul className="text-xs text-muted-foreground space-y-1.5">
                      <li><span className="font-medium text-foreground">Workday:</span> Section headers, keyword extraction, date parsing</li>
                      <li><span className="font-medium text-foreground">Greenhouse:</span> Skills matching, experience scoring</li>
                      <li><span className="font-medium text-foreground">Lever:</span> Contact info validation, formatting rules</li>
                      <li><span className="font-medium text-foreground">Taleo:</span> Keyword density, job title matching</li>
                      <li><span className="font-medium text-foreground">iCIMS:</span> Education parsing, certification detection</li>
                    </ul>
                    <div className="mt-3 pt-2 border-t border-border/50">
                      <Link 
                        to="/methodology" 
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      >
                        See full methodology
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Mobile-first: Clear step indicator */}
            <div className="sm:hidden mb-6 p-4 rounded-xl bg-card/60 border border-border/50 text-left">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">How it works:</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-success text-success-foreground text-xs font-bold flex items-center justify-center">1</span>
                  <span className="text-sm">Upload your resume below</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs font-bold flex items-center justify-center">2</span>
                  <span className="text-sm text-muted-foreground">Get instant AI analysis</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs font-bold flex items-center justify-center">3</span>
                  <span className="text-sm text-muted-foreground">See what to fix</span>
                </div>
              </div>
            </div>
          </div>

          {/* A/B Test: Social proof ABOVE CTA for 'above_fold' variant */}
          {socialProofVariant === 'above_fold' && (
            <div className="mb-6 animate-fade-in" style={{ animationDelay: "0.08s" }}>
              <SocialProofBlock variant="full" />
            </div>
          )}
          
          {/* A/B Test: Compact social proof INLINE for 'inline_hero' variant */}
          {socialProofVariant === 'inline_hero' && (
            <div className="mb-6 animate-fade-in" style={{ animationDelay: "0.08s" }}>
              <SocialProofBlock variant="compact" />
            </div>
          )}

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
                <Target className="w-4 h-4 text-success" />
                {t('hero.unlimitedJobs', 'Unlimited job matches')}
              </span>
              <span className="hidden sm:block w-1 h-1 rounded-full bg-muted-foreground/30" />
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

            {/* A/B Test: Social proof AFTER CTA for 'control' variant only */}
            {socialProofVariant === 'control' && (
              <>
                {/* Anonymous testimonials */}
                <div className="mt-6 grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
                  <div className="px-4 py-3 rounded-xl bg-card/40 border border-border/30">
                    <p className="text-sm text-muted-foreground italic">
                      {t('hero.testimonial', '"This is a very wonderful product. I have just gone through the freemium features & I can confidently say it\'s going to be a big success."')}
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-2">— {t('hero.testimonialAuthor1', 'Sarah K.')}</p>
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-card/40 border border-border/30">
                    <p className="text-sm text-muted-foreground italic">
                      "{t('hero.testimonial2', 'Service is super helpful and useful.')}"
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-2">— {t('hero.testimonialAuthor2', 'Marcus T.')}</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Live counter - always show for control, but already shown above for other variants */}
          {socialProofVariant === 'control' && (
            <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
              <LiveActivityCounter />
            </div>
          )}

          {/* Trusted by companies - hide on mobile to reduce clutter */}
          <div className="mt-8 animate-fade-in hidden sm:block" style={{ animationDelay: "0.18s" }}>
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

          {/* Sample Report Preview - Shows exactly what users will get */}
          <div className="mt-10 sm:mt-12 pt-8 border-t border-border/30 animate-fade-in" style={{ animationDelay: "0.2s" }}>
            <SampleReportPreview />
          </div>

          {/* Pricing Teaser Banner */}
          <div className="mt-10 animate-fade-in hidden sm:block" style={{ animationDelay: "0.22s" }}>
            <Link 
              to="/pricing"
              className="group inline-flex items-center gap-3 px-6 py-3 rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 hover:border-primary/40 hover:bg-primary/15 transition-all"
            >
              <Package className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-foreground">
                Need more than a scan? <span className="text-primary">Explore Resume Packages</span>
              </span>
              <ArrowRight className="w-4 h-4 text-primary group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          {/* Mobile: Direct scroll hint + Pricing teaser */}
          <div className="mt-6 sm:hidden animate-fade-in space-y-4" style={{ animationDelay: "0.2s" }}>
            <button
              onClick={handleFreeScanClick}
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto"
            >
              <span>Scroll to upload</span>
              <svg className="w-4 h-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
            
            {/* Mobile Pricing Teaser */}
            <Link 
              to="/pricing"
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20 active:bg-primary/20 transition-colors mx-auto"
            >
              <Package className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">
                View All Packages
              </span>
              <ArrowRight className="w-4 h-4 text-primary" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
