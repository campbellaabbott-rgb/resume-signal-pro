import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Target,
  FileText,
  TrendingUp,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Zap,
  BarChart3,
  Lightbulb
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const missingKeywords = ["project management", "stakeholder", "Agile", "KPIs"];
const allMissingKeywords = ["project management", "stakeholder", "Agile", "KPIs", "cross-functional", "ROI", "data-driven", "strategic planning", "process improvement", "budget management", "team leadership", "roadmap"];
const sampleScore = 47;

export function SampleReportPreview() {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const sections = [
    { key: "contactInfo", detailKey: "properlyFormatted", status: "pass" },
    { key: "keywords", detailKey: "missing12", status: "fail" },
    { key: "experience", detailKey: "weakActionVerbs", status: "warning" },
    { key: "education", detailKey: "correctlyParsed", status: "pass" },
  ];

  const atsIssues = [
    { issueKey: "tablesDetected", impactKey: "tablesImpact" },
    { issueKey: "graphicsUsed", impactKey: "graphicsImpact" },
    { issueKey: "nonStandardHeaders", impactKey: "headersImpact" },
  ];

  const detailedFixes = [
    { categoryKey: "impactMetrics", fixKey: "impactMetricsFix", priorityKey: "high" },
    { categoryKey: "actionVerbs", fixKey: "actionVerbsFix", priorityKey: "high" },
    { categoryKey: "keywords", fixKey: "keywordsFix", priorityKey: "medium" },
    { categoryKey: "formatting", fixKey: "formattingFix", priorityKey: "low" },
    { categoryKey: "summary", fixKey: "summaryFix", priorityKey: "medium" },
  ];

  const scoreBreakdown = [
    { labelKey: "keywordMatch", score: 35 },
    { labelKey: "formatting", score: 65 },
    { labelKey: "experienceRelevance", score: 50 },
    { labelKey: "education", score: 80 },
  ];

  const quickFixes = [
    t('sampleReportPreview.quickFixes.fix1'),
    t('sampleReportPreview.quickFixes.fix2'),
    t('sampleReportPreview.quickFixes.fix3'),
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pass": return <CheckCircle2 className="w-4 h-4 text-success" />;
      case "fail": return <XCircle className="w-4 h-4 text-destructive" />;
      case "warning": return <AlertTriangle className="w-4 h-4 text-warning" />;
      default: return null;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "text-destructive bg-destructive/10";
      case "medium": return "text-warning bg-warning/10";
      default: return "text-muted-foreground bg-muted";
    }
  };

  return (
    <div className="relative max-w-md mx-auto">
      {/* Label */}
      <div className="flex items-center justify-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-muted-foreground">
          {isExpanded ? t('sampleReportPreview.exploring') : t('sampleReportPreview.hereIsWhat')}
        </span>
      </div>

      {/* Preview Card */}
      <div
        className={cn(
          "relative rounded-2xl border-2 border-border/50 bg-card/80 backdrop-blur-sm shadow-xl transition-all duration-500 cursor-pointer",
          isExpanded ? "border-primary/30 shadow-2xl shadow-primary/10" : "hover:border-primary/30 hover:shadow-lg"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Badges row */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border/30">
          <div className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
            {t('sampleReportPreview.sampleReport')}
          </div>
          <div className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center gap-1">
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {isExpanded ? t('sampleReportPreview.collapse') : t('sampleReportPreview.clickToExplore')}
          </div>
        </div>

        <div className="p-4">
          {/* Score Circle */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative w-16 h-16 flex-shrink-0">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${sampleScore}, 100`} strokeLinecap="round" className="text-destructive transition-all duration-1000" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-destructive">{sampleScore}</span>
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">{t('sampleReportPreview.atsScore')}</p>
              <p className="text-xs text-destructive font-medium">{t('sampleReportPreview.needsImprovement')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('sampleReportPreview.filteredOut')}</p>
            </div>
          </div>

          {/* Section Checks */}
          <div className="space-y-2 mb-4">
            {sections.map((section) => (
              <div key={section.key} className="flex items-center justify-between p-2 rounded-lg bg-background/50">
                <div className="flex items-center gap-2">
                  {getStatusIcon(section.status)}
                  <span className="text-sm font-medium text-foreground">{t(`sampleReportPreview.sections.${section.key}`)}</span>
                </div>
                <span className={cn(
                  "text-xs",
                  section.status === "pass" && "text-success",
                  section.status === "fail" && "text-destructive",
                  section.status === "warning" && "text-warning"
                )}>
                  {t(`sampleReportPreview.sectionDetails.${section.detailKey}`)}
                </span>
              </div>
            ))}
          </div>

          {/* Missing Keywords Preview */}
          <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-destructive" />
              <span className="text-xs font-semibold text-destructive">{t('sampleReportPreview.missingKeywords')}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(isExpanded ? allMissingKeywords : missingKeywords).map((keyword) => (
                <span key={keyword} className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs">
                  {keyword}
                </span>
              ))}
              {!isExpanded && (
                <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                  {t('sampleReportPreview.plusMore')}
                </span>
              )}
            </div>
          </div>

          {/* Expanded Content */}
          <div className={cn(
            "overflow-hidden transition-all duration-500",
            isExpanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
          )}>
            {/* ATS Parsing Issues */}
            <div className="p-3 rounded-xl bg-warning/5 border border-warning/20 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-warning" />
                <span className="text-xs font-semibold text-warning">{t('sampleReportPreview.atsParsing')}</span>
              </div>
              <div className="space-y-2">
                {atsIssues.map((item) => (
                  <div key={item.issueKey} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="w-3 h-3 text-warning mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">{t(`sampleReportPreview.atsIssues.${item.issueKey}`)}</span>
                      <span className="text-muted-foreground"> — {t(`sampleReportPreview.atsIssues.${item.impactKey}`)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Fixes */}
            <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-primary">{t('sampleReportPreview.prioritizedImprovements')}</span>
              </div>
              <div className="space-y-2">
                {detailedFixes.map((item) => (
                  <div key={item.categoryKey} className="flex items-start gap-2 text-xs">
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium uppercase flex-shrink-0", getPriorityColor(item.priorityKey))}>
                      {t(`sampleReportPreview.priority.${item.priorityKey}`)}
                    </span>
                    <div>
                      <span className="font-medium text-foreground">{t(`sampleReportPreview.fixes.${item.categoryKey}`)}:</span>
                      <span className="text-muted-foreground"> {t(`sampleReportPreview.fixes.${item.fixKey}`)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Score Breakdown */}
            <div className="p-3 rounded-xl bg-muted/50 border border-border mb-4">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-4 h-4 text-foreground" />
                <span className="text-xs font-semibold text-foreground">{t('sampleReportPreview.scoreBreakdown')}</span>
              </div>
              <div className="space-y-2">
                {scoreBreakdown.map((item) => (
                  <div key={item.labelKey} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{t(`sampleReportPreview.scoreLabels.${item.labelKey}`)}</span>
                      <span className="font-medium text-foreground">{item.score}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          item.score >= 70 ? "bg-success" : item.score >= 50 ? "bg-warning" : "bg-destructive"
                        )}
                        style={{ width: `${item.score}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Fixes Preview (collapsed) */}
          {!isExpanded && (
            <div className="p-3 rounded-xl bg-success/5 border border-success/20">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-success" />
                <span className="text-xs font-semibold text-success">{t('sampleReportPreview.aiPoweredFixes')}</span>
              </div>
              <ul className="space-y-1">
                {quickFixes.slice(0, 2).map((fix, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3 h-3 text-success mt-0.5 flex-shrink-0" />
                    <span>{fix}</span>
                  </li>
                ))}
                <li className="text-xs text-success font-medium pl-5">
                  {t('sampleReportPreview.moreSuggestions')}
                </li>
              </ul>
            </div>
          )}

          {/* Expanded CTA */}
          {isExpanded && (
            <div className="p-3 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 text-center">
              <p className="text-sm font-semibold text-foreground mb-1">{t('sampleReportPreview.readyToSeeScore')}</p>
              <p className="text-xs text-muted-foreground">{t('sampleReportPreview.uploadAbove')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom text */}
      <p className="text-center text-xs text-muted-foreground mt-3">
        <FileText className="w-3 h-3 inline mr-1" />
        {isExpanded ? t('sampleReportPreview.sampleData') : t('sampleReportPreview.personalizedReport')}
      </p>
    </div>
  );
}
