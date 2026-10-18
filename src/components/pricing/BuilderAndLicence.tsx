/**
 * FOR BUILDERS AND COMPANIES: the planned Builder API card and the commercial
 * data licence. Neither sells anything here: the Builder card asks for
 * interest on /data-api#builder and carries no buy button, Stripe link or
 * sign-up flow.
 *
 * ONE SET OF BUILDER STRINGS WITH /data-api (spec P21). The card reads wave
 * 4's dataApiPage.builder* keys whenever they exist, and this shard's copies
 * of them (the same words and the same {{price}} contract, copied from
 * wave4/integration) only until they do. The quota line mirrors the API's
 * published proposal (BUILDER_PROPOSED.perDay, owner decision 7, option A).
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Chip } from "@/components/ui/chip";
import { Surface } from "@/components/ui/card";
import { count } from "@/lib/format";
import { listOf } from "./format-utc";
import { BUILDER_PRICE_USD, BUILDER_PROPOSED_PER_DAY, FREE_KEY_DAILY_QUOTA, WITHHELD_SOURCES, WITHHELD_SOURCE_NAMES } from "./plan-facts";

const LINK = "inline-flex min-h-6 items-center text-sm font-medium text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function BuilderAndLicence() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  /** wave 4's /data-api key when it exists, this page's copy of it until then. */
  const builder = (k: "builderName" | "builderPrice" | "builderBody" | "builderNotYet" | "builderCta", vars: Record<string, unknown> = {}) =>
    t(`dataApiPage.${k}`, { ...vars, defaultValue: t(`pricingPlans.b2b.${k}`, vars) });
  const names = listOf(
    WITHHELD_SOURCES.map((s) => WITHHELD_SOURCE_NAMES[s] ?? s).sort((a, b) => a.localeCompare(b)),
    lng,
  );
  return (
    <section aria-labelledby="pricing-b2b" className="border-t border-border py-8 sm:py-10 lg:py-16">
      <div className="container">
        <h2 id="pricing-b2b" className="text-2xl font-semibold tracking-tight md:text-3xl">
          {t("pricingPlans.b2b.h2")}
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Surface className="min-w-0 px-5 py-4" data-testid="builder-card">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold text-foreground">{builder("builderName")}</h3>
              <p className="text-base font-semibold text-foreground">{builder("builderPrice", { price: BUILDER_PRICE_USD })}</p>
            </div>
            <p className="mt-2">
              <Chip variant="outline">{t("pricingPlans.b2b.builderChip")}</Chip>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{builder("builderBody")}</p>
            <p className="mt-2 text-sm text-muted-foreground" data-testid="builder-quota">
              {t("pricingPlans.b2b.builderQuota", { perDay: count(BUILDER_PROPOSED_PER_DAY, { lng }) })}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{t("pricingPlans.b2b.builderFreeKey", { perDay: count(FREE_KEY_DAILY_QUOTA, { lng }) })}</p>
            <p className="mt-2 text-sm text-muted-foreground">{builder("builderNotYet")}</p>
            <p className="mt-3">
              <Link to="/data-api#builder" className={LINK}>
                {builder("builderCta")}
              </Link>
            </p>
          </Surface>
          <Surface className="min-w-0 px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold text-foreground">{t("pricingPlans.b2b.licenceName")}</h3>
              <p className="text-base font-semibold text-foreground">{t("pricingPlans.b2b.licencePrice")}</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t("pricingPlans.b2b.licenceBody")}</p>
            <p className="mt-3">
              <Link to="/data-api" className={LINK}>
                {t("pricingPlans.b2b.licenceCta")}
              </Link>
            </p>
          </Surface>
        </div>
        <p className="mt-3 text-sm text-muted-foreground" data-testid="withheld-line">
          {t("pricingPlans.b2b.withheld", { names })}
        </p>
      </div>
    </section>
  );
}
