// The Ghost Job Index — a public transparency page built on the board's own
// lifecycle data (open roles now + when roles actually close). Every number is
// real and computed live; nothing is invented. Closure data accrues from when we
// started logging it, so the "how fast roles close" figures fill in over time —
// we say so plainly rather than faking a history.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ShieldCheck, Clock, Briefcase } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { VIZ_SERIES_A } from "@/components/DataViz";
import { HowWeMeasure } from "@/components/HowWeMeasure";

interface Stats {
  total_open: number;
  total_companies: number;
  closed_90d: number;
  median_days_open: number | null;
  median_days_to_close: number | null;
  // Share of open postings whose company states its own post date — the
  // measured basis for every age stat on this page. Optional: absent until
  // the stated-date-medians migration is applied.
  posted_coverage_pct?: number | null;
}
interface Leader {
  company: string;
  company_token: string;
  closed_90d: number;
  open_roles: number;
}
interface AuditResult {
  at: string;
  sampled: number;
  live: number;
  gone: number;
  unknown: number;
  accuracyPct: number | null;
  /** Rolling ~30-day history of daily audits, oldest first. */
  history?: Array<{ at: string; sampled: number; accuracyPct: number | null }>;
  /** Stratified per-vendor results (the audit samples every hiring system). */
  byVendor?: Record<string, { sampled: number; accuracyPct: number | null }>;
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString() : "—");

interface FreshnessStats {
  boards: number;
  p50_min: number | null;
  p95_min: number | null;
}

