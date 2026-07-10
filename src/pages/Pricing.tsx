import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, FileText, Crown, Package, Loader2, ArrowRight, Star, Shield, Zap, ShieldCheck, Flame, MessageSquare, TrendingUp, Send, Briefcase, ChevronDown } from "lucide-react";
import { PRODUCTS, ProductId, isProductHidden } from "@/config/products";
import { useProductCheckout } from "@/hooks/use-product-checkout";
import { cn } from "@/lib/utils";
import { ValueComparison } from "@/components/ValueComparison";
import { useCurrency } from "@/hooks/use-currency";
import { useScrollDepth } from "@/hooks/use-scroll-depth";
import { useTimeOnPage } from "@/hooks/use-time-on-page";
import { AddOnsShowcase } from "@/components/AddOnsShowcase";
import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";
import { ProductPreview } from "@/components/ProductPreview";
import { getResumeFromSession } from "@/hooks/use-session-resume";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const productIcons: Record<string, React.ElementType> = {
  basicKeywordFix: FileText,
  coverLetter: FileText,
  premiumPackage: Crown,
  careerBundle: Package,
  fullAnalysis: Sparkles,
  scanPack: Zap,
  atsDefense: ShieldCheck,
  careerSnapshot: Package,
  graduateGamePlan: Star,
  resumeRoast: Flame,
  interviewCoach: MessageSquare,
  careerPathSimulator: TrendingUp,
  applyAssistant: Send,
  freelanceBoost: Briefcase,
};

// Premium products (shown in main grid)
// Flagship-first: the complete rewrite package leads; single-purpose tools
// follow. Order is a merchandising decision — the strongest deliverable
// (rewritten resume content) earns the first slot.
// premiumPackage + freelanceBoost live in the ladder above the fold; the
// collapsed catalog carries the rest.
const productOrder: ProductId[] = ([
  'atsDefense',
  'careerSnapshot',
  'graduateGamePlan',
  'applyAssistant',
  'fullAnalysis',
  'coverLetter',
] as ProductId[]).filter((id) => !isProductHidden(id));

