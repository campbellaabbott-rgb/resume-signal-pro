/**
 * THE TOP OF /pricing: the H1, the one-sentence summary that leads with what
 * is free, and (under lg, where the three cards stack) a row of jump links to
 * each plan. The links may wrap; none of them carries a nowrap.
 */
import { useTranslation } from "react-i18next";
import { money } from "@/lib/format";
import { FULL_ANALYSIS_PRICE_USD, PRO_PRICE_USD } from "./plan-facts";

export function PricingHead() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const jumps = [
    { href: "#free", name: t("pricingPlans.head.jumpFree"), price: money(0, "USD", { lng }) },
    { href: "#full-analysis", name: t("pricingPlans.head.jumpFa"), price: t("pricingPlans.head.jumpFaPrice", { price: money(FULL_ANALYSIS_PRICE_USD, "USD", { lng }) }) },
    { href: "#pro", name: t("pricingPlans.head.jumpPro"), price: t("pricingPlans.head.jumpProPrice", { price: money(PRO_PRICE_USD, "USD", { lng }) }) },
  ];
  return (
    <>
      <h1 id="pricing-h1" className="text-3xl font-semibold tracking-tight md:text-4xl">
        {t("pricingPlans.head.h1")}
      </h1>
      <p className="mt-2 max-w-[62ch] text-base text-muted-foreground md:text-lg" data-testid="pricing-sub">
        {t("pricingPlans.head.sub")}
      </p>
      <nav aria-label={t("pricingPlans.head.jumpLabel")} className="mt-4 lg:hidden">
        <ul className="flex flex-wrap gap-2">
          {jumps.map((j) => (
            <li key={j.href}>
              <a
                href={j.href}
                className="inline-flex min-h-9 max-w-full flex-wrap items-baseline gap-x-1.5 rounded-md border border-border-strong bg-card px-3 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:min-h-11"
              >
                <span className="font-semibold text-foreground">{j.name}</span>
                <span className="text-muted-foreground">{j.price}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
