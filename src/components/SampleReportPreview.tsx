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

const sampleData = {
  score: 47,
  sections: [
    { name: "Contact Info", status: "pass", detail: "Properly formatted" },
    { name: "Keywords", status: "fail", detail: "Missing 12 critical terms" },
    { name: "Experience", status: "warning", detail: "Weak action verbs" },
    { name: "Education", status: "pass", detail: "Correctly parsed" },
  ],
  missingKeywords: ["project management", "stakeholder", "Agile", "KPIs"],
  allMissingKeywords: ["project management", "stakeholder", "Agile", "KPIs", "cross-functional", "ROI", "data-driven", "strategic planning", "process improvement", "budget management", "team leadership", "roadmap"],
  quickFixes: [
    "Add quantified achievements (numbers, %, $)",
    "Replace 'responsible for' with action verbs",
    "Include 3 more industry keywords"
  ],
  detailedFixes: [
    { category: "Impact Metrics", fix: "Add 3-5 quantified results (e.g., 'Increased sales by 23%')", priority: "high" },
    { category: "Action Verbs", fix: "Replace passive phrases like 'responsible for' with 'Led', 'Drove', 'Achieved'", priority: "high" },
    { category: "Keywords", fix: "Add missing industry terms: 'stakeholder management', 'Agile methodology'", priority: "medium" },
    { category: "Formatting", fix: "Use consistent date format (MM/YYYY) throughout", priority: "low" },
    { category: "Summary", fix: "Add a 2-3 line professional summary at the top", priority: "medium" }
  ],
  atsIssues: [
    { issue: "Tables detected", impact: "May break parsing in 60% of ATS systems" },
    { issue: "Graphics/icons used", impact: "Will be ignored or cause errors" },
    { issue: "Non-standard section headers", impact: "Skills section may not be recognized" }
  ]
};

export function SampleReportPreview() {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pass":
        return <CheckCircle2 className="w-4 h-4 text-success" />;
      case "fail":
        return <XCircle className="w-4 h-4 text-destructive" />;
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-warning" />;
      default:
        return null;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "text-destructive bg-destructive/10";
      case "medium": return "text-warning bg-warning/10";
      case "low": return "text-muted-foreground bg-muted";
      default: return "text-muted-foreground bg-muted";
    }
  };

  return (
    <div className="relative max-w-md mx-auto">
      {/* Label */}
      <div className="flex items-center justify-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-muted-foreground">
          {isExpanded ? "Exploring sample report" : "Here's what you'll see after upload"}
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
        {/* Badges row - inside card at top */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border/30">
          <div className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
            Sample Report
          </div>
          <div className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center gap-1">
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {isExpanded ? "Collapse" : "Click to explore"}
          </div>
        </div>

        <div className="p-4">
          {/* Score Circle */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative w-16 h-16 flex-shrink-0">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle
                  cx="18" cy="18" r="15.9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-muted"
                />
                <circle
                  cx="18" cy="18" r="15.9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${sampleData.score}, 100`}
                  strokeLinecap="round"
                  className="text-destructive transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-destructive">{sampleData.score}</span>
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">ATS Compatibility Score</p>
              <p className="text-xs text-destructive font-medium">Needs Improvement</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your resume may be filtered out by 73% of ATS systems
              </p>
            </div>
          </div>

          {/* Section Checks */}
          <div className="space-y-2 mb-4">
            {sampleData.sections.map((section, i) => (
              <div 
                key={section.name}
                className="flex items-center justify-between p-2 rounded-lg bg-background/50"
              >
                <div className="flex items-center gap-2">
                  {getStatusIcon(section.status)}
                  <span className="text-sm font-medium text-foreground">{section.name}</span>
                </div>
                <span className={cn(
                  "text-xs",
                  section.status === "pass" && "text-success",
                  section.status === "fail" && "text-destructive",
                  section.status === "warning" && "text-warning"
                )}>
                  {section.detail}
                </span>
              </div>
            ))}
          </div>

          {/* Missing Keywords Preview */}
          <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-destructive" />
              <span className="text-xs font-semibold text-destructive">Missing Keywords</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(isExpanded ? sampleData.allMissingKeywords : sampleData.missingKeywords).map((keyword) => (
                <span 
                  key={keyword}
                  className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs"
                >
                  {keyword}
                </span>
              ))}
              {!isExpanded && (
                <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                  +8 more
                </span>
              )}
            </div>
          </div>

          {/* Expanded Content */}
          <div className={cn(
            "overflow-hidden transition-all duration-500",
            isExpanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
          )}>
            {/* ATS Compatibility Issues */}
            <div className="p-3 rounded-xl bg-warning/5 border border-warning/20 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-warning" />
                <span className="text-xs font-semibold text-warning">ATS Parsing Issues Found</span>
              </div>
              <div className="space-y-2">
                {sampleData.atsIssues.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="w-3 h-3 text-warning mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">{item.issue}</span>
                      <span className="text-muted-foreground"> — {item.impact}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Fixes */}
            <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-primary">Prioritized Improvements</span>
              </div>
              <div className="space-y-2">
                {sampleData.detailedFixes.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium uppercase flex-shrink-0", getPriorityColor(item.priority))}>
                      {item.priority}
                    </span>
                    <div>
                      <span className="font-medium text-foreground">{item.category}:</span>
                      <span className="text-muted-foreground"> {item.fix}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Score Breakdown */}
            <div className="p-3 rounded-xl bg-muted/50 border border-border mb-4">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-4 h-4 text-foreground" />
                <span className="text-xs font-semibold text-foreground">Score Breakdown</span>
              </div>
              <div className="space-y-2">
                {[
                  { label: "Keyword Match", score: 35, max: 30 },
                  { label: "Formatting", score: 65, max: 25 },
                  { label: "Experience Relevance", score: 50, max: 25 },
                  { label: "Education", score: 80, max: 20 }
                ].map((item) => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{item.label}</span>
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

          {/* Quick Fixes Preview (collapsed view) */}
          {!isExpanded && (
            <div className="p-3 rounded-xl bg-success/5 border border-success/20">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-success" />
                <span className="text-xs font-semibold text-success">AI-Powered Fixes Included</span>
              </div>
              <ul className="space-y-1">
                {sampleData.quickFixes.slice(0, 2).map((fix, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3 h-3 text-success mt-0.5 flex-shrink-0" />
                    <span>{fix}</span>
                  </li>
                ))}
                <li className="text-xs text-success font-medium pl-5">
                  + more personalized suggestions
                </li>
              </ul>
            </div>
          )}

          {/* Expanded CTA */}
          {isExpanded && (
            <div className="p-3 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 text-center">
              <p className="text-sm font-semibold text-foreground mb-1">Ready to see your real score?</p>
              <p className="text-xs text-muted-foreground">Upload your resume above to get personalized insights</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom text */}
      <p className="text-center text-xs text-muted-foreground mt-3">
        <FileText className="w-3 h-3 inline mr-1" />
        {isExpanded ? "This is sample data — your report will be unique to your resume" : "Your actual report will be personalized to your resume"}
      </p>
    </div>
  );
}
