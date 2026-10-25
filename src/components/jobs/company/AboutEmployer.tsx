// ABOUT THIS EMPLOYER: everything the page knows about the employer, out of
// the way of its jobs.
//
// On a desktop it is a rail beside the list; on a phone it is one accordion
// after the third card, closed, whose h2 trigger summarises what is inside
// ("pay stated on 212 of 1,653 · 6 perks stated · public records") so a reader
// knows whether opening it is worth a tap (design spec 5.3, 5.5; audit CP5).
// The sections, in order: perks, the hiring record, pay, the hiring mix, how
// applying works, public records, and (in the rail only; on a phone they sit
// after the first page) similar employers.
//
// EACH SECTION RENDERS NOTHING WHEN ITS DATA IS ABSENT, and the whole block
// renders nothing when every section is empty: no placeholder, no "being
// checked". Which sections a variant may show is the model's decision
// (lander-model.ts sections): nothing employer-level on a board name two
// hiring systems share, no hiring record, perks, claim or SEC figures on a
// staffing agency's board, and only the tracking-floor reason of the record on
// USAJOBS. The summary counts exactly what the sections will print, through
// the same functions the sections use.
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { perksView, type EmployerPerksAnswer } from "@/lib/employer-perks";
import { CompanyPerksView, perksStatedCount } from "@/components/jobs/CompanyPerks";
import type { CompanyIntelState } from "@/components/jobs/CompanyIntelPanel";
import type { Financials } from "@/components/jobs/PublicCompanyCard";
import type { LcaRow } from "@/components/jobs/LcaFiledWagesLine";
import type { LayoffFiling } from "@/components/jobs/LayoffFilingLine";
import { SimilarCompaniesView, type SimilarRow } from "@/components/jobs/SimilarCompanies";
import type { LanderModel } from "@/lib/company/lander-model";
import { count as fmtCount } from "@/lib/format";
import { tPlural } from "@/lib/company/plural";
import { HiringRecordCard, hiringRecordRenders, type HiringRecordInput } from "./HiringRecordCard";
import { PaySummary, payFacts, type PayStated } from "./PaySummary";
import { HiringMix, mixFacts } from "./HiringMix";
import { PublicRecords, publicRecordsRender } from "./PublicRecords";
import { cn } from "@/lib/utils";

/** What the employer readers answered for one token (useCompanyProfile). */
export interface CompanyProfileData {
  intel: CompanyIntelState;
  perks: EmployerPerksAnswer | null;
  financials: Financials | null;
  lca: LcaRow | null;
  similar: SimilarRow[];
}

export interface AboutEmployerProps {
  model: LanderModel;
  token: string;
  profile: CompanyProfileData;
  /** The gated hiring record, assembled by the page (null on a variant that shows none). */
  record: HiringRecordInput | null;
  /** useEmployerLayoffFilingsAll(token), from the page. */
  layoffRows: LayoffFiling[];
  /** A measured "pay stated on k of n", when the page has one. */
  payStated?: PayStated | null;
  /** The design system's HowApplyingWorks block for this board, when the page has its system. */
  howApplying?: ReactNode;
}

interface Plan {
  perks: ReturnType<typeof perksView>;
  record: boolean;
  pay: ReturnType<typeof payFacts>;
  mix: ReturnType<typeof mixFacts>;
  howApplying: boolean;
  records: boolean;
  similar: boolean;
}

/** Which sections will print, decided once for the rail, the accordion and its summary. */
export function aboutPlan(p: AboutEmployerProps, includeSimilar: boolean): Plan {
  const s = p.model.sections;
  const intel = p.profile.intel;
  return {
    perks: s.perks ? perksView(p.profile.perks) : null,
    record: s.hiringRecord && hiringRecordRenders(p.record),
    pay: s.pay ? payFacts(intel.intel, intel.readAt, p.payStated) : null,
    mix: s.mix ? mixFacts(intel.intel, p.model.openRoles, intel.readAt) : null,
    howApplying: s.howApplying && !!p.howApplying,
    records: s.publicRecords && publicRecordsRender(
      { layoffRows: p.layoffRows, financials: p.profile.financials, lca: p.profile.lca },
      { sec: s.sec, lca: !s.hiringRecordFloorOnly },
    ),
    similar: includeSimilar && s.similar && p.profile.similar.length > 0,
  };
}

