// Explore — browse/discovery surfaces for people who don't search. Every
// collection is COMPUTED from the board's own data (hiring-health, velocity,
// freshness, salary, entry-level), never curated by hand and never invented.
// Each card deep-links into the live board pre-filtered, so discovery flows
// straight into the real, verified listings.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Compass, Flame, Sparkles, TrendingUp, GraduationCap, DollarSign, Activity, ArrowRight, Briefcase, Repeat, Building2, BadgeDollarSign } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

interface CompanyRow { company: string; company_token: string; open_roles?: number; pay_pct?: number; median_usd_floor?: number | null; recent?: number; closed_90d?: number; entry_roles?: number; tracking_days?: number; repost_events?: number; reposted_roles?: number; worst_title?: string; worst_count?: number; feed_total?: number | null; on_board?: number; company_total?: number | null; employees?: number | null; employee_basis?: string | null; yc_batch?: string | null }
interface SalaryRow { category: string; currency: string; n: number; median_annual_min: number }
interface Segment { companies: number; with_headcount?: number; open_roles: number; remote_pct: number | null; disclosed_pct?: number | null; disclosed_n?: number | null; entry_pct: number; median_usd_floor: number | null; usd_n: number | null; top: CompanyRow[] }

// YC batch shorthand ("Winter 2024" → "W24") — the notation YC itself uses.
const ycAbbrev = (b: string): string => {
  const m = b.match(/^(Winter|Summer|Spring|Fall)\s+(\d{4})$/);
  if (!m) return b;
  const season = { Winter: "W", Summer: "S", Spring: "X", Fall: "F" }[m[1] as "Winter"];
  return `${season}${m[2].slice(2)}`;
};
// KEYED BY WHATEVER THE RPC EMITS, not by a literal this file guesses.
//
// It was `Record<"enterprise" | "mid" | "small", Segment>`, and the RPC has
// emitted mega/large/mid/small since 20260727212029. "enterprise" simply never
// matched, so the largest band never rendered and nothing errored: 936
// companies and 305,631 open roles — 52% of the section, and every recognisable
// large employer — were invisible while the page looked healthy. Same shape as
// tracking_days -> observed_days on the Ghost Job Index. A renamed key must
// degrade to a plain label, never to silence.
type Segments = Record<string, Segment | undefined>;

/**
 * Bands in descending order of the thing they band ON — roles open per company
 * — derived from the payload rather than from a list that can fall out of step
 * with the RPC.
 *
 * NOT by total open roles, which was the first attempt and rendered
 * "200–999, Under 50, 1,000+, 50–199": the small band holds 15,513 companies,
 * so its aggregate outweighs the mega band's 212 even though every company in
 * it is tiny. Roles-per-company IS the banding dimension, so ordering by it
 * always yields biggest-first (mega 612, large 243, mid 70, small 10) without
 * naming a single band.
 */