export default function Pricing() {
  const { t } = useTranslation();
  const { purchaseProduct, isLoading, currentProduct } = useProductCheckout();
  const { formatPrice, isLocalCurrency } = useCurrency();
  // If the visitor scanned a resume this session, every tool can preview itself
  // with their real content. Read once — sessionStorage doesn't change under us.
  const [sessionResume] = useState(() => getResumeFromSession());
  
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
      <SEO title={t('pricingPage.metaTitle')} description={t('pricingPage.metaDescription')} path="/pricing" />
      {/* SoftwareApplication + AggregateOffer — eligible for price rich results
          on "resume scanner pricing"-type queries. Prices mirror PRODUCTS. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Resume Booster",
        url: "https://resumebooster.work",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Free diagnostic resume scan plus one-time paid tools and an optional all-access subscription.",
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "USD",
          lowPrice: "0",
          highPrice: "59",
          offerCount: (Object.keys(PRODUCTS) as ProductId[]).filter((k) => !isProductHidden(k)).length + 1,
        },
      }) }} />
      <Header />

      <main className="pt-24 pb-20">
        <div className="container max-w-6xl">
          {/* Hero */}
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4">
              <Star className="w-3 h-3 mr-1" />
              Pay per tool, or go Pro for everything
            </Badge>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              {t('pricingPage.titlePrefix')} <span className="text-primary">{t('pricingPage.titleHighlight')}</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {t('pricingPage.subtitle')}
            </p>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap justify-center gap-6 mb-12 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-success" />
              <span>{t('pricingPage.secureCheckout')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-warning" />
              <span>{t('pricingPage.instantAccess')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-primary" />
              <span>{t('pricingPage.stripeProtected')}</span>
            </div>
          </div>

          {/* Risk reversal — the last-step trust flinch is the funnel's known leak */}
          <p className="text-center text-sm text-muted-foreground mb-12 max-w-xl mx-auto">
            ✓ {t('pricingPage.guarantee')}
          </p>

          {/* The ladder: three choices convert; thirteen don't. */}
          <div className="text-center mb-6">
            <h2 className="text-2xl md:text-3xl font-bold mb-1">{t('pricingPage.ladderTitle')}</h2>
            <p className="text-muted-foreground">{t('pricingPage.ladderSubtitle')}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-14">
            <div className="flex flex-col p-6 rounded-2xl border-2 border-success/50 bg-card">
              <h3 className="font-bold text-lg mb-1">{t('pricingPage.ladderFreeTitle')}</h3>
              <p className="text-3xl font-bold text-success mb-2">$0</p>
              <p className="text-sm text-muted-foreground mb-4 flex-1">{t('pricingPage.ladderFreeDesc')}</p>
              <Button asChild variant="outline" className="w-full gap-2 border-success/50">
                <a href="/#upload">{t('pricingPage.ladderFreeCta')}<ArrowRight className="w-4 h-4" /></a>
              </Button>
            </div>
            <div className="relative flex flex-col p-6 rounded-2xl border-2 border-primary ring-2 ring-primary/20 bg-card shadow-xl">
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground shadow-lg">{PRODUCTS.premiumPackage.badge}</Badge>
              <h3 className="font-bold text-lg mb-1">{PRODUCTS.premiumPackage.name}</h3>
              <p className="text-3xl font-bold mb-2">${PRODUCTS.premiumPackage.priceUsd}</p>
              <p className="text-sm text-muted-foreground mb-4 flex-1">{t('pricingPage.ladderFixDesc')}</p>
              <Button onClick={() => handlePurchase('premiumPackage')} disabled={isLoading} className="w-full gap-2">
                {isLoading && currentProduct === 'premiumPackage' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {t('pricingPage.getProduct', { name: PRODUCTS.premiumPackage.name.split(' ')[0] })}
              </Button>
              <ProductPreview productId="premiumPackage" resumeText={sessionResume.resumeText} jobDescription={sessionResume.jobDescriptionText ?? undefined} className="mt-3" />
            </div>
            <div className="flex flex-col p-6 rounded-2xl border-2 border-border bg-card hover:border-primary/50 transition-all">
              <h3 className="font-bold text-lg mb-1">{PRODUCTS.freelanceBoost.name}</h3>
              <p className="text-3xl font-bold mb-2">${PRODUCTS.freelanceBoost.priceUsd}</p>
              <p className="text-sm text-muted-foreground mb-4 flex-1">{t('pricingPage.ladderSpecialistDesc')}</p>
              <Button asChild variant="outline" className="w-full gap-2">
                <Link to="/freelance-boost">{PRODUCTS.freelanceBoost.badge}<ArrowRight className="w-4 h-4" /></Link>
              </Button>
              <ProductPreview productId="freelanceBoost" resumeText={sessionResume.resumeText} jobDescription={sessionResume.jobDescriptionText ?? undefined} className="mt-3" />
            </div>
          </div>

          {/* Pro subscription — all tools, one price */}
          <div className="max-w-xl mx-auto mb-16">
            <ProSubscriptionCard />
          </div>

          {/* Everything else, collapsed: the SKU wall demonstrably converts ~0 */}
          <Collapsible>
            <div className="text-center mb-10">
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="gap-2">
                  {t('pricingPage.allToolsToggle', { count: productOrder.length + 2 })}
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
          {/* $5 Add-Ons Section */}
          <AddOnsShowcase
            variant="full"
            className="mb-12"
            resumeText={sessionResume.resumeText}
            jobDescription={sessionResume.jobDescriptionText ?? undefined}
          />

          {/* Premium Products Grid */}
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">{t('pricingPage.premiumPackages')}</h2>
            <p className="text-muted-foreground">{t('pricingPage.premiumSubtitle')}</p>
          </div>
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
                      <span className="text-muted-foreground">{t('pricingPage.oneTime')}</span>
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
                        {t('pricingPage.processing')}
                      </>
                    ) : 'useMainCheckout' in product && product.useMainCheckout ? (
                      <>
                        {t('pricingPage.uploadResumeFirst')}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        {t('pricingPage.getProduct', { name: product.name.split(' ')[0] })}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>

                  {/* Info text for products requiring resume upload */}
                  {'useMainCheckout' in product && product.useMainCheckout && (
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      {t('pricingPage.requiresUpload')}
                    </p>
                  )}

                  {/* Preview-before-pay — shows only when a scanned résumé is in session */}
                  <ProductPreview
                    productId={key}
                    resumeText={sessionResume.resumeText}
                    jobDescription={sessionResume.jobDescriptionText ?? undefined}
                    className="mt-3"
                  />
                </div>
              );
            })}
          </div>

            </CollapsibleContent>
          </Collapsible>

          {/* Value Comparison */}
          <div className="max-w-2xl mx-auto mb-16">
            <h2 className="text-2xl font-bold text-center mb-6">
              {t('pricingPage.whyResumeBooster')}
            </h2>
            <ValueComparison />
          </div>

          {/* FAQ Section */}
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl font-bold mb-4">{t('pricingPage.questions')}</h2>
            <p className="text-muted-foreground mb-6">
              {t('pricingPage.allProductsOneTime')}{' '}
              <Link to="/" className="text-primary hover:underline">{t('pricingPage.freeScanLink')}</Link> {t('pricingPage.seeScoreFirst')}
            </p>
            <Button variant="outline" asChild>
              <Link to="/">
                {t('pricingPage.tryFreeScanFirst')}
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