export default function GhostJobIndex() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [freshness, setFreshness] = useState<FreshnessStats | null>(null);
  // Per-vendor company-stated date coverage — the same probe the ops
  // heartbeat reads, published as a trust stat: it names exactly which
  // hiring systems state post dates and how much of the corpus that covers.
  const [dateCov, setDateCov] = useState<Array<{ source: string; total: number; datedPct: number }>>([]);

  useEffect(() => {
    (async () => {
      try {
        // Fast path: the hourly stats cache supplies the two slow aggregates
        // (ghost_stats ~4.9s live, date_coverage which otherwise 500s). The
        // fast calls (leaders, freshness, audit) always run live below.
        const { data: cacheRaw } = await Promise.resolve(rpc("get_stats_cache")).catch(() => ({ data: null }));
        const cache = (cacheRaw && typeof cacheRaw === "object" && !Array.isArray(cacheRaw)) ? (cacheRaw as Record<string, unknown>) : null;
        const [s, l, a, f] = await Promise.all([
          cache?.ghost_stats ? Promise.resolve({ data: [cache.ghost_stats] }) : rpc("get_ghost_job_index_stats"),
          rpc("get_actively_hiring_companies", { p_limit: 20 }),
          // The daily self-audit result (job_board_meta is public-read).
          (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> } } } })
            .from("job_board_meta").select("v").eq("k", "audit").maybeSingle(),
          // PostgREST builders are thenables WITHOUT .catch — calling .catch on
          // one throws synchronously and would kill this whole Promise.all
          // (verified live: every tile went "—"). Promise.resolve assimilates
          // the thenable into a real Promise first.
          Promise.resolve(rpc("get_freshness_stats")).catch(() => ({ data: null })),
        ]);
        let srow = Array.isArray(s.data) ? (s.data[0] as Stats) : null;
        // The stats RPC can time out on a cold cache and succeed warm — one
        // spaced retry turns a half-blank page into a reliably full one.
        if (!srow) {
          await new Promise((r) => setTimeout(r, 1500));
          const s2 = await rpc("get_ghost_job_index_stats");
          srow = Array.isArray(s2.data) ? (s2.data[0] as Stats) : null;
        }
        if (srow) setStats(srow);
        if (Array.isArray(l.data)) setLeaders(l.data as Leader[]);
        const frow = Array.isArray(f.data) ? (f.data[0] as FreshnessStats) : null;
        if (frow && typeof frow.p50_min === "number") setFreshness(frow);
        const av = (a.data as { v?: AuditResult } | null)?.v;
        if (av && typeof av.accuracyPct === "number") setAudit(av);
        // RPC shape is (source, total, dated) — the pct is ours to compute.
        // Prefer the cache (the live RPC full-scans 557k rows); fall back live.
        const dc = cache?.date_coverage
          ? { data: cache.date_coverage }
          : await Promise.resolve(rpc("get_date_coverage")).catch(() => ({ data: null }));
        if (Array.isArray(dc.data)) {
          setDateCov((dc.data as Array<{ source: string; total: number; dated: number }>)
            .filter((r) => r && typeof r.total === "number" && r.total > 0)
            .map((r) => ({ source: r.source, total: r.total, datedPct: (Number(r.dated) / Number(r.total)) * 100 }))
            .sort((x, y) => y.total - x.total));
        }
      } catch {
        /* RPCs not deployed yet — page still renders its explainer */
      }
    })();
  }, []);

  const hasClosureData = !!stats && stats.closed_90d > 0;

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="The Ghost Job Index — how many job postings are actually real?"
        description="A live, honest look at job-posting freshness: how many roles are open right now, how long they stay open, and which companies actually fill roles — computed from companies' official job boards, not aggregators or scrapes."
        path="/ghost-job-index"
      />
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-6 h-6 text-primary" />
          <h1 className="text-3xl md:text-4xl font-bold">The Ghost Job Index</h1>
        </div>
        <p className="text-muted-foreground mb-1">
          Ghost jobs — postings that are stale, already filled, or never real — waste job seekers' time everywhere.
          This is our live, honest measure of the opposite: postings that are verified, fresh, and from companies actually hiring.
        </p>
        <p className="text-xs text-muted-foreground mb-8">
          Every figure below is computed from the full lifecycle of postings on companies' <b>official</b> job boards
          (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR, Recruitee, Teamtailor, Personio, Breezy, Rippling, Workday) — never an aggregator or a scrape.
        </p>

        {/* Headline stats — always true */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">{fmt(stats?.total_open)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">verified open roles right now</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">{fmt(stats?.total_companies)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">companies, each from its own feed</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-success">30 days</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">hard freshness cap — older postings auto-dropped</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">
              {stats?.median_days_open != null ? `${stats.median_days_open}d` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              median age of an open posting, by the company's own stated post date
              {stats?.posted_coverage_pct != null && (
                <> — {Math.round(stats.posted_coverage_pct)}% of postings state one; the rest are excluded, never estimated</>
              )}
            </div>
          </div>
        </div>

        {/* Measured freshness — the live number behind the "re-verified within a
            few hours" claim, computed from per-board verification stamps at page
            load. Shown only when measured; never an aspiration. */}
        {freshness && (
          <p className="text-xs text-muted-foreground -mt-5 mb-8">
            Measured right now across {freshness.boards.toLocaleString()} company feeds: the median feed was re-checked{" "}
            <b className="text-foreground">{Math.round(freshness.p50_min ?? 0)} minutes ago</b>
            {typeof freshness.p95_min === "number" && (
              <> — 95% of all feeds within <b className="text-foreground">{(freshness.p95_min / 60).toFixed(1)} hours</b></>
            )}
            .
          </p>
        )}

        {/* The measured accuracy stat — we audit ourselves daily and publish the
            number. Shown only when a real audit result exists; never estimated. */}
        {audit && (
          <div className="rounded-2xl border border-success/30 bg-success/5 p-5 mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-success" /> We audit ourselves — here's the number
            </h2>
            <p className="text-sm text-muted-foreground">
              On {new Date(audit.at).toLocaleDateString()}, we sampled <b className="text-foreground">{audit.sampled}</b> random
              listings from this board and re-checked each one against the company's own system:{" "}
              <b className="text-success">{audit.accuracyPct}% were confirmed live at the source</b>
              {" "}({audit.live} live, {audit.gone} already taken down{audit.unknown > 0 ? `, ${audit.unknown} unreachable` : ""}).
              The handful already taken down are pruned by the next refresh cycle. We run this audit every day.
            </p>
            {/* Per-vendor accuracy — the audit samples every hiring system
                (stratified), so a single broken vendor can't hide inside a
                healthy blended number. Shown only for real samples. */}
            {audit.byVendor && Object.keys(audit.byVendor).length > 1 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                By hiring system:{" "}
                {Object.entries(audit.byVendor)
                  .filter(([, b]) => b.sampled >= 4 && typeof b.accuracyPct === "number")
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([v, b]) => `${v} ${b.accuracyPct}%`)
                  .join(" · ")}
              </p>
            )}
            {/* The daily-audit trend — only once there are at least two real
                audits to show. Every bar is a published, dated measurement. */}
            {(audit.history?.length ?? 0) >= 2 && (
              <div className="mt-3">
                <div className="flex items-end gap-0.5">
                  {audit.history!.slice(-14).map((h) => (
                    <div
                      key={h.at}
                      className="w-5 rounded-t"
                      style={{ height: `${Math.max(6, Math.round((h.accuracyPct ?? 0) * 0.4))}px`, backgroundColor: VIZ_SERIES_A }}
                      title={`${new Date(h.at).toLocaleDateString()}: ${h.accuracyPct ?? "—"}% of ${h.sampled} sampled confirmed live`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Daily audit results, most recent {Math.min(audit.history!.length, 14)} days — hover any bar for the dated measurement.
                </p>
              </div>
            )}
          </div>
        )}

        <HowWeMeasure
          items={[
            { term: "Verified open roles", method: "A live count of postings currently served from companies' official hiring systems (Greenhouse, Lever, Ashby and 8 more) — never aggregators or scrapes. Postings a feed stops serving are removed after a confirmation pass." },
            { term: "30-day freshness cap", method: "Postings whose company-stated date is older than 30 days are dropped at ingestion AND filtered at read time — the board cannot serve a stale posting even mid-sweep. Undated postings can't be judged old, so they're kept and simply show no age." },
            { term: "Median posting age", method: "Computed only from postings whose company states its own post date (the coverage share is shown next to the number). Undated postings are excluded from age stats, never estimated. We never use our own discovery time as a posting age." },
            { term: "Typical time to close", method: "Days between the company's stated post date and the moment its feed stopped serving the posting — measured only where the post date is stated. Same-title relistings are classified as churn, not fills, and excluded." },
            { term: "Confirmed-live accuracy", method: "Every day we sample ~100 random served postings, stratified across all 12 hiring systems, and re-check each one at the company's own system. The blended and per-vendor results are published above, unedited." },
            { term: "Re-verification freshness", method: "Every board carries a verification stamp from the refresh loop; the median and 95th-percentile ages shown are computed from those stamps at page load — a measurement, not a promise." },
          ]}
        />

        {/* Closure-derived stats — the moat, staged honestly */}
        <div className="rounded-2xl border border-border bg-card p-5 mb-8">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-primary" /> Do these companies actually fill roles?
          </h2>
          {hasClosureData ? (
            <p className="text-sm text-muted-foreground">
              In the last 90 days we've watched <b className="text-foreground">{fmt(stats?.closed_90d)}</b> roles get
              filled or closed across the board
              {stats?.median_days_to_close != null && (
                <> — a typical role closes in about <b className="text-foreground">{Math.round(stats.median_days_to_close)} days</b> of
                the company posting it (measured only where the company states its post date)</>
              )}. Postings that never close are exactly the ghost jobs we drop.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              We log every posting the moment a company takes it down — the only way to know which employers truly
              hire versus perpetually collect applications. We started keeping that record recently, so this fills in
              over the coming weeks. We'd rather show it honestly than fake a history.
            </p>
          )}
        </div>

        {/* Actively-hiring leaderboard */}
        {leaders.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <Briefcase className="w-4 h-4 text-primary" /> Actively hiring right now
            </h2>
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {leaders.map((c, i) => (
                <Link
                  key={c.company_token}
                  to={`/jobs/company/${c.company_token}`}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors ${i > 0 ? "border-t border-border/60" : ""}`}
                >
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-foreground truncate">{c.company}</span>
                  <span className="text-[11px] text-success font-semibold shrink-0">{c.closed_90d} filled / 90d</span>
                  <span className="text-[11px] text-muted-foreground shrink-0 w-24 text-right">{c.open_roles} open now</span>
                </Link>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Ranked by roles actually filled or closed in the last 90 days — proof of hiring, not just open listings.
            </p>
          </div>
        )}

        {/* Methodology */}
        <div className="rounded-2xl border border-border bg-muted/30 p-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-success" /> How we measure it
          </h2>
          <ul className="text-[13px] text-muted-foreground space-y-1.5">
            <li>· Every posting is pulled straight from a company's official applicant-tracking feed — never an aggregator or a scraped copy.</li>
            <li>· Any role whose posting date passes 30 days is automatically dropped, so ghost/pipeline postings other boards leave up for months never appear.</li>
            <li>· When a company removes a role, it disappears here within one refresh cycle — and we log the closure, which is how the "actually fills roles" figures are built.</li>
            <li>· Every posting is re-checked live the moment you click Apply.</li>
          </ul>
          {/* Date-provenance table: which hiring systems state their own post
              dates, measured live from the corpus. Undated postings never show
              an age here — and the "posted today / this week" filters cover
              only the date-stating share below. Saying so IS the feature. */}
          {dateCov.length > 0 && (
            <div className="mt-4">
              <p className="text-[13px] font-semibold text-foreground mb-1.5">Which postings carry a real posted date?</p>
              <p className="text-[11px] text-muted-foreground mb-2">
                Only dates companies state themselves count — we never invent one from when we first saw a posting.
                Postings without a stated date show no age anywhere on the board, and date filters simply don't include them.
              </p>
              <div className="overflow-x-auto">
                <table className="text-[12px] text-muted-foreground w-full max-w-md">
                  <thead>
                    <tr className="text-left border-b border-border/60">
                      <th className="py-1 pr-4 font-medium">Hiring system</th>
                      <th className="py-1 pr-4 font-medium text-right">Open postings</th>
                      <th className="py-1 font-medium text-right">State a post date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dateCov.map((r) => (
                      <tr key={r.source} className="border-b border-border/30 last:border-0">
                        <td className="py-1 pr-4 capitalize text-foreground">{r.source}</td>
                        <td className="py-1 pr-4 text-right">{r.total.toLocaleString()}</td>
                        <td className="py-1 text-right">{Math.round(r.datedPct)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-4">
            <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
              Browse the live board →
            </Link>
            <Link to="/entry-level-index" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              The Entry-Level Index
            </Link>
            <Link to="/hiring-trends" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              Weekly hiring trends
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