const orderedBands = (segments: Segments): Array<[string, Segment]> =>
  Object.entries(segments)
    .filter((e): e is [string, Segment] => !!e[1] && (e[1].companies ?? 0) > 0)
    .sort((a, b) =>
      (b[1].open_roles ?? 0) / Math.max(b[1].companies, 1) -
      (a[1].open_roles ?? 0) / Math.max(a[1].companies, 1));

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
  // Transparent employers: companies stating pay on >=80% of a meaningful
  // board. Fetched live (not in the hourly cache yet); section hides on empty.
  const [transparent, setTransparent] = useState<CompanyRow[]>([]);
  // When the cached collections were computed. The cache has always carried
  // this; the page just never rendered it while claiming "computed live".
  const [computedAt, setComputedAt] = useState<string | null>(null);
  // The per-band drill-through state and loader were removed with the buttons
  // that drove them — get_size_segment_companies 57014s on every band, and
  // bands by a different definition than the section it sat under. See the
  // note at the render site.

  useEffect(() => {
    const applySalary = (rows: SalaryRow[]) =>
      // "other" is excluded everywhere else on this page (it's a catch-all,
      // not a field) — its card linked to a junk /jobs/field/other lander.
      setSalary(rows.filter((r) => r && r.median_annual_min > 0 && r.category !== "other").sort((a, b) => b.median_annual_min - a.median_annual_min).slice(0, 8));
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
          // FROM THE CACHE, not a live call. This used to fire
          // get_transparent_employers on every page view; measured 2026-08-10
          // it returns 57014 after ~27s, 100% of the time, so the section had
          // never rendered while every visitor paid 26s of database time for
          // it. It now rides the hourly refresh with the other collections.
          // Absent key (cache written before that migration) leaves the
          // section hidden, exactly as today — never a zero.
          if (Array.isArray(c.transparent)) setTransparent(c.transparent as CompanyRow[]);
          if (typeof c.computed_at === "string") setComputedAt(c.computed_at);
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
      // No live transparent-employers call on the fallback path either — the
      // RPC cannot complete inside a request, so attempting it only spends
      // database time to reach the same hidden section.
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
        description={t("explore.seoDescription", "Discover jobs by what matters: companies hiring fastest right now, businesses that actually fill roles, newly added company boards, entry-level friendly employers, and the highest-paying fields — all measured from companies' own job boards, refreshed hourly.")}
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
            {t("explore.subhead", "Not sure what to search? Browse by real signals — who's hiring fastest, who actually fills roles, who's new, and where the pay is — every list measured from companies' own boards.")}
          </p>
          {/* "computed live" was false: these collections come from a cache
              refreshed hourly, and the cache has carried its own computed_at
              all along while the page never showed it. Every other measured
              surface in this product states when it was measured; this one
              asserted something stronger than the truth instead. Renders only
              once a real timestamp is in hand — no timestamp, no claim. */}
          {computedAt && (
            <p className="text-xs text-muted-foreground/80 mt-2">
              {t("explore.asOf", "Measured {{time}}, refreshed hourly.", {
                time: new Date(computedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
          )}
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

        {transparent.length > 0 && (
          <Section icon={BadgeDollarSign} title={t("explore.transparentTitle", "Transparent about pay")} blurb={t("explore.transparentBlurb", "Companies stating pay on at least 80% of their open roles — counted from their own posting text and ATS fields. A badge no one can buy: the only way in is to actually state pay.")}>
            <CompanyGrid rows={transparent} badge={(r) => {
              const parts = [t("explore.transparentBadge", "{{pct}}% of {{n}} roles state pay", { pct: r.pay_pct ?? 0, n: r.open_roles ?? 0 })];
              if (r.median_usd_floor != null) parts.push(t("explore.transparentMedian", "median floor ${{m}}", { m: Math.round(r.median_usd_floor).toLocaleString() }));
              return parts.join(" · ");
            }} />
          </Section>
        )}

        {reposters.length > 0 && (
          <Section icon={Repeat} title={t("explore.repostTitle", "Serial re-posters")} blurb={t("explore.repostBlurb", "Companies that take roles down and re-list them again and again — measured from our own lifecycle tracking. Re-listing resets the posted date, so an opening can look brand-new long after it first appeared.")}>
            <CompanyGrid rows={reposters} badge={(r) => {
              // A re-list count far above the tracking window is a data artifact
              // (bulk feed churn re-stamping ids), not something a reader should
              // take literally — audit 2026-07-26 measured "289× in 8d". Cap the
              // stated count at one re-list per tracked day and mark it as a
              // floor rather than printing an impossible number.
              const days = Math.max(1, r.tracking_days ?? 0);
              const raw = r.worst_count ?? 0;
              const capped = Math.min(raw, days);
              return t(capped < raw ? "explore.repostBadgeCapped" : "explore.repostBadge",
                capped < raw
                  ? "“{{title}}” re-listed {{n}}+× · {{events}} total in {{d}}d"
                  : "“{{title}}” re-listed {{n}}× · {{events}} total in {{d}}d",
                { title: (r.worst_title ?? "").slice(0, 34), n: capped, events: r.repost_events ?? 0, d: r.tracking_days ?? 0 });
            }} />
          </Section>
        )}

        {newest.length > 0 && (
          <Section icon={Sparkles} title={t("explore.newestTitle", "Just added to the board")} blurb={t("explore.newestBlurb", "Boards that newly appeared in our daily tracking — verified new arrivals, get in early.")}>
            <CompanyGrid rows={newest} badge={(r) => t("explore.openRoles", "{{n}} open roles", { n: r.open_roles ?? 0 })} />
          </Section>
        )}

        {segments && orderedBands(segments).length > 0 && (
          <Section icon={Building2} title={t("explore.segTitle", "By how much they're hiring")} blurb={t("explore.segBlurb", "Banded by how many roles each company currently has open on our board — not by company size. A company with a thousand openings might be an employer of a hundred thousand, or a smaller one hiring hard.")}>
            <div className="space-y-6">
              {orderedBands(segments).map(([band, s]) => {
                // LABELS DESCRIBE WHAT IS MEASURED: open roles on this board.
                // They used to say "Enterprise — 1,000+ employees" over bands
                // computed from GREATEST(on_board, feed_total) — a posting
                // count — under a blurb promising sourced headcounts and
                // "Nothing is guessed". No row in the payload carries an
                // employee count at all, so the page was asserting three
                // things that were each untrue, and filing Epic Games under
                // "under 100 employees".
                //
                // An unrecognised key falls back to a label built from the
                // band's own numbers rather than vanishing, so the next rename
                // costs a generic heading instead of half the section.
                const label = band === "mega"
                  ? t("explore.segMega", "1,000+ open roles")
                  : band === "large"
                    ? t("explore.segLarge", "200–999 open roles")
                    : band === "mid"
                      ? t("explore.segMid", "50–199 open roles")
                      : band === "small"
                        ? t("explore.segSmall", "Under 50 open roles")
                        : t("explore.segOther", "{{n}} companies", { n: s.companies.toLocaleString() });
                return (
                  <div key={band}>
                    <h3 className="text-sm font-bold text-foreground mb-1">{label}</h3>
                    <p className="text-[11px] text-muted-foreground mb-2.5">
                      {t("explore.segStatsBase", "{{companies}} companies · {{roles}} open roles · {{entry}}% entry-level", {
                        companies: s.companies.toLocaleString(), roles: s.open_roles.toLocaleString(),
                        entry: s.entry_pct,
                      })}
                      {/* remote_pct now divides by postings that actually state
                          a work mode — 87% of the corpus states none, and the
                          old all-postings denominator made a segment that is
                          ~60% remote among those who say read as ~8%, as if it
                          were a fact about the employers. It is null when
                          nobody in the band disclosed: "none are remote" and
                          "nobody said" must not look the same. */}
                      {s.remote_pct != null && (
                        <> · {t("explore.segRemoteDisclosed", "{{remote}}% remote of the {{n}} that state a work mode", {
                          remote: s.remote_pct, n: (s.disclosed_n ?? 0).toLocaleString(),
                        })}</>
                      )}
                      {s.median_usd_floor != null && (s.usd_n ?? 0) >= 50 && (
                        <> · {t("explore.segSalary", "median stated floor ${{m}} ({{n}} USD postings)", { m: Math.round(s.median_usd_floor).toLocaleString(), n: s.usd_n })}</>
                      )}
                      {/* The "N with stated headcount" clause was removed with
                          the headcount framing: the live RPC emits no
                          with_headcount field at all, so the branch was dead,
                          and its wording implied a sourcing step that does not
                          happen. */}
                    </p>
                    {/* Two-number badge: our verified count and the company's own
                        advertised total when it exceeds it — the band label and
                        badge can never contradict each other. (Fallback fields
                        cover a frontend-before-migration deploy window.) */}
                    {(() => {
                      const segBadge = (r: CompanyRow) => {
                        const onBoard = r.on_board ?? r.open_roles ?? 0;
                        const total = r.company_total ?? r.feed_total ?? 0;
                        const openTxt = total > onBoard
                          ? t("explore.segOpenBoth", "{{n}} on our board · {{total}} company-wide", { n: onBoard, total: total.toLocaleString() })
                          : t("explore.segOpen", "{{n}} open roles", { n: onBoard });
                        const parts: string[] = [];
                        if (r.employees != null) {
                          parts.push(t("explore.segEmp", "≈{{n}} employees ({{basis}})", {
                            n: r.employees.toLocaleString(),
                            basis: r.employee_basis === "yc_self_reported"
                              ? t("explore.segBasisYc", "YC profile")
                              : t("explore.segBasisPr", "public records"),
                          }));
                        }
                        if (r.yc_batch) parts.push(t("explore.segYcChip", "YC {{b}}", { b: ycAbbrev(r.yc_batch) }));
                        parts.push(openTxt);
                        return parts.join(" · ");
                      };
                      // THE "See all N companies" BUTTONS ARE GONE.
                      //
                      // They called get_size_segment_companies, which returns
                      // 57014 for every band — measured 25.2s, 26.6s and 26.6s
                      // — and the click handler swallowed the error, so the
                      // label just reverted and nothing happened. Every press
                      // spent 25 seconds of a Postgres worker to achieve that.
                      //
                      // It was also paging a DIFFERENT population: that RPC
                      // still bands by employee headcount and requires
                      // `employees IS NOT NULL`, while the band above it is
                      // open roles. Even repaired, "See all 1,724 companies"
                      // would have returned a disjoint set under a total that
                      // did not describe it. A control that cannot keep its
                      // own promise is worse than no control.
                      return <CompanyGrid rows={s.top} badge={segBadge} />;
                    })()}
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
