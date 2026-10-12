// PUBLIC RECORDS: what this employer filed, each with its date and its source.
//
// Layoff filings used to sit inside the Hiring Health card, between a closure
// count and the fourteen-day share, as if they were part of the record we
// observe (audit CP18). They are not: a WARN notice or an SEC 8-K is a public
// filing about the employer on one date. This section holds them apart, with
// the US Department of Labor's filed H-1B wages and the SEC figures, under one
// line every reader sees first: no match in these records is not proof of
// anything. A record we hold no match for prints nothing, never "none".
//
//   - layoffs: one compact row per filing, the filer as the source spells it,
//     the state and the count a notice states, the day it was filed, the
//     source link and our read (LayoffFilingRows);
//   - filed H-1B wages: only when the reader returns a row, with the quarter,
//     the file, its published date and the occupation taken from the row
//     (LcaFiledWagesView; today's rows are empty, a wave-4 hand-off);
//   - SEC figures: the load date, FY labels with visible values, and the
//     revenue block collapsed when a year has none (PublicCompanyCardView).
//
// The section renders nothing at all when none of the three has a row.
import { useTranslation } from "react-i18next";
import { LayoffFilingRows, type LayoffFiling } from "@/components/jobs/LayoffFilingLine";
import { LcaFiledWagesView, type LcaRow } from "@/components/jobs/LcaFiledWagesLine";
import { PublicCompanyCardView, type Financials } from "@/components/jobs/PublicCompanyCard";
import { ProfileSection } from "./parts";

export interface PublicRecordsData {
  layoffRows: LayoffFiling[];
  financials: Financials | null;
  lca: LcaRow | null;
}

/** Whether the section has anything to print, given what this variant may show. */
export function publicRecordsRender(d: PublicRecordsData, show: { sec: boolean; lca: boolean }): boolean {
  return d.layoffRows.length > 0 || (show.sec && !!d.financials) || (show.lca && !!d.lca);
}

export function PublicRecords({ data, companyName, showSec, showLca = true, headingLevel = 2 }: {
  data: PublicRecordsData;
  companyName: string;
  showSec: boolean;
  showLca?: boolean;
  headingLevel?: 2 | 3;
}) {
  const { t } = useTranslation();
  if (!publicRecordsRender(data, { sec: showSec, lca: showLca })) return null;
  return (
    <ProfileSection title={t("companyProfile.records.title", "Public records")} headingLevel={headingLevel} data-public-records="">
      <p className="text-meta text-foreground" data-public-records-caveat="">
        {t("companyProfile.records.noProof", "No match in these records is not proof of anything.")}
      </p>
      {data.layoffRows.length > 0 && (
        <div className="space-y-1">
          <p className="text-meta font-medium text-foreground">{t("companyProfile.records.layoffsTitle", "Layoff filings")}</p>
          <LayoffFilingRows rows={data.layoffRows} />
        </div>
      )}
      {showLca && data.lca && (
        <div className="border-t border-border pt-2">
          <LcaFiledWagesView row={data.lca} companyName={companyName} context="employer" bare />
        </div>
      )}
      {showSec && data.financials && (
        <div className="border-t border-border pt-2">
          <PublicCompanyCardView fin={data.financials} bare />
        </div>
      )}
    </ProfileSection>
  );
}
