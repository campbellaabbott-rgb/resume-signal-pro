// Explore — browse/discovery surfaces for people who don't search. Every
// collection is COMPUTED from the board's own data (hiring-health, velocity,
// freshness, salary, entry-level), never curated by hand and never invented.
// Each card deep-links into the live board pre-filtered, so discovery flows
// straight into the real, verified listings.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Compass, Flame, Sparkles, TrendingUp, GraduationCap, DollarSign, Activity, ArrowRight, Briefcase, Repeat, Building2 } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

interface CompanyRow { company: string; company_token: string; open_roles?: number; recent?: number; closed_90d?: number; entry_roles?: number; tracking_days?: number; repost_events?: number; reposted_roles?: number; worst_title?: string; worst_count?: number; feed_total?: number | null }
interface SalaryRow { category: string; currency: string; n: number; median_annual_min: number }
interface Segment { companies: number; open_roles: number; remote_pct: number; entry_pct: number; median_usd_floor: number | null; usd_n: number | null; top: CompanyRow[] }
type Segments = Partial<Record<"enterprise" | "mid" | "small", Segment>>;

const CATEGORY_LABELS: Record<string, string> = {
  engineering: "Engineering & IT", data_ai: "Data & AI", design: "Design", product: "Product",
  marketing: "Marketing & Comms", sales: "Sales & Partnerships", customer: "Customer Success",
  finance: "Finance & Accounting", legal: "Legal & Compliance", people_hr: "People & Recruiting",
  operations: "Operations & Logistics", healthcare: "Healthcare & Clinical", science: "Science & Research",
  education: "Education", hospitality_retail: "Hospitality & Retail", security: "Security & Trust",
  admin: "Administrative", other: "Other",
};
const CCY: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

