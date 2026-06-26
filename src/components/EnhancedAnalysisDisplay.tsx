import { cn } from "@/lib/utils";
import { 
  Target, Users, FileText, CheckCircle2, AlertTriangle, 
  Briefcase, TrendingUp, MessageSquare, Lightbulb, 
  Mail, Phone, Globe, MapPin, HelpCircle, X
} from "lucide-react";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { IndustryConfidenceIndicator } from "./IndustryConfidenceIndicator";

// Resume Type Detection Types
export type ResumeType = 'chronological' | 'executive_summary' | 'ats_optimized' | 'outreach_referral' | 'hybrid';

export interface ResumeTypeResult {
  type: ResumeType;
  label: string;
  description: string;
  atsRelevance: 'high' | 'medium' | 'low';
  scoringAdjustment: string;
}

// Dual Score Types
export interface DualScore {
  atsCompatibility: number;
  recruiterImpact: number;
  atsNote: string;
  recruiterNote: string;
}

// Calibrated Language Types
export interface CalibratedLanguage {
  headline: string;
  overallTone: 'warning' | 'optimization' | 'praise';
  scoreContext: string;
}

// Usage Recommendation Types
export interface UsageRecommendation {
  channel: string;
  suitability: 'excellent' | 'good' | 'limited' | 'not_recommended';
  note: string;
}

// Credibility Issue Types
export interface CredibilityIssue {
  type: 'date_inconsistency' | 'timeline_overlap' | 'impossible_timeline' | 'gap';
  severity: 'high' | 'medium' | 'low';
  description: string;
  location?: string;
}

// Content Location Types
export interface ContentLocation {
  exists: boolean;
  locations: string[];
  suggestion: string;
}

// Industry Detection Types
export interface IndustryDetection {
  detected: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
  aiSuggested?: string;
}

interface EnhancedAnalysisDisplayProps {
  resumeType?: ResumeTypeResult;
  seniorityLevel?: string;
  dualScore?: DualScore;
  calibratedLanguage?: CalibratedLanguage;
  usageRecommendations?: UsageRecommendation[];
  credibilityIssues?: CredibilityIssue[];
  contentLocations?: {
    quota?: ContentLocation;
    metrics?: ContentLocation;
  };
  industryDetection?: IndustryDetection;
  industry?: string;
  candidateName?: string | null;
  onIndustryChange?: (newIndustry: string) => void;
  resumeTextLength?: number;
  visitorId?: string;
}

