import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowRight, Star, Shield, Zap } from "lucide-react";
import { PRODUCTS, SUBSCRIPTIONS, ProductId, isProductHidden } from "@/config/products";
import { ValueComparison } from "@/components/ValueComparison";
import { useScrollDepth } from "@/hooks/use-scroll-depth";
import { useTimeOnPage } from "@/hooks/use-time-on-page";
import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";
import { AtsCoverage } from '@/components/AtsCoverage';
import { ProductPreview } from "@/components/ProductPreview";
import { getResumeFromSession } from "@/hooks/use-session-resume";
import { useState } from "react";
import { PurchaseTerms } from "@/components/PurchaseTerms";

// THE PRODUCT LINE OF 2026-10-12 (owner decisions). The page sells what is
// still for sale: free search and scans, the $5 Full Analysis (the only
// one-off most buyers need), the Freelance Boost tiers, and Pro. The cut
// products (src/config/products.ts HIDDEN_PRODUCT_IDS: the Premium Package,
// ATS Defense, Career Snapshot, Graduate Game Plan, Career Path, Keyword Fix,
// Cover Letter and Interview Coach as one-offs, Scan Packs) are offered
// nowhere: the "Premium" ladder card and the collapsed catalogue that listed
// them are gone, and their checkouts answer 410. The apply pivot's retired
// Apply Assistant, Agent plan and Agent Pass were already gone.
const offeredHere = (id: ProductId) => !isProductHidden(id);

