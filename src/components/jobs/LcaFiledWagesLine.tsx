// A FILED WAGE IS PRINTED AS A FILED WAGE.
//
// One line beside a posting: what this employer FILED, with the US Department
// of Labor, for the certified Labor Condition Applications of one fiscal
// quarter -- the occupation, the worksite state, the number of applications
// behind the figure, the annual range, and the file it was read from with the
// date that file was published.
//
// WHAT IT NEVER SAYS. Not what the employer pays. Not what the employer will
// pay. Not what this posting pays. Not an offer, not a prediction, not a
// benchmark. Every sentence is in the past tense about applications that were
// filed and certified, and every sentence carries the quarter. The forbidden
// vocabulary is asserted over all nine locale files by
// src/test/a-range-under-the-minimum-number-of-filings-is-not-a-range.test.tsx
// -- a translator's tempting "verdient" or "paga" would turn a filing into a
// salary in eight languages at once, which is exactly the drift that took the
// "no subscriptions" copy false (project_claim_drift).
//
// AND IT NEVER SAYS THE OPPOSITE EITHER. An employer with no row here is an
// employer we have nothing to print about: we hold one quarter of one
// country's certifications, matched only where a name resolves to exactly one
// employer. A missing row is never "does not sponsor", is never rendered, and
// is never counted. The reader answers EVERY token asked -- a null row rather
// than no row -- so this component is never in the position of interpreting an
// absence.
//
// WHERE THE RULES LIVE. In SQL. get_employer_lca_wages holds the minimum
// number of applications behind a printable figure, the nearness rule (asked
// with an occupation it answers only from that occupation or its major group)
// and the one-row-per-token shape. This file mirrors those bars so a row that
// somehow arrives outside them renders nothing, and so the copy can name the
// minimum it is gated on. The mirrored numbers are read back out of the
// migration by the guard; changing one runtime alone fails it.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** The minimum number of certified applications behind any figure this line prints -- both behind
 *  the wage cell and behind the employer total. Mirrors the k block of the reader migration
 *  20260923114903; the cross-runtime guard reads both and fails on drift. */
export const LCA_MIN_FILINGS = 3;

/** What the reader may answer with. A row naming anything else is refused here too, so a future
 *  column cannot slip a cell past the nearness rule that admitted it. */
export const LCA_MATCH_BASES = ["soc_and_state", "soc", "soc_group_and_state", "soc_group", "state_top", "employer_top"] as const;
export type LcaMatchBasis = (typeof LCA_MATCH_BASES)[number];

/** The two bases that are NOT about the posting in front of the reader.
 *
 *  Nothing on a posting carries an occupation code or a worksite subdivision, so the only call site
 *  asks the reader with neither -- and with neither, the nearness rule can only land on the
 *  employer's largest cell, or on the largest cell in an asked state. That cell's occupation has no
 *  connection to the role being read. Under a heading naming the quarter and the file, an occupation
 *  and a state with no stated reason for being there is a figure whose basis is not printed, which
 *  is the rule project_stat_provenance exists for. These two therefore carry a sentence saying how
 *  the cell was chosen; the four occupation-matched bases do not need one, because the occupation
 *  the sentence already names IS the basis. */
export const LCA_UNASKED_BASES: readonly LcaMatchBasis[] = ["employer_top", "state_top"];

/** The authority the copy must name on every surface that prints one of these numbers. */
export const LCA_SOURCE_AUTHORITY = "US Department of Labor";

export interface LcaFiledWages {
  companyToken: string;
  socCode: string;
  socTitle: string | null;
  worksiteState: string;
  wageLow: number;
  wageHigh: number;
  wageMedian: number;
  filingsN: number;
  basis: LcaMatchBasis;
  employerFilingsN: number;
  employerCellsN: number;
  fiscalQuarter: string;
  sourceFile: string;
  sourceUrl: string;
  publishedOn: string;
}

/** The employer-level answer alone: enough to say an employer filed, when no cell is near enough. */
export interface LcaEmployerFilings {
  companyToken: string;
  employerFilingsN: number;
  employerCellsN: number;
  fiscalQuarter: string;
  sourceFile: string;
  sourceUrl: string;
  publishedOn: string;
}

const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const isDateOnly = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The reader's row, refused unless it is exactly what the reader admits.
 *
 * Returns { employer } for a token whose employer total clears the bar but
 * whose nearest cell does not, { employer, wages } when both clear, and null
 * for the reader's "nothing qualifies" answer and for any row that fails the
 * client's mirror of the bars -- a total or a cell under the minimum, a basis
 * outside the vocabulary, a source link that is not https, a publication date
 * that is not a plain date, a range out of order.
 */
