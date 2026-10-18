/**
 * "BEFORE YOU BUY", ABOVE THE PLAN CARDS: the three things a buyer must know
 * before any click (owner decisions, 2026-10-17).
 *
 *   1. All sales are final (and the Terms' remedy: we make it again, free).
 *   2. Not sold in the EU, the EEA, the UK or India yet, and what checkout
 *      actually checks: the currency, the time zone the device reports and an
 *      IP address lookup. Never "billing address": no code checks one before
 *      payment.
 *   3. US dollars, and Pro renews monthly with a separate renewal tick box.
 *
 * From lg the three sit side by side, all text shown. Under lg they stack in
 * one box; the region line stays open, its mechanism included, so it is read
 * before any click, and the other two are native <details>, whose text stays
 * in the DOM while closed (a reader's Find opens them; a crawler reads them).
 */
import { ChevronDown, DollarSign, Globe, Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { money } from "@/lib/format";
import { PRO_PRICE_USD } from "./plan-facts";
import { useMinWidth } from "./use-media";

interface Item {
  id: "final" | "region" | "renewal";
  icon: ReactNode;
  title: string;
  body: string;
  /** Shown open under lg too: the region line and its mechanism come before any click. */
  alwaysOpen: boolean;
}

export function BeforeYouBuy() {
  const { t, i18n } = useTranslation();
  const wide = useMinWidth(1024);
  const proPrice = money(PRO_PRICE_USD, "USD", { lng: i18n.language });
  const items: Item[] = [
    { id: "final", icon: <Receipt aria-hidden="true" />, title: t("pricingPlans.buy.finalSale"), body: t("pricingPlans.before.finalBody"), alwaysOpen: false },
    { id: "region", icon: <Globe aria-hidden="true" />, title: t("pricingPlans.buy.region"), body: t("pricingPlans.before.regionBody"), alwaysOpen: true },
    { id: "renewal", icon: <DollarSign aria-hidden="true" />, title: t("pricingPlans.before.renewalTitle"), body: t("pricingPlans.before.renewalBody", { proPrice }), alwaysOpen: false },
  ];
  const iconCls = "mt-0.5 inline-flex shrink-0 text-foreground [&_svg]:h-4 [&_svg]:w-4";

  return (
    <section aria-labelledby="pricing-before" className="mt-5" data-testid="before-you-buy">
      <h2 id="pricing-before" className="mb-1.5 text-meta font-semibold text-muted-foreground">
        {t("pricingPlans.before.h2")}
      </h2>
      {wide ? (
        <ul className="grid grid-cols-3 rounded-lg border border-border-strong bg-card">
          {items.map((it, i) => (
            <li key={it.id} data-notice={it.id} className={`flex items-start gap-2.5 px-4 py-3.5 text-sm text-muted-foreground ${i > 0 ? "border-l border-border" : ""}`}>
              <span className={iconCls}>{it.icon}</span>
              <span className="min-w-0">
                <b className="block font-semibold text-foreground">{it.title}</b>
                <span>{it.body}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="rounded-lg border border-border-strong bg-card">
          {items.map((it, i) => (
            <li key={it.id} data-notice={it.id} className={i > 0 ? "border-t border-border" : ""}>
              {it.alwaysOpen ? (
                <div className="flex items-start gap-2.5 px-3 py-3 text-sm">
                  <span className={iconCls}>{it.icon}</span>
                  <span className="min-w-0">
                    <b className="block font-semibold text-foreground">{it.title}</b>
                    <span className="text-muted-foreground">{it.body}</span>
                  </span>
                </div>
              ) : (
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className={iconCls}>{it.icon}</span>
                    <span className="min-w-0 flex-1">{it.title}</span>
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base group-open:rotate-180" />
                  </summary>
                  <p className="px-3 pb-3 pl-[2.375rem] text-sm text-muted-foreground">{it.body}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
