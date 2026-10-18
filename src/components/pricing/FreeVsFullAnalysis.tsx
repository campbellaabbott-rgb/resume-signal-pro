/**
 * WHAT THE FULL ANALYSIS ADDS TO THE FREE REPORT. From lg the two columns are
 * shown; under lg they sit inside a native <details>, so the text stays in the
 * DOM while closed. No delivery time is printed: none has been observed yet
 * (gate G2), and the column describes the product, not a promise of speed.
 */
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Surface } from "@/components/ui/card";
import { money } from "@/lib/format";
import { FREE_REPORT_DAYS, FULL_ANALYSIS_LINK_DAYS, FULL_ANALYSIS_PRICE_USD } from "./plan-facts";
import { useMinWidth } from "./use-media";

function Col({ title, unit, items, notes }: { title: string; unit: string; items: string[]; notes: ReactNode[] }) {
  return (
    <Surface className="min-w-0 px-5 py-4">
      <h3 className="text-base font-semibold text-foreground">
        {title} <small className="text-sm font-normal text-muted-foreground">{unit}</small>
      </h3>
      <ul className="mt-2.5 grid gap-2">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-2.5 text-sm text-foreground">
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span className="min-w-0">{it}</span>
          </li>
        ))}
      </ul>
      {notes.map((n, i) => (
        <p key={i} className="mt-2 text-xs text-subtle-foreground first-of-type:mt-3">
          {n}
        </p>
      ))}
    </Surface>
  );
}

export function FreeVsFullAnalysis() {
  const { t, i18n } = useTranslation();
  const wide = useMinWidth(1024);
  const price = money(FULL_ANALYSIS_PRICE_USD, "USD", { lng: i18n.language });
  const cols = (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <Col
        title={t("pricingPlans.adds.freeTitle")}
        unit={t("pricingPlans.adds.freeUnit")}
        items={[t("pricingPlans.adds.free1"), t("pricingPlans.adds.free2"), t("pricingPlans.adds.free3"), t("pricingPlans.adds.free4")]}
        notes={[t("pricingPlans.adds.freeBrackets"), t("pricingPlans.adds.freeKept", { days: FREE_REPORT_DAYS })]}
      />
      <Col
        title={t("pricingPlans.adds.faTitle")}
        unit={t("pricingPlans.adds.faUnit", { price })}
        items={[t("pricingPlans.adds.fa1"), t("pricingPlans.adds.fa2"), t("pricingPlans.adds.fa3"), t("pricingPlans.adds.fa4")]}
        notes={[t("pricingPlans.adds.faKept", { days: FULL_ANALYSIS_LINK_DAYS })]}
      />
    </div>
  );
  return (
    <section aria-labelledby="pricing-adds" className="border-t border-border py-8 sm:py-10 lg:py-16">
      <div className="container">
        <h2 id="pricing-adds" className="text-2xl font-semibold tracking-tight md:text-3xl">
          {t("pricingPlans.adds.h2", { price })}
        </h2>
        <p className="mt-2.5 max-w-[62ch] text-base text-muted-foreground">{t("pricingPlans.adds.lede")}</p>
        {wide ? (
          cols
        ) : (
          <details className="group mt-3" data-testid="adds-details">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-base font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">{t("pricingPlans.adds.summary")}</span>
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base group-open:rotate-180" />
            </summary>
            {cols}
          </details>
        )}
      </div>
    </section>
  );
}
