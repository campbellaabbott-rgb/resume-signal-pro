import { Header } from "@/components/Header";
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

const atsPlatformNames = [
  "Workday", "Greenhouse", "Lever", "Taleo", "iCIMS",
  "BambooHR", "JazzHR", "Jobvite", "SmartRecruiters", "Bullhorn",
];

export default function Methodology() {
  const { t } = useTranslation();

  const atsPlaftorms = atsPlatformNames.map((name, i) => ({
    name,
    description: t(`methodologyPage.atsPlatforms.${i}.description`),
    marketShare: t(`methodologyPage.atsPlatforms.${i}.marketShare`),
  }));

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
      description: t('methodologyPage.steps.scoringAlgorithm.description')
    },
  ];

  const scoringFactors = [
    { factor: t('methodologyPage.scoringFactors.keywordOptimization.factor'), weight: "25%", description: t('methodologyPage.scoringFactors.keywordOptimization.description') },
    { factor: t('methodologyPage.scoringFactors.formatCompatibility.factor'), weight: "20%", description: t('methodologyPage.scoringFactors.formatCompatibility.description') },
    { factor: t('methodologyPage.scoringFactors.sectionCompleteness.factor'), weight: "15%", description: t('methodologyPage.scoringFactors.sectionCompleteness.description') },
    { factor: t('methodologyPage.scoringFactors.experienceClarity.factor'), weight: "15%", description: t('methodologyPage.scoringFactors.experienceClarity.description') },
    { factor: t('methodologyPage.scoringFactors.actionVerbUsage.factor'), weight: "10%", description: t('methodologyPage.scoringFactors.actionVerbUsage.description') },
    { factor: t('methodologyPage.scoringFactors.quantifiedAchievements.factor'), weight: "10%", description: t('methodologyPage.scoringFactors.quantifiedAchievements.description') },
    { factor: t('methodologyPage.scoringFactors.redFlagAbsence.factor'), weight: "5%", description: t('methodologyPage.scoringFactors.redFlagAbsence.description') },
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
                  {t('methodologyPage.platformsAnalyzed')}
                </span>
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  {t('methodologyPage.resumesProcessed')}
                </span>
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  {t('methodologyPage.updatedMonthly')}
                </span>
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
                  {t('methodologyPage.atsPlatformsSubtitle')}
                </p>
              </div>
              
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {atsPlaftorms.map((platform) => (
                  <div 
                    key={platform.name}
                    className="p-4 rounded-xl bg-card/50 border border-border/50 hover:border-primary/20 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold">{platform.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {platform.marketShare}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{platform.description}</p>
                  </div>
                ))}
              </div>
              
              <p className="text-center text-sm text-muted-foreground mt-8">
                {t('methodologyPage.moreAtsPlatforms')}
              </p>
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
                      <span className="text-sm font-bold text-primary">{item.weight}</span>
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
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span>{t('methodologyPage.continuousResearch.recruiterFeedback')}</span>
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
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>{t('methodologyPage.validatedByResults.interviewRates')}</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>{t('methodologyPage.validatedByResults.resumesAnalyzed')}</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>{t('methodologyPage.validatedByResults.scoreImprovement')}</span>
                    </li>
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
