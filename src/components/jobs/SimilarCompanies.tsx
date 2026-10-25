// Similar employers on a company page: other boards hiring in the same
// dominant field, ranked by open roles, excluded boards filtered server-side.
// Turns a company page from a leaf into a hub.
//
// WHAT A ROW MAY SAY (design spec 5.5g, audit CP25). get_similar_companies
// ranks by field alone: its rows carry no country and no as-of. So the
// heading says "(any country)" rather than implying a local peer, a row's
// open-role count prints only when the reader returns the day it was counted
// (open_roles_as_of; today's reader returns none, so no count prints), and a
// headcount prints only with the date it was true (D11, datedHeadcount).
// Counts that do print are grouped in the reader's language.
//
// WHERE IT GOES. In the rail on a desktop, after the first page of results on
// a phone, and inside the empty state of a board with no open roles. One
// view, three placements; the data is read once per token while in flight.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { companyLanderPath } from "@/lib/public-href";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { datedHeadcount } from "@/lib/headcount";
import { inflight } from "@/lib/company/inflight";
import { count as fmtCount, date as fmtDate } from "@/lib/format";
import { tPlural } from "@/lib/company/plural";
import { cn } from "@/lib/utils";

export interface SimilarRow {
  company: string;
  company_token: string;
  open_roles: number;
  /** The day open_roles was counted. Not returned today, so no count prints. */
  open_roles_as_of?: string | null;
  employees: number | null;
  /** The day the count was true; today's reader returns none, so no count prints (D11). */
  employees_as_of?: string | null;
  employee_basis: string | null;
  category: string;
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}/;

/** get_similar_companies for one token, asked once while in flight. Empty until it answers, and on failure. */
export function useSimilarCompanies(companyToken: string | null | undefined, enabled = true, limit = 6): SimilarRow[] {
  const [rows, setRows] = useState<SimilarRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    setRows([]);
    if (!companyToken || !enabled) return;
    inflight(`get_similar_companies:${companyToken}:${limit}`, async () => {
      const { data } = await (supabase as unknown as {
        rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
      }).rpc("get_similar_companies", { p_token: companyToken, p_limit: limit });
      return data;
    }).then((data) => {
      if (!cancelled && Array.isArray(data)) {
        setRows((data as SimilarRow[]).filter((r) => r && typeof r.company === "string" && typeof r.company_token === "string"));
      }
    }).catch(() => { /* additive module */ });
    return () => { cancelled = true; };
  }, [companyToken, enabled, limit]);
  return rows;
}

export function SimilarCompaniesView({ rows, variant = "page", limit, headingLevel = 2 }: {
  rows: SimilarRow[];
  /** "page": full-width section; "rail": the desktop rail; "inline": inside an empty state or after page one. */
  variant?: "page" | "rail" | "inline";
  limit?: number;
  headingLevel?: 2 | 3;
}) {
  const { t, i18n } = useTranslation();
  const shown = typeof limit === "number" ? rows.slice(0, limit) : rows;
  if (shown.length === 0) return null;
  const lang = i18n.language || "en";
  const field = t(`jobsPage.categories.${shown[0].category}`, shown[0].category);
  const H = (headingLevel === 3 ? "h3" : "h2") as "h2" | "h3";

  return (
    <section
      data-similar-employers={variant}
      className={cn(
        variant === "page" && "container py-8",
        variant === "rail" && "rounded-lg border border-border bg-card p-4",
        variant === "inline" && "pt-2",
      )}
    >
      <H className="text-base font-semibold text-foreground">
        {t("companyProfile.similar.title", "Also hiring in {{field}} (any country)", { field })}
      </H>
      <p className="text-meta text-muted-foreground mt-0.5 mb-2">
        {t("jobsPage.similar.blurb", "Companies with live openings in the same field, from their own career systems.")}
      </p>
      <ul className={cn("grid gap-1.5", variant === "page" && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
        {shown.map((r) => {
          // A headcount prints with the date it was true or not at all (D11).
          const head = datedHeadcount(r);
          const counted = typeof r.open_roles === "number" && typeof r.open_roles_as_of === "string" && PLAIN_DATE.test(r.open_roles_as_of);
          return (
            <li key={r.company_token}>
              <Link
                to={companyLanderPath(r.company_token)}
                className="group flex min-h-11 items-center gap-3 rounded-md border border-border bg-card px-3 py-2 hover:border-border-strong hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground truncate">{r.company}</span>
                  {(counted || head) && (
                    <span className="block text-xs text-muted-foreground">
                      {counted && tPlural(t, "companyProfile.similar.openRolesAsOf", r.open_roles, { n: fmtCount(r.open_roles, { lng: lang }), date: fmtDate(r.open_roles_as_of!, { lng: lang }) }, "{{n}} open role · as of {{date}}", "{{n}} open roles · as of {{date}}")}
                      {counted && head && " · "}
                      {head && (
                        // Basis label rides along (same keys the intel panel uses) —
                        // an unattributed headcount reads as our claim; it isn't.
                        <>
                          {t("jobsPage.similar.employees", "≈{{n}} employees", { n: fmtCount(head.n, { lng: lang }) })}
                          {" ("}{r.employee_basis === "yc_self_reported"
                            ? t("jobsPage.intel.basisYc", "YC profile")
                            : t("jobsPage.intel.basisPr", "public records")}{", "}{t("jobsPage.intel.asOf", "as of {{date}}", { date: head.asOf })}{")"}
                        </>
                      )}
                    </span>
                  )}
                </span>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SimilarCompanies({ companyToken }: { companyToken: string }) {
  const rows = useSimilarCompanies(companyToken);
  return <SimilarCompaniesView rows={rows} variant="page" />;
}
