/**
 * THE POSTING'S FACTS, AS A LABELLED LIST — the pane's <dl>, shared with the
 * posting page.
 *
 * A fact the employer did not state has no row: no label, no dash, no "not
 * specified". Every figure names its basis in its own row. Two rows say more
 * than they used to, because the job-listings audit found them misleading:
 *
 *   Posted       dated: "9 Oct 2026, as the employer's system states it";
 *                a system that moves its date (Breezy, Paylocity, UKG): the
 *                FEED date with the hedge; undated: one sentence saying the
 *                employer's system states none. Never a first-seen date.
 *   Pay          "from the employer's feed" — never a claim that it is the
 *                employer's verbatim words (displaySalary tidies the
 *                notation) and never a raw vendor slug such as
 *                "/per-month-salary".
 *   Hiring system  "Apply link opens on {system}", read off the apply link
 *                itself, which is the system the reader will actually meet.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { decodeListingText } from "@/lib/listing/text";
import { applySystem, cleanApplyUrl } from "@/lib/listing/apply-url";
import { allListingPlaces, countryLabelOrNull, displayLocation } from "@/lib/listing/location";
import { listingPay, PAY_BASIS_FALLBACK } from "@/lib/listing/pay";
import { EMPLOYMENT_TYPE_FALLBACK, statedEmploymentType, statedWorkMode, type ListingJob } from "@/lib/listing/types";
import { agoText, periodSuffix, postedFactText } from "./listing-text";
import { AgencyBoardChip } from "./AgencyBoardChip";

export interface PostingFactsProps {
  job: ListingJob;
  /** The posting page prints our-reading copy for a pay figure we could not read; the pane prints no row. */
  showPayAbsence?: boolean;
  /** The field's pay benchmark (Jobs.tsx detailSalaryContext), rendered inside the Pay row. */
  payContext?: ReactNode;
  /** The Field row is a control on the board ("more like this"); absent elsewhere, it is plain text. */
  onCategory?: (category: string) => void;
  now?: Date;
}

const DT = "pt-0.5 text-xs text-muted-foreground";
const DD = "min-w-0 text-sm text-foreground";
const NOTE = "block text-xs text-muted-foreground";

