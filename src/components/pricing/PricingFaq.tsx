/**
 * QUESTIONS BEFORE YOU PAY. Native <details>: every answer stays in the DOM
 * while its question is closed, so a reader's Find reaches "refund" on a
 * phone and Google's rendered page holds every answer (spec P9). The
 * refund answer keeps the Terms' remedy, and the cancel answer says Pro is
 * cancelled online, the way it was bought.
 */
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WRITING } from "./plan-facts";

export const FAQ_IDS = ["refund", "region", "fit", "package", "cancel", "apply", "interviews"] as const;

export function PricingFaq() {
  const { t } = useTranslation();
  const vars = { perDay: WRITING.proPackagesPerDay, perMonth: WRITING.proPackagesPerMonth, freePerDay: WRITING.freePerToolPerDay };
  return (
    <section aria-labelledby="pricing-faq" className="border-t border-border py-8 sm:py-10 lg:py-16">
      <div className="container">
        <h2 id="pricing-faq" className="text-2xl font-semibold tracking-tight md:text-3xl">
          {t("pricingPlans.faq.h2")}
        </h2>
        <div className="mt-4 max-w-[780px] border-t border-border">
          {FAQ_IDS.map((id) => (
            <details key={id} className="group border-b border-border" data-faq={id}>
              <summary className="flex min-h-[3.25rem] cursor-pointer list-none items-center justify-between gap-4 py-3 text-base font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">{t(`pricingPlans.faq.${id}Q`)}</span>
                <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base group-open:rotate-180" />
              </summary>
              <p className="max-w-reading pb-4 text-sm text-muted-foreground md:text-base">{t(`pricingPlans.faq.${id}A`, vars)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