/** The accordion trigger's second line: what is inside, counted. Empty when nothing is. */
export function aboutSummary(t: TFunction, plan: Plan, lang: string, payStated?: PayStated | null): string {
  const parts: string[] = [];
  if (plan.pay) {
    parts.push(plan.pay.stated && payStated
      ? t("companyProfile.about.summaryPayStated", "pay stated on {{k}} of {{n}}", { k: fmtCount(payStated.k, { lng: lang }), n: fmtCount(payStated.n, { lng: lang }) })
      : t("companyProfile.about.summaryPay", "pay"));
  }
  const perks = perksStatedCount(plan.perks);
  if (perks > 0) parts.push(tPlural(t, "companyProfile.about.summaryPerks", perks, { n: fmtCount(perks, { lng: lang }) }, "{{n}} perk stated", "{{n}} perks stated"));
  if (plan.record) parts.push(t("companyProfile.about.summaryRecord", "hiring record"));
  if (plan.mix) parts.push(t("companyProfile.about.summaryMix", "hiring mix"));
  if (plan.howApplying) parts.push(t("companyProfile.about.summaryApplying", "how applying works"));
  if (plan.records) parts.push(t("companyProfile.about.summaryRecords", "public records"));
  return parts.join(" · ");
}

function Sections({ p, plan, level }: { p: AboutEmployerProps; plan: Plan; level: 2 | 3 }) {
  const s = p.model.sections;
  const name = p.model.name.name ?? p.token;
  return (
    <>
      {plan.perks && <CompanyPerksView answer={p.profile.perks} headingLevel={level} />}
      {plan.record && <HiringRecordCard input={p.record} floorOnly={s.hiringRecordFloorOnly} headingLevel={level} listingSite={p.model.variant === "usajobs"} />}
      {plan.pay && <PaySummary facts={plan.pay} headingLevel={level} />}
      {plan.mix && <HiringMix facts={plan.mix} asListings={s.mixAsListings} headingLevel={level} />}
      {plan.howApplying && <div data-how-applying="">{p.howApplying}</div>}
      {plan.records && (
        <PublicRecords
          data={{ layoffRows: p.layoffRows, financials: p.profile.financials, lca: p.profile.lca }}
          companyName={name}
          showSec={s.sec}
          showLca={!s.hiringRecordFloorOnly}
          headingLevel={level}
        />
      )}
      {plan.similar && <SimilarCompaniesView rows={p.profile.similar} variant="rail" limit={6} headingLevel={level} />}
    </>
  );
}

const any = (plan: Plan) => !!(plan.perks || plan.record || plan.pay || plan.mix || plan.howApplying || plan.records || plan.similar);

/** The desktop rail beside the list. */
export function AboutEmployerRail(props: AboutEmployerProps & { className?: string }) {
  const { t } = useTranslation();
  const plan = aboutPlan(props, true);
  if (!any(plan)) return null;
  const title = props.model.sections.perks || props.model.sections.sec
    ? t("companyProfile.about.title", "About this employer")
    : t("companyProfile.about.titleBoard", "About this board");
  return (
    <aside aria-label={title} data-company-about="rail" className={cn("space-y-3", props.className)}>
      <Sections p={props} plan={plan} level={2} />
    </aside>
  );
}

/** The phone accordion, closed, after the third card. */
export function AboutEmployerAccordion(props: AboutEmployerProps & { className?: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const plan = aboutPlan(props, false);
  if (!any(plan)) return null;
  const lang = i18n.language || "en";
  const title = props.model.sections.perks || props.model.sections.sec
    ? t("companyProfile.about.title", "About this employer")
    : t("companyProfile.about.titleBoard", "About this board");
  const summary = aboutSummary(t, plan, lang, props.payStated);
  return (
    <section data-company-about="accordion" className={cn("rounded-lg border border-border bg-card", props.className)}>
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full min-h-11 items-start justify-between gap-3 rounded-lg px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="min-w-0">
            <span className="block text-base font-semibold text-foreground">{title}</span>
            {summary && <span className="block text-meta font-normal text-muted-foreground" data-about-summary="">{summary}</span>}
          </span>
          <ChevronDown aria-hidden="true" className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </h2>
      <div id={`${id}-panel`} hidden={!open} className="space-y-3 border-t border-border p-3">
        <Sections p={props} plan={plan} level={3} />
      </div>
    </section>
  );
}