export default function Pricing() {
  const { t } = useTranslation();
  // If the visitor scanned a resume this session, the Freelance preview can
  // show itself with their real content. Read once.
  const [sessionResume] = useState(() => getResumeFromSession());

  // Track scroll depth for drop-off analysis
  useScrollDepth('pricing');

  // Track time on page for engagement analysis
  useTimeOnPage('pricing');

  // The JSON-LD price range is DERIVED from the catalog it describes — every
  // one-time product this page offers and the one recurring plan on sale (Pro)
  // — so the offer can never state a ceiling the catalog has outgrown, nor a
  // price for a product the page no longer sells.
  const visibleProducts = (Object.keys(PRODUCTS) as ProductId[]).filter(offeredHere);
  const offerPrices = [
    ...visibleProducts.map((k) => PRODUCTS[k].priceUsd),
    SUBSCRIPTIONS.pro.priceUsd,
  ];
  // THE DESCRIPTION'S RANGE IS THE CATALOGUE'S, by the same derivation
  // (platform sweep L3-18).
  const oneTimePrices = visibleProducts.map((k) => PRODUCTS[k].priceUsd);
  const metaPrices = {
    lowPrice: Math.min(...oneTimePrices),
    highPrice: Math.max(...oneTimePrices),
    proPrice: SUBSCRIPTIONS.pro.priceUsd,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Prices come from the catalog, not the copy. */}
      <SEO
        title={t('pricingPage.metaTitle')}
        description={t('pricingPage.metaDescriptionLine', 'Free job search and résumé scan. One-time tools from ${{lowPrice}} to ${{highPrice}} that never renew, or Pro at ${{proPrice}} a month for the writing tools.', metaPrices)}
        path="/pricing"
      />
      {/* SoftwareApplication + AggregateOffer — eligible for price rich results
          on "resume scanner pricing"-type queries. Prices mirror PRODUCTS. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Resume Booster",
        url: "https://resumebooster.work",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Free diagnostic resume scan plus one-time paid tools and one optional subscription.",
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "USD",
          lowPrice: "0",
          highPrice: String(Math.max(...offerPrices)),
          offerCount: offerPrices.length + 1,
        },
      }) }} />
      <Header />

      <main className="pt-24 pb-20">
        <div className="container max-w-6xl">
          {/* Hero */}
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4">
              <Star className="w-3 h-3 mr-1" />
              {t('pricingPage.heroBadgeLine', 'Free to search, $5 for one deep analysis, or Pro for the writing tools')}
            </Badge>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              {t('pricingPage.titlePrefix')} <span className="text-primary">{t('pricingPage.titleHighlight')}</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {t('pricingPage.subtitleLine', 'Search and scan for free. Pay once for one deep résumé analysis, or go Pro for the writing tools on the jobs you apply to.')}
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

          {/* Risk reversal — the remedy the Terms state (regenerate on request). */}
          <p className="text-center text-sm text-muted-foreground mb-12 max-w-xl mx-auto">
            ✓ {t('pricingPage.guarantee')}
          </p>

          {/* The ladder: three choices. */}
          <div className="text-center mb-6">
            <h2 className="text-2xl md:text-3xl font-bold mb-1">{t('pricingPage.ladderTitle')}</h2>
            <p className="text-muted-foreground">{t('pricingPage.ladderSubtitleLine', 'Most people need exactly one of these.')}</p>
          </div>
          <PurchaseTerms kind="payment" className="mb-4 text-center" />
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-14">
            <div className="flex flex-col p-6 rounded-2xl border-2 border-success/50 bg-card">
              <h3 className="font-bold text-lg mb-1">{t('pricingPage.ladderFreeTitle')}</h3>
              <p className="text-3xl font-bold text-success mb-2">$0</p>
              <p className="text-sm text-muted-foreground mb-4 flex-1">{t('pricingPage.ladderFreeDesc')}</p>
              <Button asChild variant="outline" className="w-full gap-2 border-success/50">
                <a href="/#upload">{t('pricingPage.ladderFreeCta')}<ArrowRight className="w-4 h-4" /></a>
              </Button>
            </div>
            {/* The $5 Full Analysis: bought from the homepage, where the résumé it reads is. */}
            <div className="relative flex flex-col p-6 rounded-2xl border-2 border-primary ring-2 ring-primary/20 bg-card shadow-xl" data-ladder="fullAnalysis">
              <h3 className="font-bold text-lg mb-1">{PRODUCTS.fullAnalysis.name}</h3>
              <p className="text-3xl font-bold mb-2">${PRODUCTS.fullAnalysis.priceUsd}</p>
              <p className="text-sm text-muted-foreground mb-4 flex-1">{t('pricingPage.ladderAnalysisDesc', 'Every keyword gap and ATS issue in your résumé, scored against the job you paste, with the fix for each. No account needed; included in Pro.')}</p>
              <Button asChild className="w-full gap-2">
                <a href="/#upload">{t('pricingPage.buyProduct', 'Get {{name}}', { name: PRODUCTS.fullAnalysis.name })}<ArrowRight className="w-4 h-4" /></a>
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">{t('pricingPage.requiresUpload')}</p>
            </div>
            <div className="flex flex-col p-6 rounded-2xl border-2 border-border bg-card hover:border-primary/50 transition-all">
              <h3 className="font-bold text-lg mb-1">{PRODUCTS.freelanceBoost.name}</h3>
              <p className="text-3xl font-bold mb-2">${PRODUCTS.freelanceBoost.priceUsd}</p>
              <p className="text-sm text-muted-foreground mb-4 flex-1">{t('pricingPage.ladderSpecialistDesc')}</p>
              <Button asChild variant="outline" className="w-full gap-2">
                <Link to="/freelance-boost">{t('pricingPage.buyProduct', 'Get {{name}}', { name: PRODUCTS.freelanceBoost.name })}<ArrowRight className="w-4 h-4" /></Link>
              </Button>
              <ProductPreview productId="freelanceBoost" resumeText={sessionResume.resumeText} jobDescription={sessionResume.jobDescriptionText ?? undefined} className="mt-3" />
            </div>
          </div>

          {/* The one recurring plan. Pro is presented by what it does today
              (src/config/pro-perks.ts, every line a shipped capability); the
              Agent plan's card is not rendered since the apply pivot. */}
          <div className="max-w-xl mx-auto mb-4">
            <ProSubscriptionCard />
          </div>
          {/* Connecting your own AI costs nothing and is not a product: one
              line, no price, pointing at the page that sets it up. The key
              keeps its old name (pricingPage.passLine) with a new sentence in
              all nine locales, because the /pricing crawler bake reads it by
              name; no pass is sold. */}
          <p className="text-center text-sm text-muted-foreground max-w-4xl mx-auto mb-12" data-connect-free>
            {t('pricingPage.passLine', 'Connecting your own Claude or ChatGPT is free: search the board in your chat and apply yourself on the employer\'s own site, with your AI\'s help. We never submit an application for you.')}{' '}
            <Link to="/agents" className="text-primary hover:underline">{t('pricingPage.passLink', 'Connect your AI')}</Link>
          </p>

          {/* Where every posting comes from, directly under the plans. */}
          <AtsCoverage className="max-w-4xl mx-auto mb-16" />

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
              {t('pricingPage.oneTimeAndProLine', 'One-time tools (the $5 Full Analysis, Freelance Boost and Transition Pro) are paid once and never renew; Pro is a monthly plan you can cancel any time.')}{' '}{t('pricingPage.freeScanLeadIn', 'Not sure yet? Run the')}{' '}
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
