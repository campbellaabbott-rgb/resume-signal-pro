import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComparisonRow {
  feature: string;
  us: string | boolean;
  them: string | boolean;
}

export function ValueComparison() {
  const comparisons: ComparisonRow[] = [
    {
      feature: "Time to results",
      us: "Under 60 seconds",
      them: "3-7 business days",
    },
    {
      feature: "Cost",
      us: "$5 – $25 one-time",
      them: "$150 – $500+",
    },
    {
      feature: "ATS optimization",
      us: true,
      them: "Varies by writer",
    },
    {
      feature: "Keyword analysis",
      us: "Industry-specific AI",
      them: "Manual research",
    },
    {
      feature: "Revisions included",
      us: "Unlimited retries",
      them: "1-2 rounds",
    },
    {
      feature: "Job-specific tailoring",
      us: true,
      them: "Extra $50-100",
    },
  ];

  const renderCell = (value: string | boolean) => {
    if (typeof value === "boolean") {
      return value ? (
        <Check className="w-5 h-5 text-primary mx-auto" />
      ) : (
        <X className="w-5 h-5 text-muted-foreground mx-auto" />
      );
    }
    return <span className="text-sm">{value}</span>;
  };

  return (
    <div className="rounded-xl border border-border bg-card/50 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-3 bg-muted/30 border-b border-border">
        <div className="p-3 md:p-4 font-medium text-sm text-muted-foreground">
          Feature
        </div>
        <div className="p-3 md:p-4 text-center">
          <span className="font-bold text-primary text-sm md:text-base">Resume Booster</span>
        </div>
        <div className="p-3 md:p-4 text-center">
          <span className="font-medium text-muted-foreground text-sm md:text-base">
            Traditional Writer
          </span>
        </div>
      </div>

      {/* Rows */}
      {comparisons.map((row, index) => (
        <div
          key={row.feature}
          className={cn(
            "grid grid-cols-3",
            index !== comparisons.length - 1 && "border-b border-border/50"
          )}
        >
          <div className="p-3 md:p-4 text-sm text-muted-foreground font-medium">
            {row.feature}
          </div>
          <div className="p-3 md:p-4 text-center font-medium bg-primary/5">
            {renderCell(row.us)}
          </div>
          <div className="p-3 md:p-4 text-center text-muted-foreground">
            {renderCell(row.them)}
          </div>
        </div>
      ))}
    </div>
  );
}
