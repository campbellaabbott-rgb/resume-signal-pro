import { useTranslation } from "react-i18next";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Briefcase, ChevronDown, Check, AlertTriangle,
  HelpCircle, X, RefreshCw, Lightbulb, ThumbsUp, ThumbsDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { INDUSTRY_KEYWORDS } from "@/config/industry-keywords";
import { supabase } from "@/integrations/supabase/client";

export interface IndustryDetectionData {
  detected: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
  aiSuggested?: string;
  detectedRole?: string | null;
  seniorityLevel?: string;
  yearsEstimate?: string | null;
  alternativeIndustries?: string[];
  alternativeIndustriesWithReasons?: Array<{ industry: string; reason?: string }>;
  educationSignals?: string[];
  subRole?: string;
  techStack?: string[];
}

interface IndustryConfidenceIndicatorProps {
  industry: string;
  industryDetection?: IndustryDetectionData;
  onIndustryChange?: (newIndustry: string) => void;
  className?: string;
  resumeTextLength?: number;
  visitorId?: string;
}

// Format industry name for display
const formatIndustryName = (ind: string): string => {
  const industryLabels: Record<string, string> = {
    technology: 'Technology',
    software: 'Software/Tech',
    sales: 'Sales',
    business_development: 'Business Development',
    marketing: 'Marketing',
    finance: 'Finance',
    healthcare: 'Healthcare',
    legal: 'Legal',
    consulting: 'Consulting',
    hr: 'Human Resources',
    human_resources: 'Human Resources',
    humanResources: 'Human Resources',
    engineering: 'Engineering',
    education: 'Education',
    creative: 'Creative/Design',
    design: 'Design',
    retail: 'Retail',
    hospitality: 'Hospitality',
    manufacturing: 'Manufacturing',
    government: 'Government',
    operations: 'Operations',
    dataScience: 'Data Science',
    data_science: 'Data Science',
    projectManagement: 'Project Management',
    project_management: 'Project Management',
    customerService: 'Customer Service',
    customer_service: 'Customer Service',
    real_estate: 'Real Estate',
    realEstate: 'Real Estate',
    nonprofit: 'Nonprofit',
    general: 'General',
    other: 'Other'
  };
  
  if (industryLabels[ind]) return industryLabels[ind];
  
  // Convert snake_case to Title Case
  return ind
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Get available industries for correction
const getAvailableIndustries = (): { value: string; label: string }[] => {
  const industries = Object.keys(INDUSTRY_KEYWORDS).map(key => ({
    value: key,
    label: INDUSTRY_KEYWORDS[key].name
  }));
  
  // Add common ones that might not be in the config
  const additionalIndustries = [
    { value: 'business_development', label: 'Business Development' },
    { value: 'real_estate', label: 'Real Estate' },
    { value: 'nonprofit', label: 'Nonprofit' },
    { value: 'government', label: 'Government' },
    { value: 'hospitality', label: 'Hospitality' },
    { value: 'manufacturing', label: 'Manufacturing' },
    { value: 'general', label: 'General / Other' }
  ];
  
  // Merge and dedupe
  const existingValues = new Set(industries.map(i => i.value));
  additionalIndustries.forEach(ind => {
    if (!existingValues.has(ind.value)) {
      industries.push(ind);
    }
  });
  
  return industries.sort((a, b) => a.label.localeCompare(b.label));
};

export function IndustryConfidenceIndicator({
  industry,
  industryDetection,
  onIndustryChange,
  className,
  resumeTextLength,
  visitorId
}: IndustryConfidenceIndicatorProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const getConfidenceConfig = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high':
        return {
          icon: Check,
          label: t('industryConfidence.confidenceHigh'),
          shortLabel: t('industryConfidence.highShort'),
          bgColor: 'bg-success/10',
          borderColor: 'border-success/30',
          textColor: 'text-success',
          description: t('industryConfidence.highDesc')
        };
      case 'medium':
        return {
          icon: HelpCircle,
          label: t('industryConfidence.confidenceMedium'),
          shortLabel: t('industryConfidence.mediumShort'),
          bgColor: 'bg-warning/10',
          borderColor: 'border-warning/30',
          textColor: 'text-warning',
          description: t('industryConfidence.mediumDesc')
        };
      case 'low':
        return {
          icon: AlertTriangle,
          label: t('industryConfidence.confidenceLow'),
          shortLabel: t('industryConfidence.lowShort'),
          bgColor: 'bg-muted',
          borderColor: 'border-border',
          textColor: 'text-muted-foreground',
          description: t('industryConfidence.lowDesc')
        };
    }
  };

  const confidence = industryDetection?.confidence || 'medium';
  const signals = industryDetection?.signals || [];
  const aiSuggested = industryDetection?.aiSuggested;
  const detectedRole = industryDetection?.detectedRole;
  const seniorityLevel = industryDetection?.seniorityLevel;
  const yearsEstimate = industryDetection?.yearsEstimate;
  const alternativeIndustries = industryDetection?.alternativeIndustries || [];
  const alternativeIndustriesWithReasons = industryDetection?.alternativeIndustriesWithReasons || [];
  const techStack = industryDetection?.techStack || [];
  const educationSignals = industryDetection?.educationSignals || [];
  const config = getConfidenceConfig(confidence);
  const availableIndustries = getAvailableIndustries();

  const seniorityLabel: Record<string, string> = {
    entry: 'Entry-level', mid: 'Mid-level', senior: 'Senior', executive: 'Executive',
  };

  // Inline feedback state — "Is this right?"
  // null = not answered, true = confirmed correct, false = wants to correct
  const [feedbackGiven, setFeedbackGiven] = useState<boolean | null>(null);

  const handleConfirm = async () => {
    setFeedbackGiven(true);
    // Log a "confirmed correct" correction where original === corrected
    try {
      await supabase.rpc('log_industry_correction', {
        p_original_industry: industry,
        p_corrected_industry: industry,
        p_original_confidence: confidence,
        p_detection_source: 'user_confirmed',
        p_resume_text_length: resumeTextLength || null,
        p_server_signals: signals.length > 0 ? signals : null,
        p_ai_suggested_industry: aiSuggested || null,
        p_visitor_id: visitorId || null
      });
    } catch { /* non-blocking */ }
  };
  
  const handleCorrection = async (newIndustry: string) => {
    // Log the correction for improving detection algorithm
    try {
      await supabase.rpc('log_industry_correction', {
        p_original_industry: industry,
        p_corrected_industry: newIndustry,
        p_original_confidence: confidence,
        p_detection_source: industryDetection ? 'server' : 'fallback',
        p_resume_text_length: resumeTextLength || null,
        p_server_signals: signals.length > 0 ? signals : null,
        p_ai_suggested_industry: aiSuggested || null,
        p_visitor_id: visitorId || null
      });
      console.log('[IndustryCorrection] Logged correction:', industry, '->', newIndustry);
    } catch (err) {
      console.error('[IndustryCorrection] Failed to log:', err);
    }
    
    setSelectedIndustry(newIndustry);
    onIndustryChange?.(newIndustry);
    setShowCorrection(false);
    setIsExpanded(false);
  };
  
  // Show different treatment based on confidence
  const showWarning = confidence === 'low' || confidence === 'medium';
  const displayIndustry = selectedIndustry || industry;
  
  return (
    <div className={cn("rounded-2xl border transition-all duration-300", className, 
      showWarning && !selectedIndustry 
        ? `${config.bgColor} ${config.borderColor}`
        : 'bg-primary/5 border-primary/20'
    )}>
      {/* Main Header */}
      <div 
        className="p-4 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-xl", config.bgColor)}>
              <Briefcase className={cn("w-5 h-5", config.textColor)} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">{t("industryConfidence.industry")} </span>
                <span className="font-bold text-foreground text-lg">
                  {formatIndustryName(displayIndustry)}
                </span>
                {selectedIndustry && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success font-medium">
                    Corrected
                  </span>
                )}
              </div>
              {/* Role + seniority — shown when available, makes detection feel specific */}
              {(detectedRole || seniorityLevel) && (
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {seniorityLevel && seniorityLabel[seniorityLevel] && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {seniorityLabel[seniorityLevel]}
                    </span>
                  )}
                  {detectedRole && (
                    <span className="text-xs text-muted-foreground truncate max-w-[220px]" title={detectedRole}>
                      {detectedRole}
                    </span>
                  )}
                  {yearsEstimate && (
                    <span className="text-xs text-muted-foreground">· {yearsEstimate}</span>
                  )}
                </div>
              )}
              {/* Tech stack badges — only for tech-family roles */}
              {techStack.length > 0 && (
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {techStack.map((t, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium border border-primary/20">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {/* Education credential badges */}
              {educationSignals.length > 0 && (
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {educationSignals.slice(0, 2).map((s, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-medium border border-success/20">
                      {s.replace('Degree: ', '').replace('Credential: ', '')}
                    </span>
                  ))}
                </div>
              )}
              {/* Top 2 signals always visible — builds trust without requiring expand */}
              {signals.length > 0 && (
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {signals.slice(0, 2).map((s, i) => (
                    <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground">
                      {s}
                    </span>
                  ))}
                  {signals.length > 2 && (
                    <span className="text-xs text-muted-foreground">+{signals.length - 2} more</span>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Confidence Badge */}
            <span className={cn(
              "text-xs px-2.5 py-1 rounded-full font-medium border",
              config.bgColor, config.borderColor, config.textColor
            )}>
              {config.shortLabel}
            </span>
            
            {/* Expand/Collapse */}
            <ChevronDown className={cn(
              "w-4 h-4 text-muted-foreground transition-transform duration-200",
              isExpanded && "rotate-180"
            )} />
          </div>
        </div>
        
        {/* Inline "Is this right?" feedback — always visible, no expand needed */}
        {!selectedIndustry && feedbackGiven === null && (
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Is this right?</span>
            <button
              onClick={(e) => { e.stopPropagation(); handleConfirm(); }}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-success/40 text-success hover:bg-success/10 transition-colors"
            >
              <ThumbsUp className="w-3 h-3" /> Yes
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setFeedbackGiven(false); setIsExpanded(true); setShowCorrection(true); }}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-muted text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors"
            >
              <ThumbsDown className="w-3 h-3" /> No
            </button>
          </div>
        )}
        {!selectedIndustry && feedbackGiven === true && (
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-success">
            <Check className="w-3.5 h-3.5" /> Got it — thanks for confirming!
          </div>
        )}

        {/* Warning for low/medium confidence */}
        {showWarning && !selectedIndustry && feedbackGiven === null && (
          <div className="mt-2 flex items-start gap-2">
            <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", config.textColor)} />
            <p className="text-xs text-muted-foreground">
              {confidence === 'low'
                ? t("industryConfidence.lowWarning")
                : t("industryConfidence.mediumWarning")
              }
            </p>
          </div>
        )}
      </div>
      
      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-border/30 pt-3 space-y-3 animate-fade-in">
          {/* All detection signals (expanded — first 2 already shown above the fold) */}
          {signals.length > 2 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">All detection signals:</p>
              <div className="flex flex-wrap gap-1.5">
                {signals.map((signal, idx) => (
                  <span key={idx} className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                    {signal}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Alternative industries — quick switches with reason strings */}
          {(alternativeIndustriesWithReasons.length > 0 || alternativeIndustries.length > 0) && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Also considered:</p>
              <div className="space-y-1.5">
                {(alternativeIndustriesWithReasons.length > 0 ? alternativeIndustriesWithReasons : alternativeIndustries.map(a => ({ industry: a, reason: undefined }))).map((alt, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); handleCorrection(alt.industry); }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-colors group"
                  >
                    <div>
                      <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                        {formatIndustryName(alt.industry)}
                      </span>
                      {alt.reason && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{alt.reason}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">Switch →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI Suggestion (if different) */}
          {aiSuggested && aiSuggested !== industry && (
            <div className="p-3 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">{t("industryConfidence.aiSuggested", { industry: formatIndustryName(aiSuggested) })}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Click below to change if this is more accurate.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Confidence Explanation */}
          <div className="p-3 rounded-xl bg-muted/50">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">{config.label}: </span>
              {config.description}
            </p>
          </div>
          
          {/* Correction Section */}
          {!showCorrection ? (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowCorrection(true);
              }}
              className="w-full gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              {confidence === 'low' ? t('industryConfidence.correctIndustry') : t('industryConfidence.changeIndustry')}
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{t("industryConfidence.selectCorrect")}</p>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCorrection(false);
                  }}
                  className="p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                {availableIndustries.map((ind) => (
                  <button
                    key={ind.value}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCorrection(ind.value);
                    }}
                    className={cn(
                      "px-3 py-2 text-xs rounded-lg border text-left transition-all",
                      ind.value === displayIndustry
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card hover:bg-muted border-border hover:border-primary/50"
                    )}
                  >
                    {ind.label}
                  </button>
                ))}
              </div>
              
              {/* Quick suggestion if AI suggested different */}
              {aiSuggested && aiSuggested !== industry && aiSuggested !== selectedIndustry && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCorrection(aiSuggested);
                  }}
                  className="w-full gap-2 border-primary/50 text-primary"
                >
                  <Check className="w-4 h-4" />
                  Use AI suggestion: {formatIndustryName(aiSuggested)}
                </Button>
              )}
            </div>
          )}
          
          {/* Impact Notice */}
          <p className="text-xs text-center text-muted-foreground">
            Changing industry will update keyword recommendations and benchmarks.
          </p>
        </div>
      )}
    </div>
  );
}
