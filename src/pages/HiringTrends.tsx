// Weekly Hiring Trends — how many new roles companies posted this week, which
// fields they're in, and how many roles got filled/closed, computed live from
// the board's own postings and closure log. Honesty guards: weekly counts use
// the company's own posting date and only include postings we observed near
// their posting time (so catalog growth never fakes a hiring spike), and
// closure history starts from when we began logging it — we say so.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, ShieldCheck, CalendarDays, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { isBoardCategory } from "@/lib/job-board-categories";

interface WeekRow {
  week_start: string;
  new_postings: number;
  entry_new: number;
  remote_new: number;
  closed: number;
}
interface CatTrend {
  category: string;
  last7: number;
  prior7: number;
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString() : "—");

const CAT_LABELS: Record<string, string> = {
  engineering: "Engineering & IT", data_ai: "Data & AI", design: "Design", product: "Product",
  marketing: "Marketing & Comms", sales: "Sales & Partnerships", customer: "Customer Success & Support",
  finance: "Finance & Accounting", legal: "Legal & Compliance", people_hr: "People & Recruiting",
  operations: "Operations & Logistics", healthcare: "Healthcare & Clinical", science: "Science & Research",
  education: "Education", hospitality_retail: "Hospitality & Retail", security: "Security & Trust",
  admin: "Administrative", other: "Other",
};

