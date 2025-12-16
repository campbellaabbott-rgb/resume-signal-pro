import { useState } from "react";
import { useTranslation } from "react-i18next";
import { 
  Sparkles, ArrowRight, CheckCircle2, Target, Zap, Lock, Mail, Loader2, 
  FileCheck, FileText, AlertTriangle, Type, User, LayoutList, Phone, 
  Trophy, Hash, Pencil, XCircle, CheckCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface KeywordSuggestion {
  keyword: string;
  reason: string;
}

interface ResumeLength {
  currentPages: number;
  recommendedPages: number;
  verdict: "too_short" | "just_right" | "too_long";
}

interface WordCount {
  current: number;
  idealMin: number;
  idealMax: number;
  verdict: "too_few" | "ideal" | "too_many";
}

interface ExperienceLevel {
  level: "entry" | "mid" | "senior" | "executive";
  yearsEstimate: string;
}

interface SectionCheck {
  hasContact: boolean;
  hasSummary: boolean;
  hasExperience: boolean;
  hasEducation: boolean;
  hasSkills: boolean;
  missingSections: string[];
}

interface ContactInfo {
  hasEmail: boolean;
  hasPhone: boolean;
  hasLinkedIn: boolean;
  missingItems: string[];
}

interface TopStrength {
  title: string;
  description: string;
}

interface QuantificationScore {
  score: number;
  verdict: "weak" | "average" | "strong";
  tip: string;
}

interface ActionVerbGrade {
  grade: string;
  issue: string;
}

interface RedFlag {
  issue: string;
  impact: string;
}

interface ReadabilityScore {
  score: number;
  verdict: "hard_to_read" | "readable" | "easy_to_scan";
  issue: string;
}

interface BulletImpactScore {
  score: number;
  verdict: "responsibility_heavy" | "balanced" | "achievement_focused";
  tip: string;
}

interface KeywordDensity {
  level: "sparse" | "moderate" | "dense";
  explanation: string;
}

interface ImprovementPotential {
  level: "low" | "medium" | "high";
  estimatedScoreIncrease: number;
  topPriority: string;
}

interface FreeKeywordResultsProps {
  industry: string;
  atsScoreEstimate: number;
  formatGrade: string;
  formatIssue: string;
  resumeLength: ResumeLength;
  wordCount?: WordCount;
  experienceLevel?: ExperienceLevel;
  sectionCheck?: SectionCheck;
  contactInfo?: ContactInfo;
  topStrength?: TopStrength;
  quantificationScore?: QuantificationScore;
  actionVerbGrade?: ActionVerbGrade;
  readabilityScore?: ReadabilityScore;
  bulletImpactScore?: BulletImpactScore;
  keywordDensity?: KeywordDensity;
  improvementPotential?: ImprovementPotential;
  redFlags: RedFlag[];
  keywords: KeywordSuggestion[];
  onGetFullAnalysis: () => void;
  isLoading?: boolean;
}

export function FreeKeywordResults({
  industry,
  atsScoreEstimate,
  formatGrade,
  formatIssue,
  resumeLength: resumeLengthProp,
  wordCount: wordCountProp,
  experienceLevel: experienceLevelProp,
  sectionCheck: sectionCheckProp,
  contactInfo: contactInfoProp,
  topStrength: topStrengthProp,
  quantificationScore: quantificationScoreProp,
  actionVerbGrade: actionVerbGradeProp,
  readabilityScore: readabilityScoreProp,
  bulletImpactScore: bulletImpactScoreProp,
  keywordDensity: keywordDensityProp,
  improvementPotential: improvementPotentialProp,
  redFlags: redFlagsProp,
  keywords,
  onGetFullAnalysis,
  isLoading
}: FreeKeywordResultsProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const { toast } = useToast();

  // Safe defaults
  const resumeLength = resumeLengthProp || { currentPages: 1, recommendedPages: 1, verdict: "just_right" as const };
  const wordCount = wordCountProp || { current: 500, idealMin: 400, idealMax: 600, verdict: "ideal" as const };
  const experienceLevel = experienceLevelProp || { level: "mid" as const, yearsEstimate: "3-5 years" };
  const sectionCheck = sectionCheckProp || { hasContact: true, hasSummary: false, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [] };
  const contactInfo = contactInfoProp || { hasEmail: true, hasPhone: true, hasLinkedIn: false, missingItems: [] };
  const topStrength = topStrengthProp || { title: "Clear Experience", description: "Your work history is well-documented" };
  const quantificationScore = quantificationScoreProp || { score: 40, verdict: "average" as const, tip: "Add more metrics" };
  const actionVerbGrade = actionVerbGradeProp || { grade: "B", issue: "Good variety" };
  const readabilityScore = readabilityScoreProp || { score: 65, verdict: "readable" as const, issue: "Some long sentences" };
  const bulletImpactScore = bulletImpactScoreProp || { score: 45, verdict: "responsibility_heavy" as const, tip: "Focus on achievements" };
  const keywordDensity = keywordDensityProp || { level: "moderate" as const, explanation: "Good keyword presence" };
  const improvementPotential = improvementPotentialProp || { level: "medium" as const, estimatedScoreIncrease: 15, topPriority: "Add quantified achievements" };
  const redFlags = redFlagsProp || [];

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 60) return "text-warning";
    return "text-destructive";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return "bg-success/10 border-success/20";
    if (score >= 60) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getGradeColor = (grade: string) => {
    if (grade === "A") return "text-success";
    if (grade === "B") return "text-success/80";
    if (grade === "C") return "text-warning";
    return "text-destructive";
  };

  const getGradeBgColor = (grade: string) => {
    if (grade === "A") return "bg-success/10 border-success/20";
    if (grade === "B") return "bg-success/10 border-success/20";
    if (grade === "C") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getGradeLabel = (grade: string) => {
    if (grade === "A") return t('freeScan.excellent');
    if (grade === "B") return t('freeScan.good');
    if (grade === "C") return t('freeScan.fair');
    return t('freeScan.needsWork');
  };

  const getLengthColor = (verdict: string) => {
    if (verdict === "just_right") return "text-success";
    return "text-warning";
  };

  const getLengthBgColor = (verdict: string) => {
    if (verdict === "just_right") return "bg-success/10 border-success/20";
    return "bg-warning/10 border-warning/20";
  };

  const getLengthLabel = (verdict: string) => {
    if (verdict === "just_right") return t('freeScan.perfect');
    if (verdict === "too_short") return t('freeScan.tooShort');
    return t('freeScan.tooLong');
  };

  const getWordCountColor = (verdict: string) => {
    if (verdict === "ideal") return "text-success";
    return "text-warning";
  };

  const getWordCountBgColor = (verdict: string) => {
    if (verdict === "ideal") return "bg-success/10 border-success/20";
    return "bg-warning/10 border-warning/20";
  };

  const getExperienceLevelLabel = (level: string) => {
    if (level === "entry") return "Entry Level";
    if (level === "mid") return "Mid Level";
    if (level === "senior") return "Senior";
    return "Executive";
  };

  const getQuantificationColor = (verdict: string) => {
    if (verdict === "strong") return "text-success";
    if (verdict === "average") return "text-warning";
    return "text-destructive";
  };

  const getQuantificationBgColor = (verdict: string) => {
    if (verdict === "strong") return "bg-success/10 border-success/20";
    if (verdict === "average") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getSectionScore = () => {
    const total = 5;
    const present = [sectionCheck.hasContact, sectionCheck.hasSummary, sectionCheck.hasExperience, sectionCheck.hasEducation, sectionCheck.hasSkills].filter(Boolean).length;
    return `${present}/${total}`;
  };

  const getSectionColor = () => {
    const present = [sectionCheck.hasContact, sectionCheck.hasSummary, sectionCheck.hasExperience, sectionCheck.hasEducation, sectionCheck.hasSkills].filter(Boolean).length;
    if (present === 5) return "text-success";
    if (present >= 3) return "text-warning";
    return "text-destructive";
  };

  const getSectionBgColor = () => {
    const present = [sectionCheck.hasContact, sectionCheck.hasSummary, sectionCheck.hasExperience, sectionCheck.hasEducation, sectionCheck.hasSkills].filter(Boolean).length;
    if (present === 5) return "bg-success/10 border-success/20";
    if (present >= 3) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getContactScore = () => {
    const total = 3;
    const present = [contactInfo.hasEmail, contactInfo.hasPhone, contactInfo.hasLinkedIn].filter(Boolean).length;
    return `${present}/${total}`;
  };

  const getContactColor = () => {
    const present = [contactInfo.hasEmail, contactInfo.hasPhone, contactInfo.hasLinkedIn].filter(Boolean).length;
    if (present === 3) return "text-success";
    if (present >= 2) return "text-warning";
    return "text-destructive";
  };

  const getContactBgColor = () => {
    const present = [contactInfo.hasEmail, contactInfo.hasPhone, contactInfo.hasLinkedIn].filter(Boolean).length;
    if (present === 3) return "bg-success/10 border-success/20";
    if (present >= 2) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(email)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.rpc('save_free_scan_lead', {
        p_email: email,
        p_industry: industry,
        p_ats_score: atsScoreEstimate
      });

      if (error) throw error;

      setIsSubscribed(true);
      toast({
        title: "You're on the list!",
        description: "We'll send you resume tips to help you land more interviews.",
      });
    } catch (error: any) {
      console.error("Email capture error:", error);
      toast({
        title: "Something went wrong",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getReadabilityColor = (verdict: string) => {
    if (verdict === "easy_to_scan") return "text-success";
    if (verdict === "readable") return "text-warning";
    return "text-destructive";
  };

  const getReadabilityBgColor = (verdict: string) => {
    if (verdict === "easy_to_scan") return "bg-success/10 border-success/20";
    if (verdict === "readable") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getBulletImpactColor = (verdict: string) => {
    if (verdict === "achievement_focused") return "text-success";
    if (verdict === "balanced") return "text-warning";
    return "text-destructive";
  };

  const getBulletImpactBgColor = (verdict: string) => {
    if (verdict === "achievement_focused") return "bg-success/10 border-success/20";
    if (verdict === "balanced") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getKeywordDensityColor = (level: string) => {
    if (level === "dense") return "text-success";
    if (level === "moderate") return "text-warning";
    return "text-destructive";
  };

  const getKeywordDensityBgColor = (level: string) => {
    if (level === "dense") return "bg-success/10 border-success/20";
    if (level === "moderate") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getImprovementPotentialColor = (level: string) => {
    if (level === "low") return "text-success";
    if (level === "medium") return "text-warning";
    return "text-primary";
  };

  const getImprovementPotentialBgColor = (level: string) => {
    if (level === "low") return "bg-success/10 border-success/20";
    if (level === "medium") return "bg-warning/10 border-warning/20";
    return "bg-primary/10 border-primary/20";
  };

  return (
    <div className="w-full max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 text-success text-sm font-medium mb-3">
          <Sparkles className="w-4 h-4" />
          {t('freeScan.complete')}
        </div>
        <h3 className="text-xl font-bold mb-1">{t('freeScan.preview')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('freeScan.detected')}: <span className="text-foreground font-medium">{industry}</span> • <span className="text-foreground font-medium">{getExperienceLevelLabel(experienceLevel.level)}</span> ({experienceLevel.yearsEstimate})
        </p>
      </div>

      {/* Score Cards Grid - Row 1: Primary Scores */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {/* ATS Score */}
        <div className={cn("rounded-2xl border p-3", getScoreBgColor(atsScoreEstimate))}>
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.atsScore')}</p>
          </div>
          <p className={cn("text-2xl font-bold", getScoreColor(atsScoreEstimate))}>
            {atsScoreEstimate}<span className="text-sm text-muted-foreground">/100</span>
          </p>
          <div className="flex items-center gap-1 mt-1 text-muted-foreground">
            <Lock className="w-3 h-3" />
            <span className="text-xs">{t('freeScan.breakdownLocked')}</span>
          </div>
        </div>

        {/* Format Grade */}
        <div className={cn("rounded-2xl border p-3", getGradeBgColor(formatGrade))}>
          <div className="flex items-center gap-2 mb-1">
            <FileCheck className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.format')}</p>
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-2xl font-bold", getGradeColor(formatGrade))}>{formatGrade}</p>
            <span className={cn("text-xs font-medium", getGradeColor(formatGrade))}>{getGradeLabel(formatGrade)}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{formatIssue}</p>
        </div>

        {/* Quantification Score */}
        <div className={cn("rounded-2xl border p-3", getQuantificationBgColor(quantificationScore.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <Hash className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.metrics')}</p>
          </div>
          <p className={cn("text-2xl font-bold", getQuantificationColor(quantificationScore.verdict))}>
            {quantificationScore.score}<span className="text-sm text-muted-foreground">%</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{quantificationScore.tip}</p>
        </div>

        {/* Action Verb Grade */}
        <div className={cn("rounded-2xl border p-3", getGradeBgColor(actionVerbGrade.grade))}>
          <div className="flex items-center gap-2 mb-1">
            <Pencil className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.verbs')}</p>
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-2xl font-bold", getGradeColor(actionVerbGrade.grade))}>{actionVerbGrade.grade}</p>
            <span className={cn("text-xs font-medium", getGradeColor(actionVerbGrade.grade))}>{getGradeLabel(actionVerbGrade.grade)}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{actionVerbGrade.issue}</p>
        </div>
      </div>

      {/* Score Cards Grid - Row 2: Structure & Content */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {/* Resume Length */}
        <div className={cn("rounded-2xl border p-3", getLengthBgColor(resumeLength.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.pages')}</p>
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-2xl font-bold", getLengthColor(resumeLength.verdict))}>{resumeLength.currentPages}</p>
            <span className="text-sm text-muted-foreground">/ {resumeLength.recommendedPages}</span>
          </div>
          <p className={cn("text-xs font-medium mt-1", getLengthColor(resumeLength.verdict))}>{getLengthLabel(resumeLength.verdict)}</p>
        </div>

        {/* Word Count */}
        <div className={cn("rounded-2xl border p-3", getWordCountBgColor(wordCount.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <Type className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.words')}</p>
          </div>
          <p className={cn("text-2xl font-bold", getWordCountColor(wordCount.verdict))}>{wordCount.current}</p>
          <p className="text-xs text-muted-foreground mt-1">{wordCount.idealMin}-{wordCount.idealMax} {t('freeScan.ideal')}</p>
        </div>

        {/* Section Check */}
        <div className={cn("rounded-2xl border p-3", getSectionBgColor())}>
          <div className="flex items-center gap-2 mb-1">
            <LayoutList className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.sections')}</p>
          </div>
          <p className={cn("text-2xl font-bold", getSectionColor())}>{getSectionScore()}</p>
          {sectionCheck.missingSections.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">Missing: {sectionCheck.missingSections[0]}</p>
          )}
          {sectionCheck.missingSections.length === 0 && (
            <p className="text-xs text-success mt-1">All present!</p>
          )}
        </div>

        {/* Contact Info */}
        <div className={cn("rounded-2xl border p-3", getContactBgColor())}>
          <div className="flex items-center gap-2 mb-1">
            <Phone className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.contact')}</p>
          </div>
          <p className={cn("text-2xl font-bold", getContactColor())}>{getContactScore()}</p>
          {contactInfo.missingItems.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">Add: {contactInfo.missingItems[0]}</p>
          )}
          {contactInfo.missingItems.length === 0 && (
            <p className="text-xs text-success mt-1">Complete!</p>
          )}
        </div>
      </div>

      {/* Score Cards Grid - Row 3: New Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {/* Readability Score */}
        <div className={cn("rounded-2xl border p-3", getReadabilityBgColor(readabilityScore.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.readability')}</p>
          </div>
          <p className={cn("text-2xl font-bold", getReadabilityColor(readabilityScore.verdict))}>
            {readabilityScore.score}<span className="text-sm text-muted-foreground">%</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{readabilityScore.issue}</p>
        </div>

        {/* Bullet Impact Score */}
        <div className={cn("rounded-2xl border p-3", getBulletImpactBgColor(bulletImpactScore.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.bulletImpact')}</p>
          </div>
          <p className={cn("text-2xl font-bold", getBulletImpactColor(bulletImpactScore.verdict))}>
            {bulletImpactScore.score}<span className="text-sm text-muted-foreground">%</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{bulletImpactScore.tip}</p>
        </div>

        {/* Keyword Density */}
        <div className={cn("rounded-2xl border p-3", getKeywordDensityBgColor(keywordDensity.level))}>
          <div className="flex items-center gap-2 mb-1">
            <Hash className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.keywordDensity')}</p>
          </div>
          <p className={cn("text-xl font-bold capitalize", getKeywordDensityColor(keywordDensity.level))}>
            {keywordDensity.level}
          </p>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{keywordDensity.explanation}</p>
        </div>

        {/* Improvement Potential */}
        <div className={cn("rounded-2xl border p-3", getImprovementPotentialBgColor(improvementPotential.level))}>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">{t('freeScan.improvementPotential')}</p>
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-xl font-bold", getImprovementPotentialColor(improvementPotential.level))}>
              +{improvementPotential.estimatedScoreIncrease}
            </p>
            <span className="text-xs text-muted-foreground">pts</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{improvementPotential.topPriority}</p>
        </div>
      </div>

      {/* Row 4: Special Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {/* Top Strength */}
        <div className="rounded-2xl border p-4 bg-success/5 border-success/20">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-4 h-4 text-success" />
            <p className="text-xs font-medium text-success">{t('freeScan.topStrength')}</p>
          </div>
          <p className="font-semibold text-foreground">{topStrength.title}</p>
          <p className="text-sm text-muted-foreground">{topStrength.description}</p>
        </div>

        {/* Red Flags Preview */}
        <div className="rounded-2xl border p-4 bg-destructive/5 border-destructive/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <p className="text-xs font-medium text-destructive">{t('freeScan.redFlags')}</p>
          </div>
          <p className="text-2xl font-bold text-destructive mb-1">{redFlags.length}+</p>
          {redFlags.length > 0 && (
            <p className="text-sm text-muted-foreground line-clamp-1">{redFlags[0].issue}</p>
          )}
        </div>
      </div>

      {/* Detailed Section Check */}
      <div className="rounded-2xl bg-card border border-border p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <LayoutList className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">Section Checklist</h4>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Contact", has: sectionCheck.hasContact },
            { label: "Summary", has: sectionCheck.hasSummary },
            { label: "Experience", has: sectionCheck.hasExperience },
            { label: "Education", has: sectionCheck.hasEducation },
            { label: "Skills", has: sectionCheck.hasSkills },
          ].map((item) => (
            <div key={item.label} className={cn(
              "flex items-center gap-2 p-2 rounded-xl border",
              item.has ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20"
            )}>
              {item.has ? (
                <CheckCircle className="w-4 h-4 text-success shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive shrink-0" />
              )}
              <span className={cn("text-sm font-medium", item.has ? "text-success" : "text-destructive")}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Red Flags Details */}
      {redFlags.length > 0 && (
        <div className="rounded-2xl bg-destructive/5 border border-destructive/20 p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <h4 className="font-semibold">Recruiter Red Flags</h4>
          </div>
          <div className="space-y-2">
            {redFlags.map((flag, index) => (
              <div key={index} className="flex items-start gap-3 p-3 rounded-xl bg-background/50 border border-destructive/10">
                <span className="text-destructive font-bold text-sm">{index + 1}.</span>
                <div>
                  <span className="font-medium text-foreground">{flag.issue}</span>
                  <p className="text-sm text-muted-foreground">{flag.impact}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 mt-3 text-muted-foreground">
            <Lock className="w-3 h-3" />
            <span className="text-xs">More red flags + how to fix them in full analysis</span>
          </div>
        </div>
      )}

      {/* Keyword Suggestions */}
      <div className="rounded-2xl bg-card border border-border p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">{t('freeScan.missingKeywords')}</h4>
        </div>
        <div className="space-y-3">
          {keywords.map((item, index) => (
            <div key={index} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
              <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
              <div>
                <span className="font-medium text-foreground">{item.keyword}</span>
                <p className="text-sm text-muted-foreground">{item.reason}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Email Capture */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Mail className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">{t('freeScan.emailCapture.title')}</h4>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Join 10,000+ job seekers getting weekly tips to beat the ATS and land interviews.
        </p>
        
        {isSubscribed ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/20">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span className="text-sm text-success font-medium">{t('freeScan.emailCapture.subscribed')}</span>
          </div>
        ) : (
          <form onSubmit={handleEmailSubmit} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('freeScan.emailCapture.placeholder')}
              className="flex-1 h-10 px-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 text-sm transition-all"
              disabled={isSubmitting}
            />
            <Button 
              type="submit" 
              variant="outline"
              disabled={isSubmitting || !email.trim()}
              className="h-10 px-4 border-primary/30 hover:bg-primary/10"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('freeScan.emailCapture.button')}
            </Button>
          </form>
        )}
        <p className="text-xs text-muted-foreground mt-2">No spam. Unsubscribe anytime.</p>
      </div>

      {/* What's Locked */}
      <div className="rounded-2xl bg-muted/30 border border-border/50 p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <h4 className="font-medium text-muted-foreground">Unlock with Full Analysis</h4>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            "Full ATS score breakdown",
            "Bullet point rewrites",
            "Detailed red flag fixes",
            "LinkedIn optimization",
            "Action verb replacements",
            "Quantification suggestions",
            "Skills gap analysis",
            "Industry-specific insights",
            "Summary/headline rewrites",
            "Prioritized action plan"
          ].map((feature, i) => (
            <div key={i} className="flex items-center gap-2 text-muted-foreground">
              <div className="w-1 h-1 rounded-full bg-muted-foreground/50" />
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        <Button 
          size="lg" 
          onClick={onGetFullAnalysis}
          disabled={isLoading}
          className="gap-2 px-8 h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20"
        >
          {t('freeScan.cta.button')} — {t('freeScan.cta.price')}
          <ArrowRight className="w-4 h-4" />
        </Button>
        <p className="text-xs text-muted-foreground mt-2">One interview pays for itself</p>
      </div>
    </div>
  );
}
