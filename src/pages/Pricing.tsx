import { Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, FileText, Crown, Package, Loader2, ArrowRight, Star, Shield, Zap, ShieldCheck } from "lucide-react";
import { PRODUCTS, ProductId } from "@/config/products";
import { useProductCheckout } from "@/hooks/use-product-checkout";
import { cn } from "@/lib/utils";
import { ValueComparison } from "@/components/ValueComparison";
import { useCurrency } from "@/hooks/use-currency";
import { useScrollDepth } from "@/hooks/use-scroll-depth";
import { useTimeOnPage } from "@/hooks/use-time-on-page";

const productIcons: Record<string, React.ElementType> = {
  basicKeywordFix: FileText,
  coverLetter: FileText,
  premiumPackage: Crown,
  careerBundle: Package,
  fullAnalysis: Sparkles,
  scanPack: Zap,
  atsDefense: ShieldCheck,
};

const productOrder: ProductId[] = [
  'careerSnapshot',
  'atsDefense',
  'premiumPackage',
  'basicKeywordFix',
  'fullAnalysis', 
  'coverLetter',
];

export default function Pricing() {
  const { purchaseProduct, isLoading, currentProduct } = useProductCheckout();
  const { formatPrice, isLocalCurrency } = useCurrency();
  
  // Track scroll depth for drop-off analysis
  useScrollDepth('pricing');
  
  // Track time on page for engagement analysis
  useTimeOnPage('pricing');

  const handlePurchase = async (productId: ProductId) => {
    const product = PRODUCTS[productId];
    if ('useMainCheckout' in product && product.useMainCheckout) {
      // Full analysis is performed from the main flow
      window.location.href = '/#upload';
      return;
    }

    await purchaseProduct(productId);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-32 pb-20">
        <div className="container max-w-6xl">
          {/* Hero */}
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4">
              <Star className="w-3 h-3 mr-1" />
              One-time payments • No subscriptions
            </Badge>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Choose Your <span className="text-primary">Resume Boost</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              From quick fixes to complete career packages. Pay once, use forever.
            </p>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap justify-center gap-6 mb-12 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-success" />
              <span>Secure checkout</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-warning" />
              <span>Instant access</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-primary" />
              <span>Stripe protected</span>
            </div>
          </div>

          {/* Products Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {productOrder.map((key) => {
              const product = PRODUCTS[key];
              const Icon = productIcons[key] || Sparkles;
              const isPremium = key === 'premiumPackage';
              const isCareerSnapshot = key === 'careerSnapshot';
              const isLoadingThis = isLoading && currentProduct === key;
              
              return (
                <div 
                  key={key}
                  className={cn(
                    "relative flex flex-col p-6 rounded-2xl border-2 bg-card transition-all hover:shadow-lg",
                    isPremium 
                      ? "border-primary ring-2 ring-primary/20 shadow-xl" 
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {/* Badge */}
                  {'badge' in product && product.badge && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground shadow-lg">
                      {product.badge}
                    </Badge>
                  )}
                  
                  {/* Header */}
                  <div className="flex items-start gap-4 mb-4">
                    <div className={cn(
                      "flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center",
                      isPremium ? "bg-primary/20" : "bg-accent"
                    )}>
                      <Icon className={cn(
                        "w-6 h-6",
                        isPremium ? "text-primary" : "text-muted-foreground"
                      )} />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">{product.name}</h3>
                      <p className="text-sm text-muted-foreground">{product.description}</p>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="mb-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold">${product.priceUsd}</span>
                      <span className="text-muted-foreground">one-time</span>
                      {'savings' in product && product.savings && (
                        <Badge variant="secondary" className="ml-auto">
                          {product.savings}
                        </Badge>
                      )}
                    </div>
                    {isLocalCurrency && (
                      <p className="text-sm text-muted-foreground mt-1">
                        ≈ {formatPrice(product.priceUsd)}
                      </p>
                    )}
                  </div>

                  {/* Features */}
                  <ul className="space-y-2 mb-6 flex-1">
                    {product.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Button
                    onClick={() => handlePurchase(key)}
                    disabled={isLoading}
                    className={cn(
                      "w-full gap-2",
                      isPremium && "bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30"
                    )}
                    variant={isPremium ? "default" : "outline"}
                  >
                    {isLoadingThis ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing...
                      </>
                    ) : 'useMainCheckout' in product && product.useMainCheckout ? (
                      <>
                        Upload Resume First
                        <ArrowRight className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        Get {product.name.split(' ')[0]}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                  
                  {/* Info text for products requiring resume upload */}
                  {'useMainCheckout' in product && product.useMainCheckout && (
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      Requires uploading your resume to analyze
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Value Comparison */}
          <div className="max-w-2xl mx-auto mb-16">
            <h2 className="text-2xl font-bold text-center mb-6">
              Why Resume Booster?
            </h2>
            <ValueComparison />
          </div>

          {/* FAQ Section */}
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl font-bold mb-4">Questions?</h2>
            <p className="text-muted-foreground mb-6">
              All products are one-time purchases with instant access. 
              Start with a <Link to="/" className="text-primary hover:underline">free scan</Link> to see your score first.
            </p>
            <Button variant="outline" asChild>
              <Link to="/">
                Try Free Scan First
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
        </div>
      </main>

      <Footer />
      
    </div>
  );
}
