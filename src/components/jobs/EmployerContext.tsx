// "About this employer" block in the detail panel — the sourced company facts
// moved to the exact place users decide. Headcount (with basis), public-company
// financials, and the role-matched declared wage from H-1B filings; every row
// renders only when its data exists, and the whole block disappears when none
// does. Data comes from the shared per-employer cache, keyed on the posting's
// hiring system plus its board (no refires while arrowing through postings).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { companyLanderPath } from "@/lib/public-href";
import { Building2, Landmark, FileText, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getEmployerCtx, matchDeclaredRole, type EmployerCtx } from "@/lib/employer-context";
import { postTrackEvent, getVisitorId } from "@/lib/track-transport";
import { datedHeadcount } from "@/lib/headcount";
import { formatListingDate } from "@/lib/listing/age";

/**
 * Money in the reader's own notation ("$14.5B", "14,5 Mrd. $"), compact from
 * 10,000 up and whole below it — the hard-coded "$14.5B" printed the same
 * English shape in every locale (company-pages audit CP19). The currency is
 * the filing's own; an absent one is US dollars, which is what SEC and DOL
 * filings are stated in.
 */
export const fmtMoney = (n: number, currency: string | null | undefined, lng: string): string => {
  const code = typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const compact = Math.abs(n) >= 10_000;
  try {
    return new Intl.NumberFormat(lng || "en", {
      style: "currency", currency: code, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0,
    }).format(n);
  } catch {
    return `${code} ${Math.round(n)}`;
  }
};

export function EmployerContext({ companyToken, source, companyName, postingTitle }: {
  companyToken: string;
  /** The posting's hiring system: the employer key is the system plus the board. */
  source?: string | null;
  companyName: string; postingTitle: string;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "en";
  const [ctx, setCtx] = useState<EmployerCtx | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCtx(null);
    setLoading(true);
    // Small dwell so arrowing through the list doesn't fire a fetch per stop.
    const timer = setTimeout(() => {
      void getEmployerCtx(companyToken, source).then((c) => {
        if (cancelled) return;
        setCtx(c);
        setLoading(false);
        if (datedHeadcount(c) || c.ticker || c.h1bTotal) {
          const visitorId = getVisitorId();
          postTrackEvent({ testName: "job_board", variant: "employer_ctx_view", eventType: "view", visitorId, metadata: { token: companyToken.split("~")[0] } });
        }
      });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [companyToken, source]);

  // Shimmer while the sourced facts load — prevents both the late pop-in and
  // the "did anything happen?" gap (the RPCs take a couple of seconds).
  if (loading && !ctx) {
    return (
      <div className="rounded-lg border border-border bg-muted p-3 space-y-2" aria-hidden="true">
        <div className="h-3.5 w-40 rounded bg-background animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-64 rounded bg-background animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-52 rounded bg-background animate-pulse motion-reduce:animate-none" />
      </div>
    );
  }
  if (!ctx) return null;
  const declared = matchDeclaredRole(postingTitle, ctx.h1bRoles);
  // A headcount prints with the date it was true or not at all (D11).
  const head = datedHeadcount(ctx);
  const hasAnything = head || ctx.ticker || ctx.h1bTotal;
  if (!hasAnything) return null;

  return (
    <div className="rounded-lg border border-border bg-muted p-3 text-sm space-y-1.5">
      <p className="font-semibold text-foreground text-sm flex items-center gap-1.5">
        <Building2 className="w-4 h-4 text-primary" />
        {t("jobsPage.employerCtx.title", "About this employer")}
      </p>
      {head && (
        <p className="text-muted-foreground">
          {t("jobsPage.employerCtx.employees", "≈{{n}} employees ({{basis}})", {
            n: head.n.toLocaleString(lng),
            basis: ctx.employeeBasis === "yc_self_reported"
              ? t("jobsPage.intel.basisYc", "YC profile")
              : t("jobsPage.intel.basisPr", "public records"),
          })}{" · "}{t("jobsPage.intel.asOf", "as of {{date}}", { date: formatListingDate(head.asOf, lng) })}
        </p>
      )}
      {ctx.ticker && ctx.revenue != null && (
        <p className="text-muted-foreground flex items-center gap-1.5 flex-wrap">
          <Landmark className="w-3.5 h-3.5 text-primary shrink-0" />
          {t("jobsPage.employerCtx.publicCo", "Public company ({{ex}}: {{tk}}) — {{rev}} revenue FY{{y}}", {
            ex: ctx.exchange, tk: ctx.ticker, rev: fmtMoney(ctx.revenue, ctx.currency, lng), y: ctx.fyYear,
          })}
          {ctx.netIncome != null && (
            <span className="inline-flex items-center gap-0.5 text-foreground">
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
              m: fmtMoney(declared.median, "USD", lng), role: declared.title, n: declared.n, fy: ctx.h1bFy,
            })}
          </span>
        </p>
      )}
      {!declared && ctx.h1bMedian != null && (
        <p className="text-muted-foreground flex items-start gap-1.5">
          <FileText className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
          <span>
            {t("jobsPage.employerCtx.declaredCompany", "Declared {{m}}/yr median across {{n}} H-1B filings ({{fy}}) — US DOL public records; H-1B roles only.", {
              m: fmtMoney(ctx.h1bMedian, "USD", lng), n: ctx.h1bTotal?.toLocaleString(lng), fy: ctx.h1bFy,
            })}
          </span>
        </p>
      )}
      <Link
        to={companyLanderPath(companyToken)}
        className="inline-flex items-center gap-1 text-xs text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary rounded"
      >
        {t("jobsPage.employerCtx.companyPage", "Full {{company}} hiring profile", { company: companyName })}
        <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}
