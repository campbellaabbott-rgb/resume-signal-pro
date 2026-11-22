import { useState } from "react";
import {
  Target, FileCheck, Hash, Pencil, FileText, Type,
  LayoutList, Phone, Zap, HelpCircle, X, Trophy, AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { improvementLevelOf } from "../../../supabase/functions/free-keyword-scan/score-projection";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { scoreTone } from "@/lib/score-bands";

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

// The tooltips are read from freeResults.metricTooltips, which every locale
// already carries (S14X-057); this card held an English copy of them.
const METRIC_TOOLTIP_KEYS = new Set([
  "atsScore", "format", "metrics", "verbs", "pages", "words", "sections",
  "contact", "readability", "bulletImpact", "keywordDensity", "improvementPotential",
]);

// --- Inline MetricTooltip ---

function MetricTip({ metricKey }: { metricKey: string }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const isMobile = useIsMobile();
  if (!METRIC_TOOLTIP_KEYS.has(metricKey)) return null;
  const tip = {
    title: t(`freeResults.metricTooltips.${metricKey}.title`),
    description: t(`freeResults.metricTooltips.${metricKey}.description`),
    whyMatters: t(`freeResults.metricTooltips.${metricKey}.whyMatters`),
  };

  if (isMobile) {
    return (
      <div className="relative inline-block">
        <button onClick={() => setShow(!show)} className="p-1 -m-1 touch-manipulation" aria-label={t("freeScanPage.metric.learnAbout", { title: tip.title })}>
          <HelpCircle className="w-3 h-3 text-muted-foreground/50" />
        </button>
        {show && (
          <div className="absolute z-50 right-0 top-6 w-60 p-3 rounded-xl bg-card border border-border shadow-lg animate-fade-in">
            <button onClick={() => setShow(false)} className="absolute top-2 right-2 p-1 text-muted-foreground" aria-label={t("common.close")}>
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
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card/50 hover:bg-card/80 transition-colors" data-metric={tooltipKey} data-status={status}>
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
  actionVerbGrade?: ActionVerbGrade;
  resumeLength?: ResumeLength;
  wordCount?: WordCount;
  sectionCheck: SectionCheck;
  /** Null when the scan read no contact facts (SCAN-M1): the card is not shown. */
  contactInfo: ContactInfo | null;
  readabilityScore?: ReadabilityScore;
  bulletImpactScore: BulletImpactScore;
  keywordDensity?: KeywordDensity;
  improvementPotential?: ImprovementPotential;
  /** Hidden when the scan named none (S11-147): never an invented strength. */
  topStrength: TopStrength | null;
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

  const gradeLabel = (g: string) => t(g === "A" ? "metricCards.grade.a" : g === "B" ? "metricCards.grade.b" : g === "C" ? "metricCards.grade.c" : "metricCards.grade.d");
  // The ATS score's colour and words come from the report's one set of bands
  // (src/lib/score-bands.ts, S13-019), never thresholds of this card's own.
  const atsTone = scoreTone(atsScoreEstimate);

  // WHAT IS MISSING COMES FROM THE SAME BOOLEANS AS THE COUNT (SCAN-02). The
  // scan's own missingSections and missingItems lists can be empty, or in
  // English, beside a false: the card ticked "all present" next to 2/3 or
  // 3/5. Each part the count leaves out is named in the reader's language.
  const SECTION_PARTS = [
    ["contact", sectionCheck.hasContact],
    ["summary", sectionCheck.hasSummary],
    ["experience", sectionCheck.hasExperience],
    ["education", sectionCheck.hasEducation],
    ["skills", sectionCheck.hasSkills],
  ] as const;
  const missingSections = SECTION_PARTS.filter(([, has]) => !has).map(([part]) => t(`freeScanPage.metric.section.${part}`));
  const sectionPresent = SECTION_PARTS.length - missingSections.length;
  const CONTACT_PARTS = contactInfo
    ? ([["email", contactInfo.hasEmail], ["phone", contactInfo.hasPhone], ["linkedIn", contactInfo.hasLinkedIn]] as const)
    : [];
  const missingContact = CONTACT_PARTS.filter(([, has]) => !has).map(([part]) => t(`freeScanPage.metric.contact.${part}`));
  const contactPresent = CONTACT_PARTS.length - missingContact.length;

  const densityScore = keywordDensity ? (keywordDensity.level === "dense" ? 90 : keywordDensity.level === "moderate" ? 55 : 25) : 0;
  const densityStatus: Status = keywordDensity ? (keywordDensity.level === "dense" ? "success" : keywordDensity.level === "moderate" ? "warning" : "destructive") : "muted";

  // Build card data
  const primaryCards: MetricCardProps[] = [
    {
      icon: Target,
      label: t('freeScan.atsScore'),
      tooltipKey: "atsScore",
      value: `${atsScoreEstimate}/100`,
      // What the score reads, not what a recruiter's search will do with it
      // (the review of 2026-10-27, finding 3's class).
      subtext: t(atsTone === "success" ? "metricCards.ats.strong" : atsTone === "warning" ? "metricCards.ats.gaps" : "metricCards.ats.manyGaps"),
      status: atsTone,
      progress: atsScoreEstimate,
    },
    {
      icon: FileCheck,
      label: t('freeScan.format'),
      tooltipKey: "format",
      value: `${formatGrade} — ${gradeLabel(formatGrade)}`,
      // In the reader's language (S14X-057).
      subtext: formatGrade === "A" ? `✓ ${t("freeScanPage.metric.formatA")}` : formatGrade === "B" ? `✓ ${t("freeScanPage.metric.formatB")}` : formatGrade === "C" ? `⚠ ${t("freeScanPage.metric.formatC")}` : `✗ ${t("freeScanPage.metric.formatD")}`,
      status: statusFromGrade(formatGrade),
    },
    {
      icon: Hash,
      label: t('freeScan.metrics'),
      tooltipKey: "metrics",
      value: `${quantificationScore.score}%`,
      subtext: quantificationScore.tip || (quantificationScore.verdict === "strong" ? `✓ ${t("freeScanPage.metric.quantStrong")}` : quantificationScore.score >= 50 ? `⚠ ${t("freeScanPage.metric.quantOlder")}` : `⚠ ${t("freeScanPage.metric.quantAdd")}`),
      status: statusFromScore(quantificationScore.score, 60, 40),
      progress: quantificationScore.score,
    },
    // Tiles below hide when the scan didn't return the metric — never
    // fabricated (audit 2026-07-08).
    ...(actionVerbGrade ? [{
      icon: Pencil,
      label: t('freeScan.verbs'),
      tooltipKey: "verbs",
      value: `${actionVerbGrade.grade} — ${gradeLabel(actionVerbGrade.grade)}`,
      subtext: actionVerbGrade.grade === "A" ? `✓ ${t("freeScanPage.metric.verbsA")}` : actionVerbGrade.grade === "B" ? `✓ ${t("freeScanPage.metric.verbsB")}` : actionVerbGrade.grade === "C" ? `⚠ ${t("freeScanPage.metric.verbsC")}` : `✗ ${t("freeScanPage.metric.verbsD")}`,
      status: statusFromGrade(actionVerbGrade.grade),
    }] : []),
  ];

  const structureCards: MetricCardProps[] = [
    ...(resumeLength ? [{
      icon: FileText,
      label: t('freeScan.pages'),
      tooltipKey: "pages",
      value: `${resumeLength.currentPages} / ${resumeLength.recommendedPages}`,
      subtext: resumeLength.verdict === "just_right" ? `✓ ${t("freeScanPage.metric.lengthRight")}` : resumeLength.verdict === "too_short" ? `⚠ ${t("freeScanPage.metric.lengthShort")}` : `⚠ ${t("freeScanPage.metric.lengthLong")}`,
      status: (resumeLength.verdict === "just_right" ? "success" : "warning") as Status,
    }] : []),
    ...(wordCount ? [{
      icon: Type,
      label: t('freeScan.words'),
      tooltipKey: "words",
      value: `${wordCount.current}`,
      subtext: wordCount.verdict === "ideal" ? `✓ ${t("freeScanPage.metric.wordsIdeal", { min: wordCount.idealMin, max: wordCount.idealMax })}` : wordCount.verdict === "too_few" ? `⚠ ${t("freeScanPage.metric.wordsFew")}` : `⚠ ${t("freeScanPage.metric.wordsMany")}`,
      status: (wordCount.verdict === "ideal" ? "success" : "warning") as Status,
    }] : []),
    {
      icon: LayoutList,
      label: t('freeScan.sections'),
      tooltipKey: "sections",
      value: `${sectionPresent}/5`,
      subtext: missingSections.length === 0 ? `✓ ${t("freeScanPage.metric.sectionsAll")}` : `⚠ ${t("freeScanPage.metric.sectionsAdd", { section: missingSections.join(", ") })}`,
      status: sectionPresent === 5 ? "success" : sectionPresent >= 3 ? "warning" : "destructive",
      progress: (sectionPresent / 5) * 100,
    },
    ...(contactInfo ? [{
      icon: Phone,
      label: t('freeScan.contact'),
      tooltipKey: "contact",
      value: `${contactPresent}/3`,
      subtext: missingContact.length === 0 ? `✓ ${t("freeScanPage.metric.contactAll")}` : `⚠ ${t("freeScanPage.metric.contactAdd", { item: missingContact.join(", ") })}`,
      status: (contactPresent === 3 ? "success" : contactPresent >= 2 ? "warning" : "destructive") as Status,
      progress: (contactPresent / 3) * 100,
    }] : []),
  ];

  const advancedCards: MetricCardProps[] = [
    ...(readabilityScore ? [{
      icon: FileText,
      label: t('freeScan.readability'),
      tooltipKey: "readability",
      value: `${readabilityScore.score}%`,
      subtext: readabilityScore.verdict === "easy_to_scan" ? `✓ ${t("freeScanPage.metric.readEasy")}` : readabilityScore.verdict === "readable" ? `⚠ ${t("freeScanPage.metric.readSome")}` : `✗ ${t("freeScanPage.metric.readHard")}`,
      status: statusFromScore(readabilityScore.score, 70, 45),
      progress: readabilityScore.score,
    }] : []),
    {
      icon: Target,
      label: t('freeScan.bulletImpact'),
      tooltipKey: "bulletImpact",
      value: `${bulletImpactScore.score}%`,
      subtext: bulletImpactScore.tip || (bulletImpactScore.verdict === "achievement_focused" ? `✓ ${t("freeScanPage.metric.impactStrong")}` : bulletImpactScore.score >= 50 ? `⚠ ${t("freeScanPage.metric.impactEarlier")}` : `⚠ ${t("freeScanPage.metric.impactFocus")}`),
      status: statusFromScore(bulletImpactScore.score, 60, 40),
      progress: bulletImpactScore.score,
    },
    ...(keywordDensity ? [{
      icon: Hash,
      label: t('freeScan.keywordDensity'),
      tooltipKey: "keywordDensity",
      value: t(keywordDensity.level === "dense" ? "freeScanPage.metric.levelDense" : keywordDensity.level === "moderate" ? "freeScanPage.metric.levelModerate" : "freeScanPage.metric.levelSparse"),
      subtext: keywordDensity.level === "dense" ? `✓ ${t("freeScanPage.metric.densityDense")}` : keywordDensity.level === "moderate" ? `⚠ ${t("freeScanPage.metric.densityModerate")}` : `✗ ${t("freeScanPage.metric.densitySparse")}`,
      status: densityStatus,
      progress: densityScore,
    }] : []),
    // The number and its verdict come from the one projected gain (S13-058
    // recheck): the model's own level beside the projection's number read
    // "+10 pts, Already optimized". A gain of 0 says nothing worth a card.
    ...(improvementPotential && improvementPotential.estimatedScoreIncrease > 0 ? (() => {
      const gain = improvementPotential.estimatedScoreIncrease;
      const level = improvementLevelOf(gain);
      return [{
        icon: Zap,
        label: t('freeScan.improvementPotential'),
        tooltipKey: "improvementPotential",
        value: t('metricCards.improvement.value', { count: gain }),
        subtext: t(`metricCards.improvement.${level}`),
        status: (level === "low" ? "success" : level === "medium" ? "warning" : "muted") as Status,
      }];
    })() : []),
  ];

  return (
    <div className="space-y-4 mb-6">
      {/* Section: Primary Scores */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 px-1">
          {t("metricCards.section.primary")}
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
          {t("metricCards.section.structure")}
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
          {t("metricCards.section.advanced")}
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {advancedCards.map((card, i) => (
            <DashboardMetricCard key={i} {...card} />
          ))}
        </div>
      </div>

      {/* Highlights row: Top Strength + Red Flags */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {topStrength && (
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
        )}

        <div className="flex items-start gap-3 p-3 rounded-xl border border-destructive/20 bg-destructive/5">
          <div className="p-2 rounded-lg bg-destructive/10 shrink-0">
            <AlertTriangle className="w-4 h-4 text-destructive" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-destructive uppercase tracking-wider">
              {t('freeScan.redFlags')}
            </span>
            <p className="font-semibold text-foreground text-sm mt-0.5">
              {redFlags.length === 0 ? t("scoreHero.noRedFlags") : t("scoreHero.issue", { count: redFlags.length })}
            </p>
            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
              {redFlags.length > 0 ? redFlags[0].issue : t("metricCards.redFlagsClean")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
