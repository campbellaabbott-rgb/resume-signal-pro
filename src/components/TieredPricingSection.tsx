import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Crown, Sparkles, FileText, ArrowRight, Loader2 } from "lucide-react";
import { PRODUCTS, ProductId } from "@/config/products";
import { useProductCheckout } from "@/hooks/use-product-checkout";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { useTranslation } from "react-i18next";

interface TieredPricingSectionProps {
  onFullAnalysisCheckout?: () => void;
  sessionId?: string;
}

const tiers: { key: ProductId; highlight?: boolean }[] = [
  { key: 'basicKeywordFix' },
  { key: 'fullAnalysis', highlight: true },
  { key: 'premiumPackage' },
];

const tierIcons: Record<string, React.ElementType> = {
  basicKeywordFix: FileText,
  fullAnalysis: Sparkles,
  premiumPackage: Crown,
};

export function TieredPricingSection({ onFullAnalysisCheckout, sessionId }: TieredPricingSectionProps) {
  const { purchaseProduct, isLoading, currentProduct } = useProductCheckout();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const { t } = useTranslation();

  const handleSelect = async (productId: ProductId) => {
    const product = PRODUCTS[productId];

    // Full analysis uses existing checkout flow
    if ('useMainCheckout' in product && product.useMainCheckout && onFullAnalysisCheckout) {
      onFullAnalysisCheckout();
      return;
    }

    await purchaseProduct(productId, sessionId);
  };

  return (
    <div className="my-8">
      <div className="text-center mb-6">
        <h3 className="text-xl font-bold mb-2">{t("tieredPricing.title")}</h3>
        <p className="text-muted-foreground text-sm">{t("tieredPricing.subtitle")}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {tiers.map(({ key, highlight }) => {
          const product = PRODUCTS[key];
          const Icon = tierIcons[key] || Sparkles;
          const isLoadingThis = isLoading && currentProduct === key;
          
          return (
            <div 
              key={key}
              className={cn(
                "relative flex flex-col p-5 rounded-xl border-2 transition-all",
                highlight 
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-lg" 
                  : "border-border hover:border-primary/50 bg-card"
              )}
            >
              {/* Popular badge */}
              {highlight && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs">
                  {t("tieredPricing.mostPopular")}
                </Badge>
              )}
              
              {/* Icon & Name */}
              <div className="flex items-center gap-3 mb-3">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  highlight ? "bg-primary/20" : "bg-accent"
                )}>
                  <Icon className={cn("w-5 h-5", highlight ? "text-primary" : "text-muted-foreground")} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm">{t(`tieredPricing.products.${key}.name`, product.name)}</h4>
                  <p className="text-xs text-muted-foreground">{t(`tieredPricing.products.${key}.description`, product.description)}</p>
                </div>
              </div>

              {/* Price */}
              <div className="mb-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold">${product.priceUsd}</span>
                  <span className="text-xs text-muted-foreground">{t("tieredPricing.oneTime")}</span>
                </div>
                {isLocalCurrency && (
                  <p className="text-xs text-muted-foreground">≈ {formatPrice(product.priceUsd)}</p>
                )}
              </div>

              {/* Features (first 3) */}
              <ul className="space-y-1.5 mb-4 flex-1">
                {product.features.slice(0, 3).map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Button
                onClick={() => handleSelect(key)}
                disabled={isLoading}
                size="sm"
                className={cn(
                  "w-full gap-1.5",
                  highlight && "shadow-md shadow-primary/20"
                )}
                variant={highlight ? "default" : "outline"}
              >
                {isLoadingThis ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    {t("tieredPricing.select")}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        {t("tieredPricing.footer")}
      </p>

    </div>
  );
}
