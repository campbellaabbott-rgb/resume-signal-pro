import { useTranslation } from "react-i18next";
import { Check, X, Minus } from "lucide-react";

type FeatureStatus = "yes" | "no" | "partial";

interface ComparisonFeature {
  key: string;
  resumeBooster: FeatureStatus;
  chatgpt: FeatureStatus;
  templates: FeatureStatus;
}

const features: ComparisonFeature[] = [
  { key: "atsScoring", resumeBooster: "yes", chatgpt: "no", templates: "no" },
  { key: "industryTemplates", resumeBooster: "yes", chatgpt: "partial", templates: "partial" },
  { key: "consistentOutput", resumeBooster: "yes", chatgpt: "no", templates: "yes" },
  { key: "linkedinAnalysis", resumeBooster: "yes", chatgpt: "partial", templates: "no" },
  { key: "jobAlignment", resumeBooster: "yes", chatgpt: "partial", templates: "no" },
  { key: "noPromptNeeded", resumeBooster: "yes", chatgpt: "no", templates: "yes" },
  { key: "recruiterCalibrated", resumeBooster: "yes", chatgpt: "no", templates: "no" },
  { key: "privacyFirst", resumeBooster: "yes", chatgpt: "no", templates: "yes" },
];

function StatusIcon({ status }: { status: FeatureStatus }) {
  if (status === "yes") {
    return (
      <div className="flex items-center justify-center">
        <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center">
          <Check className="w-4 h-4 text-success" />
        </div>
      </div>
    );
  }
  if (status === "no") {
    return (
      <div className="flex items-center justify-center">
        <div className="w-6 h-6 rounded-full bg-destructive/20 flex items-center justify-center">
          <X className="w-4 h-4 text-destructive" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center">
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
        <Minus className="w-4 h-4 text-muted-foreground" />
      </div>
    </div>
  );
}

export function ComparisonTable() {
  const { t } = useTranslation();

  return (
    <section id="comparison" className="py-20 border-t border-border">
      <div className="container">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            {t("comparison.title")}
          </h2>
          <p className="text-muted-foreground text-center mb-12">
            {t("comparison.subtitle")}
          </p>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-4 font-medium text-muted-foreground">
                    {t("comparison.feature")}
                  </th>
                  <th className="p-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-bold text-primary">Resume Booster</span>
                      <span className="text-xs text-muted-foreground">$25</span>
                    </div>
                  </th>
                  <th className="p-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-medium">ChatGPT</span>
                      <span className="text-xs text-muted-foreground">$20/mo</span>
                    </div>
                  </th>
                  <th className="p-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-medium">{t("comparison.templates")}</span>
                      <span className="text-xs text-muted-foreground">{t("comparison.free")}</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {features.map((feature, index) => (
                  <tr
                    key={feature.key}
                    className={index !== features.length - 1 ? "border-b border-border/50" : ""}
                  >
                    <td className="p-4 text-sm">{t(`comparison.features.${feature.key}`)}</td>
                    <td className="p-4 bg-primary/5">
                      <StatusIcon status={feature.resumeBooster} />
                    </td>
                    <td className="p-4">
                      <StatusIcon status={feature.chatgpt} />
                    </td>
                    <td className="p-4">
                      <StatusIcon status={feature.templates} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-4">
            {features.map((feature) => (
              <div
                key={feature.key}
                className="p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
              >
                <p className="font-medium mb-3">{t(`comparison.features.${feature.key}`)}</p>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="flex flex-col items-center gap-1">
                    <StatusIcon status={feature.resumeBooster} />
                    <span className="text-xs text-primary font-medium">Resume Booster</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <StatusIcon status={feature.chatgpt} />
                    <span className="text-xs text-muted-foreground">ChatGPT</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <StatusIcon status={feature.templates} />
                    <span className="text-xs text-muted-foreground">{t("comparison.templates")}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-8 text-center">
            <button
              onClick={() => document.getElementById("upload")?.scrollIntoView({ behavior: "smooth" })}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-all duration-300 hover:scale-105"
            >
              {t("comparison.cta")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
