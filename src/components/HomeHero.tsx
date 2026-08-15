// ONE HERO, ONE ACTION, AND THE PROOF DIRECTLY UNDER IT.
//
// This replaces two stacked full-height heroes — the agent's (2,751px) and the
// board's (4,056px) — that together put 6,807px and FOUR competing calls to
// action between a visitor and anything they could do. Measured 2026-08-13 on
// a 45,741px page: the upload tool, which is the only path to a paying
// customer, began at 10,546px. A visitor choosing between "feed it your CV",
// "watch it work", "browse the job board" and "rank them to my resume" is a
// visitor choosing nothing.
//
// THE DESIGN RULES THIS FOLLOWS, in the order they matter for conversion:
//
//   ONE claim. The board and the agent are not two products to be pitched in
//   sequence; they are one sentence — every job here is real, and the agent
//   applies to them for you. Two heroes made a visitor read the pitch twice
//   and believe it half as much.
//
//   ONE primary action, styled as the only one. Uploading a CV is the step
//   that leads to a paid customer; browsing the board is engagement. The
//   secondary path stays available and stops competing for the eye.
//
//   PROOF IMMEDIATELY UNDER THE CLAIM. The fifteen hiring systems and their
//   live counts sit directly beneath the buttons, not 13,800px down. The
//   headline asserts hundreds of thousands of verified openings; the strip is
//   what lets a sceptic check it without scrolling. This is the single most
//   differentiating thing the product can say and it was below the fold.
//
//   EVERY NUMBER MEASURED OR ABSENT. Board totals, agent-submittable count and
//   the per-vendor tallies all come from live payloads. Nothing here renders a
//   literal, and a failed read renders no sentence rather than a stale or zero
//   one — the rule the rest of this codebase already enforces.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Upload, Briefcase, ArrowRight, ShieldCheck, Bot, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AtsCoverage } from "@/components/AtsCoverage";
import { useBoardTotals } from "@/hooks/use-board-totals";

/** Scrolls to the CV intake — the hero's one action. Reuses the uploader's
 *  existing anchor so there is a single source of truth for "where does
 *  uploading start". */
const scrollToUploader = () => {
  const el = document.querySelector('[data-scan-button="true"]') ?? document.querySelector("[data-resume-loaded]");
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
};

const FIELDS = [
  { id: "engineering", label: "Engineering & IT" },
  { id: "data_ai", label: "Data & AI" },
  { id: "product", label: "Product" },
  { id: "design", label: "Design" },
  { id: "marketing", label: "Marketing" },
  { id: "finance", label: "Finance" },
  { id: "sales", label: "Sales" },
  { id: "healthcare", label: "Healthcare" },
] as const;

export function HomeHero() {
  const { t, i18n } = useTranslation();
  const totals = useBoardTotals();
  const [sendable, setSendable] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    void supabase.functions.invoke("job-board", { body: { action: "status" } }).then(({ data }) => {
      if (dead || !data || typeof data !== "object") return;
      const n = (data as { sendable?: { postings?: number } }).sendable?.postings;
      if (typeof n === "number" && n > 0) setSendable(n);
    }).catch(() => { /* the hero stands without it */ });
    return () => { dead = true; };
  }, []);

  const nf = (n: number) => n.toLocaleString(i18n.language);

  return (
    <section className="relative overflow-hidden border-b border-border" aria-labelledby="home-hero-heading">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-primary/[0.07] rounded-full blur-[140px]" />
      </div>

      <div className="container relative py-10 sm:py-14">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 border border-primary/25 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" aria-hidden />
            <span className="text-[13px] font-semibold text-primary">
              {t("homeHero.badge", "Live job board + AI apply agent")}
            </span>
          </div>

          {/* The page's single h1. */}
          <h1
            id="home-hero-heading"
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] mb-4"
          >
            {t("homeHero.headlinePre", "Every job here is real.")}{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-primary to-success">
              {t("homeHero.headlineHighlight", "The agent applies for you.")}
            </span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-5">
            {t("homeHero.sub", "Openings pulled straight from companies' own hiring systems — never scraped, re-checked all day. Upload your CV and the agent ranks every one against it, writes each application honestly, and submits where employers allow.")}
          </p>

          {/* THE THREE NUMBERS THAT MATTER, and only once measured. Reserved
              height so the buttons below never jump when they land. */}
          <div className="min-h-[30px] mb-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
            {totals && (
              <span className="text-muted-foreground">
                <span className="font-bold text-foreground tabular-nums">{nf(totals.jobs)}</span>{" "}
                {t("homeHero.statOpenings", "verified openings")}
              </span>
            )}
            {totals && totals.companies > 0 && (
              <span className="text-muted-foreground">
                <span className="text-border" aria-hidden>·</span>{" "}
                <span className="font-bold text-foreground tabular-nums">{nf(totals.companies)}</span>{" "}
                {t("homeHero.statCompanies", "companies")}
              </span>
            )}
            {sendable !== null && (
              <span className="text-muted-foreground">
                <span className="text-border" aria-hidden>·</span>{" "}
                <Bot className="inline w-3.5 h-3.5 text-success -mt-0.5" aria-hidden />{" "}
                <span className="font-bold text-foreground tabular-nums">{nf(sendable)}</span>{" "}
                {t("homeHero.statSendable", "the agent can submit for you")}
              </span>
            )}
          </div>

          {/* ONE primary action. The secondary is a link-weight button, not a
              second gradient — two equally-loud buttons is the choice paralysis
              this hero exists to remove. */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-3">
            <button
              type="button"
              onClick={scrollToUploader}
              className="group w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-primary to-primary/90 text-primary-foreground font-bold px-8 py-4 text-base sm:text-lg shadow-xl shadow-primary/25 hover:shadow-2xl hover:shadow-primary/35 active:scale-[0.98] transition-all min-h-[56px]"
            >
              <Upload className="w-5 h-5" />
              {t("homeHero.ctaPrimary", "Upload your CV — free")}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <Link
              to="/jobs"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-card/60 text-foreground font-semibold px-6 py-4 text-base hover:border-primary/50 transition-colors min-h-[56px]"
            >
              <Briefcase className="w-5 h-5" />
              {t("homeHero.ctaSecondary", "Browse the board")}
            </Link>
          </div>

          <p className="text-xs text-muted-foreground mb-7 inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-success" aria-hidden />
            {t("homeHero.reassure", "Free scan · no card, no signup")}
          </p>

          {/* THE PROOF, DIRECTLY UNDER THE ACTION. Same component and same live
              counts the rest of the site uses — never a second data path. */}
          <div className="mb-6">
            <AtsCoverage variant="strip" />
          </div>

          {/* One-tap entries into the board, for visitors who came to browse. */}
          <div className="flex flex-wrap justify-center gap-1.5">
            {FIELDS.map((f) => (
              <Link
                key={f.id}
                to={`/jobs/field/${f.id}`}
                className="inline-flex items-center px-3 py-1.5 rounded-full border border-border bg-card/60 text-[13px] text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
              >
                {t(`jobsPage.categories.${f.id}`, f.label)}
              </Link>
            ))}
            <Link
              to="/explore"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-primary/40 bg-primary/5 text-[13px] font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t("homeHero.exploreCta", "Explore employers")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
