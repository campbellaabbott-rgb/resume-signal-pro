// SEC-sourced public-company card on the lander: what kind of company a
// candidate is actually applying to. Every figure is from the company's own
// SEC filings (10-K / 20-F XBRL) — ticker, up to 3 fiscal years of revenue
// as a mini bar trend, YoY delta (arithmetic on two filed figures, labeled),
// and profitability with an icon + label (never color alone). Values render
// in text tokens; the single-series bars carry the one accent hue. Renders
// nothing for companies without a filing row — never a guess.

import { useEffect, useState } from "react";
import { Landmark, TrendingUp, TrendingDown, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

interface FyRow { fy: number; revenue: number | null; net_income: number | null }
interface Financials {
  ticker: string;
  exchange: string;
  sec_name: string;
  cik: number;
  currency: string;
  series: FyRow[];
}

const fmtMoney = (n: number, currency: string): string => {
  const prefix = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  const abs = Math.abs(n);
  const compact = abs >= 1e9 ? `${(abs / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${(abs / 1e6).toFixed(0)}M` : abs.toLocaleString();
  return `${n < 0 ? "-" : ""}${prefix}${compact}`;
};

export function PublicCompanyCard({ companyToken }: { companyToken: string }) {
  const { t } = useTranslation();
  const [fin, setFin] = useState<Financials | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFin(null);
    (async () => {
      try {
        const { data } = await (supabase as unknown as {
          rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_company_financials", { p_token: companyToken });
        if (!cancelled && data && typeof data === "object" && (data as Financials).ticker) {
          setFin(data as Financials);
        }
      } catch { /* additive card; the lander stands without it */ }
    })();
    return () => { cancelled = true; };
  }, [companyToken]);

  if (!fin || fin.series.length === 0) return null;

  const newest = fin.series[0];
  const prior = fin.series.find((s) => s.fy === newest.fy - 1);
  const revYoY = newest.revenue != null && prior?.revenue != null && prior.revenue > 0
    ? ((newest.revenue - prior.revenue) / prior.revenue) * 100
    : null;
  // Bars oldest → newest so time reads left to right.
  const bars = [...fin.series].sort((a, b) => a.fy - b.fy).filter((s) => s.revenue != null) as Array<FyRow & { revenue: number }>;
  const maxRev = Math.max(...bars.map((b) => b.revenue), 1);
  const profitable = newest.net_income != null ? newest.net_income > 0 : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 max-w-xl mb-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary">
          <Landmark className="w-3.5 h-3.5" />
          {t("jobsPage.publicCo.chip", "Public company")} · {fin.exchange}: {fin.ticker}
        </span>
        <a
          href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${fin.cik}&type=10-K`}
          target="_blank" rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
        >
          {t("jobsPage.publicCo.viewFilings", "SEC filings")} <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {newest.revenue != null && (
            <>
              <div className="text-2xl font-display font-bold text-foreground leading-none">
                {fmtMoney(newest.revenue, fin.currency)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {t("jobsPage.publicCo.revenueLabel", "FY{{y}} revenue", { y: newest.fy })}
                {revYoY != null && (
                  <span className={revYoY >= 0 ? "text-success" : "text-destructive"}>
                    {" "}· {revYoY >= 0 ? "+" : ""}{revYoY.toFixed(1)}% {t("jobsPage.publicCo.vsPrior", "vs FY{{y}}", { y: newest.fy - 1 })}
                  </span>
                )}
              </div>
            </>
          )}
          {profitable != null && (
            <div className={`inline-flex items-center gap-1 mt-2 text-[12px] ${profitable ? "text-success" : "text-destructive"}`}>
              {profitable ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {profitable
                ? t("jobsPage.publicCo.profitable", "Profitable — net income {{v}} (FY{{y}})", { v: fmtMoney(newest.net_income as number, fin.currency), y: newest.fy })
                : t("jobsPage.publicCo.netLoss", "Net loss {{v}} (FY{{y}})", { v: fmtMoney(Math.abs(newest.net_income as number), fin.currency), y: newest.fy })}
            </div>
          )}
        </div>

        {bars.length >= 2 && (
          <div className="flex items-end gap-1.5 h-16 shrink-0" role="img"
            aria-label={t("jobsPage.publicCo.trendAria", "Revenue by fiscal year")}>
            {bars.map((b) => (
              <div key={b.fy} className="flex flex-col items-center gap-1">
                <div
                  className="w-6 rounded-t bg-primary/80"
                  style={{ height: `${Math.max(8, Math.round((b.revenue / maxRev) * 48))}px` }}
                  title={`FY${b.fy}: ${fmtMoney(b.revenue, fin.currency)}`}
                />
                <span className="text-[10px] text-muted-foreground tabular-nums">{String(b.fy).slice(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground mt-2.5">
        {t("jobsPage.publicCo.sourceLine", "Source: {{name}}'s own SEC filings (10-K/20-F). Figures as filed; not investment advice.", { name: fin.sec_name })}
      </p>
    </div>
  );
}
