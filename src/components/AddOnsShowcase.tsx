import { Link } from "react-router-dom";
import { Flame, MessageSquare, TrendingUp, ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRODUCTS, ProductId } from "@/config/products";
import { useCurrency } from "@/hooks/use-currency";
import { useProductCheckout } from "@/hooks/use-product-checkout";

const addOnProducts: { key: ProductId; icon: React.ElementType }[] = [
  { key: 'interviewCoach', icon: MessageSquare },
  { key: 'careerPathSimulator', icon: TrendingUp },
];

interface AddOnsShowcaseProps {
  variant?: 'compact' | 'full';
  sessionId?: string;
  className?: string;
}

export function AddOnsShowcase({ variant = 'compact', sessionId, className }: AddOnsShowcaseProps) {
  const { formatPrice, isLocalCurrency } = useCurrency();
  const { purchaseProduct, isLoading, currentProduct } = useProductCheckout();

  const handlePurchase = async (productId: ProductId) => {
    await purchaseProduct(productId, sessionId);
  };

  if (variant === 'compact') {
    return (
      <div className={cn("rounded-2xl bg-gradient-to-br from-accent/10 to-primary/5 border border-accent/30 p-5", className)}>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-primary" />
          <h4 className="font-bold text-foreground">Power-Up Add-Ons</h4>
          <Badge variant="secondary" className="text-xs">$5 each</Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-1">
          <Flame className="w-3 h-3 inline text-destructive" /> <strong>Resume Roast</strong> is included free with your scan!
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Get targeted insights to level up specific areas of your job search.
        </p>
        
        <div className="grid gap-3">
          {addOnProducts.map(({ key, icon: Icon }) => {
            const product = PRODUCTS[key];
            const isLoadingThis = isLoading && currentProduct === key;
            
            return (
              <button
                key={key}
                onClick={() => handlePurchase(key)}
                disabled={isLoading}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border bg-card/50 hover:bg-card hover:border-primary/50 transition-all text-left w-full",
                  isLoadingThis && "opacity-50"
                )}
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{product.name}</span>
                    <span className="text-xs font-bold text-primary">${product.priceUsd}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{product.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
        
        <Link 
          to="/pricing" 
          onClick={() => window.scrollTo(0, 0)}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-3"
        >
          View all products <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  // Full variant for pricing page
  return (
    <div className={cn("mb-12", className)}>
      <div className="text-center mb-8">
        <Badge variant="outline" className="mb-3 border-primary/30 text-primary">
          <Sparkles className="w-3 h-3 mr-1" />
          $5 Each
        </Badge>
        <h2 className="text-2xl md:text-3xl font-bold mb-2">Quick Add-Ons</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Targeted tools to boost specific areas of your job search. Mix and match for your needs.
        </p>
      </div>
      
      <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
        {addOnProducts.map(({ key, icon: Icon }) => {
          const product = PRODUCTS[key];
          const isLoadingThis = isLoading && currentProduct === key;
          
          return (
            <div
              key={key}
              className="flex flex-col p-5 rounded-xl border-2 border-border bg-card hover:border-primary/50 transition-all"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold">{product.name}</h3>
                  <p className="text-xl font-bold text-primary">${product.priceUsd}</p>
                </div>
              </div>
              
              <p className="text-sm text-muted-foreground mb-4">{product.description}</p>
              
              <ul className="space-y-2 mb-4 flex-1">
                {product.features.slice(0, 3).map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              
              <Button
                onClick={() => handlePurchase(key)}
                disabled={isLoading}
                variant="outline"
                size="sm"
                className="w-full gap-2"
              >
                {isLoadingThis ? 'Processing...' : `Get for $${product.priceUsd}`}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
