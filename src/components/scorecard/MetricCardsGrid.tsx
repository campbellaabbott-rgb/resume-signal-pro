import { useState } from "react";
import {
  Target, FileCheck, Hash, Pencil, FileText, Type,
  LayoutList, Phone, Zap, HelpCircle, X, Trophy, AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";

// --- Types ---

interface QuantificationScore {
  score: number;
  verdict: "weak" | "average" | "strong";
  tip?: string;
}

interface ReadabilityScore {
  score: number;
  verdict: "hard_to_read" | "readable" | "easy_to_scan";
}

interface BulletImpactScore {
  score: number;
  verdict: "responsibility_heavy" | "balanced" | "achievement_focused";
  tip?: string;
}

interface KeywordDensity {
  level: "sparse" | "moderate" | "dense";
  tip?: string;
}

interface ImprovementPotential {
  level: "low" | "medium" | "high";
  estimatedScoreIncrease: number;
  topActions?: string[];
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

interface ActionVerbGrade {
  grade: string;
  percentage?: number;
  suggestion?: string;
}

interface TopStrength {
  title: string;
  description: string;
}

interface RedFlag {
  issue: string;
  severity?: string;
}

// --- Tooltip data ---

const metricTooltips: Record<string, { title: string; description: string; whyMatters: string }> = {
  atsScore: {
    title: "AI-ATS Score",
    description: "Our AI simulates how modern AI-powered Applicant Tracking Systems scan your resume.",
    whyMatters: "A low score means your resume may never reach a human recruiter."
  },
  format: {
    title: "Format Grade",
    description: "Evaluates your resume's structure, layout, and AI-ATS readability.",
    whyMatters: "Poor formatting causes AI-ATS parsing errors, losing your key information."
  },
  metrics: {
    title: "Quantification Score",
    description: "Measures how many of your achievements include numbers, percentages, or metrics.",
    whyMatters: "Recruiters spend 6 seconds scanning—numbers catch their eye first."
  },
  verbs: {
    title: "Action Verb Grade",
    description: "Rates the strength and variety of action verbs starting your bullet points.",
    whyMatters: "Strong verbs like 'Spearheaded' beat weak ones like 'Helped' or 'Assisted'."
  },
  pages: {
    title: "Resume Length",
    description: "Checks if your resume length matches industry standards for your experience level.",
    whyMatters: "Too long = skipped. Too short = lacking substance."
  },
  words: {
    title: "Word Count",
    description: "Measures if you have enough content to showcase your value.",
    whyMatters: "The sweet spot varies by experience—too few words signals inexperience."
  },
  sections: {
    title: "Section Check",
    description: "Verifies all essential resume sections are present.",
    whyMatters: "Missing sections are immediate red flags for recruiters."
  },
  contact: {
    title: "Contact Info",
    description: "Checks for email, phone, and LinkedIn presence.",
    whyMatters: "Recruiters can't hire you if they can't contact you."
  },
  readability: {
    title: "Readability Score",
    description: "Measures how easy your resume is to scan quickly.",
    whyMatters: "Recruiters average 6-7 seconds per resume—make every word count."
  },
  bulletImpact: {
    title: "Bullet Impact",
    description: "Analyzes if your bullets focus on achievements vs. just listing responsibilities.",
    whyMatters: "Achievement-focused bullets prove value; responsibility lists don't."
  },
  keywordDensity: {
    title: "Keyword Density",
    description: "Measures industry-relevant keyword presence for AI-ATS matching.",
    whyMatters: "Too few keywords = no AI-ATS match. Too many = keyword stuffing penalty."
  },
  improvementPotential: {
    title: "Improvement Potential",
    description: "Estimated score increase possible with optimization.",
    whyMatters: "Shows how much room you have to outcompete other candidates."
  },
};

// --- Inline MetricTooltip ---

function MetricTip({ metricKey }: { metricKey: string }) {
  const [show, setShow] = useState(false);
  const isMobile = useIsMobile();
  const tip = metricTooltips[metricKey];
  if (!tip) return null;

  if (isMobile) {
    return (
      <div className="relative inline-block">
        <button onClick={() => setShow(!show)} className="p-1 -m-1 touch-manipulation" aria-label={`Learn about ${tip.title}`}>
          <HelpCircle className="w-3 h-3 text-muted-foreground/50" />
        </button>
        {show && (
          <div className="absolute z-50 right-0 top-6 w-60 p-3 rounded-xl bg-card border border-border shadow-lg animate-fade-in">
            <button onClick={() => setShow(false)} className="absolute top-2 right-2 p-1 text-muted-foreground" aria-label="Close">
              <X className="w-3 h-3" />
            </button>
            <p className="font-semibold text-foreground mb-1 pr-4 text-xs">{tip.title}</p>
            <p className="text-[10px] text-muted-foreground mb-1">{tip.description}</p>
            <p className="text-[10px] text-primary font-medium">💡 {tip.whyMatters}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="w-3 h-3 text-muted-foreground/40 hover:text-muted-foreground cursor-help transition-colors" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] p-3">
        <p className="font-semibold text-foreground mb-1 text-xs">{tip.title}</p>
        <p className="text-[10px] text-muted-foreground mb-1">{tip.description}</p>
        <p className="text-[10px] text-primary font-medium">💡 {tip.whyMatters}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// --- Utility functions ---

type Status = "success" | "warning" | "destructive" | "muted";

function statusFromScore(score: number, goodThreshold = 75, okThreshold = 50): Status {
  if (score >= goodThreshold) return "success";
  if (score >= okThreshold) return "warning";
  return "destructive";
}

function statusFromGrade(grade: string): Status {
  if (grade === "A" || grade === "B") return "success";
  if (grade === "C") return "warning";
  return "destructive";
}

const statusColor: Record<Status, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

const progressColor: Record<Status, string> = {
  success: "[&>div]:bg-success",
  warning: "[&>div]:bg-warning",
  destructive: "[&>div]:bg-destructive",
  muted: "[&>div]:bg-muted-foreground",
};

// --- DashboardMetricCard ---

interface MetricCardProps {
  icon: typeof Target;
  label: string;
  tooltipKey: string;
  value: string;
  subtext: string;
  status: Status;
  progress?: number; // 0-100, if applicable
}

function DashboardMetricCard({ icon: Icon, label, tooltipKey, value, subtext, status, progress }: MetricCardProps) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card/50 hover:bg-card/80 transition-colors">
      <div className={cn(
        "p-2 rounded-lg shrink-0",
        status === "success" ? "bg-success/10" :
        status === "warning" ? "bg-warning/10" :
        status === "destructive" ? "bg-destructive/10" :
        "bg-muted"
      )}>
        <Icon className={cn("w-4 h-4", statusColor[status])} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">{label}</span>
          <MetricTip metricKey={tooltipKey} />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className={cn("text-lg font-bold tabular-nums leading-none", statusColor[status])}>{value}</span>
        </div>
        {progress !== undefined && (
          <Progress
            value={progress}
            className={cn("h-1 mt-1.5 bg-muted/50", progressColor[status])}
          />
        )}
        <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{subtext}</p>
      </div>
    </div>
  );
}

// --- Main component ---

interface MetricCardsGridProps {
  atsScoreEstimate: number;
  formatGrade: string;
  quantificationScore: QuantificationScore;
  actionVerbGrade: ActionVerbGrade;
  resumeLength: ResumeLength;
  wordCount: WordCount;
  sectionCheck: SectionCheck;
  contactInfo: ContactInfo;
  readabilityScore: ReadabilityScore;
  bulletImpactScore: BulletImpactScore;
  keywordDensity: KeywordDensity;
  improvementPotential: ImprovementPotential;
  topStrength: TopStrength;
  redFlags: RedFlag[];
}

export function MetricCardsGrid({
  atsScoreEstimate,
  formatGrade,
  quantificationScore,
  actionVerbGrade,
  resumeLength,
  wordCount,
  sectionCheck,
  contactInfo,
  readabilityScore,
  bulletImpactScore,
  keywordDensity,
  improvementPotential,
  topStrength,
  redFlags,
}: MetricCardsGridProps) {
  const { t } = useTranslation();

  const gradeLabel = (g: string) => g === "A" ? "Excellent" : g === "B" ? "Good" : g === "C" ? "Fair" : "Needs Work";

  const sectionPresent = [sectionCheck.hasContact, sectionCheck.hasSummary, sectionCheck.hasExperience, sectionCheck.hasEducation, sectionCheck.hasSkills].filter(Boolean).length;
  const contactPresent = [contactInfo.hasEmail, contactInfo.hasPhone, contactInfo.hasLinkedIn].filter(Boolean).length;

  const densityScore = keywordDensity.level === "dense" ? 90 : keywordDensity.level === "moderate" ? 55 : 25;
  const densityStatus: Status = keywordDensity.level === "dense" ? "success" : keywordDensity.level === "moderate" ? "warning" : "destructive";

  // Build card data
  const primaryCards: MetricCardProps[] = [
    {
      icon: Target,
      label: t('freeScan.atsScore'),
      tooltipKey: "atsScore",
      value: `${atsScoreEstimate}/100`,
      subtext: atsScoreEstimate >= 80 ? "✓ Great! You'll pass most ATS" : atsScoreEstimate >= 60 ? "⚠ May get filtered out" : "✗ High rejection risk",
      status: statusFromScore(atsScoreEstimate, 80, 60),
      progress: atsScoreEstimate,
    },
    {
      icon: FileCheck,
      label: t('freeScan.format'),
      tooltipKey: "format",
      value: `${formatGrade} — ${gradeLabel(formatGrade)}`,
      subtext: formatGrade === "A" ? "✓ ATS can read this well" : formatGrade === "B" ? "✓ Minor formatting tweaks needed" : formatGrade === "C" ? "⚠ May cause parsing errors" : "✗ ATS may scramble your info",
      status: statusFromGrade(formatGrade),
    },
    {
      icon: Hash,
      label: t('freeScan.metrics'),
      tooltipKey: "metrics",
      value: `${quantificationScore.score}%`,
      subtext: quantificationScore.tip || (quantificationScore.verdict === "strong" ? "✓ Strong metrics throughout" : quantificationScore.score >= 50 ? "⚠ Older roles need more numbers" : "⚠ Add more $, %, # throughout"),
      status: statusFromScore(quantificationScore.score, 60, 40),
      progress: quantificationScore.score,
    },
    {
      icon: Pencil,
      label: t('freeScan.verbs'),
      tooltipKey: "verbs",
      value: `${actionVerbGrade.grade} — ${gradeLabel(actionVerbGrade.grade)}`,
      subtext: actionVerbGrade.grade === "A" ? "✓ Strong, powerful verbs" : actionVerbGrade.grade === "B" ? "✓ Good variety of verbs" : actionVerbGrade.grade === "C" ? "⚠ Use stronger words" : "✗ Weak verbs hurt impact",
      status: statusFromGrade(actionVerbGrade.grade),
    },
  ];

  const structureCards: MetricCardProps[] = [
    {
      icon: FileText,
      label: t('freeScan.pages'),
      tooltipKey: "pages",
      value: `${resumeLength.currentPages} / ${resumeLength.recommendedPages}`,
      subtext: resumeLength.verdict === "just_right" ? "✓ Perfect length for your level" : resumeLength.verdict === "too_short" ? "⚠ Add more accomplishments" : "⚠ Recruiters may skip long resumes",
      status: resumeLength.verdict === "just_right" ? "success" : "warning",
    },
    {
      icon: Type,
      label: t('freeScan.words'),
      tooltipKey: "words",
      value: `${wordCount.current}`,
      subtext: wordCount.verdict === "ideal" ? `✓ Sweet spot: ${wordCount.idealMin}-${wordCount.idealMax}` : wordCount.verdict === "too_few" ? "⚠ Looks thin — add content" : "⚠ Too dense — trim fat",
      status: wordCount.verdict === "ideal" ? "success" : "warning",
    },
    {
      icon: LayoutList,
      label: t('freeScan.sections'),
      tooltipKey: "sections",
      value: `${sectionPresent}/5`,
      subtext: sectionCheck.missingSections.length === 0 ? "✓ All key sections present" : `⚠ Add: ${sectionCheck.missingSections[0]}`,
      status: sectionPresent === 5 ? "success" : sectionPresent >= 3 ? "warning" : "destructive",
      progress: (sectionPresent / 5) * 100,
    },
    {
      icon: Phone,
      label: t('freeScan.contact'),
      tooltipKey: "contact",
      value: `${contactPresent}/3`,
      subtext: contactInfo.missingItems.length === 0 ? "✓ Easy for recruiters to reach you" : `⚠ Add ${contactInfo.missingItems[0]}`,
      status: contactPresent === 3 ? "success" : contactPresent >= 2 ? "warning" : "destructive",
      progress: (contactPresent / 3) * 100,
    },
  ];

  const advancedCards: MetricCardProps[] = [
    {
      icon: FileText,
      label: t('freeScan.readability'),
      tooltipKey: "readability",
      value: `${readabilityScore.score}%`,
      subtext: readabilityScore.verdict === "easy_to_scan" ? "✓ Quick 6-second scan friendly" : readabilityScore.verdict === "readable" ? "⚠ Some sections hard to scan" : "✗ Recruiters will skip this",
      status: statusFromScore(readabilityScore.score, 70, 45),
      progress: readabilityScore.score,
    },
    {
      icon: Target,
      label: t('freeScan.bulletImpact'),
      tooltipKey: "bulletImpact",
      value: `${bulletImpactScore.score}%`,
      subtext: bulletImpactScore.tip || (bulletImpactScore.verdict === "achievement_focused" ? "✓ Shows results, not tasks" : bulletImpactScore.score >= 50 ? "⚠ Earlier roles list duties" : "⚠ Focus on outcomes over duties"),
      status: statusFromScore(bulletImpactScore.score, 60, 40),
      progress: bulletImpactScore.score,
    },
    {
      icon: Hash,
      label: t('freeScan.keywordDensity'),
      tooltipKey: "keywordDensity",
      value: keywordDensity.level.charAt(0).toUpperCase() + keywordDensity.level.slice(1),
      subtext: keywordDensity.level === "dense" ? "✓ ATS will find your skills" : keywordDensity.level === "moderate" ? "⚠ Add more industry terms" : "✗ Missing key search terms",
      status: densityStatus,
      progress: densityScore,
    },
    {
      icon: Zap,
      label: t('freeScan.improvementPotential'),
      tooltipKey: "improvementPotential",
      value: `+${improvementPotential.estimatedScoreIncrease} pts`,
      subtext: improvementPotential.level === "high" ? "🚀 Big gains possible!" : improvementPotential.level === "medium" ? "📈 Room to improve" : "✓ Already optimized",
      status: improvementPotential.level === "low" ? "success" : improvementPotential.level === "medium" ? "warning" : "muted",
    },
  ];

  return (
    <div className="space-y-4 mb-6">
      {/* Section: Primary Scores */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 px-1">
          Primary Scores
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {primaryCards.map((card, i) => (
            <DashboardMetricCard key={i} {...card} />
          ))}
        </div>
      </div>

      {/* Section: Structure & Content */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 px-1">
          Structure & Content
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {structureCards.map((card, i) => (
            <DashboardMetricCard key={i} {...card} />
          ))}
        </div>
      </div>

      {/* Section: Advanced Metrics */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 px-1">
          Advanced Metrics
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {advancedCards.map((card, i) => (
            <DashboardMetricCard key={i} {...card} />
          ))}
        </div>
      </div>

      {/* Highlights row: Top Strength + Red Flags */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="flex items-start gap-3 p-3 rounded-xl border border-success/20 bg-success/5">
          <div className="p-2 rounded-lg bg-success/10 shrink-0">
            <Trophy className="w-4 h-4 text-success" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-success uppercase tracking-wider">
              {t('freeScan.topStrength')}
            </span>
            <p className="font-semibold text-foreground text-sm mt-0.5">{topStrength.title}</p>
            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{topStrength.description}</p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-xl border border-destructive/20 bg-destructive/5">
          <div className="p-2 rounded-lg bg-destructive/10 shrink-0">
            <AlertTriangle className="w-4 h-4 text-destructive" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-destructive uppercase tracking-wider">
              {t('freeScan.redFlags')}
            </span>
            <p className="font-semibold text-foreground text-sm mt-0.5">
              {redFlags.length === 0 ? "No red flags" : `${redFlags.length} issue${redFlags.length > 1 ? "s" : ""} found`}
            </p>
            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
              {redFlags.length > 0 ? redFlags[0].issue : "Your resume looks clean — no major issues detected."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