// A collection of companies → each a deep-link into the board filtered to that
// company. One shared card grid so every section reads consistently.
function CompanyGrid({ rows, badge }: { rows: CompanyRow[]; badge?: (r: CompanyRow) => string | null }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {rows.map((r) => {
        const b = badge?.(r);
        return (
          <Link
            key={r.company_token}
            to={`/jobs/company/${encodeURIComponent(r.company_token)}?from=explore`}
            className="group flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-primary/50 hover:bg-card transition-colors"
          >
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
              {r.company.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground truncate">{r.company}</span>
              {b && <span className="block text-[11px] text-muted-foreground">{b}</span>}
            </span>
            <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}

function Section({ icon: Icon, title, blurb, children }: { icon: typeof Flame; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0 mt-0.5">
          <Icon className="w-4 h-4 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-foreground leading-tight">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{blurb}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function Explore() {
  const { t } = useTranslation();
  const [trending, setTrending] = useState<CompanyRow[]>([]);
  const [newest, setNewest] = useState<CompanyRow[]>([]);
  const [hiring, setHiring] = useState<CompanyRow[]>([]);
  const [reposters, setReposters] = useState<CompanyRow[]>([]);
  const [entry, setEntry] = useState<CompanyRow[]>([]);
  const [salary, setSalary] = useState<SalaryRow[]>([]);
  const [segments, setSegments] = useState<Segments | null>(null);

  useEffect(() => {
    const applySalary = (rows: SalaryRow[]) =>
      setSalary(rows.filter((r) => r && r.median_annual_min > 0).sort((a, b) => b.median_annual_min - a.median_annual_min).slice(0, 8));
    (async () => {
      // Fast path: the hourly-cached collections — one row read instead of five
      // full-table aggregates (measured 13s → <0.5s). Falls through to the live
      // RPCs only if the cache row doesn't exist yet (fresh deploy / miss).
      try {
        const { data: cache } = await Promise.resolve(rpc("get_explore_cache")).catch(() => ({ data: null }));
        const c = cache as Record<string, unknown> | null;
        if (c && (Array.isArray(c.trending) || Array.isArray(c.hiring) || Array.isArray(c.entry))) {
          if (Array.isArray(c.trending)) setTrending(c.trending as CompanyRow[]);
          if (Array.isArray(c.newest)) setNewest(c.newest as CompanyRow[]);
          if (Array.isArray(c.hiring)) setHiring(c.hiring as CompanyRow[]);
          if (Array.isArray(c.reposters)) setReposters(c.reposters as CompanyRow[]);
          if (Array.isArray(c.entry)) setEntry(c.entry as CompanyRow[]);
          if (Array.isArray(c.salary)) applySalary(c.salary as SalaryRow[]);
          if (c.segments && typeof c.segments === "object" && !Array.isArray(c.segments)) setSegments(c.segments as Segments);
          return;
        }
      } catch { /* fall through to live RPCs */ }
      const [tr, nw, hi, rp, en, sa] = await Promise.all([
        Promise.resolve(rpc("get_trending_companies", { p_limit: 12 })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_newest_companies", { p_limit: 12 })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_actively_hiring_companies", { p_limit: 12 })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_repost_churn_companies", { p_limit: 12 })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_entry_level_companies", { p_limit: 12 })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_salary_benchmarks")).catch(() => ({ data: null })),
      ]);
      // Segments live-fallback fires separately: its full-table aggregate is the
      // slowest collection and must never delay the five above.
      void Promise.resolve(rpc("get_size_segments")).then((r: { data: unknown }) => {
        if (r.data && typeof r.data === "object" && !Array.isArray(r.data)) setSegments(r.data as Segments);
      }).catch(() => { /* section hides */ });
      if (Array.isArray(tr.data)) setTrending(tr.data as CompanyRow[]);
      if (Array.isArray(nw.data)) setNewest(nw.data as CompanyRow[]);
      if (Array.isArray(hi.data)) setHiring(hi.data as CompanyRow[]);
      if (Array.isArray(rp.data)) setReposters(rp.data as CompanyRow[]);
      if (Array.isArray(en.data)) setEntry(en.data as CompanyRow[]);
      if (Array.isArray(sa.data)) applySalary(sa.data as SalaryRow[]);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={t("explore.seoTitle", "Explore Jobs — Trending Companies, Fast Hirers & Top-Paying Fields")}
        description={t("explore.seoDescription", "Discover jobs by what matters: companies hiring fastest right now, businesses that actually fill roles, newly added company boards, entry-level friendly employers, and the highest-paying fields — all computed live from companies' own job boards.")}
        path="/explore"
      />
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 mb-3">
            <Compass className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">{t("explore.badge", "Explore the board")}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-2">
            {t("explore.headline", "Find your next role by what actually matters")}
          </h1>
          <p className="text-base text-muted-foreground max-w-2xl">
            {t("explore.subhead", "Not sure what to search? Browse by real signals — who's hiring fastest, who actually fills roles, who's new, and where the pay is — every list computed live from companies' own boards.")}
          </p>
        </div>

        {trending.length > 0 && (
          <Section icon={Flame} title={t("explore.trendingTitle", "Fastest-growing boards")} blurb={t("explore.trendingBlurb", "Biggest net increase in open roles — counted from our own daily snapshots, so reposts can't inflate it.")}>
            <CompanyGrid rows={trending} badge={(r) => t("explore.trendingBadge", "+{{n}} net-new roles", { n: r.recent ?? 0 })} />
          </Section>
        )}

        {hiring.length > 0 && (
          <Section icon={Activity} title={t("explore.hiringTitle", "Companies that actually fill roles")} blurb={t("explore.hiringBlurb", "Roles that stayed posted at least a week and then came down — a real fill signal from our own tracking. Companies whose takedowns are mostly re-listings are disqualified (they appear under Serial re-posters instead).")}>
            {/* tracking_days ships with the rebuilt RPC; rows from the old cache
                lack it — show only the open count then, never an unbacked claim. */}
            <CompanyGrid rows={hiring} badge={(r) => r.tracking_days
              ? t("explore.hiringBadge", "{{filled}} filled in {{d}}d tracked · {{open}} open now", { filled: r.closed_90d ?? 0, d: r.tracking_days, open: r.open_roles ?? 0 })
              : t("explore.openRoles", "{{n}} open roles", { n: r.open_roles ?? 0 })} />
          </Section>
        )}

        {reposters.length > 0 && (
          <Section icon={Repeat} title={t("explore.repostTitle", "Serial re-posters")} blurb={t("explore.repostBlurb", "Companies that take roles down and re-list them again and again — measured from our own lifecycle tracking. Re-listing resets the posted date, so an opening can look brand-new long after it first appeared.")}>
            <CompanyGrid rows={reposters} badge={(r) => t("explore.repostBadge", "“{{title}}” re-listed {{n}}× · {{events}} total in {{d}}d", { title: (r.worst_title ?? "").slice(0, 34), n: r.worst_count ?? 0, events: r.repost_events ?? 0, d: r.tracking_days ?? 0 })} />
          </Section>
        )}

        {newest.length > 0 && (
          <Section icon={Sparkles} title={t("explore.newestTitle", "Just added to the board")} blurb={t("explore.newestBlurb", "Boards that newly appeared in our daily tracking — verified new arrivals, get in early.")}>
            <CompanyGrid rows={newest} badge={(r) => t("explore.openRoles", "{{n}} open roles", { n: r.open_roles ?? 0 })} />
          </Section>
        )}

        {segments && (["enterprise", "mid", "small"] as const).some((b) => (segments[b]?.companies ?? 0) > 0) && (
          <Section icon={Building2} title={t("explore.segTitle", "By company scale")} blurb={t("explore.segBlurb", "Segmented by hiring footprint — open roles on each company's own board right now. We don't guess headcount; the definition is the number you see.")}>
            <div className="space-y-6">
              {(["enterprise", "mid", "small"] as const).map((band) => {
                const s = segments[band];
                if (!s || !s.companies) return null;
                const label = band === "enterprise"
                  ? t("explore.segEnterprise", "Enterprise scale — 500+ open roles")
                  : band === "mid"
                    ? t("explore.segMid", "Mid-market — 50–499 open roles")
                    : t("explore.segSmall", "Startups & small teams — 3–49 open roles");
                return (
                  <div key={band}>
                    <h3 className="text-sm font-bold text-foreground mb-1">{label}</h3>
                    <p className="text-[11px] text-muted-foreground mb-2.5">
                      {t("explore.segStats", "{{companies}} companies · {{roles}} open roles · {{remote}}% remote · {{entry}}% entry-level", {
                        companies: s.companies.toLocaleString(), roles: s.open_roles.toLocaleString(),
                        remote: s.remote_pct, entry: s.entry_pct,
                      })}
                      {s.median_usd_floor != null && (s.usd_n ?? 0) >= 50 && (
                        <> · {t("explore.segSalary", "median stated floor ${{m}} ({{n}} USD postings)", { m: Math.round(s.median_usd_floor).toLocaleString(), n: s.usd_n })}</>
                      )}
                    </p>
                    <CompanyGrid rows={s.top} badge={(r) =>
                      t("explore.segOpen", "{{n}}{{plus}} open roles", {
                        n: r.open_roles ?? 0,
                        plus: (r.feed_total ?? 0) > (r.open_roles ?? 0) ? "+" : "",
                      })} />
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {entry.length > 0 && (
          <Section icon={GraduationCap} title={t("explore.entryTitle", "Entry-level friendly")} blurb={t("explore.entryBlurb", "Companies with the most roles open to people early in their careers.")}>
            <CompanyGrid rows={entry} badge={(r) => t("explore.entryBadge", "{{n}} entry-level roles", { n: r.entry_roles ?? 0 })} />
          </Section>
        )}

        {salary.length > 0 && (
          <Section icon={DollarSign} title={t("explore.salaryTitle", "Where the pay is")} blurb={t("explore.salaryBlurb", "Fields ranked by the median advertised floor — from postings that state pay, in each field's dominant currency. Never converted, never mixed.")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {salary.map((s) => (
                <Link
                  key={`${s.category}-${s.currency}`}
                  to={`/jobs/field/${s.category}?sort=salary&from=explore`}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-primary/50 hover:bg-card transition-colors"
                >
                  <TrendingUp className="w-4 h-4 text-success shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{t(`jobsPage.categories.${s.category}`, CATEGORY_LABELS[s.category] ?? s.category)}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t("explore.salaryBadge", "median floor {{sym}}{{median}} ({{ccy}}) · {{n}} postings", { sym: CCY[s.currency] ?? "", median: Math.round(s.median_annual_min).toLocaleString(), ccy: s.currency, n: s.n })}
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                </Link>
              ))}
            </div>
          </Section>
        )}

        {/* Browse by field — always shown; the classic taxonomy entry point. */}
        <Section icon={Briefcase} title={t("explore.fieldsTitle", "Browse by field")} blurb={t("explore.fieldsBlurb", "Jump straight into any field's live openings.")}>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CATEGORY_LABELS).filter(([id]) => id !== "other").map(([id, label]) => (
              <Link
                key={id}
                to={`/jobs/field/${id}?from=explore`}
                className="inline-flex items-center px-3.5 py-1.5 rounded-full border border-border bg-card/60 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
              >
                {t(`jobsPage.categories.${id}`, label)}
              </Link>
            ))}
          </div>
        </Section>

        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 text-center">
          <p className="text-sm text-foreground font-medium mb-3">{t("explore.ctaLine", "Know what you're looking for? Search the full live board.")}</p>
          <Link to="/jobs" className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold px-6 py-3 hover:bg-primary/90 transition-colors">
            <Briefcase className="w-4 h-4" />
            {t("explore.ctaButton", "Search all jobs")}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
