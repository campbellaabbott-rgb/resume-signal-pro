// SEC-sourced public-company card on the company page: what kind of company
// a candidate is actually applying to. Every figure is from the company's
// own SEC filings (10-K / 20-F XBRL) — ticker, up to 3 fiscal years of
// revenue as bars, the year-on-year change (arithmetic on two filed figures,
// labelled), and profitability with an icon and a word (never colour alone).
// Renders nothing for companies without a filing row — never a guess.
//
// WHAT THE AUDIT CHANGED (CP19, plan D11):
//   - the card says when its figures were loaded: the row's loaded_at when the
//     reader returns one, else SEC_FIGURES_LOADED_ON, the day the table was
//     measured as loaded (plan 2026-10-11, D11);
//   - a fiscal year with no revenue collapses its block instead of leaving an
//     empty band above the net-income line;
//   - each bar is labelled "FY'25" with its value printed beside it, and the
//     same figures sit in a table for screen readers (a title tooltip is out
//     of reach on a phone);
//   - money is formatted in the reader's language with the filing's currency
//     ("14,5 Mrd. $"), never a hand-built "$14.5B".

import { useEffect, useState } from "react";
import { Landmark, TrendingUp, TrendingDown, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { inflight } from "@/lib/company/inflight";
import { date as fmtDate, money as fmtMoney } from "@/lib/company/format";
import { cn } from "@/lib/utils";

/** The day company_financials was measured as loaded (plan 2026-10-11, D11): the basis when a row carries none. */
export const SEC_FIGURES_LOADED_ON = "2026-07-23";

interface FyRow { fy: number; revenue: number | null; net_income: number | null }
export interface Financials {
  ticker: string;
  exchange: string;
  sec_name: string;
  cik: number;
  currency: string;
  series: FyRow[];
  /** When the row was loaded, when the reader returns it. */
  loaded_at?: string | null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The reader's answer, or null for 'null' and anything without a ticker or a year. */
export function readFinancials(data: unknown): Financials | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.ticker !== "string" || !d.ticker) return null;
  const series = Array.isArray(d.series)
    ? (d.series as Array<Record<string, unknown>>)
        .filter((s) => s && finite(s.fy))
        .map((s) => ({ fy: s.fy as number, revenue: finite(s.revenue) ? s.revenue : null, net_income: finite(s.net_income) ? s.net_income : null }))
    : [];
  if (series.length === 0) return null;
  return {
    ticker: d.ticker,
    exchange: typeof d.exchange === "string" ? d.exchange : "",
    sec_name: typeof d.sec_name === "string" ? d.sec_name : d.ticker,
    cik: finite(d.cik) ? d.cik : 0,
    currency: typeof d.currency === "string" ? d.currency : "USD",
    series: series.sort((a, b) => b.fy - a.fy),
    loaded_at: typeof d.loaded_at === "string" ? d.loaded_at : null,
  };
}

/** When the figures were loaded: the row's own stamp, else the measured load day. */
export function financialsLoadedOn(fin: Pick<Financials, "loaded_at">): string {
  const v = fin.loaded_at;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : SEC_FIGURES_LOADED_ON;
}

/** get_company_financials for one token, asked once while in flight. */
export function useCompanyFinancials(companyToken: string | null | undefined, enabled = true): Financials | null {
  const [fin, setFin] = useState<Financials | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFin(null);
    if (!companyToken || !enabled) return;
    inflight(`get_company_financials:${companyToken}`, async () => {
      const { data } = await (supabase as unknown as {
        rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
      }).rpc("get_company_financials", { p_token: companyToken });
      return data;
    }).then((data) => { if (!cancelled) setFin(readFinancials(data)); })
      .catch(() => { /* additive card; the page stands without it */ });
    return () => { cancelled = true; };
  }, [companyToken, enabled]);
  return fin;
}

const fy = (y: number) => `FY'${String(y).slice(-2)}`;

