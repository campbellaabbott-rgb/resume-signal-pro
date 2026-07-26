// Similar-companies module at the bottom of a company lander: other companies
// hiring in the same dominant field, ranked by open roles, excluded boards
// filtered server-side. Turns a lander from a leaf into a hub.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

interface SimilarRow {
  company: string;
  company_token: string;
  open_roles: number;
  employees: number | null;
  employee_basis: string | null;
  category: string;
}

export function SimilarCompanies({ companyToken }: { companyToken: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SimilarRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    (async () => {
      try {
        const { data } = await (supabase as unknown as {
          rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_similar_companies", { p_token: companyToken, p_limit: 6 });
        if (!cancelled && Array.isArray(data)) setRows(data as SimilarRow[]);
      } catch { /* additive module */ }
    })();
    return () => { cancelled = true; };
  }, [companyToken]);

  if (rows.length === 0) return null;
  const field = t(`jobsPage.categories.${rows[0].category}`, rows[0].category);

  return (
    <section className="container py-8">
      <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
        <Compass className="w-5 h-5 text-primary" />
        {t("jobsPage.similar.title", "Also hiring in {{field}}", { field })}
      </h2>
      <p className="text-[12px] text-muted-foreground mb-3">
        {t("jobsPage.similar.blurb", "Companies with live openings in the same field, from their own career systems.")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {rows.map((r) => (
          <Link
            key={r.company_token}
            to={`/jobs/company/${encodeURIComponent(r.company_token)}`}
            className="group flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-primary/50 hover:bg-card transition-colors"
          >
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
              {r.company.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground truncate">{r.company}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t("jobsPage.similar.openRoles", "{{n}} open roles", { n: r.open_roles })}
                {r.employees != null && (
                  // Basis label rides along (same keys the intel panel uses) —
                  // an unattributed headcount reads as our claim; it isn't.
                  <>
                    {" · "}{t("jobsPage.similar.employees", "≈{{n}} employees", { n: r.employees.toLocaleString() })}
                    {" ("}{r.employee_basis === "yc_self_reported"
                      ? t("jobsPage.intel.basisYc", "YC profile")
                      : t("jobsPage.intel.basisPr", "public records")}{")"}
                  </>
                )}
              </span>
            </span>
            <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        ))}
      </div>
    </section>
  );
}
