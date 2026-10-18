import { Trans, useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Chip } from "@/components/ui/chip";

/**
 * WHAT A FREE REPORT SHOWS, on an invented résumé (the chip says so). The
 * rewrite keeps the facts only the reader knows in brackets, and the foot
 * line says to check every figure: the free report's model is told not to
 * invent achievements, but nothing checks its rewrite, so the page does not
 * promise it never does (review P19).
 */
export function SampleReport() {
  const { t } = useTranslation();
  const ph = <span className="font-mono text-meta text-primary" />;
  return (
    <div role="group" aria-label={t("home.sample.label")} className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <h3 className="text-[15px] font-semibold leading-snug">{t("home.sample.title")}</h3>
        <Chip variant="outline">{t("home.sample.chip")}</Chip>
      </div>
      <div className="grid gap-4 p-4 [&>*]:min-w-0">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[32px] font-semibold leading-9 tracking-tight">64</span>
          <span className="text-muted-foreground">{t("home.sample.scoreOf")}</span>
          <span className="ml-1 text-sm text-muted-foreground">{t("home.sample.scoreLabel")}</span>
        </p>
        <dl className="border-t border-border">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-2 text-sm">
            <dt className="min-w-0 text-muted-foreground">{t("home.sample.readable")}</dt>
            <dd><Chip variant="live" icon={<CheckCircle2 />}>{t("home.sample.passes")}</Chip></dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-2 text-sm">
            <dt className="min-w-0 text-muted-foreground">{t("home.sample.sections")}</dt>
            <dd><Chip variant="caution" icon={<AlertTriangle />}>{t("home.sample.noSkills")}</Chip></dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-2 text-sm">
            <dt className="min-w-0 text-muted-foreground">{t("home.sample.numbers")}</dt>
            <dd><Chip variant="caution" icon={<AlertTriangle />}>{t("home.sample.numbersValue", { have: 3, total: 14 })}</Chip></dd>
          </div>
        </dl>
        <div>
          <p className="text-meta font-semibold text-muted-foreground">{t("home.sample.missing")}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {["term1", "term2", "term3"].map((k) => (
              <li key={k}><Chip>{t(`home.sample.${k}`)}</Chip></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-meta font-semibold text-muted-foreground">{t("home.sample.rewriteTitle")}</p>
          <div className="mt-1.5 grid gap-1.5 text-sm">
            <p className="rounded-md border border-border bg-background px-2.5 py-2">
              <span className="block text-xs font-semibold text-subtle-foreground">{t("home.sample.before")}</span>
              {t("home.sample.beforeText")}
            </p>
            <p className="rounded-md border border-border bg-background px-2.5 py-2">
              <span className="block text-xs font-semibold text-subtle-foreground">{t("home.sample.after")}</span>
              <Trans i18nKey="home.sample.afterText" components={{ ph }} />
            </p>
          </div>
        </div>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-subtle-foreground">{t("home.sample.foot")}</p>
    </div>
  );
}
