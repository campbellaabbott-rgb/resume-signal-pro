// WHERE THE OPEN ROLES ARE: fields and countries, as labelled bars.
//
// Only from what the company intel reader returns (its top fields and top
// countries, each with a count), and only when the plan's module bar is met:
// at least two fields, and countries stated on at least half of the open
// roles. A near-universal "two fields" with no stated place is not a hiring
// mix (plan section 8, D7). The share is judged against the page's one
// open-roles figure, and only while that figure is exact: against a floor
// ("10,000+") the share would be overstated, so the countries are left out.
//
// One hue, values printed beside every bar, and the same figures in a table
// for screen readers. On an agency's board or USAJOBS the heading says "Roles
// listed mostly in", never "hires mostly in": the roles are not the board's
// own hires.
import { useTranslation } from "react-i18next";
import type { CompanyIntel } from "@/components/jobs/CompanyIntelPanel";
import type { OpenRolesValue } from "@/lib/company/lander-model";
import { count as fmtCount, date as fmtDate } from "@/lib/format";
import { ProfileSection, ValueBar } from "./parts";

/** The plan's bar: at least this many fields, and a place stated on at least this share of open roles. */
export const MIX_MIN_FIELDS = 2;
export const MIX_MIN_PLACE_SHARE = 0.5;

export interface MixFacts {
  fields: Array<{ category: string; n: number }>;
  countries: Array<{ country: string; n: number }>;
  asOf: string | null;
  /**
   * The reader's counts cover more roles than this page serves (S13-116):
   * get_company_intel pools every career site an employer runs on one
   * hiring system (a multi-site Workday tenant), so the PwC campus page (353
   * roles) printed India 1,172. `atLeast` is the smallest total the pooled
   * counts prove; `page` is this page's own figure.
   */
  pooled?: { atLeast: number; page: number };
}

export function mixFacts(intel: CompanyIntel | null | undefined, openRoles: OpenRolesValue | null, readAt: string | null): MixFacts | null {
  if (!intel) return null;
  const fields = intel.categories.filter((c) => c.n > 0);
  if (fields.length < MIX_MIN_FIELDS) return null;
  const placed = intel.countries.reduce((s, c) => s + (c.n > 0 ? c.n : 0), 0);
  const inFields = fields.reduce((s, c) => s + c.n, 0);
  // Against a floor ("10,000+") neither the share nor the pooling can be judged.
  const page = openRoles && !openRoles.floor && openRoles.value > 0 ? openRoles.value : null;
  if (!page) return null;
  const countries = intel.countries.filter((c) => c.n > 0);
  // POOLED: either list alone already holds more roles than this page serves,
  // so the counts are the employer's whole hiring system, not this page's.
  // They print under that label, and placement is judged against the pooled
  // total the lists prove (never against this page's figure, which the
  // pooled sum always cleared).
  const atLeast = Math.max(placed, inFields);
  if (atLeast > page) {
    if (placed < atLeast * MIX_MIN_PLACE_SHARE) return null;
    return { fields, countries, asOf: readAt, pooled: { atLeast, page } };
  }
  if (placed < page * MIX_MIN_PLACE_SHARE) return null;
  return { fields, countries, asOf: readAt };
}

function countryName(code: string, lang: string): string {
  try { return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code; } catch { return code; }
}

export function HiringMix({ facts, asListings = false, headingLevel = 2 }: { facts: MixFacts | null; asListings?: boolean; headingLevel?: 2 | 3 }) {
  const { t, i18n } = useTranslation();
  if (!facts) return null;
  const lang = i18n.language || "en";
  const fieldLabel = (c: string) => t(`jobsPage.categories.${c}`, c);
  const maxField = Math.max(...facts.fields.map((f) => f.n), 1);
  const maxCountry = Math.max(...facts.countries.map((f) => f.n), 1);
  const roles = (n: number) => fmtCount(n, { lng: lang });
  return (
    <ProfileSection
      title={asListings
        ? t("companyProfile.mix.titleListings", "Roles listed mostly in")
        : facts.pooled
          ? t("companyProfile.mix.titlePooled", "Hiring mix across the employer's hiring system")
          : t("companyProfile.mix.title", "Hiring mix")}
      headingLevel={headingLevel}
      data-company-mix=""
    >
      <div className="space-y-2">
        <p className="text-meta font-medium text-foreground">{t("companyProfile.mix.fields", "Fields")}</p>
        {facts.fields.map((f) => <ValueBar key={f.category} label={fieldLabel(f.category)} value={roles(f.n)} share={f.n / maxField} />)}
      </div>
      {facts.countries.length > 0 && (
        <div className="space-y-2">
          <p className="text-meta font-medium text-foreground">{t("companyProfile.mix.countries", "Countries")}</p>
          {facts.countries.map((c) => <ValueBar key={c.country} label={countryName(c.country, lang)} value={roles(c.n)} share={c.n / maxCountry} />)}
        </div>
      )}
      <table className="sr-only">
        <caption>{t("companyProfile.mix.tableCaption", "Open roles by field and by country")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("companyProfile.mix.group", "Group")}</th>
            <th scope="col">{t("companyProfile.mix.roles", "Open roles")}</th>
          </tr>
        </thead>
        <tbody>
          {facts.fields.map((f) => <tr key={f.category}><th scope="row">{fieldLabel(f.category)}</th><td>{roles(f.n)}</td></tr>)}
          {facts.countries.map((c) => <tr key={c.country}><th scope="row">{countryName(c.country, lang)}</th><td>{roles(c.n)}</td></tr>)}
        </tbody>
      </table>
      <p className="text-xs text-subtle-foreground" data-company-mix-basis={facts.pooled ? "pooled" : "page"}>
        {facts.pooled
          ? facts.asOf
            ? t("companyProfile.mix.basisPooled", "These counts cover every career site this employer runs on the same hiring system (at least {{n}} open roles), not only the {{m}} on this page. Read on {{date}}; roles in no field we recognize are left out.", { n: roles(facts.pooled.atLeast), m: roles(facts.pooled.page), date: fmtDate(facts.asOf, { lng: lang }) })
            : t("companyProfile.mix.basisPooledUndated", "These counts cover every career site this employer runs on the same hiring system (at least {{n}} open roles), not only the {{m}} on this page. Roles in no field we recognize are left out.", { n: roles(facts.pooled.atLeast), m: roles(facts.pooled.page) })
          : facts.asOf
          ? t("companyProfile.mix.basis", "The largest groups among the open roles we read on {{date}}; roles in no field we recognize are left out.", { date: fmtDate(facts.asOf, { lng: lang }) })
          : t("companyProfile.mix.basisUndated", "The largest groups among the open roles we read; roles in no field we recognize are left out.")}
      </p>
    </ProfileSection>
  );
}
