import { useState } from "react";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Target, 
  FileText,
  TrendingUp,
  Sparkles,
  ChevronRight
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
  quickFixes: [
    "Add quantified achievements (numbers, %, $)",
    "Replace 'responsible for' with action verbs",
    "Include 3 more industry keywords"
  ]
};

export function SampleReportPreview() {
  const [isHovered, setIsHovered] = useState(false);
  
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

  return (
    <div 
      className="relative max-w-md mx-auto"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Label */}
      <div className="flex items-center justify-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-muted-foreground">
          Here's what you'll see after upload
        </span>
      </div>

      {/* Preview Card */}
      <div 
        className={cn(
          "relative rounded-2xl border-2 border-border/50 bg-card/80 backdrop-blur-sm p-4 shadow-xl transition-all duration-500",
          isHovered && "border-primary/50 shadow-2xl shadow-primary/10 scale-[1.02]"
        )}
      >
        {/* Sample badge */}
        <div className="absolute -top-3 left-4 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
          Sample Report
        </div>

        {/* Score Circle */}
        <div className="flex items-center gap-4 mb-4 pt-2">
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
              style={{ animationDelay: `${i * 0.1}s` }}
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
            {sampleData.missingKeywords.map((keyword) => (
              <span 
                key={keyword}
                className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs"
              >
                {keyword}
              </span>
            ))}
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
              +8 more
            </span>
          </div>
        </div>

        {/* Quick Fixes Preview */}
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

        {/* Hover overlay */}
        <div className={cn(
          "absolute inset-0 rounded-2xl bg-gradient-to-t from-primary/90 via-primary/70 to-transparent flex items-end justify-center p-6 transition-opacity duration-300",
          isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
        )}>
          <div className="text-center text-primary-foreground">
            <p className="font-bold text-lg mb-1">Get Your Real Score</p>
            <p className="text-sm opacity-90 flex items-center gap-1 justify-center">
              Upload your resume to see your results
              <ChevronRight className="w-4 h-4" />
            </p>
          </div>
        </div>
      </div>

      {/* Bottom text */}
      <p className="text-center text-xs text-muted-foreground mt-3">
        <FileText className="w-3 h-3 inline mr-1" />
        Your actual report will be personalized to your resume
      </p>
    </div>
  );
}
