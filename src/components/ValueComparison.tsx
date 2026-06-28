import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface ComparisonRow {
  feature: string;
  us: string | boolean;
  them: string | boolean;
}

export function ValueComparison() {
  const { t } = useTranslation();
  const comparisons: ComparisonRow[] = [
    {
      feature: t('valueComparison.rows.timeToResults.feature'),
      us: t('valueComparison.rows.timeToResults.us'),
      them: t('valueComparison.rows.timeToResults.them'),
    },
    {
      feature: t('valueComparison.rows.cost.feature'),
      us: t('valueComparison.rows.cost.us'),
      them: t('valueComparison.rows.cost.them'),
    },
    {
      feature: t('valueComparison.rows.atsOptimization.feature'),
      us: true,
      them: t('valueComparison.rows.atsOptimization.them'),
    },
    {
      feature: t('valueComparison.rows.keywordAnalysis.feature'),
      us: t('valueComparison.rows.keywordAnalysis.us'),
      them: t('valueComparison.rows.keywordAnalysis.them'),
    },
    {
      feature: t('valueComparison.rows.revisions.feature'),
      us: t('valueComparison.rows.revisions.us'),
      them: t('valueComparison.rows.revisions.them'),
    },
    {
      feature: t('valueComparison.rows.jobTailoring.feature'),
      us: true,
      them: t('valueComparison.rows.jobTailoring.them'),
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
          {t('valueComparison.feature')}
        </div>
        <div className="p-3 md:p-4 text-center">
          <span className="font-bold text-primary text-sm md:text-base">{t('valueComparison.us')}</span>
        </div>
        <div className="p-3 md:p-4 text-center">
          <span className="font-medium text-muted-foreground text-sm md:text-base">
            {t('valueComparison.them')}
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