export function PostingFacts({ job, showPayAbsence, payContext, onCategory, now }: PostingFactsProps) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "en";
  const pay = listingPay(job, lng);
  const mode = statedWorkMode(job);
  const type = statedEmploymentType(job.employmentType);
  const loc = displayLocation(job.location);
  const places = allListingPlaces(job);
  const country = countryLabelOrNull(job.country, lng);
  const system = applySystem(cleanApplyUrl(job.applyUrl));
  const department = decodeListingText(job.department);
  const read = job.missingSince ? null : agoText(t, job.recheckedAt, lng, now);
  const band = job.experienceBand && job.experienceBand !== "unspecified" ? job.experienceBand : null;
  const years = typeof job.minYears === "number" && job.minYears > 0 ? job.minYears : null;
  const category = typeof job.category === "string" && job.category ? job.category : null;

  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5" data-posting-facts="">
      {(pay || showPayAbsence) && (
        <>
          <dt className={DT}>{t("jobsPage.factPay", "Pay")}</dt>
          <dd className={DD}>
            {pay ? (
              <>
                <span className="font-semibold" title={pay.raw}>{pay.text}</span>
                {pay.currencyCode && <span className="text-muted-foreground"> ({pay.currencyCode})</span>}
                {pay.basis && (
                  <span className="text-muted-foreground"> · {t(`jobsPage.payBasis.${pay.basis}`, PAY_BASIS_FALLBACK[pay.basis])}</span>
                )}
                {pay.annual && job.salaryPeriod && (
                  <span
                    className="text-muted-foreground"
                    title={t("jobsPage.annualizedBasisTip", "Our arithmetic, not the employer's: an hourly rate × 2,080 hours (40 hours a week, 52 weeks), a daily rate × 260 days, a monthly rate × 12. The figure to its left is what the posting actually says.")}
                  >
                    {" · "}
                    {t("listing.card.annualEstimate", { defaultValue: "≈ {{amount}}{{period}}", amount: pay.annual, period: periodSuffix(t, "year") })}
                  </span>
                )}
                <span className={NOTE}>{t("listing.facts.payBasis", "from the employer's feed")}</span>
                {payContext}
              </>
            ) : (
              <span className="text-muted-foreground">
                {t("jobPostingPage.noPayFound", "We found no pay figure on this posting. That is our reading, not a statement by the employer — the description may still name one.")}
              </span>
            )}
          </dd>
        </>
      )}
      {mode && (
        <>
          <dt
            className={DT}
            title={t("jobsPage.workModeProvenance", "Work mode as the employer states it — the option they chose in their own hiring system, or their own words on the posting: its title, its location or its department. Where those disagree, or where none of them states a mode, the posting shows none: silence is never read as on-site.")}
          >
            {t("jobsPage.factWorkMode", "Work mode")}
          </dt>
          <dd className={DD}>{t(`jobsPage.workMode.${mode}`, mode)}</dd>
        </>
      )}
      {type && (
        <>
          <dt className={DT} title={t("jobsPage.employmentTypeProvenance", "Employment type as the employer states it on its own careers feed. Postings whose feed states no type show no tag — never a guess.")}>
            {t("jobsPage.factEmploymentType", "Job type")}
          </dt>
          <dd className={DD}>{t(`jobsPage.employmentType.${type}`, EMPLOYMENT_TYPE_FALLBACK[type])}</dd>
        </>
      )}
      <dt className={DT}>{t("jobsPage.factPosted", "Posted")}</dt>
      <dd className={DD} data-fact="posted">{postedFactText(t, job, lng, now)}</dd>
      {places.length > 0 && (
        <>
          <dt className={DT}>{places.length > 1 ? t("listing.facts.locations", "Locations") : t("listing.facts.location", "Location")}</dt>
          <dd className={DD}>
            {places.length > 1 ? (
              <ul className="space-y-0.5">{places.map((p) => <li key={p}>{p}</li>)}</ul>
            ) : places[0]}
          </dd>
        </>
      )}
      {loc.reduced && loc.raw && (
        <>
          <dt className={DT}>{t("jobsPage.factLocationRaw", "Location, verbatim")}</dt>
          <dd className={DD}>
            {loc.raw}
            <span className={NOTE}>
              {t("jobsPage.locationTidiedNote", "Exactly as the employer's system wrote it. The line at the top of this panel is the same text with requisition and site codes removed — nothing was added to it.")}
            </span>
          </dd>
        </>
      )}
      {country && (
        <>
          <dt className={DT}>{t("jobsPage.factCountry", "Country")}</dt>
          <dd className={DD} title={t("jobsPage.countryProvenance", "Read from the employer's own feed — its country field where it publishes one, otherwise its location text. Postings we cannot place show no country rather than a guess.")}>
            {country}
          </dd>
        </>
      )}
      {system && (
        <>
          <dt className={DT}>{t("listing.facts.system", "Hiring system")}</dt>
          <dd className={DD} data-fact="system">{t("listing.facts.systemValue", { defaultValue: "Apply link opens on {{system}}", system: system.label })}</dd>
        </>
      )}
      {department && (
        <>
          <dt className={DT}>{t("listing.facts.department", "Department")}</dt>
          <dd className={DD}>{department}</dd>
        </>
      )}
      {(band || years) && (
        <>
          <dt className={DT}>{t("jobsPage.factExperience", "Experience")}</dt>
          <dd className={DD}>
            {band && (
              <span title={t("jobsPage.experienceProvenance", "Our seniority bucket for this posting, read from its title and requirements — not a label the employer chose.")}>
                {t(`jobsPage.experience.${band}`, band)}
              </span>
            )}
            {years && (
              <span className="text-muted-foreground" title={t("jobsPage.minYearsProvenance", "The minimum years the posting itself asks for, in the employer's own words.")}>
                {band ? " · " : ""}{t("jobsPage.minYears", { defaultValue: "{{n}}+ yrs", n: years })}
              </span>
            )}
          </dd>
        </>
      )}
      {category && (
        <>
          <dt className={DT}>{t("jobsPage.factField", "Field")}</dt>
          <dd className={DD} title={t("jobsPage.categoryProvenance", "Our classification of this posting, read from its title — not a label the employer chose. The employer's own team name, where its feed states one, is beside the company at the top.")}>
            {onCategory ? (
              <button type="button" className="text-left text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary" onClick={() => onCategory(category)}>
                {t(`jobsPage.categories.${category}`, category)}
              </button>
            ) : t(`jobsPage.categories.${category}`, category)}
          </dd>
        </>
      )}
      {job.agency === true && (
        <>
          <dt className={DT}>{t("jobsPage.factEmployer", "Employer")}</dt>
          <dd className={DD}><AgencyBoardChip /></dd>
        </>
      )}
      {read && (
        <>
          <dt className={DT}>{t("listing.facts.feedRead", "Feed read")}</dt>
          <dd className={DD} title={t("listing.card.feedReadTip", "When we last read this employer's own job feed. A posting the employer takes down leaves the board at the next read of its feed.")}>
            {read}
          </dd>
        </>
      )}
    </dl>
  );
}
