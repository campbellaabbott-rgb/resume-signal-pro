import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "@/i18n/home-strings";
import { Banknote, Receipt } from "lucide-react";
import { money } from "@/lib/format";
import { HOME_FULL_ANALYSIS_USD, HOME_PRO_USD_PER_MONTH, HOME_PRO_WRITING_PER_DAY, HOME_PRO_WRITING_PER_MONTH } from "@/lib/home/facts";
import { homePlanRows, type SaleGates } from "@/lib/home/sale-gates";

/**
 * 4.6 WHAT IT COSTS, quietly: no buy control on the homepage. Free leads. The
 * Full Analysis row is on sale while its switch is on (G2) and says why not
 * while it is off; the Pro row appears while G2b is on, and says it includes
 * the Full Analysis only while G2 is. Neither waits for the seller's name
 * (the owner, 2026-10-27: sales stay on), and both switches are on. The sale
 * terms sit under the rows before any click: final sale, and the currency
 * each product is charged in (owner decision 2026-10-25), with no place named
 * as unsold (a buyer in the EU, the EEA, the UK or India checks out as on
 * main): Pro's only while its row is shown, and the
 * Full Analysis's US-dollar list price with how it is charged: the currency
 * of the device's time zone when the hook recognizes the zone and checkout
 * supports its currency, else US dollars.
 */
export function HomePlanStrip({ gates }: { gates: SaleGates }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "en";
  const rows = homePlanRows(gates);
  const lede = rows.onSale === 2 ? "home.plans.ledeTwo" : rows.onSale === 1 ? "home.plans.ledeOne" : "home.plans.ledeNone";
  const fa = rows.fullAnalysis;

  return (
    <section aria-labelledby="home-plans" className="border-t border-border py-8 sm:py-10 lg:py-16">
      <div className="container">
        <h2 id="home-plans" className="text-[clamp(1.25rem,5vw,1.875rem)] font-semibold leading-tight md:text-3xl">{t("home.plans.title")}</h2>
        <p className="mt-2.5 max-w-[62ch] text-muted-foreground">{t(lede)}</p>
        <ul className="mt-5 rounded-lg border border-border bg-card" data-home-plans="">
          <li className="grid gap-1 p-4 md:grid-cols-[200px_minmax(0,1fr)] md:items-baseline md:gap-6 md:px-5 md:py-[18px]" data-plan="free">
            <p className="text-xl font-semibold">{t("home.plans.free")}</p>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-snug">{t("home.plans.freeTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t(gates.alertsStatable ? "home.plans.freeBody" : "home.plans.freeBodyNoAlerts")}</p>
            </div>
          </li>
          <li className="grid gap-1 border-t border-border p-4 md:grid-cols-[200px_minmax(0,1fr)] md:items-baseline md:gap-6 md:px-5 md:py-[18px]" data-plan="full-analysis" data-plan-state={fa.state}>
            <p className={`text-xl font-semibold ${fa.state === "onSale" ? "" : "text-muted-foreground"}`}>
              {money(HOME_FULL_ANALYSIS_USD, "USD", { lng })} <small className="text-sm font-normal text-muted-foreground">{t("home.plans.once")}</small>
            </p>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-snug">{t("home.plans.faTitle")}</h3>
              <p className="text-sm text-muted-foreground">
                {fa.state === "onSale" ? t("home.plans.faBody") : t("home.plans.faGatedDelivery")}
              </p>
            </div>
          </li>
          {rows.pro && (
            <li className="grid gap-1 border-t border-border p-4 md:grid-cols-[200px_minmax(0,1fr)] md:items-baseline md:gap-6 md:px-5 md:py-[18px]" data-plan="pro">
              <p className="text-xl font-semibold">
                {money(HOME_PRO_USD_PER_MONTH, "USD", { lng })} <small className="text-sm font-normal text-muted-foreground">{t("home.plans.perMonth")}</small>
              </p>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold leading-snug">{t("home.plans.proTitle")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("home.plans.proBody", { perDay: HOME_PRO_WRITING_PER_DAY, perMonth: HOME_PRO_WRITING_PER_MONTH })}
                  {rows.pro.includesFullAnalysis ? ` ${t("home.plans.proIncludesFa")}` : null}
                </p>
              </div>
            </li>
          )}
        </ul>
        <ul className="mt-3 grid gap-1.5 text-meta text-muted-foreground">
          <li className="flex items-start gap-2"><Receipt aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" /><span>{t("home.plans.termFinal")}</span></li>
          <li className="flex items-start gap-2"><Banknote aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" /><span>{t(rows.pro ? "home.plans.termCurrency" : "home.plans.termCurrencyFa")}</span></li>
        </ul>
        <div className="mt-5">
          <Link to="/pricing" className="link inline-flex items-center">{t("home.plans.more")}</Link>
        </div>
      </div>
    </section>
  );
}