// Mobile-friendly tooltip
const InfoTooltip = ({ title, description }: { title: string; description: string }) => {
  const [showMobile, setShowMobile] = useState(false);
  const isMobile = useIsMobile();
  
  if (isMobile) {
    return (
      <div className="relative inline-block">
        <button
          onClick={() => setShowMobile(!showMobile)}
          className="p-1 -m-1 touch-manipulation"
          aria-label={`Learn about ${title}`}
        >
          <HelpCircle className="w-3 h-3 text-muted-foreground/50" />
        </button>
        {showMobile && (
          <div className="absolute z-50 left-0 top-6 w-64 p-3 rounded-xl bg-card border border-border shadow-lg animate-fade-in">
            <button 
              onClick={() => setShowMobile(false)}
              className="absolute top-2 right-2 p-1 text-muted-foreground"
              aria-label="Close"
            >
              <X className="w-3 h-3" />
            </button>
            <p className="font-semibold text-foreground mb-1 pr-4">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        )}
      </div>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="w-3 h-3 text-muted-foreground/50 hover:text-muted-foreground cursor-help transition-colors" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] p-3">
        <p className="font-semibold text-foreground mb-1">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export function EnhancedAnalysisDisplay({
  resumeType,
  seniorityLevel,
  dualScore,
  calibratedLanguage,
  usageRecommendations,
  credibilityIssues,
  contentLocations,
  industryDetection,
  industry,
  candidateName,
  onIndustryChange,
  resumeTextLength,
  visitorId
}: EnhancedAnalysisDisplayProps) {
  if (!dualScore && !resumeType && !usageRecommendations && !industryDetection && !industry) {
    return null;
  }

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-success";
    if (score >= 50) return "text-warning";
    return "text-destructive";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 70) return "bg-success/10 border-success/20";
    if (score >= 50) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getSuitabilityIcon = (suitability: UsageRecommendation['suitability']) => {
    switch (suitability) {
      case 'excellent':
        return <CheckCircle2 className="w-4 h-4 text-success" />;
      case 'good':
        return <CheckCircle2 className="w-4 h-4 text-warning" />;
      case 'limited':
        return <AlertTriangle className="w-4 h-4 text-warning" />;
      case 'not_recommended':
        return <AlertTriangle className="w-4 h-4 text-destructive" />;
    }
  };

  const getSuitabilityLabel = (suitability: UsageRecommendation['suitability']) => {
    switch (suitability) {
      case 'excellent':
        return 'Excellent';
      case 'good':
        return 'Good';
      case 'limited':
        return 'Limited';
      case 'not_recommended':
        return 'Not Recommended';
    }
  };

  const getResumeTypeIcon = (type: ResumeType) => {
    switch (type) {
      case 'chronological':
        return <FileText className="w-5 h-5 text-primary" />;
      case 'executive_summary':
        return <Briefcase className="w-5 h-5 text-primary" />;
      case 'ats_optimized':
        return <Target className="w-5 h-5 text-success" />;
      case 'outreach_referral':
        return <Mail className="w-5 h-5 text-primary" />;
      case 'hybrid':
        return <TrendingUp className="w-5 h-5 text-success" />;
      default:
        return <FileText className="w-5 h-5 text-primary" />;
    }
  };

  const getToneStyle = (tone: CalibratedLanguage['overallTone']) => {
    switch (tone) {
      case 'praise':
        return 'from-success/10 to-success/5 border-success/30';
      case 'optimization':
        return 'from-primary/10 to-primary/5 border-primary/30';
      case 'warning':
        return 'from-warning/10 to-warning/5 border-warning/30';
    }
  };

  return (
    <div className="space-y-4 mb-6">
      {/* Industry Detection with Confidence and Correction */}
      {(industryDetection || industry) && (
        <IndustryConfidenceIndicator
          industry={industryDetection?.detected || industry || 'general'}
          industryDetection={industryDetection}
          onIndustryChange={onIndustryChange}
          resumeTextLength={resumeTextLength}
          visitorId={visitorId}
        />
      )}

      {/* Resume Type & Calibrated Language Header */}
      {(resumeType || calibratedLanguage) && (
        <div className={cn(
          "rounded-2xl bg-gradient-to-r border p-5",
          calibratedLanguage ? getToneStyle(calibratedLanguage.overallTone) : 'from-primary/10 to-primary/5 border-primary/30'
        )}>
          {/* Resume Type Badge */}
          {resumeType && (
            <div className="flex items-center gap-3 mb-3">
              {getResumeTypeIcon(resumeType.type)}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground">{resumeType.label}</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    resumeType.atsRelevance === 'high' ? 'bg-success/20 text-success' :
                    resumeType.atsRelevance === 'medium' ? 'bg-warning/20 text-warning' :
                    'bg-muted text-muted-foreground'
                  )}>
                    ATS Relevance: {resumeType.atsRelevance}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{resumeType.description}</p>
              </div>
            </div>
          )}

          {/* Calibrated Language */}
          {calibratedLanguage && (
            <div className="pt-3 border-t border-border/30">
              <h4 className="font-bold text-lg mb-1">
                {calibratedLanguage.headline}
              </h4>
              <p className="text-sm text-muted-foreground">
                {calibratedLanguage.scoreContext}
              </p>
            </div>
          )}

          {/* Resume Type Scoring Note */}
          {resumeType && resumeType.scoringAdjustment && (
            <div className="mt-3 p-3 rounded-xl bg-background/50 border border-border/30">
              <div className="flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  {resumeType.scoringAdjustment}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dual Scoring - ATS vs Recruiter */}
      {dualScore && (
        <div className="grid grid-cols-2 gap-3">
          {/* ATS Compatibility Score */}
          <div className={cn("rounded-2xl border p-4", getScoreBgColor(dualScore.atsCompatibility))}>
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-primary" />
              <p className="text-sm font-medium text-foreground flex-1">ATS Compatibility</p>
              <InfoTooltip 
                title="ATS Compatibility Score" 
                description="Measures how well your resume will parse through job portal systems like Workday, Greenhouse, and Lever. Higher is better for online applications."
              />
            </div>
            <p className={cn("text-3xl font-bold", getScoreColor(dualScore.atsCompatibility))}>
              {dualScore.atsCompatibility}<span className="text-lg text-muted-foreground">/100</span>
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {dualScore.atsNote}
            </p>
          </div>

          {/* Recruiter Impact Score */}
          <div className={cn("rounded-2xl border p-4", getScoreBgColor(dualScore.recruiterImpact))}>
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-primary" />
              <p className="text-sm font-medium text-foreground flex-1">Recruiter Impact</p>
              <InfoTooltip 
                title="Recruiter Impact Score" 
                description="Measures how compelling your resume is to human recruiters. Factors in quantified achievements, outcome language, and professional presentation."
              />
            </div>
            <p className={cn("text-3xl font-bold", getScoreColor(dualScore.recruiterImpact))}>
              {dualScore.recruiterImpact}<span className="text-lg text-muted-foreground">/100</span>
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {dualScore.recruiterNote}
            </p>
          </div>
        </div>
      )}

      {/* Credibility Issues - High Priority */}
      {credibilityIssues && credibilityIssues.length > 0 && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <h4 className="font-bold text-foreground">Credibility Flags</h4>
            <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive font-medium">
              High Priority
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            These issues may raise red flags with recruiters and should be addressed first.
          </p>
          <div className="space-y-2">
            {credibilityIssues.map((issue, idx) => (
              <div key={idx} className={cn(
                "flex items-start gap-3 p-3 rounded-xl border",
                issue.severity === 'high' ? 'bg-destructive/10 border-destructive/20' :
                issue.severity === 'medium' ? 'bg-warning/10 border-warning/20' :
                'bg-muted/50 border-border'
              )}>
                <div className={cn(
                  "p-1.5 rounded-full mt-0.5",
                  issue.severity === 'high' ? 'bg-destructive/20' :
                  issue.severity === 'medium' ? 'bg-warning/20' :
                  'bg-muted'
                )}>
                  <AlertTriangle className={cn(
                    "w-3 h-3",
                    issue.severity === 'high' ? 'text-destructive' :
                    issue.severity === 'medium' ? 'text-warning' :
                    'text-muted-foreground'
                  )} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{issue.description}</p>
                  {issue.location && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Found: {issue.location}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Location Insights */}
      {contentLocations && (contentLocations.quota?.exists || contentLocations.metrics?.exists) && (
        <div className="rounded-2xl border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h4 className="font-bold text-foreground">Content Insights</h4>
          </div>
          <div className="space-y-2">
            {contentLocations.quota?.exists && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-success/5 border border-success/20">
                <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">Quota/Revenue Data Found</p>
                  <p className="text-xs text-muted-foreground">
                    {contentLocations.quota.suggestion}
                  </p>
                  {contentLocations.quota.locations.length > 0 && (
                    <p className="text-xs text-primary mt-1">
                      Located in: {contentLocations.quota.locations.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            )}
            {contentLocations.metrics?.exists && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-success/5 border border-success/20">
                <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">Quantified Metrics Found</p>
                  <p className="text-xs text-muted-foreground">
                    {contentLocations.metrics.suggestion}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Usage Recommendations */}
      {usageRecommendations && usageRecommendations.length > 0 && (
        <div className="rounded-2xl border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-5 h-5 text-primary" />
            <h4 className="font-bold text-foreground">Best Uses for This Resume</h4>
            <InfoTooltip 
              title="Usage Recommendations" 
              description="Different resume formats work better for different channels. This shows where your resume will perform best."
            />
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {candidateName ? `${candidateName.split(' ')[0]}, here's` : 'Here\'s'} where this resume version works best:
          </p>
          <div className="grid grid-cols-2 gap-2">
            {usageRecommendations.map((rec, idx) => (
              <div key={idx} className={cn(
                "flex items-start gap-2 p-3 rounded-xl border",
                rec.suitability === 'excellent' ? 'bg-success/5 border-success/20' :
                rec.suitability === 'good' ? 'bg-primary/5 border-primary/20' :
                rec.suitability === 'limited' ? 'bg-warning/5 border-warning/20' :
                'bg-destructive/5 border-destructive/20'
              )}>
                {getSuitabilityIcon(rec.suitability)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{rec.channel}</p>
                  <p className={cn(
                    "text-xs font-medium",
                    rec.suitability === 'excellent' ? 'text-success' :
                    rec.suitability === 'good' ? 'text-primary' :
                    rec.suitability === 'limited' ? 'text-warning' :
                    'text-destructive'
                  )}>
                    {getSuitabilityLabel(rec.suitability)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                    {rec.note}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
