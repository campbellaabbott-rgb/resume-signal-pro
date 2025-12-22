import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { PRODUCTS } from "@/config/products";

interface ComparisonRow {
  label: string;
  us: string;
  them: string;
}

export function ValueComparison() {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  
  // Use the actual premium package price for comparison (most valuable product)
  const comparisonPrice = PRODUCTS.atsDefense.priceUsd;

  const comparisons: ComparisonRow[] = [
    {
      label: t("valueComparison.price", "Price"),
      us: `$${comparisonPrice}${isLocalCurrency ? ` ≈ ${formatPrice(comparisonPrice)}` : ""}`,
      them: "$150–$500",
    },
    {
      label: t("valueComparison.speed", "Speed"),
      us: t("valueComparison.instant", "Instant results"),
      them: t("valueComparison.days", "3–7 day wait"),
    },
    {
      label: t("valueComparison.optimization", "Optimization"),
      us: t("valueComparison.atsOptimized", "ATS-optimized"),
      them: t("valueComparison.subjective", "Often subjective"),
    },
  ];

  return (
    <div className="rounded-xl border border-border bg-card/50 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-3 bg-muted/30 border-b border-border">
        <div className="p-3 md:p-4" />
        <div className="p-3 md:p-4 text-center">
          <span className="font-bold text-primary text-sm md:text-base">Resume Booster</span>
        </div>
        <div className="p-3 md:p-4 text-center">
          <span className="font-medium text-muted-foreground text-sm md:text-base">
            {t("valueComparison.traditional", "Traditional Resume Writer")}
          </span>
        </div>
      </div>

      {/* Rows */}
      {comparisons.map((row, index) => (
        <div
          key={row.label}
          className={`grid grid-cols-3 ${
            index !== comparisons.length - 1 ? "border-b border-border/50" : ""
          }`}
        >
          <div className="p-3 md:p-4 text-sm text-muted-foreground font-medium">
            {row.label}
          </div>
          <div className="p-3 md:p-4 text-center text-sm font-medium bg-primary/5">
            {row.us}
          </div>
          <div className="p-3 md:p-4 text-center text-sm text-muted-foreground">
            {row.them}
          </div>
        </div>
      ))}
    </div>
  );
}
