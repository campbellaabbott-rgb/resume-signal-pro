import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { FileText, Zap, Target, AlertTriangle, Shield, Clock, Star, Sparkles, Info, X, ArrowRight, Package, Award, Check, ScanSearch, Globe2, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { useIsMobile } from "@/hooks/use-mobile";
import { PRODUCTS } from "@/config/products";
import { useABTest } from "@/hooks/use-ab-test";
import { SampleReportPreview } from "./SampleReportPreview";

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

// Live scan totals from the corpus (all-time scans conducted + countries),
// via the aggregate-only get_scan_totals RPC. Fetched on mount, refreshed
// every 30s while the tab is visible, and immediately when a scan completes
// on this page (Index dispatches "scan-completed"). Renders nothing until
// real numbers arrive — no hardcoded or invented counts, ever.
function useScanTotals() {
  const [totals, setTotals] = useState<{ total_scans: number; countries: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // When the RPC doesn't exist yet (migration not published), every visitor
    // would otherwise re-poll a guaranteed 404 every 30s for their whole
    // session — stop permanently on the first "function not found".
    let gone = false;
    const load = () => {
      if (document.hidden || gone) return;
      // RPC created in migration 20260706200000; not yet in generated client types.
      (supabase.rpc as unknown as (fn: string) => PromiseLike<{ data: unknown; error: unknown }>)(
        "get_scan_totals"
      ).then(
        ({ data, error }) => {
          const err = error as { code?: string } | null;
          if (err?.code === "PGRST202") { gone = true; return; }
          const d = data as { total_scans?: number; countries?: number } | null;
          if (!cancelled && !error && typeof d?.total_scans === "number" && d.total_scans > 0) {
            setTotals({ total_scans: d.total_scans, countries: d.countries ?? 0 });
          }
        },
        () => {}
      );
    };
    load();
    const interval = setInterval(load, 30_000);
    window.addEventListener("scan-completed", load);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("scan-completed", load);
    };
  }, []);

  return totals;
}

