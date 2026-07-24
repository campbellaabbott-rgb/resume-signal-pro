// "About this employer" block in the detail panel — the sourced company facts
// moved to the exact place users decide. Headcount (with basis), public-company
// financials, and the role-matched declared wage from H-1B filings; every row
// renders only when its data exists, and the whole block disappears when none
// does. Data comes from the shared per-slug cache (no refires while arrowing
// through postings).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Landmark, FileText, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getEmployerCtx, matchDeclaredRole, type EmployerCtx } from "@/lib/employer-context";
import { postTrackEvent, getVisitorId } from "@/lib/track-transport";

const fmtMoney = (n: number, currency?: string | null): string => {
  const prefix = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  const abs = Math.abs(n);
  return `${prefix}${abs >= 1e9 ? (abs / 1e9).toFixed(1) + "B" : abs >= 1e6 ? Math.round(abs / 1e6) + "M" : abs >= 1e3 ? Math.round(abs / 1e3) + "k" : abs}`;
};

export function EmployerContext({ companyToken, companyName, postingTitle }: {
  companyToken: string; companyName: string; postingTitle: string;
}) {
  const { t } = useTranslation();
  const [ctx, setCtx] = useState<EmployerCtx | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCtx(null);
    setLoading(true);
    // Small dwell so arrowing through the list doesn't fire a fetch per stop.
    const timer = setTimeout(() => {
      void getEmployerCtx(companyToken).then((c) => {
        if (cancelled) return;
        setCtx(c);
        setLoading(false);
        if (c.employees != null || c.ticker || c.h1bTotal) {
          const visitorId = getVisitorId();
          postTrackEvent({ testName: "job_board", variant: "employer_ctx_view", eventType: "view", visitorId, metadata: { token: companyToken.split("~")[0] } });
        }
      });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [companyToken]);

  // Shimmer while the sourced facts load — prevents both the late pop-in and
  // the "did anything happen?" gap (the RPCs take a couple of seconds).
  if (loading && !ctx) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2" aria-hidden="true">
        <div className="h-3.5 w-40 rounded bg-muted animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-64 rounded bg-muted/70 animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-52 rounded bg-muted/70 animate-pulse motion-reduce:animate-none" />
      </div>
    );
  }
  if (!ctx) return null;
  const declared = matchDeclaredRole(postingTitle, ctx.h1bRoles);
  const hasAnything = ctx.employees != null || ctx.ticker || ctx.h1bTotal;
  if (!hasAnything) return null;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 text-[13px] space-y-1.5">
      <p className="font-semibold text-foreground text-sm flex items-center gap-1.5">
        <Building2 className="w-4 h-4 text-primary" />
        {t("jobsPage.employerCtx.title", "About this employer")}
      </p>
      {ctx.employees != null && (
        <p className="text-muted-foreground">
          {t("jobsPage.employerCtx.employees", "≈{{n}} employees ({{basis}})", {
            n: ctx.employees.toLocaleString(),
            basis: ctx.employeeBasis === "yc_self_reported"
              ? t("jobsPage.intel.basisYc", "YC profile")
              : t("jobsPage.intel.basisPr", "public records"),
          })}
        </p>
      )}
      {ctx.ticker && ctx.revenue != null && (
        <p className="text-muted-foreground flex items-center gap-1.5 flex-wrap">
          <Landmark className="w-3.5 h-3.5 text-primary shrink-0" />
          {t("jobsPage.employerCtx.publicCo", "Public company ({{ex}}: {{tk}}) — {{rev}} revenue FY{{y}}", {
            ex: ctx.exchange, tk: ctx.ticker, rev: fmtMoney(ctx.revenue, ctx.currency), y: ctx.fyYear,
          })}
          {ctx.netIncome != null && (
            <span className={`inline-flex items-center gap-0.5 ${ctx.netIncome > 0 ? "text-success" : "text-destructive"}`}>
              {ctx.netIncome > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {ctx.netIncome > 0 ? t("jobsPage.employerCtx.profitable", "profitable") : t("jobsPage.employerCtx.unprofitable", "operating at a loss")}
            </span>
          )}
        </p>
      )}
      {declared && (
        <p className="text-muted-foreground flex items-start gap-1.5">
          <FileText className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
          <span>
            {t("jobsPage.employerCtx.declared", "Declared {{m}}/yr median for “{{role}}” in H-1B filings ({{n}} filings, {{fy}}) — US DOL public records.", {
              m: fmtMoney(declared.median), role: declared.title, n: declared.n, fy: ctx.h1bFy,
            })}
          </span>
        </p>
      )}
      {!declared && ctx.h1bMedian != null && (
        <p className="text-muted-foreground flex items-start gap-1.5">
          <FileText className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
          <span>
            {t("jobsPage.employerCtx.declaredCompany", "Declared {{m}}/yr median across {{n}} H-1B filings ({{fy}}) — US DOL public records; H-1B roles only.", {
              m: fmtMoney(ctx.h1bMedian), n: ctx.h1bTotal?.toLocaleString(), fy: ctx.h1bFy,
            })}
          </span>
        </p>
      )}
      <Link
        to={`/jobs/company/${encodeURIComponent(companyToken)}`}
        className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
      >
        {t("jobsPage.employerCtx.companyPage", "Full {{company}} hiring profile", { company: companyName })}
        <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}
