// PAY, AS THE POSTINGS STATE IT, COUNTED AND DATED.
//
// From the company intel reader: the median of the bottom of each stated pay
// range, over the postings in one currency that state one -- printed only
// when at least PAY_MEDIAN_MIN_POSTINGS postings carry it (the plan's module
// bar), and named in plain words ("Typical bottom of the stated pay range")
// rather than "median stated salary floor". "Pay stated on k of n" prints
// only when the page has both numbers measured; today's readers return no
// such pair, so that line waits for one. Money and counts are formatted in
// the reader's language, and the line carries the time it was read.
import { useTranslation } from "react-i18next";
import type { CompanyIntel } from "@/components/jobs/CompanyIntelPanel";
import { count as fmtCount, date as fmtDate, money as fmtMoney } from "@/lib/format";
import { tPlural } from "@/lib/company/plural";
import { ProfileSection } from "./parts";

/** The plan's bar: a pay figure needs at least this many postings stating pay (plan section 8, D7). */
export const PAY_MEDIAN_MIN_POSTINGS = 5;

/** A measured "pay stated on k of n", when the page has one. */
export interface PayStated { k: number; n: number; asOf: string | null }

export interface PayFacts {
  stated: PayStated | null;
  floor: { amount: number; currency: string; m: number } | null;
  asOf: string | null;
}

/** What the pay section may print, or null for nothing at all. */
export function payFacts(intel: CompanyIntel | null | undefined, readAt: string | null, stated?: PayStated | null): PayFacts | null {
  const s = stated && Number.isFinite(stated.k) && Number.isFinite(stated.n) && stated.n > 0 && stated.k >= 0 && stated.k <= stated.n ? stated : null;
  const m = intel?.usd_n ?? 0;
  const floor = intel && intel.median_usd_floor != null && intel.median_usd_floor > 0 && m >= PAY_MEDIAN_MIN_POSTINGS
    ? { amount: intel.median_usd_floor, currency: "USD", m }
    : null;
  if (!s && !floor) return null;
  return { stated: s, floor, asOf: s?.asOf ?? readAt };
}

export function PaySummary({ facts, headingLevel = 2 }: { facts: PayFacts | null; headingLevel?: 2 | 3 }) {
  const { t, i18n } = useTranslation();
  if (!facts) return null;
  const lang = i18n.language || "en";
  const when = facts.asOf ? fmtDate(facts.asOf, { lng: lang }) : null;
  return (
    <ProfileSection title={t("companyProfile.pay.title", "Pay")} headingLevel={headingLevel} data-company-pay="">
      {facts.stated && (
        <p className="text-foreground">
          {t("companyProfile.pay.stated", "Pay stated on {{k}} of {{n}} postings", { k: fmtCount(facts.stated.k, { lng: lang }), n: fmtCount(facts.stated.n, { lng: lang }) })}
          {facts.stated.asOf ? <> · {t("companyProfile.pay.read", "read {{date}}", { date: fmtDate(facts.stated.asOf, { lng: lang }) })}</> : null}
        </p>
      )}
      {facts.floor && (
        <p className="text-foreground" data-pay-floor="">
          {tPlural(t, "companyProfile.pay.floor", facts.floor.m, {
            amount: fmtMoney(Math.round(facts.floor.amount), facts.floor.currency, { lng: lang }),
            m: fmtCount(facts.floor.m, { lng: lang }),
            currency: facts.floor.currency,
          },
          "Typical bottom of the stated pay range: {{amount}} · median across {{m}} {{currency}} posting",
          "Typical bottom of the stated pay range: {{amount}} · median across {{m}} {{currency}} postings")}
          {when && !facts.stated ? <> · {t("companyProfile.pay.read", "read {{date}}", { date: when })}</> : null}
        </p>
      )}
      <p className="text-xs text-subtle-foreground">
        {t("companyProfile.pay.basis", "Yearly figures from the pay ranges their open postings state; postings that state no pay are not counted.")}
      </p>
    </ProfileSection>
  );
}
