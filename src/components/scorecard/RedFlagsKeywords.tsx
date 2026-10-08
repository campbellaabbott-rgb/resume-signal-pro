import { useState } from "react";
import {
  AlertTriangle, Lock, Target, Zap, ChevronDown, ChevronUp,
  ShieldAlert, AlertCircle, Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

// --- Types ---

interface RedFlag {
  issue: string;
  impact: string;
  severity?: "critical" | "moderate" | "minor";
}

interface KeywordSuggestion {
  keyword: string;
  reason: string;
  category?: "tool" | "skill" | "certification" | "methodology" | "metric" | "regulation";
  impact?: "critical" | "high" | "medium";
}

// --- Severity helpers ---

function inferSeverity(flag: RedFlag, index: number): "critical" | "major" | "minor" {
  // Use AI-supplied severity when available (AI uses "moderate" → map to "major")
  if (flag.severity === "critical") return "critical";
  if (flag.severity === "moderate") return "major";
  if (flag.severity === "minor") return "minor";
  const text = (flag.issue + " " + flag.impact).toLowerCase();
  if (text.includes("missing") || text.includes("no ") || text.includes("lack") || text.includes("absent") || text.includes("without") || index === 0) return "critical";
  if (text.includes("weak") || text.includes("unclear") || text.includes("vague") || text.includes("inconsistent") || index === 1) return "major";
  return "minor";
}

const severityConfig = {
  critical: {
    label: "Critical",
    icon: ShieldAlert,
    bg: "bg-destructive/10 border-destructive/25",
    badge: "bg-destructive/15 text-destructive",
    iconColor: "text-destructive",
    dot: "bg-destructive",
  },
  major: {
    label: "Major",
    icon: AlertCircle,
    bg: "bg-warning/10 border-warning/25",
    badge: "bg-warning/15 text-warning",
    iconColor: "text-warning",
    dot: "bg-warning",
  },
  minor: {
    label: "Minor",
    icon: Info,
    bg: "bg-muted/50 border-border",
    badge: "bg-muted text-muted-foreground",
    iconColor: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

const impactConfig = {
  critical: {
    label: "Must have",
    badge: "bg-destructive/15 text-destructive border-destructive/20",
  },
  high: {
    label: "High impact",
    badge: "bg-warning/15 text-warning border-warning/20",
  },
  medium: {
    label: "Helpful",
    badge: "bg-muted text-muted-foreground border-border",
  },
};

const categoryConfig: Record<string, { label: string; className: string }> = {
  certification: { label: "Certification", className: "bg-success/10 text-success" },
  tool: { label: "Tool", className: "bg-primary/10 text-primary" },
  skill: { label: "Skill", className: "bg-warning/10 text-warning" },
  methodology: { label: "Method", className: "bg-accent/50 text-accent-foreground" },
  metric: { label: "Metric", className: "bg-primary/10 text-primary" },
  regulation: { label: "Regulation", className: "bg-destructive/10 text-destructive" },
};

// --- Red Flags Section ---

// Findings only: the free report's two paid offers live in its Next steps
// section (owner decision 2026-10-08). The "More red flags in full analysis"
// hint and the $12 package button that sat here promised what no product
// was shown to deliver.
interface RedFlagsSectionProps {
  redFlags: RedFlag[];
}

export function RedFlagsSection({ redFlags }: RedFlagsSectionProps) {
  if (redFlags.length === 0) return null;

  // Sort by inferred severity
  const sorted = redFlags.map((flag, i) => ({
    ...flag,
    severity: inferSeverity(flag, i),
  })).sort((a, b) => {
    const order = { critical: 0, major: 1, minor: 2 };
    return order[a.severity] - order[b.severity];
  });

  const criticalCount = sorted.filter(f => f.severity === "critical").length;
  const majorCount = sorted.filter(f => f.severity === "major").length;
  const minorCount = sorted.filter(f => f.severity === "minor").length;

  return (
    <div className="rounded-2xl border border-destructive/20 bg-card p-5 mb-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-destructive/10">
            <AlertTriangle className="w-4 h-4 text-destructive" />
          </div>
          <h4 className="font-bold text-base">Recruiter Red Flags</h4>
        </div>
        {/* Severity summary pills */}
        <div className="flex items-center gap-1.5">
          {criticalCount > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
              {criticalCount} critical
            </span>
          )}
          {majorCount > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-warning/15 text-warning">
              {majorCount} major
            </span>
          )}
          {minorCount > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {minorCount} minor
            </span>
          )}
        </div>
      </div>

      {/* Flag cards */}
      <div className="space-y-2">
        {sorted.map((flag, index) => {
          const config = severityConfig[flag.severity];
          const SevIcon = config.icon;
          return (
            <div
              key={index}
              className={cn(
                "flex items-start gap-3 p-3 rounded-xl border transition-colors",
                config.bg
              )}
            >
              <div className="shrink-0 mt-0.5">
                <SevIcon className={cn("w-4 h-4", config.iconColor)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-foreground text-sm">{flag.issue}</span>
                  <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0", config.badge)}>
                    {config.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{flag.impact}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Keywords Section ---

interface KeywordsSectionProps {
  keywords: KeywordSuggestion[];
  industry: string;
}

export function KeywordsSection({
  keywords,
  industry,
}: KeywordsSectionProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Sort by impact: critical > high > medium
  const sorted = [...keywords].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, undefined: 3 };
    return (order[a.impact || "undefined"] ?? 3) - (order[b.impact || "undefined"] ?? 3);
  });

  const visibleCount = expanded ? sorted.length : Math.min(sorted.length, 3);
  const hiddenCount = sorted.length - 3;

  // Group counts
  const criticalKw = sorted.filter(k => k.impact === "critical").length;
  const highKw = sorted.filter(k => k.impact === "high").length;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <h4 className="font-bold text-base">{t('freeScan.missingKeywords')}</h4>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize">
          {industry.replace(/_/g, " ")}
        </span>
      </div>

      {/* Impact summary */}
      {(criticalKw > 0 || highKw > 0) && (
        <div className="flex items-center gap-2 mb-3 mt-2">
          {criticalKw > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
              {criticalKw} must-have
            </span>
          )}
          {highKw > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-warning/15 text-warning">
              {highKw} high impact
            </span>
          )}
        </div>
      )}

      {/* Keyword cards */}
      <div className="space-y-2">
        {sorted.slice(0, visibleCount).map((item, index) => {
          const impact = impactConfig[item.impact || "medium"];
          const cat = item.category ? categoryConfig[item.category] : null;

          return (
            <div
              key={index}
              className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card/50 hover:bg-card/80 transition-colors"
            >
              {/* Priority indicator */}
              <div className={cn(
                "shrink-0 mt-1 w-2 h-2 rounded-full",
                item.impact === "critical" ? "bg-destructive" :
                item.impact === "high" ? "bg-warning" :
                "bg-muted-foreground/40"
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <span className="font-semibold text-foreground text-sm">{item.keyword}</span>
                  {cat && (
                    <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full", cat.className)}>
                      {cat.label}
                    </span>
                  )}
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border", impact.badge)}>
                    {impact.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.reason}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Show more / locked */}
      {hiddenCount > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 w-full p-2.5 mt-2 rounded-xl border border-dashed border-muted-foreground/25 text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>+{hiddenCount} more {industry.replace(/_/g, " ")} keywords</span>
          <ChevronDown className="w-3.5 h-3.5 ml-auto" />
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(false)}
          className="flex items-center justify-center gap-1.5 w-full p-2 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronUp className="w-3.5 h-3.5" />
          Show less
        </button>
      )}
    </div>
  );
}