export function readLcaRow(raw: unknown): { employer: LcaEmployerFilings; wages: LcaFiledWages | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const token = strOrNull(r.ow_company_token);
  const total = numOrNull(r.ow_employer_filings_n);
  const cells = numOrNull(r.ow_employer_cells_n);
  const quarter = strOrNull(r.ow_fiscal_quarter);
  const file = strOrNull(r.ow_source_file);
  const url = strOrNull(r.ow_source_url);
  const published = r.ow_published_on;
  if (!token || total === null || cells === null || !quarter || !file || !url) return null;
  if (!url.startsWith("https://")) return null;
  if (!isDateOnly(published)) return null;
  if (total < LCA_MIN_FILINGS || cells < 1) return null;
  const employer: LcaEmployerFilings = {
    companyToken: token, employerFilingsN: total, employerCellsN: cells,
    fiscalQuarter: quarter, sourceFile: file, sourceUrl: url, publishedOn: published,
  };

  const soc = strOrNull(r.ow_soc_code);
  const state = strOrNull(r.ow_worksite_state);
  const low = numOrNull(r.ow_wage_low);
  const high = numOrNull(r.ow_wage_high);
  const med = numOrNull(r.ow_wage_median);
  const n = numOrNull(r.ow_filings_n);
  const basis = r.ow_match_basis;
  if (!soc || !state || low === null || high === null || med === null || n === null) return { employer, wages: null };
  if (!(LCA_MATCH_BASES as readonly unknown[]).includes(basis)) return { employer, wages: null };
  if (n < LCA_MIN_FILINGS || low <= 0 || high < low) return { employer, wages: null };
  return {
    employer,
    wages: {
      companyToken: token, socCode: soc, socTitle: strOrNull(r.ow_soc_title), worksiteState: state,
      wageLow: low, wageHigh: high, wageMedian: med, filingsN: n, basis: basis as LcaMatchBasis,
      employerFilingsN: total, employerCellsN: cells, fiscalQuarter: quarter,
      sourceFile: file, sourceUrl: url, publishedOn: published,
    },
  };
}

const money = (n: number, lang: string) => {
  try {
    return new Intl.NumberFormat(lang || "en", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString("en-US")}`;
  }
};

export interface LcaFiledWagesLineProps {
  companyToken: string;
  companyName: string;
  /** The posting's occupation code, when the caller knows one. Without it the reader answers the
   *  employer's largest cell and the copy names which occupation that is. */
  socCode?: string | null;
  /** The posting's US state, two letters or a region code with its country prefix. */
  worksiteState?: string | null;
}

/**
 * The line itself. Renders nothing at all until a row arrives that clears
 * every bar -- no skeleton, no "no data" state, because an absence here is not
 * a fact about the employer and must not occupy space as though it were.
 */
export function LcaFiledWagesLine({ companyToken, companyName, socCode = null, worksiteState = null }: LcaFiledWagesLineProps) {
  const { t, i18n } = useTranslation();
  const [row, setRow] = useState<{ employer: LcaEmployerFilings; wages: LcaFiledWages | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRow(null);
    if (!companyToken) return;
    (async () => {
      try {
        const { data } = await (supabase as unknown as {
          rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_employer_lca_wages", {
          p_tokens: [companyToken],
          p_soc_code: socCode ?? null,
          p_worksite_state: worksiteState ?? null,
        });
        if (cancelled) return;
        const first = Array.isArray(data) ? data[0] : data;
        setRow(readLcaRow(first));
      } catch {
        /* additive line: a reader that could not load prints nothing, and prints no error either */
      }
    })();
    return () => { cancelled = true; };
  }, [companyToken, socCode, worksiteState]);

  if (!row) return null;
  const { employer, wages } = row;
  const lang = i18n.language || "en";

  return (
    <div className="rounded-lg border border-border bg-card p-3 max-w-xl text-left">
      <div className="flex items-center gap-1.5 mb-1 text-[12px] font-medium text-primary">
        <FileText className="w-3.5 h-3.5" aria-hidden="true" />
        {t("jobsPage.lcaChip", "Filed H-1B wages · {{quarter}}", { quarter: employer.fiscalQuarter })}
      </div>

      {wages && (
        <p className="text-[12px] text-foreground mb-1">
          {t(
            "jobsPage.lcaRange",
            "{{company}} filed {{n}} certified labor condition applications for {{occupation}} in {{state}} in {{quarter}}, at annual wages from {{low}} to {{high}}.",
            {
              company: companyName,
              n: wages.filingsN.toLocaleString(lang),
              occupation: wages.socTitle ?? wages.socCode,
              state: wages.worksiteState,
              quarter: wages.fiscalQuarter,
              low: money(wages.wageLow, lang),
              high: money(wages.wageHigh, lang),
            },
          )}
        </p>
      )}

      {wages && LCA_UNASKED_BASES.includes(wages.basis) && (
        <p className="text-[11px] text-muted-foreground mb-1" data-lca-basis={wages.basis}>
          {t(
            "jobsPage.lcaWhyThisCell",
            "This is the largest group of applications this employer filed that quarter. Nothing on this posting states an occupation code, so it was not matched to this role.",
          )}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground mb-1">
        {t(
          "jobsPage.lcaSponsor",
          "{{company}} has {{total}} certified applications on file for that quarter, across {{groups}} occupation-and-state groups.",
          {
            company: companyName,
            total: employer.employerFilingsN.toLocaleString(lang),
            groups: employer.employerCellsN.toLocaleString(lang),
          },
        )}
      </p>

      <p className="text-[11px] text-muted-foreground mb-1">
        {t("jobsPage.lcaNotAnOffer", "These are wages that were filed for those applications. They are not this role's pay and not an offer.")}
      </p>

      <p className="text-[11px] text-muted-foreground">
        {t(
          "jobsPage.lcaBasis",
          "Source: {{file}}, published {{published}} — US Department of Labor, Office of Foreign Labor Certification. Public-domain data; the Department does not endorse this site.",
          { file: employer.sourceFile, published: employer.publishedOn },
        )}{" "}
        {t("jobsPage.lcaMinNote", "Shown only where at least {{min}} certified applications sit behind the figure.", { min: LCA_MIN_FILINGS })}
      </p>
    </div>
  );
}

export default LcaFiledWagesLine;