export function PublicCompanyCardView({ fin, bare = false }: { fin: Financials | null; bare?: boolean }) {
  const { t, i18n } = useTranslation();
  if (!fin || fin.series.length === 0) return null;
  const lang = i18n.language || "en";
  const money = (n: number) => fmtMoney(n, fin.currency, { compact: true, lng: lang });

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
    <div data-public-company="" className={cn(!bare && "rounded-lg border border-border bg-card p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="inline-flex items-center gap-1.5 text-meta font-medium text-foreground">
          <Landmark className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          {t("jobsPage.publicCo.chip", "Public company")} · {fin.exchange ? `${fin.exchange}: ` : ""}{fin.ticker}
        </span>
        <a
          href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${fin.cik}&type=10-K`}
          target="_blank" rel="noopener noreferrer nofollow"
          className="inline-flex min-h-6 items-center gap-1 text-xs text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
        >
          {t("jobsPage.publicCo.viewFilings", "SEC filings")} <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>

      {newest.revenue != null && (
        <div className="mb-2">
          <div className="text-2xl font-semibold tracking-tight text-foreground leading-none tabular-nums">
            {money(newest.revenue)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t("jobsPage.publicCo.revenueLabel", "FY{{y}} revenue", { y: newest.fy })}
            {revYoY != null && (
              <span className="text-foreground">
                {" "}· {revYoY >= 0 ? "+" : ""}{revYoY.toLocaleString(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}% {t("jobsPage.publicCo.vsPrior", "vs FY{{y}}", { y: newest.fy - 1 })}
              </span>
            )}
          </div>
        </div>
      )}

      {profitable != null && (
        <div className="inline-flex items-center gap-1 text-meta text-foreground">
          {profitable
            ? <TrendingUp className="w-3.5 h-3.5 text-success" aria-hidden="true" />
            : <TrendingDown className="w-3.5 h-3.5 text-destructive" aria-hidden="true" />}
          {profitable
            ? t("jobsPage.publicCo.profitable", "Profitable — net income {{v}} (FY{{y}})", { v: money(newest.net_income as number), y: newest.fy })
            : t("jobsPage.publicCo.netLoss", "Net loss {{v}} (FY{{y}})", { v: money(Math.abs(newest.net_income as number)), y: newest.fy })}
        </div>
      )}

      {bars.length >= 2 && (
        <>
          <div className="mt-3 space-y-1.5" aria-hidden="true" data-sec-bars="">
            {bars.map((b) => (
              <div key={b.fy} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
                <span className="tabular-nums text-muted-foreground">{fy(b.fy)}</span>
                <span className="h-2 rounded-sm bg-muted">
                  <span className="block h-2 rounded-sm bg-primary" style={{ width: `${Math.max(4, Math.round((b.revenue / maxRev) * 100))}%` }} />
                </span>
                <span className="tabular-nums text-foreground">{money(b.revenue)}</span>
              </div>
            ))}
          </div>
          <table className="sr-only">
            <caption>{t("jobsPage.publicCo.trendAria", "Revenue by fiscal year")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("companyProfile.sec.fiscalYear", "Fiscal year")}</th>
                <th scope="col">{t("companyProfile.sec.revenue", "Revenue")}</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.fy}><th scope="row">{fy(b.fy)}</th><td>{money(b.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="text-xs text-subtle-foreground mt-2.5">
        {t("jobsPage.publicCo.sourceLine", "Source: {{name}}'s own SEC filings (10-K/20-F). Figures as filed; not investment advice.", { name: fin.sec_name })}{" "}
        <span data-sec-loaded={financialsLoadedOn(fin)}>
          {t("companyProfile.sec.loaded", "Figures loaded {{date}}.", { date: fmtDate(financialsLoadedOn(fin), { lng: lang }) })}
        </span>
      </p>
    </div>
  );
}

export function PublicCompanyCard({ companyToken }: { companyToken: string }) {
  const fin = useCompanyFinancials(companyToken);
  return <PublicCompanyCardView fin={fin} />;
}
