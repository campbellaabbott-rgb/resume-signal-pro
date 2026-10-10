import { Header } from "@/components/Header";
import { useScanTotals } from "@/hooks/use-scan-totals";
import { SEO } from "@/components/seo/SEO";
import { Footer } from "@/components/Footer";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FileSearch,
  Brain,
  Target,
  CheckCircle2,
  ArrowRight,
  Shield,
  Zap,
  BarChart3,
  FileText,
  Users,
  Building2,
  Clock,
  Sparkles
} from "lucide-react";
import { SCAN_ATS_SYSTEMS, SCORE_AI_BAND, SCORE_AUDIT_PARTS } from "@/config/score-method";

// Everything this page says about the scorer comes from the mirror of the
// scorer's own constants (src/config/score-method.ts), held to the edge
// function by a test: the systems the scan names, the AI band, the audit parts.

export default function Methodology() {
  // Both counts on this page were the hardcoded "10,000+" while
  // get_scan_totals reported 1,052. They are live now, and each line is
  // omitted entirely until the RPC answers.
  const scanTotals = useScanTotals();
  const { t } = useTranslation();

  const atsPlaftorms = SCAN_ATS_SYSTEMS.map((name) => ({ name }));

  const analysisSteps = [
    {
      icon: FileSearch,
      title: t('methodologyPage.steps.parsing.title'),
      description: t('methodologyPage.steps.parsing.description')
    },
    {
      icon: Brain,
      title: t('methodologyPage.steps.aiAnalysis.title'),
      description: t('methodologyPage.steps.aiAnalysis.description')
    },
    {
      icon: Target,
      title: t('methodologyPage.steps.keywordMatching.title'),
      description: t('methodologyPage.steps.keywordMatching.description')
    },
    {
      icon: BarChart3,
      title: t('methodologyPage.steps.scoringAlgorithm.title'),
      description: t('methodologyPage.steps.scoringAlgorithm.description', { band: SCORE_AI_BAND })
    },
  ];

  // The report's own "Why this score" parts, out of 100 points.
  const scoringFactors = [
    ...SCORE_AUDIT_PARTS.map((p) => ({
      factor: t(`methodologyPage.audit.${p.key}.label`),
      weight: `${p.possible}%`,
      points: t('methodologyPage.pointsOf', { points: p.possible }),
      description: t(`methodologyPage.audit.${p.key}.description`),
    })),
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO title={t('methodologyPage.metaTitle')} description={t('methodologyPage.metaDescription')} path="/methodology" />
      {/* HowTo schema mirroring the on-page "how the analysis works" steps */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: "How Resume Booster analyzes your resume",
        description: "The steps our free resume scan runs on every upload: parsing, industry detection, keyword analysis, and transparent scoring.",
        step: analysisSteps.map((s, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          name: s.title,
          text: s.description,
        })),
      }) }} />
      <Header />

      <main className="pt-20">
        {/* Hero Section */}
        <section className="py-16 sm:py-24 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
          </div>

          <div className="container relative">
            <div className="max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-6">
                <Shield className="w-4 h-4" />
                <span>{t('methodologyPage.transparentResearchBased')}</span>
              </div>

              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
                {t('methodologyPage.titlePrefix')}{" "}
                <span className="text-primary">{t('methodologyPage.titleHighlight')}</span>
              </h1>

              <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
                {t('methodologyPage.heroSubtitle')}
              </p>

              <div className="flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  {t('methodologyPage.atsCount', { count: SCAN_ATS_SYSTEMS.length })}
                </span>
                {scanTotals && (
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    {t('methodologyPage.resumesProcessed', { total: scanTotals.total_scans.toLocaleString() })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* How Analysis Works */}
        <section className="py-16 bg-card/30">
          <div className="container">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">
                {t('methodologyPage.howAnalysisWorks')}
              </h2>
              
              <div className="grid sm:grid-cols-2 gap-6">
                {analysisSteps.map((step, index) => (
                  <div 
                    key={step.title}
                    className="p-6 rounded-2xl bg-card border border-border hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <step.icon className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-primary">{t('methodologyPage.step', { number: index + 1 })}</span>
                        </div>
                        <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ATS Platforms */}
        <section className="py-16">
          <div className="container">
            <div className="max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold mb-4">
                  {t('methodologyPage.atsPlatformsTitle')}
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  {t('methodologyPage.atsPlatformsSubtitle', { count: SCAN_ATS_SYSTEMS.length })}
                </p>
              </div>
              
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {atsPlaftorms.map((platform) => (
                  <div 
                    key={platform.name}
                    className="p-4 rounded-xl bg-card/50 border border-border/50 hover:border-primary/20 transition-colors"
                  >
                    <h3 className="font-semibold">{platform.name}</h3>
                  </div>
                ))}
              </div>
              
            </div>
          </div>
        </section>

        {/* Scoring Breakdown */}
        <section className="py-16 bg-card/30">
          <div className="container">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold mb-4">
                  {t('methodologyPage.scoreCalculatedTitle')}
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  {t('methodologyPage.scoreCalculatedSubtitle')}
                </p>
              </div>
              
              <div className="space-y-4">
                {scoringFactors.map((item) => (
                  <div 
                    key={item.factor}
                    className="p-4 rounded-xl bg-card border border-border"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium">{item.factor}</h3>
                      <span className="text-sm font-bold text-primary">{item.points}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full"
                          style={{ width: item.weight }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground flex-shrink-0 max-w-[200px]">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Research & Updates */}
        <section className="py-16">
          <div className="container">
            <div className="max-w-4xl mx-auto">
              <div className="grid md:grid-cols-2 gap-8">
                <div className="p-6 rounded-2xl bg-card border border-border">
                  <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center mb-4">
                    <Zap className="w-6 h-6 text-success" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{t('methodologyPage.continuousResearchTitle')}</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    {t('methodologyPage.continuousResearchSubtitle')}
                  </p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span>{t('methodologyPage.continuousResearch.monthlyUpdates')}</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span>{t('methodologyPage.continuousResearch.keywordDatabases')}</span>
                    </li>
                  </ul>
                </div>

                <div className="p-6 rounded-2xl bg-card border border-border">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{t('methodologyPage.validatedByResultsTitle')}</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    {t('methodologyPage.validatedByResultsSubtitle')}
                  </p>
                  <ul className="space-y-2 text-sm">
                    {/* "89% report better interview rates" and "Average
                        23-point score improvement" were removed 2026-07-27:
                        there is no outcome survey and no score-delta aggregate
                        anywhere in this repo, so neither number had a source.
                        What remains is measured. */}
                    {scanTotals && (
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                        <span>{t('methodologyPage.validatedByResults.resumesAnalyzed', { total: scanTotals.total_scans.toLocaleString() })}</span>
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 bg-gradient-to-b from-transparent to-card/50">
          <div className="container">
            <div className="max-w-2xl mx-auto text-center">
              <Sparkles className="w-10 h-10 text-primary mx-auto mb-4" />
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">
                {t('methodologyPage.ctaTitle')}
              </h2>
              <p className="text-muted-foreground mb-8">
                {t('methodologyPage.ctaSubtitle')}
              </p>
              <Link
                to="/"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
              >
                {t('methodologyPage.ctaButton')}
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </section>
      </main>
      
      <Footer />
    </div>
  );
}
