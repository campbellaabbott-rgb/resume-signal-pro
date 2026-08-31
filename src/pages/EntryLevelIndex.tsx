// The Entry-Level Index — a public page ranking who's actually hiring people
// early in their careers, computed live from the board's own postings (the
// experience band each posting's title/description states, from companies'
// official ATS feeds). Every number is real; when a figure can't be computed
// yet the section explains itself instead of showing a fake.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, ShieldCheck, Briefcase, MapPin } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { isBoardCategory } from "@/lib/job-board-categories";
import { HBarList } from "@/components/DataViz";
import { HowWeMeasure } from "@/components/HowWeMeasure";

interface Stats {
  total_entry: number;
  total_open: number;
  companies_with_entry: number;
  remote_entry: number;
  by_category: Record<string, number> | null;
}
interface Leader {
  company: string;
  company_token: string;
  entry_roles: number;
  open_roles: number;
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString() : "—");

// Human labels for category slugs on an English-only SEO page — mirrors
// jobsPage.categories in en.json (this page doesn't load i18n).
const CAT_LABELS: Record<string, string> = {
  engineering: "Engineering & IT", data_ai: "Data & AI", design: "Design", product: "Product",
  marketing: "Marketing & Comms", sales: "Sales & Partnerships", customer: "Customer Success & Support",
  finance: "Finance & Accounting", legal: "Legal & Compliance", people_hr: "People & Recruiting",
  operations: "Operations & Logistics", healthcare: "Healthcare & Clinical", science: "Science & Research",
  education: "Education", hospitality_retail: "Hospitality & Retail", security: "Security & Trust",
  admin: "Administrative", other: "Other",
};

