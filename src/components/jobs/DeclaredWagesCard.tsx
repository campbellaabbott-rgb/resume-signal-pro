// Declared-wages card: what this employer actually declared it pays, from the
// US Department of Labor's public LCA disclosure files (H-1B filings). Every
// number is the employer's own declared base wage, annualized from the filing
// unit and aggregated per role (median + interquartile band, n>=3). The
// labeling is load-bearing: these are H-1B roles only — never presented as
// company-wide pay. Renders nothing for companies without filings.

import { useEffect, useState } from "react";
import { H1B_DATA_AVAILABLE } from "@/lib/h1b-availability";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

interface H1bRole { title: string; n: number; median: number; p25: number; p75: number }
interface H1bData {
  fiscal_year: string;
  total_certified: number;
  median_annual: number;
  roles: H1bRole[];
}

const fmtUsd = (n: number) => `$${n >= 1000 ? Math.round(n / 1000) + "k" : n}`;

export function DeclaredWagesCard({ companyToken, companyName }: { companyToken: string; companyName: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<H1bData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    // No H1B_DATA_AVAILABLE → the RPC does not exist; don't 404 on every view.
    if (!H1B_DATA_AVAILABLE) return;
    (async () => {
      try {
        const { data: d } = await (supabase as unknown as {
          rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_company_h1b", { p_token: companyToken });
        if (!cancelled && d && typeof d === "object" && (d as H1bData).total_certified) {
          setData(d as H1bData);
        }
      } catch { /* additive card */ }
    })();
    return () => { cancelled = true; };
  }, [companyToken]);

  if (!data || data.roles.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 max-w-xl mb-3">
      <div className="flex items-center gap-1.5 mb-1 text-[12px] font-medium text-primary">
        <FileText className="w-3.5 h-3.5" />
        {t("jobsPage.h1b.chip", "Declared wages · H-1B filings {{fy}}", { fy: data.fiscal_year })}
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {t("jobsPage.h1b.summary", "{{company}} declared base wages for {{n}} certified H-1B positions — median {{m}}/year.", {
          company: companyName, n: data.total_certified.toLocaleString(), m: fmtUsd(data.median_annual),
        })}
      </p>
      <div className="space-y-1.5">
        {data.roles.slice(0, 5).map((r) => (
          <div key={r.title} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-foreground truncate">{r.title}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold text-foreground">{fmtUsd(r.median)}</span>
              <span className="text-muted-foreground text-[11px]">
                {" "}· {t("jobsPage.h1b.range", "{{lo}}–{{hi}} · {{n}} filings", { lo: fmtUsd(r.p25), hi: fmtUsd(r.p75), n: r.n })}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2.5">
        {t("jobsPage.h1b.sourceLine", "Source: US Department of Labor LCA disclosure files — base wages as declared by the employer, annualized. H-1B roles only; not company-wide pay.")}
      </p>
    </div>
  );
}