export default function HiringTrends() {
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [cats, setCats] = useState<CatTrend[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [w, c] = await Promise.all([rpc("get_hiring_trends"), rpc("get_trending_categories")]);
        let wrows = Array.isArray(w.data) ? (w.data as WeekRow[]) : [];
        if (wrows.length === 0) {
          // Cold-cache RPCs can time out once and succeed warm — one spaced retry.
          await new Promise((r) => setTimeout(r, 1500));
          const w2 = await rpc("get_hiring_trends");
          wrows = Array.isArray(w2.data) ? (w2.data as WeekRow[]) : [];
        }
        setWeeks(wrows);
        if (Array.isArray(c.data)) setCats(c.data as CatTrend[]);
      } catch {
        /* RPCs not deployed yet — page still renders its explainer */
      }
    })();
  }, []);

  // The last row is the current, partial week — label it honestly.
  const complete = weeks.slice(0, -1);
  const current = weeks.length > 0 ? weeks[weeks.length - 1] : null;
  const lastFull = complete.length > 0 ? complete[complete.length - 1] : null;
  const prevFull = complete.length > 1 ? complete[complete.length - 2] : null;
  const maxNew = Math.max(1, ...weeks.map((w) => w.new_postings));
  // Week-over-week ratios need BOTH weeks fully observed. Postings that
  // predate our tracking are excluded from counts (that's the honesty guard),
  // so a week we only partially observed has a structurally low count and any
  // ratio against it ("+19,000%") would be a lie of framing. Proxy for "prevFull
  // was fully observed": the week before it already had counted postings.
  const beforePrev = complete.length > 2 ? complete[complete.length - 3] : null;
  const wowMature = !!beforePrev && beforePrev.new_postings > 0;
  const wow = wowMature && lastFull && prevFull && prevFull.new_postings > 0
    ? Math.round((100 * (lastFull.new_postings - prevFull.new_postings)) / prevFull.new_postings)
    : null;
  // Same idea for the rolling 7d-vs-prior-7d category deltas: meaningful only
  // once the prior rolling window falls inside fully-tracked territory.
  const deltasMature = !!prevFull && prevFull.new_postings > 0;

  const weekLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Weekly Hiring Trends — how many jobs were really posted this week?"
        description="Live weekly hiring data from companies' official job boards: new postings per week, which fields are hiring, entry-level and remote shares, and how many roles actually got filled — no estimates, no surveys."
        path="/hiring-trends"
      />
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-6 h-6 text-primary" />
          <h1 className="text-3xl md:text-4xl font-bold">Weekly Hiring Trends</h1>
        </div>
        <p className="text-muted-foreground mb-1">
          Is hiring up or down this week? This page answers with counted postings, not vibes: every new role companies
          dated this week on their own boards, which fields they're in, and how many roles actually got filled.
        </p>
        <p className="text-xs text-muted-foreground mb-8">
          Counted from companies' <b>official</b> job boards only, using each posting's own stated date. Postings from
          companies newly added to our catalog are excluded from weekly counts, so growth in our coverage never shows up
          as a fake hiring spike.
        </p>

        {/* Week-over-week headline */}
        {lastFull && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-bold text-foreground">{fmt(lastFull.new_postings)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">new roles posted last week (w/o {weekLabel(lastFull.week_start)})</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className={`text-2xl font-bold inline-flex items-center gap-1 ${wow == null ? "text-foreground" : wow > 0 ? "text-success" : wow < 0 ? "text-destructive" : "text-foreground"}`}>
                {wow == null ? "—" : (
                  <>
                    {wow > 0 ? <ArrowUpRight className="w-5 h-5" /> : wow < 0 ? <ArrowDownRight className="w-5 h-5" /> : <Minus className="w-5 h-5" />}
                    {Math.abs(wow)}%
                  </>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">vs the week before</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-bold text-foreground">
                {lastFull.new_postings > 0 ? `${Math.round((100 * lastFull.remote_new) / lastFull.new_postings)}%` : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">of last week's new roles are remote</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-bold text-foreground">{fmt(lastFull.closed)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">roles filled or closed last week</div>
            </div>
          </div>
        )}

        {/* Weekly bars */}
        {weeks.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-5 mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <CalendarDays className="w-4 h-4 text-primary" /> New postings by week
            </h2>
            <div className="space-y-2.5">
              {weeks.map((w, i) => (
                <div key={w.week_start} className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0">
                    {weekLabel(w.week_start)}{i === weeks.length - 1 ? " (so far)" : ""}
                  </span>
                  <div className="flex-1 h-5 bg-muted/40 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${i === weeks.length - 1 ? "bg-primary/40" : "bg-primary/70"}`}
                      style={{ width: `${Math.max(2, Math.round((100 * w.new_postings) / maxNew))}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-foreground w-16 text-right shrink-0">{fmt(w.new_postings)}</span>
                  <span className="text-[11px] text-muted-foreground w-28 text-right shrink-0 hidden md:inline">
                    {w.entry_new > 0 ? `${fmt(w.entry_new)} entry-level` : ""}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              {current ? "The newest week is partial — it fills in as companies post." : ""} Counts include only postings
              whose companies date them themselves; boards we added mid-window are excluded from that window.
            </p>
          </div>
        )}

        {/* Trending fields */}
        {cats.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-primary" /> Which fields are hiring this week
            </h2>
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {cats.map((c, i) => {
                const delta = deltasMature && c.prior7 >= 20 ? Math.round((100 * (c.last7 - c.prior7)) / c.prior7) : null;
                return (
                  <Link
                    key={c.category}
                    to={isBoardCategory(c.category) ? `/jobs?category=${c.category}` : "/jobs"}
                    className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors ${i > 0 ? "border-t border-border/60" : ""}`}
                  >
                    <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}</span>
                    <span className="flex-1 text-sm font-medium text-foreground truncate">{CAT_LABELS[c.category] ?? c.category}</span>
                    <span className="text-[11px] text-foreground font-semibold shrink-0">{fmt(c.last7)} new / 7d</span>
                    <span className={`text-[11px] font-semibold shrink-0 w-20 text-right ${delta == null ? "text-muted-foreground" : delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {delta == null ? "new" : `${delta > 0 ? "+" : ""}${delta}%`}
                    </span>
                  </Link>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              New postings in the last 7 days vs the 7 days before, per field (minimum 20 this week).
            </p>
          </div>
        )}

        {weeks.length === 0 && cats.length === 0 && (
          <div className="rounded-2xl border border-border bg-card p-5 mb-8">
            <p className="text-sm text-muted-foreground">
              Trend data is computed live from the board and accrues from when we started tracking each company. If this
              page looks empty, the data is still loading — or still accruing. We'd rather show nothing than a made-up chart.
            </p>
          </div>
        )}

        {/* Methodology */}
        <div className="rounded-2xl border border-border bg-muted/30 p-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-success" /> How we count it
          </h2>
          <ul className="text-[13px] text-muted-foreground space-y-1.5">
            <li>· "New postings" are counted by the date the company itself put on the role, straight from its official applicant-tracking feed — never scraped, never estimated.</li>
            <li>· When we add new companies to our catalog, their existing postings are excluded from weekly counts — coverage growth is not a hiring trend.</li>
            <li>· "Filled or closed" counts come from our closure log: we record the moment a company takes a posting down. Reposted-role churn is excluded.</li>
            <li>· Some feeds don't publish posting dates; those roles appear on the board but not in these weekly counts.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
              Browse the live board →
            </Link>
            <Link to="/entry-level-index" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              The Entry-Level Index
            </Link>
            <Link to="/ghost-job-index" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              The Ghost Job Index
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