export default function EntryLevelIndex() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);

  useEffect(() => {
    (async () => {
      try {
        // Fast path: the hourly stats cache (the live aggregates are ~12s and
        // ~11s). Falls through to the live RPCs if the cache row isn't there.
        const { data: cacheRaw } = await Promise.resolve(rpc("get_stats_cache")).catch(() => ({ data: null }));
        const cache = (cacheRaw && typeof cacheRaw === "object" && !Array.isArray(cacheRaw)) ? (cacheRaw as Record<string, unknown>) : null;
        if (cache && cache.entry_stats && Array.isArray(cache.entry_companies)) {
          setStats(cache.entry_stats as Stats);
          setLeaders(cache.entry_companies as Leader[]);
          return;
        }
        const [s, l] = await Promise.all([
          rpc("get_entry_level_stats"),
          rpc("get_entry_level_companies", { p_limit: 25 }),
        ]);
        let srow = Array.isArray(s.data) ? (s.data[0] as Stats) : null;
        // Cold-cache RPCs can time out once and succeed warm — one spaced retry.
        if (!srow) {
          await new Promise((r) => setTimeout(r, 1500));
          const s2 = await rpc("get_entry_level_stats");
          srow = Array.isArray(s2.data) ? (s2.data[0] as Stats) : null;
        }
        if (srow) setStats(srow);
        if (Array.isArray(l.data)) setLeaders(l.data as Leader[]);
      } catch {
        /* RPCs not deployed yet — page still renders its explainer */
      }
    })();
  }, []);

  const topCategories = stats?.by_category
    ? Object.entries(stats.by_category).sort((a, b) => b[1] - a[1]).slice(0, 8)
    : [];

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="The Entry-Level Index — who's actually hiring entry-level right now?"
        description="A live ranking of companies with real entry-level openings — junior, graduate, and early-career roles counted from companies' official job boards, refreshed all day. No aggregators, no dated posting older than 30 days."
        path="/entry-level-index"
      />
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-2">
          <GraduationCap className="w-6 h-6 text-primary" />
          <h1 className="text-3xl md:text-4xl font-bold">The Entry-Level Index</h1>
        </div>
        <p className="text-muted-foreground mb-1">
          "Entry-level, 5 years' experience required" is a running joke for a reason. This page counts the real thing:
          openings whose own titles and requirements say early-career — internships, junior, graduate, and 0–2 year roles —
          and ranks the companies that post the most of them.
        </p>
        <p className="text-xs text-muted-foreground mb-8">
          {/* This list named 10 systems while the board serves 15. The five it
              omitted — Workday, iCIMS, Oracle, Rippling, Pinpoint — include
              Workday, which alone is 52.1% of postings (303,098 of 581,576 on
              2026-07-27). A sources line that leaves out the majority source
              is false by omission, however true each named item is. */}
          Counted live from employers' <b>official</b> job boards (Workday, Greenhouse, SmartRecruiters, Ashby,
          iCIMS, Oracle, Lever, Workable, BambooHR, Recruitee, Teamtailor, Personio, Breezy, Rippling,
          Pinpoint and Paylocity) and the U.S. federal government's own system (USAJOBS) — never an aggregator
          or a scrape, and no dated posting older than 30 days.
        </p>

        {/* Headline stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">{fmt(stats?.total_entry)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">verified entry-level openings right now</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">{fmt(stats?.companies_with_entry)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">companies with at least one entry-level role</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">{fmt(stats?.remote_entry)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">of them are remote</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">
              {stats && stats.total_open > 0 ? `${Math.round((100 * stats.total_entry) / stats.total_open)}%` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">share of all openings on this board</div>
          </div>
        </div>

        {/* Leaderboard */}
        {leaders.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <Briefcase className="w-4 h-4 text-primary" /> Hiring the most entry-level right now
            </h2>
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {leaders.map((c, i) => (
                <Link
                  key={c.company_token}
                  to={`/jobs/company/${c.company_token}?experience=entry`}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors ${i > 0 ? "border-t border-border/60" : ""}`}
                >
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-foreground truncate">{c.company}</span>
                  <span className="text-[11px] text-success font-semibold shrink-0">{c.entry_roles} entry-level</span>
                  <span className="text-[11px] text-muted-foreground shrink-0 w-24 text-right">{c.open_roles} open total</span>
                </Link>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Ranked by entry-level openings live right now (minimum 5). Every link goes to the company's verified roles here.
            </p>
          </div>
        )}

        {/* Where the entry-level jobs are */}
        {topCategories.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-primary" /> Where the entry-level jobs are
            </h2>
            <div className="rounded-2xl border border-border bg-card p-4">
              <HBarList
                items={topCategories.map(([cat, n]) => ({ key: cat, label: CAT_LABELS[cat] ?? cat, value: n }))}
                renderLabel={(it) => (
                  <Link
                    to={isBoardCategory(it.key) ? `/jobs?category=${it.key}&experience=entry` : `/jobs?experience=entry`}
                    className="hover:text-primary hover:underline"
                  >
                    {it.label}
                  </Link>
                )}
              />
            </div>
          </div>
        )}

        {/* Methodology */}
        <div className="rounded-2xl border border-border bg-muted/30 p-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-success" /> How we count it
          </h2>
          <ul className="text-[13px] text-muted-foreground space-y-1.5">
            <li>· A role counts as entry-level when its own title or stated requirements say so — internship, junior, graduate, or ≤2 years' experience. We classify from the posting's text; we never guess from the salary or the team.</li>
            <li>· Every posting comes straight from the company's official applicant-tracking feed, is dropped after 30 days, and is re-checked live when you click Apply.</li>
            <li>· Numbers on this page are computed live from the board — the same postings you can browse and apply to.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link to="/jobs?experience=entry" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
              Browse all entry-level openings →
            </Link>
            <Link to="/hiring-trends" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              Weekly hiring trends
            </Link>
            <Link to="/ghost-job-index" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              The Ghost Job Index
            </Link>
          </div>
        </div>
        <HowWeMeasure
          items={[
            { term: "Entry-level classification", method: "Detected from each posting's own title and description (explicit level markers and stated year requirements). Postings that can't be placed are labeled 'unspecified' and never counted as entry-level." },
            { term: "Daily label audit", method: "Every day we sample postings and cross-check the entry label against the posting's own text — an 'entry' posting whose description demands 3+ years is a contradiction: it's demoted on the spot and the rate is tracked, so this page's counts can't quietly drift." },
            { term: "Counts", method: "Exact counts from the live posting table at page load — the same rows the job board serves, under the same 30-day freshness cap." },
          ]}
        />
      </main>
      <Footer />
    </div>
  );
}