// Hero stats bar — verifiable product facts, not manufactured social proof.
// Every number here is checkable in the product itself (industry list, scan
// report, language picker), which is what actually builds credibility.
function HeroStatsBar() {
  const { t } = useTranslation();
  const totals = useScanTotals();

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 py-3 px-4 rounded-2xl bg-gradient-to-r from-card/80 via-card/60 to-card/80 border border-border/40 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/20">
          <Target className="w-4 h-4 text-primary" />
        </div>
        <div className="text-left">
          <p className="text-lg sm:text-xl font-bold text-foreground">59</p>
          <p className="text-xs text-muted-foreground">{t('hero.stats.industriesCovered', 'Industries covered')}</p>
        </div>
      </div>
      <div className="w-px h-10 bg-border/50 hidden sm:block" />
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-success/20">
          <FileText className="w-4 h-4 text-success" />
        </div>
        <div className="text-left">
          <p className="text-lg sm:text-xl font-bold text-foreground">24+</p>
          <p className="text-xs text-muted-foreground">{t('hero.stats.checksPerScan', 'Checks per scan')}</p>
        </div>
      </div>
      <div className="w-px h-10 bg-border/50 hidden sm:block" />
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-warning/20">
          <Award className="w-4 h-4 text-warning" />
        </div>
        <div className="text-left">
          <p className="text-lg sm:text-xl font-bold text-foreground">10</p>
          <p className="text-xs text-muted-foreground">{t('hero.stats.languagesSupported', 'Languages supported')}</p>
        </div>
      </div>
      {totals && (
        <>
          <div className="w-px h-10 bg-border/50 hidden sm:block" />
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/20">
              <ScanSearch className="w-4 h-4 text-primary" />
            </div>
            <div className="text-left">
              <p className="text-lg sm:text-xl font-bold text-foreground tabular-nums">{totals.total_scans.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{t('hero.stats.resumesScanned', 'Resumes scanned')}</p>
            </div>
          </div>
          {totals.countries > 1 && (
            <>
              <div className="w-px h-10 bg-border/50 hidden sm:block" />
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-success/20">
                  <Globe2 className="w-4 h-4 text-success" />
                </div>
                <div className="text-left">
                  <p className="text-lg sm:text-xl font-bold text-foreground tabular-nums">{totals.countries.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{t('hero.stats.countries', 'Countries')}</p>
                </div>
              </div>
            </>
          )}
        </>
      )}
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

export function Hero({ onFileSelect }: { onFileSelect?: (file: File) => void | Promise<void> }) {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const isMobile = useIsMobile();
  const [showAtsInfo, setShowAtsInfo] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  
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

    // Board-first: the job board is the headline product, the free scan is the
    // companion step. One change here covers every hero A/B variant, since
    // they all render CTAs through this helper.
    return (
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 w-full sm:w-auto">
        <Link
          to="/jobs"
          onClick={() => {
            trackSocialProof({ action: 'browse_jobs_cta_click' });
            trackLayout({ action: 'browse_jobs_cta_click', layout: layoutVariant });
          }}
          className={`group relative w-full sm:w-auto inline-flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-primary via-primary to-blue-500 text-primary-foreground font-bold shadow-xl shadow-primary/30 hover:shadow-2xl hover:shadow-primary/40 active:scale-[0.98] transition-all duration-300 touch-manipulation ${sizeClasses[size]}`}
        >
          <Briefcase className={iconSize[size]} />
          <span>{t('hero.browseJobs', 'Browse 450,000+ verified jobs')}</span>
        </Link>
        <button
          onClick={handleFreeScanClick}
          className={`group relative w-full sm:w-auto inline-flex items-center justify-center gap-3 rounded-2xl border-2 border-success/60 bg-success/10 text-success font-bold hover:bg-success/20 active:scale-[0.98] transition-all duration-300 touch-manipulation ${sizeClasses[size]}`}
        >
          <Sparkles className={iconSize[size]} />
          <span>{t('hero.ctaButton', 'Scan my resume free')}</span>
          <div className={`absolute rounded-full bg-primary text-primary-foreground font-bold shadow-lg ${badgeClasses[size]}`}>
            {t('hero.freeBadge', 'FREE')}
          </div>
        </button>
      </div>
    );
  };

  // Handle a resume dropped/picked directly in the hero — visitors get to the
  // product without a single scroll, which is the point of putting it here.
  const handleHeroFile = (file: File | undefined | null) => {
    if (!file || !onFileSelect) return;
    trackSocialProof({ action: 'hero_dropzone_upload' });
    trackLayout({ action: 'hero_dropzone_upload', layout: layoutVariant });
    void onFileSelect(file);
    // Bring the uploader (with the loaded file, intent chips, and scan button)
    // into view so the next step is obvious.
    setTimeout(() => {
      document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  // Render the drop zone directly under the CTA (all variants)
  const renderDropZone = () => {
    if (!onFileSelect) return null;
    return (
      <>
      <label
        className={`mt-3 flex w-full sm:max-w-md mx-auto cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-3 text-xs sm:text-sm transition-colors ${
          isDragOver
            ? 'border-success bg-success/10 text-foreground'
            : 'border-border text-muted-foreground hover:border-success/60 hover:text-foreground'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          handleHeroFile(e.dataTransfer.files?.[0]);
        }}
      >
        <FileText className="w-4 h-4 shrink-0" />
        <span>
          {isDragOver
            ? t('hero.dropzoneActive', 'Drop it — scanning is seconds away')
            : t('hero.dropzone', 'Or drop your resume here — PDF, DOCX, or TXT')}
        </span>
        <input
          type="file"
          accept=".pdf,.docx,.doc,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={(e) => {
            handleHeroFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {/* First-viewport answer to the question every visitor silently asks,
          plus the front door to the live job board (all hero variants). */}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Link
          to="/jobs"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-primary/40 bg-primary/10 text-primary text-xs sm:text-sm font-semibold hover:bg-primary/20 transition-colors"
        >
          <Briefcase className="w-3.5 h-3.5" />
          {t('hero.jobsCta', 'Live job board — check your fit before you apply →')}
        </Link>
        <button
          onClick={() => {
            trackLayout({ action: 'why_not_chatgpt_click', layout: layoutVariant });
            document.getElementById('why-not-chatgpt')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-primary/40 bg-primary/10 text-primary text-xs sm:text-sm font-semibold hover:bg-primary/20 transition-colors"
        >
          Why use this instead of ChatGPT or Claude? →
        </button>
      </div>
      </>
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
      {/* The anti-chatbot wedge, stated where every variant's CTA renders:
          what a ChatGPT/Claude answer structurally isn't. */}
      <span className="basis-full text-center text-[11px] sm:text-xs text-primary/90 font-medium mt-1">
        {t('hero.measureStrip', 'Measurements, not opinions · Every quote verified · A score that shows its work')}
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
                {t('hero.headline.get', 'The job board with')}{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-success via-emerald-400 to-success">
                  {t('hero.headline.recruiterGrade', 'zero ghost jobs')}
                </span>{" "}
                {t('hero.headline.feedback', '— 450,000+ verified openings, matched to your resume')}
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
                {t('hero.socialFirst.subheading')}
              </p>
            </div>

            {/* CTA */}
            <div className="mb-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              {renderCTA('md')}
              {renderDropZone()}
              {renderTrustIndicators()}
            </div>

            {/* Transparency strip — verifiable facts beat manufactured activity feeds */}
            <div className="animate-fade-in flex justify-center" style={{ animationDelay: "0.15s" }}>
              <Link
                to="/methodology"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card/60 border border-border/40 hover:border-primary/40 transition-colors"
              >
                <Shield className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">
                  {t('hero.seeMethodology', 'See our methodology')} — {t('hero.transparentScoring', 'transparent AI scoring, no black box')}
                </span>
                <ArrowRight className="w-3 h-3 text-primary" />
              </Link>
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
                {t('hero.headline.get', 'The job board with')}{" "}
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
              {renderDropZone()}
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
          
          {/* VALUE-FIRST HEADLINE - Always show. The stats bar, benefit
              bullets, and chips render BELOW the CTA so the scan entry point
              is visible without scrolling. */}
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
              {t('hero.headline.get', 'The job board with')}{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-success via-emerald-400 to-success">
                {t('hero.headline.recruiterGrade', 'zero ghost jobs')}
              </span>{" "}
              {t('hero.headline.feedback', '— 450,000+ verified openings, matched to your resume')}
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

          </div>

          {/* PRIMARY CTA - Large and unmissable, directly under the headline */}
          <div className={`animate-fade-in ${isUltraCompact ? 'mb-3' : isCompactLayout ? 'mb-4' : 'mb-6'}`} style={{ animationDelay: isUltraCompact ? "0.05s" : "0.1s" }}>
            {renderCTA(isUltraCompact ? 'sm' : isCompactLayout ? 'md' : 'lg')}
            {renderDropZone()}
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

          {/* Stats bar — below the CTA on every variant now */}
          <div className="mb-6 animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <HeroStatsBar />
          </div>

          <div className={`animate-fade-in ${isUltraCompact ? 'mb-3' : isCompactLayout ? 'mb-4 sm:mb-6' : 'mb-8'}`} style={{ animationDelay: "0.2s" }}>
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

          {/* Credibility: verifiable product facts only — no invented
              testimonials. Every number here is checkable in the product. */}

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

          {/* How-it-works transparency strip — replaces the implied big-tech
              endorsement wall, which read as fake and undercut trust */}
          <div className="animate-fade-in hidden sm:block" style={{ animationDelay: "0.35s" }}>
            <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-xs text-muted-foreground/70">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-success/70" />
                {t('hero.factGdpr', 'GDPR compliant')}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-success/70" />
                {t('hero.factAutoDelete', 'Resumes auto-deleted within 24h')}
              </span>
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-success/70" />
                {t('hero.factNoStorage', 'Never stored, never shared')}
              </span>
              <Link to="/methodology" className="flex items-center gap-1.5 text-primary/80 hover:text-primary transition-colors">
                <Info className="w-3.5 h-3.5" />
                {t('hero.seeMethodology', 'See our methodology')}
              </Link>
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
