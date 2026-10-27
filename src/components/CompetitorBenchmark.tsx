// What résumés for a role usually include: general guidance from the role's
// configuration (src/config/personalization.ts), worded as guidance.
//
// It used to print, for each role, the share of "top candidates" with a
// portfolio, a certification or a quantified bullet and an average bullet
// count, all hand-set in the config, beside a "competitive standing" built
// from three props the report never passed (so every reader got the same
// empty checklist). Those numbers were never measured, so none is printed:
// the role's configured weights only decide which guideline shows.
import { Award, BarChart3, FileText, Link, Lightbulb, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { type RoleConfig } from "@/config/personalization";
import { useTranslation } from "react-i18next";

interface CompetitorBenchmarkProps {
  roleConfig: RoleConfig;
  className?: string;
}

export function CompetitorBenchmark({ roleConfig, className }: CompetitorBenchmarkProps) {
  const { t } = useTranslation();
  const guide = roleConfig.topResumeElements;

  if (!guide) {
    return null;
  }

  const worthAdding = [
    guide.portfolioRate >= 50 && { key: "portfolio", icon: Link, text: t("competitorBenchmark.addPortfolio") },
    guide.certificationRate >= 40 && { key: "certifications", icon: Award, text: t("competitorBenchmark.addCerts") },
    { key: "metrics", icon: BarChart3, text: t("competitorBenchmark.addMetrics") },
  ].filter(Boolean) as Array<{ key: string; icon: typeof Link; text: string }>;

  return (
    <div className={cn("p-4 rounded-xl bg-gradient-to-br from-primary/5 via-background to-background border border-primary/20", className)}>
      <h4 className="font-semibold text-foreground flex items-center gap-2 mb-4">
        <Trophy className="w-5 h-5 text-amber-500" />
        {t("competitorBenchmark.title", { role: roleConfig.name })}
      </h4>

      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {t("competitorBenchmark.sectionsAlwaysInclude", { role: roleConfig.name })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {guide.sections.map((section, i) => (
              <span key={i} className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                {section}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            {t("competitorBenchmark.whatMakesStandOut")}
          </p>
          <div className="space-y-1.5">
            {guide.differentiators.map((diff, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="text-amber-500">★</span>
                <span>{diff}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <p className="text-xs font-semibold text-amber-600 mb-1.5 flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5" />
          {t("competitorBenchmark.quickWins")}
        </p>
        <ul className="space-y-1">
          {worthAdding.map(({ key, icon: Icon, text }) => (
            <li key={key} className="text-xs text-muted-foreground flex items-start gap-2">
              <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
