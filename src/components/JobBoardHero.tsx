import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Briefcase, Target, ShieldCheck, ArrowRight, Sparkles, CalendarClock, Bot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Page-leading hero for the live job board. The board is the destination; the
// resume tools (below) are how you win the jobs on it. Numbers are fetched live
// from the same board function the /jobs page uses — never hardcoded, so they
// stay honest as the catalog grows.
function useBoardTotals() {
  const [totals, setTotals] = useState<{ jobs: number; companies: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.functions
      .invoke("job-board", { body: { action: "list", limit: 1, includeFacets: true } })
      .then(({ data }) => {
        if (cancelled) return;
        // Use `total` — the read-filtered (≤30-day) count the /jobs board
        // actually serves — NOT `totalAllCompanies` (the pre-sweep facet total,
        // which still counts aged rows the read filter hides). This keeps the
        // homepage number identical to what a visitor sees on the board, and
        // honest with the "nothing older than 30 days" claim. Companies counted
        // the same way /jobs does (count > 0).
        const d = data as { total?: number; companiesCount?: number; companies?: Array<{ count?: number }> } | null;
        const jobs = d?.total || 0;
        // companiesCount is the untrimmed facet size (the served `companies`
        // array is capped for payload weight); fall back to counting the array
        // for older deployed function versions.
        const companies = d?.companiesCount
          ?? (Array.isArray(d?.companies) ? d!.companies.filter((c) => (c?.count ?? 0) > 0).length : 0);
        if (jobs > 0) setTotals({ jobs, companies });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return totals;
}

// A few high-traffic fields for one-tap browsing straight into the board.
const FIELDS: Array<{ id: string; label: string }> = [
  { id: "engineering", label: "Engineering & IT" },
  { id: "data_ai", label: "Data & AI" },
  { id: "product", label: "Product" },
  { id: "design", label: "Design" },
  { id: "marketing", label: "Marketing" },
  { id: "finance", label: "Finance" },
  { id: "sales", label: "Sales" },
  { id: "healthcare", label: "Healthcare" },
];

export function JobBoardHero() {
  const { t } = useTranslation();
  const totals = useBoardTotals();

  return (
    <section className="relative overflow-hidden py-10 sm:py-14 md:py-20" aria-labelledby="board-hero-heading">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-success/5 rounded-full blur-[100px]" />
      </div>

      <div className="container relative">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 mb-5 animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-sm font-medium text-primary">{t("boardHero.badge", "Live job board")}</span>
          </div>

          <h1
            id="board-hero-heading"
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight mb-4 animate-fade-in"
            style={{ animationDelay: "0.05s" }}
          >
            {t("boardHero.headlinePre", "Find jobs you're")}{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-primary to-success">
              {t("boardHero.headlineHighlight", "actually a match for")}
            </span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-5 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            {t(
              "boardHero.subhead",
              "Live openings pulled straight from companies' own career pages — then ranked against your resume, so you apply where you'll actually win.",
            )}
          </p>

          {/* Live, honest counts from the board itself. */}
          <div className="min-h-[28px] mb-6 animate-fade-in" style={{ animationDelay: "0.12s" }}>
            {totals && (
              <p className="text-sm text-muted-foreground">
                <span className="font-bold text-foreground tabular-nums">{totals.jobs.toLocaleString()}</span>{" "}
                {t("boardHero.liveOpenings", "live openings")}
                {totals.companies > 0 && (
                  <>
                    {" · "}
                    <span className="font-bold text-foreground tabular-nums">{totals.companies.toLocaleString()}</span>{" "}
                    {t("boardHero.companies", "companies")}
                  </>
                )}
                {" · "}
                {t("boardHero.freshness", "new roles added continuously")}
              </p>
            )}
          </div>

          {/* Primary path: into the board. Secondary: rank to your resume. */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6 animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <Link
              to="/jobs"
              className="group w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-primary to-primary/90 text-primary-foreground font-bold px-8 py-4 text-base sm:text-lg shadow-xl shadow-primary/25 hover:shadow-2xl hover:shadow-primary/35 active:scale-[0.98] transition-all min-h-[56px]"
            >
              <Briefcase className="w-5 h-5" />
              {t("boardHero.browseCta", "Browse the job board")}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/jobs"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/5 text-primary font-semibold px-6 py-4 text-base hover:bg-primary/10 transition-colors min-h-[56px]"
            >
              <Target className="w-5 h-5" />
              {t("boardHero.rankCta", "Rank them to my resume")}
            </Link>
          </div>

          {/* AI apply agent — front and center, above the fold. The claim is
              exactly what ships: the agent drafts and preps; the user sends. */}
          <div className="flex justify-center mb-5 animate-fade-in" style={{ animationDelay: "0.18s" }}>
            <button
              type="button"
              onClick={() => document.getElementById("apply-agent-heading")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="inline-flex items-center gap-2 rounded-full border border-success/40 bg-success/10 px-4 py-2 text-sm text-foreground hover:bg-success/15 transition-colors"
            >
              <Bot className="w-4 h-4 text-success shrink-0" />
              <span>
                <span className="font-semibold">{t("boardHero.agentLead", "Your AI agent applies with you:")}</span>{" "}
                {t("boardHero.agentLine", "it writes the cover letter, answers the real questions, preps you — you hit send")}
              </span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>

          {/* Trust: what makes this board different — always true. */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs sm:text-sm text-muted-foreground mb-7 animate-fade-in" style={{ animationDelay: "0.2s" }}>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-success" />
              {t("boardHero.trustDirect", "Direct from company career pages — no aggregators")}
            </span>
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30 hidden sm:block" />
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4 text-success" />
              {t("boardHero.trustFresh", "Nothing older than 30 days — stale listings removed automatically")}
            </span>
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30 hidden sm:block" />
            <span className="inline-flex items-center gap-1.5">
              <Target className="w-4 h-4 text-primary" />
              {t("boardHero.trustFit", "Ranked by your fit, with the keywords to add")}
            </span>
          </div>

          {/* One-tap browse by field. */}
          <div className="flex flex-wrap justify-center gap-2 animate-fade-in" style={{ animationDelay: "0.25s" }}>
            {FIELDS.map((f) => (
              <Link
                key={f.id}
                to={`/jobs?category=${f.id}`}
                className="inline-flex items-center px-3.5 py-1.5 rounded-full border border-border bg-card/60 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
              >
                {t(`boardHero.field.${f.id}`, f.label)}
              </Link>
            ))}
          </div>

          {/* Bridge into the resume tools below — they're the "how you win". */}
          <div className="mt-8 animate-fade-in" style={{ animationDelay: "0.3s" }}>
            <button
              onClick={() => document.getElementById("upload")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Sparkles className="w-4 h-4 text-success" />
              {t("boardHero.toolsBridge", "New here? Free tools below help you land them — scan, fix, and tailor your resume")}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
