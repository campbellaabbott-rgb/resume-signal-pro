import { Link } from "react-router-dom";
import { Crown, FileText, Package, ArrowRight, Sparkles, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PRODUCTS, ProductId } from "@/config/products";
import { useCurrency } from "@/hooks/use-currency";

const featuredProductKeys: { key: ProductId; highlight?: boolean }[] = [
  { key: 'premiumPackage', highlight: false },
  { key: 'atsDefense', highlight: true },
  { key: 'careerBundle', highlight: false },
];

const productIcons: Record<string, React.ElementType> = {
  premiumPackage: Crown,
  atsDefense: ShieldCheck,
  careerBundle: Package,
};

export function MiniPricingCards() {
  const { formatPrice, isLocalCurrency } = useCurrency();

  return (
    <section className="py-16 border-t border-border/50">
      <div className="container">
        <div className="text-center mb-10">
          <Badge variant="outline" className="mb-3 text-xs px-3 py-1 rounded-full border-primary/30 text-primary">
            <Sparkles className="w-3 h-3 mr-1" />
            One-time payments
          </Badge>
          <h2 className="text-2xl md:text-3xl font-bold mb-2">
            Choose Your Resume Boost
          </h2>
          <p className="text-muted-foreground">
            From quick fixes to complete career packages
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {featuredProductKeys.map(({ key, highlight }) => {
            const product = PRODUCTS[key];
            const Icon = productIcons[key] || Sparkles;
            const badge = 'badge' in product ? product.badge : undefined;
            
            return (
              <Link
                key={key}
                to="/pricing"
                className={cn(
                  "group relative p-5 rounded-xl border-2 bg-card transition-all hover:shadow-lg hover:-translate-y-1",
                  highlight
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/50"
                )}
              >
                {badge && (
                  <span className={cn(
                    "absolute -top-2.5 left-1/2 -translate-x-1/2 text-xs font-medium px-2.5 py-0.5 rounded-full",
                    highlight
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-accent-foreground"
                  )}>
                    {badge}
                  </span>
                )}
                
                <div className="flex items-center gap-3 mb-3">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    highlight ? "bg-primary/20" : "bg-accent"
                  )}>
                    <Icon className={cn(
                      "w-5 h-5",
                      highlight ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{product.name}</h3>
                    <p className="text-xs text-muted-foreground">{product.description}</p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-2xl font-bold">${product.priceUsd}</span>
                    {isLocalCurrency && (
                      <p className="text-xs text-muted-foreground">≈ {formatPrice(product.priceUsd)}</p>
                    )}
                  </div>
                  <span className="text-xs text-primary group-hover:translate-x-1 transition-transform flex items-center gap-1">
                    View details <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="text-center mt-8">
          <Link
            to="/pricing"
            onClick={() => window.scrollTo(0, 0)}
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            Compare all packages
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
