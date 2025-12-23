import { 
  Target, FileCheck, Hash, Pencil, FileText, Type, LayoutList, Phone,
  Trophy, AlertTriangle, Zap, Eye, BarChart3, TrendingUp, Sparkles,
  Clock, CheckCircle2, Brain, Shield
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export function HowItWorks() {
  const { t } = useTranslation();

  const analysisPoints = [
    { icon: Target, labelKey: "howItWorks.points.atsScore", color: "text-primary" },
    { icon: FileCheck, labelKey: "howItWorks.points.formatGrade", color: "text-success" },
    { icon: FileText, labelKey: "howItWorks.points.resumeLength", color: "text-warning" },
    { icon: Type, labelKey: "howItWorks.points.wordCount", color: "text-primary" },
    { icon: BarChart3, labelKey: "howItWorks.points.experienceLevel", color: "text-success" },
    { icon: LayoutList, labelKey: "howItWorks.points.sectionCheck", color: "text-warning" },
    { icon: Phone, labelKey: "howItWorks.points.contactInfo", color: "text-primary" },
    { icon: Trophy, labelKey: "howItWorks.points.topStrength", color: "text-success" },
    { icon: Hash, labelKey: "howItWorks.points.quantification", color: "text-warning" },
    { icon: Pencil, labelKey: "howItWorks.points.actionVerbs", color: "text-primary" },
    { icon: AlertTriangle, labelKey: "howItWorks.points.redFlags", color: "text-destructive" },
    { icon: Zap, labelKey: "howItWorks.points.keywords", color: "text-success" },
    { icon: Eye, labelKey: "howItWorks.points.readability", color: "text-warning" },
    { icon: TrendingUp, labelKey: "howItWorks.points.bulletImpact", color: "text-primary" },
    { icon: BarChart3, labelKey: "howItWorks.points.keywordDensity", color: "text-success" },
    { icon: Sparkles, labelKey: "howItWorks.points.improvementPotential", color: "text-warning" },
    { icon: AlertTriangle, labelKey: "howItWorks.points.skipReasons", color: "text-destructive" },
    { icon: CheckCircle2, labelKey: "howItWorks.points.powerWords", color: "text-success" },
    { icon: AlertTriangle, labelKey: "howItWorks.points.weakPhrases", color: "text-warning" },
    { icon: Clock, labelKey: "howItWorks.points.timelineAnalysis", color: "text-primary" },
    { icon: BarChart3, labelKey: "howItWorks.points.industryBenchmark", color: "text-success" },
    { icon: Zap, labelKey: "howItWorks.points.quickWins", color: "text-warning" },
    { icon: Sparkles, labelKey: "howItWorks.points.sampleRewrite", color: "text-primary" },
    { icon: Target, labelKey: "howItWorks.points.careerTrajectory", color: "text-success" },
  ];

  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Brain className="w-4 h-4" />
            {t("howItWorks.badge")}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-3">
            {t("howItWorks.title")}
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            {t("howItWorks.subtitle")}
          </p>
        </div>

        {/* Process Steps */}
        <div className="grid md:grid-cols-3 gap-6 mb-10">
          <div className="rounded-2xl bg-card border border-border p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/20 text-primary flex items-center justify-center mx-auto mb-4">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="font-semibold mb-2">{t("howItWorks.steps.upload.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("howItWorks.steps.upload.description")}
            </p>
          </div>
          
          <div className="rounded-2xl bg-card border border-border p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-success/20 text-success flex items-center justify-center mx-auto mb-4">
              <Brain className="w-6 h-6" />
            </div>
            <h3 className="font-semibold mb-2">{t("howItWorks.steps.analysis.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("howItWorks.steps.analysis.description")}
            </p>
          </div>
          
          <div className="rounded-2xl bg-card border border-border p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-warning/20 text-warning flex items-center justify-center mx-auto mb-4">
              <Target className="w-6 h-6" />
            </div>
            <h3 className="font-semibold mb-2">{t("howItWorks.steps.results.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("howItWorks.steps.results.description")}
            </p>
          </div>
        </div>

        {/* 24-Point Grid */}
        <div className="rounded-2xl bg-gradient-to-br from-card to-muted/30 border border-border p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold">{t("howItWorks.whatWeAnalyze")}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="w-3 h-3" />
              {t("howItWorks.dataNotStored")}
            </div>
          </div>
          
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {analysisPoints.map((point, index) => (
              <div 
                key={index}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-background/50 border border-border/50 hover:border-primary/30 transition-all duration-300 group animate-fade-in hover:scale-105 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5"
                style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
              >
                <div className="relative">
                  <point.icon className={cn(
                    "w-4 h-4 transition-all duration-300",
                    point.color,
                    "group-hover:scale-125 group-hover:rotate-6"
                  )} />
                  <div className="absolute inset-0 rounded-full bg-current opacity-0 group-hover:opacity-20 blur-md transition-opacity duration-300" />
                </div>
                <span className="text-[10px] text-center text-muted-foreground leading-tight group-hover:text-foreground transition-colors">
                  {t(point.labelKey)}
                </span>
              </div>
            ))}
          </div>
          
          <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-success" />
              {t("howItWorks.footer.realAi")}
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-primary" />
              {t("howItWorks.footer.results")}
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-warning" />
              {t("howItWorks.footer.private")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
