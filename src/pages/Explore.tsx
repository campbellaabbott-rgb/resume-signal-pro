// Explore — browse/discovery surfaces for people who don't search. Every
// collection is COMPUTED from the board's own data (hiring-health, velocity,
// freshness, salary, entry-level), never curated by hand and never invented.
// Each card deep-links into the live board pre-filtered, so discovery flows
// straight into the real, verified listings.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
// Compass went with the header pill; Flame and Sparkles went with the trending
// and newest sections. Section's icon prop is typed off LucideIcon rather than
// off one of the icons it happens to receive, so removing a section no longer
// strands an import purely to satisfy a type.
import { LucideIcon, TrendingUp, GraduationCap, DollarSign, Activity, ArrowRight, Briefcase, Repeat, Building2, BadgeDollarSign, Search } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

interface CompanyRow { company: string; company_token: string; open_roles?: number; p50_days_open?: number | null; dated_n?: number; pay_pct?: number; median_usd_floor?: number | null; recent?: number; closed_90d?: number; entry_roles?: number; tracking_days?: number; repost_events?: number; reposted_roles?: number; worst_title?: string; worst_count?: number; feed_total?: number | null; on_board?: number; company_total?: number | null }
interface SalaryRow { category: string; currency: string; n: number; median_annual_min: number }
interface Segment { companies: number; with_headcount?: number; open_roles: number; remote_pct: number | null; disclosed_pct?: number | null; disclosed_n?: number | null; entry_pct: number; median_usd_floor: number | null; usd_n: number | null; top: CompanyRow[] }

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

/** MIRRORS `COUNT_CAP` in supabase/functions/job-board/index.ts:5626.
 *
 *  The serving API stops counting at 10,000 and replies `countCapped: true`,
 *  so /jobs/field/marketing renders "10,000+" no matter how many roles are
 *  really there. get_explore_denominators counts in SQL and is NOT capped, so
 *  a chip printing its raw number would read "38,412" and open a page saying
 *  "10,000+" — the card-contradicts-destination defect, merely inverted.
 *
 *  So the chip formats through the SAME cap. Two runtimes, one number, and a
 *  cross-runtime test pins them together: this is the exact shape of the
 *  claim-drift failure where copy went false because the thing it described
 *  lived in a different runtime than the sentence about it. */
const SERVE_COUNT_CAP = 10_000;
const fieldCount = (n: number, loc: string) =>
  n >= SERVE_COUNT_CAP ? `${SERVE_COUNT_CAP.toLocaleString(loc)}+` : n.toLocaleString(loc);

/** token -> [repost_events, reposted_roles, days_tracked]. */
type RepostIndex = Record<string, [number, number, number] | undefined>;
/** Pool sizes behind each collection. Every key is optional and every one is
 *  absent rather than zero when its scan failed — see the NULLIF/strip_nulls
 *  note in 20260812020000. Nothing here may render as "0". */
interface Totals {
  hiring_n?: number; repost_pool_n?: number; repost_flagged_n?: number;
  entry_n?: number; pay_n?: number; pay_pool_n?: number;
  employers_n?: number; postings_n?: number; postings_pay_n?: number;
}

/** THE ONLY PLACE THIS FILE BUILDS A /jobs URL.
 *
 *  Every card used to hardcode `/jobs/company/{token}?from=explore`, which is
 *  how the entry-level card came to promise "38 entry-level roles" over a
 *  destination showing 900 — the badge counted one thing and the page it opened
 *  counted another. A card's number and the filter its link carries are one
 *  decision, so they live in one function.
 *
 *  `experience=entry` is read by Jobs.tsx:315 and accepted by experience.ts —
 *  verified, not assumed. Nothing here appends a filter Jobs does not read: a
 *  `fresh=day` link was drafted for the ghost-job answer and dropped, because
 *  Jobs.tsx WRITES that param but never reads it back, so the button would have
 *  promised a 24-hour window and delivered an unfiltered board. */
const companyHref = (token: string, intent: Intent): string => {
  const base = `/jobs/company/${encodeURIComponent(token)}?from=explore`;
  return intent === "entry" ? `${base}&experience=entry` : base;
};

/** The six things a visitor might actually want, in chip order. Each renders
 *  one cached collection; none triggers a fetch. */
type Intent = "check" | "hiring" | "pay" | "entry" | "ghost" | "scale" | "fields";
/** `check` first, deliberately. The other six are browsing; this one answers the
 *  question a visitor most often actually arrives with — "should I trust this
 *  posting from THIS employer?" — and it is the only answer that covers all
 *  24,931 employers rather than the 85 that top a list. */
const INTENTS: readonly Intent[] = ["check", "hiring", "pay", "entry", "ghost", "scale", "fields"];
const isIntent = (v: string | null): v is Intent => !!v && (INTENTS as readonly string[]).includes(v);

// A collection of companies → each a deep-link into the board filtered to that
// company. One shared card grid so every section reads consistently.
function CompanyGrid({ rows, badge, intent, tone = "default", warn }: { rows: CompanyRow[]; badge?: (r: CompanyRow) => string | null; intent: Intent; tone?: "default" | "warning"; warn?: (r: CompanyRow) => string | null }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {rows.map((r) => {
        const b = badge?.(r);
        const w = warn?.(r);
        return (
          <Link
            key={r.company_token}
            to={companyHref(r.company_token, intent)}
            className={`group flex items-center gap-3 rounded-xl border bg-card/60 px-4 py-3 transition-colors ${
              tone === "warning"
                ? "border-warning/40 hover:border-warning hover:bg-warning/5"
                : "border-border hover:border-primary/50 hover:bg-card"
            }`}
          >
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
              {r.company.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground truncate">{r.company}</span>
              {b && <span className="block text-[11px] text-muted-foreground">{b}</span>}
              {/* THE CHURN WARNING, WHEREVER THE EMPLOYER APPEARS.
                  Rendered only on a hit, and only ever as a positive statement
                  — a miss means "did not clear the rate gate", which includes
                  every employer we have watched for a week. Styled warning, not
                  muted, because it contradicts the recommendation the card it
                  sits inside is making. */}
              {w && <span className="block text-[11px] text-warning mt-0.5">{w}</span>}
            </span>
            {/* No arrow on the warning list. Every other collection is a
                recommendation and the arrow reads as "go here"; the re-poster
                list is the one that says "be careful", and it must not look
                like the five that say "apply". */}
            {tone !== "warning" && (
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** Twelve card-shaped placeholders, matching CompanyGrid's geometry exactly so
 *  nothing shifts when the real cards replace them.
 *
 *  aria-hidden with a polite live region beside it: a screen reader should hear
 *  "loading employers" once, not twelve empty list items. */
function GridSkeleton() {
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">Loading employers…</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card/30 px-4 py-3">
            <div className="w-9 h-9 rounded-lg bg-muted animate-pulse shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: `${55 + ((i * 7) % 35)}%` }} />
              <div className="h-2.5 rounded bg-muted/60 animate-pulse" style={{ width: `${35 + ((i * 11) % 40)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** `note` is the denominator line — "the 12 best of N that qualify".
 *
 *  Twelve cards under "Companies that actually fill roles" is indistinguishable
 *  from "twelve companies fill roles". The collection is a top slice and has
 *  always been one; the page simply never said what it was a slice OF, which
 *  makes a leaderboard read as a census.
 *
 *  Optional, and absent whenever its counter is — a failed scan leaves the key
 *  stripped rather than zero, so a broken instrument renders no sentence rather
 *  than "the 12 best of 0 employers". */
function Section({ icon: Icon, title, blurb, note, children }: { icon: LucideIcon; title: string; blurb: string; note?: string | null; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0 mt-0.5">
          <Icon className="w-4 h-4 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-foreground leading-tight">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{blurb}</p>
          {note && <p className="text-[12px] text-foreground/70 mt-1.5 font-medium">{note}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function Explore() {
  const { t, i18n } = useTranslation();
  // ONE QUESTION AT A TIME.
  //
  // Measured before this change: the page was 31,935px — about forty screens —
  // with 120 company cards, ZERO interactive controls, and six of its eight
  // sections rendering the same 12-card grid differing only in sort order. A
  // visitor with no specific query had nothing to act on and no way to tell
  // why they should care about one leaderboard over the next.
  //
  // The collections are unchanged and still come from the single hourly cache
  // row. What changed is that one is visible at a time, chosen by the reader,
  // with the rest kept in the DOM under `hidden` — never conditionally
  // unmounted, because /explore is prerendered and sitemapped at priority 0.8
  // daily and every company link must stay crawlable and findable with Ctrl-F.
  const [intent, setIntent] = useState<Intent>("hiring");
  // Employer lookup state. The query fires on keystroke only, never on load,
  // and only at 3+ characters — a shorter one would scan the alphabet.
  const [cq, setCq] = useState("");
  const [cHits, setCHits] = useState<Array<{ name: string; tokens: string[] }>>([]);
  /** THREE STATES, NOT TWO — and the third is the whole point.
   *
   *  This was a boolean, and a failed lookup fell into the same branch as a
   *  genuine miss: searching "wegman" while the RPC was undeployed printed
   *  "We don't carry that employer's job board", which is a confident false
   *  statement about a company we carry 498 roles for. Caught by testing before
   *  the migration applied.
   *
   *  A broken instrument must never render as a fact about the thing it
   *  measures. That is the failure this whole page has been paying down: a
   *  section that timed out looked like a section with nothing to show. */
  const [cState, setCState] = useState<"idle" | "ok" | "error">("idle");
  // Which size band is expanded. Only one band's cards render at a time; the
  // four stat lines act as the selector, so 36 of 48 cards leave the viewport
  // while every band's aggregate stays on screen.
  const [band, setBand] = useState<string | null>(null);
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
  // Per-field served counts, pool sizes, and the churn index. All three ride
  // the same cached row as the collections — no extra request, and no live
  // aggregate on the request path, which is the rule this page exists to keep.
  // All three default EMPTY and every render site is gated, so a cache row
  // written before this migration renders exactly today's page.
  const [fields, setFields] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<Totals>({});
  const [repostIndex, setRepostIndex] = useState<RepostIndex>({});
  // THE PAGE USED TO RENDER EMPTY AND POP.
  //
  // Every answer is gated on `collection.length > 0`, so before the cache read
  // returns, a visitor sees a heading, six chips and nothing under them — which
  // is indistinguishable from "this section is broken" and is exactly the
  // reading this page has earned elsewhere. It resolves in well under a second
  // on a warm cache and noticeably longer on a cold one, which is precisely
  // when a visitor is most likely to conclude nothing works.
  //
  // Not a spinner: a spinner says "wait" without saying what for. Twelve
  // card-shaped placeholders say what is coming and stop the layout jumping
  // when it arrives.
  const [loading, setLoading] = useState(true);
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
        // TRENDING AND NEWEST ARE NO LONGER READ, AND THAT IS THE POINT.
        //
        // Both answered a question nobody arrives with (a board adding roles
        // fast is not a board more likely to hire you), and both carried a live
        // honesty problem: their open_roles comes from
        // job_board_company_snapshots, whose writer applies neither serving
        // predicate — migration 20260811013000 says so in as many words under
        // "NOT INCLUDED, DELIBERATELY" — so their badges could overstate what
        // the click-through would show. "Just added" was worse still: its
        // "get in early" framing rested on first_added, which is when WE
        // discovered the board, not when the roles went up.
        //
        // The cache still carries both keys; this page simply stops rendering
        // claims it cannot stand behind.
        if (c && (Array.isArray(c.hiring) || Array.isArray(c.entry) || Array.isArray(c.transparent))) {
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
          // Objects, not arrays — and checked as such. `typeof null === "object"`
          // is the trap that would put `null` into a Record and crash the first
          // Object.entries over it, so each is required to be a non-null,
          // non-array object before it is trusted.
          const obj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
          if (obj(c.fields)) setFields(c.fields as Record<string, number>);
          if (obj(c.totals)) setTotals(c.totals as Totals);
          if (obj(c.repost_index)) setRepostIndex(c.repost_index as RepostIndex);
          if (typeof c.computed_at === "string") setComputedAt(c.computed_at);
          setLoading(false);
          return;
        }
      } catch { /* fall through to live RPCs */ }
      // Two fewer RPCs on the fallback path than before: the trending and
      // newest collections are no longer rendered, so fetching them would only
      // spend request time to fill state nothing reads.
      const [hi, rp, en, sa] = await Promise.all([
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
      if (Array.isArray(hi.data)) setHiring(hi.data as CompanyRow[]);
      if (Array.isArray(rp.data)) setReposters(rp.data as CompanyRow[]);
      if (Array.isArray(en.data)) setEntry(en.data as CompanyRow[]);
      if (Array.isArray(sa.data)) applySalary(sa.data as SalaryRow[]);
      // Cleared after the four that gate visible answers. The segments call
      // above resolves on its own schedule and must not hold the skeleton up —
      // it is the slowest collection and its band section appears when ready.
      setLoading(false);
    })();
  }, []);

  // The chosen answer lives in the URL, so it is shareable, survives the back
  // button, and a crawler following ?i=pay sees the pay answer rather than
  // whatever happens to be first. replaceState rather than push: switching
  // answers is not a navigation, and stacking six entries would make Back feel
  // broken.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("i");
    if (isIntent(q)) setIntent(q);
  }, []);
  const chooseIntent = (next: Intent) => {
    setIntent(next);
    const u = new URL(window.location.href);
    u.searchParams.set("i", next);
    window.history.replaceState(null, "", u.toString());
  };

  // Debounced typeahead. 250ms and 3 chars keep this to roughly one request per
  // word typed, against a single-row PK lookup — no aggregate on the request
  // path, which is the rule this page exists to respect.
  useEffect(() => {
    const s = cq.trim();
    if (s.length < 3) { setCHits([]); setCState("idle"); return; }
    let alive = true;
    const id = setTimeout(() => {
      void Promise.resolve(rpc("get_company_suggest", { p_q: s }))
        .then((r: { data: unknown; error?: unknown }) => {
          if (!alive) return;
          // A non-array reply is a FAILURE, not an empty result. supabase-js
          // resolves rather than throws on a PostgREST error, so an undeployed
          // or erroring RPC arrives here with data === null — and treating that
          // as "no match" is what printed "we don't carry that employer" over a
          // company with 498 open roles.
          if (r.error || !Array.isArray(r.data)) { setCHits([]); setCState("error"); return; }
          setCHits(r.data as Array<{ name: string; tokens: string[] }>);
          setCState("ok");
        })
        .catch(() => { if (alive) { setCHits([]); setCState("error"); } });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [cq]);

  const bands = segments ? orderedBands(segments) : [];
  // Default to the biggest band, but only once the payload is in hand — a band
  // key hardcoded here is how half this section vanished the last time the SQL
  // renamed one.
  const activeBand = band ?? bands[0]?.[0] ?? null;

  // A chip is rendered only when its collection has something to show. An
  // answer that would open empty is worse than an answer that is not offered,
  // and a chip whose body is blank reads as breakage rather than as absence.
  const available: Record<Intent, boolean> = {
    // Always offered: it reads the facets row, which the edge-function refresh
    // pass maintains independently of the hourly cron. When pg_cron died today
    // every other answer froze; this one would have kept working.
    check: true,
    hiring: hiring.length > 0,
    pay: transparent.length > 0 || salary.length > 0,
    entry: entry.length > 0,
    ghost: reposters.length > 0,
    scale: bands.length > 0,
    fields: true,
  };
  // WHILE LOADING, EVERY COLLECTION IS EMPTY — so availability is unknown, not
  // false. Deriving `shown` and `active` from it during load produced two
  // visible defects, both measured in a browser rather than reasoned about:
  //
  //   - the chip row rendered TWO chips (check, fields — the only two that do
  //     not depend on a collection) and then jumped to seven;
  //   - `active` fell back to `check`, so the hiring skeleton — which sits
  //     inside `hidden={active !== "hiring"}` — was hidden for the entire
  //     540ms it existed to cover, and the loading state I had just added
  //     never appeared once.
  //
  // Absence of data is not evidence of absence, which is the rule this page
  // applies to every number on it; it applies to its own controls too.
  const shown = loading ? INTENTS : INTENTS.filter((i) => available[i]);
  // Once loaded: if the chosen answer genuinely has no data, fall to the first
  // that does rather than rendering a heading over nothing.
  const active: Intent = loading ? intent : (available[intent] ? intent : (shown[0] ?? "fields"));

  /** Each answer's way into the board, turning an intent into JOBS rather than
   *  into twelve more company links.
   *
   *  Every one of these params is READ by Jobs.tsx — that is not decoration.
   *  A `fresh=day` action was drafted for the ghost answer and dropped, because
   *  Jobs WROTE that param and never read it back, so the button would have
   *  promised a 24-hour window over an unfiltered board. `fresh` and
   *  `activelyHiring` are now both read; `company` accepts a comma list, which
   *  the server has always supported.
   *
   *  NO COUNTS on these buttons. The collection holds 12 rows, which is not the
   *  size of the population the sentence would imply, and only a live aggregate
   *  could state the real number — the 26-seconds-per-view mistake. */
  const ACTION: Partial<Record<Intent, { to: string; label: string }>> = {
    hiring: hiring.length
      ? {
          to: `/jobs?company=${encodeURIComponent(hiring.slice(0, 12).map((r) => r.company_token).join(","))}&from=explore`,
          label: t("explore.actionHiring", "Open roles at all of these employers"),
        }
      : undefined,
    entry: { to: "/jobs?experience=entry&from=explore", label: t("explore.actionEntry", "All entry-level roles on the board") },
    // "Proven fill record" was a claim the data cannot support. What the
    // lifecycle log actually observes is a posting DISAPPEARING and not coming
    // back — which can be a fill, a cancelled req, or a paused budget.
    // Measured 2026-08-24 over the top 150 employers: of the 31 that qualify,
    // the median carries 60% superseded (reposted) closure activity and 68%
    // are majority-churn, so even the surviving signal is noisy. The label now
    // says exactly what is measured.
    ghost: { to: "/jobs?activelyHiring=1&from=explore", label: t("explore.actionGhost", "Show only employers whose roles close and stay closed") },
  };

  const INTENT_LABEL: Record<Intent, string> = {
    check: t("explore.intentCheck", "Check an employer"),
    hiring: t("explore.intentHiring", "Will actually hire me"),
    pay: t("explore.intentPay", "States the pay"),
    entry: t("explore.intentEntry", "Early career"),
    ghost: t("explore.intentGhost", "Watch out: ghost jobs"),
    scale: t("explore.intentScale", "Hiring at scale"),
    fields: t("explore.intentFields", "By field"),
  };

  const nf = (n: number) => n.toLocaleString(i18n.language);

  /** The churn warning for one employer, or null — POSITIVE FORM ONLY.
   *
   *  A hit means "this employer cleared a rate gate of 5 re-lists per affected
   *  role on 25+ events". A MISS means only that it did not, which includes
   *  every employer whose board we have watched for a week. So there is no
   *  "no re-posting detected", no green tick, no clean-bill styling anywhere
   *  in this file: absence of evidence is not evidence of absence, and this
   *  page applies that rule to its own numbers everywhere else.
   *
   *  "across {{roles}} roles" is not decoration — it is what separates a
   *  diagnosis from a libel. 581 re-lists across 3 roles is one job advertised
   *  forever; 769 across 298 is a large employer with ordinary churn. Read as
   *  a bare count they look identical and the second employer is defamed. It
   *  travels in the same sentence, never a tooltip.
   *
   *  Not on the ghost answer: that card's own badge already states these
   *  numbers, and repeating them under it would read as two findings. */
  const repostWarn = (token: string | undefined, on: Intent): string | null => {
    if (!token || on === "ghost") return null;
    const hit = repostIndex[token];
    // Shape-checked, not just presence-checked: the payload is JSON from a
    // cache row that may predate the migration, and destructuring a non-array
    // would print "undefined re-postings across undefined roles".
    if (!Array.isArray(hit) || hit.length < 3) return null;
    const [events, roles, days] = hit;
    if (!(typeof events === "number" && events > 0 && typeof roles === "number" && roles > 0)) return null;
    return t("explore.repostWarn", "Re-lists roles: {{events}} re-postings across {{roles}} roles in {{d}}d", {
      events: nf(events), roles: nf(roles), d: days,
    });
  };

  /** The denominator under each answer. Rendered only when its counter is
   *  present — see the strip_nulls note in the migration; a missing key is a
   *  failed scan and must produce silence, not a zero. */
  const NOTE: Partial<Record<Intent, string | null>> = {
    hiring: totals.hiring_n
      ? t("explore.noteHiring", "The 12 with the strongest fill rate, out of {{n}} employers that qualify — a measurable fill record and 100+ roles open now.", { n: nf(totals.hiring_n) })
      : null,
    // TWO SENTENCES, because the second is what makes the first mean anything.
    // "41 employers state pay on 80%+ of their roles" sounds thin until you
    // know the board-wide rate; together they say how unusual the badge is.
    pay: totals.pay_n && totals.pay_pool_n
      ? [
          t("explore.notePay", "{{n}} of the {{pool}} employers with 20+ open roles state pay on at least 80% of them.", { n: nf(totals.pay_n), pool: nf(totals.pay_pool_n) }),
          totals.postings_pay_n && totals.postings_n
            ? t("explore.notePayBoard", "Board-wide, {{pct}}% of open postings state pay at all.", { pct: Math.round(100 * totals.postings_pay_n / totals.postings_n) })
            : "",
        ].filter(Boolean).join(" ")
      : null,
    entry: totals.entry_n
      ? t("explore.noteEntry", "The 12 with the most, out of {{n}} employers with 5 or more entry-level roles open.", { n: nf(totals.entry_n) })
      : null,
    ghost: totals.repost_pool_n
      ? [
          t("explore.noteGhost", "The 12 with the most re-listings, out of {{n}} employers with 20 or more tracked.", { n: nf(totals.repost_pool_n) }),
          // The flagged count is the population behind the warning that now
          // follows employers onto the other answers, so this is where it is
          // explained rather than appearing unannounced under a pay card.
          totals.repost_flagged_n
            ? t("explore.noteGhostFlagged", "{{n}} re-list often enough to carry a warning on the other answers.", { n: nf(totals.repost_flagged_n) })
            : "",
        ].filter(Boolean).join(" ")
      : null,
    fields: totals.postings_n
      ? t("explore.noteFields", "{{n}} roles open across the board right now.", { n: nf(totals.postings_n) })
      : null,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* NEW KEYS, because the old copy described sections that no longer
          exist. seoTitle led with "Trending Companies" and seoDescription
          promised "companies hiring fastest right now" and "newly added company
          boards" — both collections were removed above for having counts their
          click-through could contradict. Leaving the old strings would have the
          page advertise, to crawlers and in nine languages, two things it does
          not contain: the same claim-drift defect the collections were removed
          FOR. */}
      <SEO
        title={t("explore.seoTitle2", "Explore Employers — Who Fills Roles, Who States Pay, Who Re-posts")}
        description={t("explore.seoDescription2", "Pick what you're looking for: employers that actually fill the roles they post, companies that state pay up front, entry-level friendly boards, serial re-posters to avoid, and the highest-paying fields — all measured from companies' own job boards and our own daily tracking, refreshed hourly.")}
        path="/explore"
      />
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        {/* The Compass pill is gone. It said "Explore the board" directly above
            an H1 saying much the same thing, and on a 375px screen it cost
            ~56px of the only fold a visitor is guaranteed to see. */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-2">
            {t("explore.headline", "Find your next role by what actually matters")}
          </h1>
          <p className="text-base text-muted-foreground max-w-2xl">
            {/* Same reason as the SEO strings: the old subhead named "who's
                hiring fastest" and "who's new", which are exactly the two
                collections deleted above. */}
            {t("explore.subhead2", "Pick what you're actually looking for. Every answer is measured from our own daily tracking of what happens to each posting — not from what employers claim.")}
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
                // i18n.language, not undefined. `undefined` resolves to the
                // BROWSER's locale, which is independent of the language the
                // reader picked — so a German page rendered "Aug 11, 2026,
                // 10:07 PM" in English while every word around it was German.
                // The one visible date on the page belonged to a different
                // language than the sentence containing it.
                time: new Date(computedAt).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
          )}
        </div>

        {/* THE PAGE'S ONLY CONTROL, and the fix for "zero interactive inputs".
            Wrapped, never a horizontal scroller: all six choices are visible on
            a 375px screen without a gesture. A nowrap row would hide half the
            options behind a swipe nobody knows to make, which is the same class
            of defect as the header nav being `hidden sm:flex` with no
            hamburger — the reason /explore was unreachable on a phone at all
            until today.

            No counts on the chips. A number here would be the size of a
            collection capped at 12, not the size of the population it implies,
            and this page has already shipped one heading whose number its own
            contents contradicted. */}
        <div className="mb-8" role="tablist" aria-label={t("explore.intentAria", "What are you looking for?")}>
          <div className="flex flex-wrap gap-2">
            {shown.map((i, idx) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={active === i}
                // role="tablist" PROMISES arrow-key navigation. Shipping the
                // role without the keys is worse than shipping neither: a
                // screen reader announces "tab, 1 of 7" and the arrow keys a
                // user is then told to press do nothing. Roving tabindex so
                // Tab enters the group once and arrows move within it, which is
                // the behaviour the role advertises.
                tabIndex={active === i ? 0 : -1}
                onKeyDown={(e) => {
                  const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const next = shown[(idx + d + shown.length) % shown.length];
                  chooseIntent(next);
                  // Move focus with selection, or the ring stays on a chip that
                  // is no longer the selected one.
                  const el = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                  el?.[(idx + d + shown.length) % shown.length]?.focus();
                }}
                onClick={() => chooseIntent(i)}
                className={`inline-flex items-center px-3.5 py-2 rounded-full border text-sm font-medium transition-colors min-h-[40px] ${
                  active === i
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card/60 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {INTENT_LABEL[i]}
              </button>
            ))}
            {/* The way out, kept beside the choices rather than buried at the
                bottom of a long page. /jobs does search, filters and sorting
                well; Explore is for people who do not yet have a query, and the
                ones who do should not have to scroll to leave. */}
            <Link
              to="/jobs"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-primary/40 bg-primary/5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors min-h-[40px]"
            >
              <Briefcase className="w-3.5 h-3.5" />
              {t("explore.searchAll", "Search all jobs")}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* "Fastest-growing boards" was here. Removed, not hidden: it answered
            no question a job seeker arrives with, and its counts came from the
            snapshot path that applies neither serving predicate. */}

        {/* The answer's action, rendered once for whichever answer is showing
            rather than repeated inside six bodies. */}
        {ACTION[active] && (
          <Link
            to={ACTION[active]!.to}
            className="flex items-center justify-center gap-2 mb-6 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            {ACTION[active]!.label}
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}

        {/* CHECK AN EMPLOYER — the only answer that covers all 24,931 boards
            rather than the 85 that top a list. Selecting a match NAVIGATES to
            /jobs/company/{token} rather than rendering a verdict here: that
            page already states these sentences from nine translated locales,
            and rebuilding them on Explore would be eight new sentence keys x
            nine languages to reach a page one click away. */}
        <div hidden={active !== "check"}>
          <Section
            icon={Search}
            title={t("explore.checkTitle", "Check a specific employer")}
            blurb={t("explore.checkBlurb", "Every employer on the board — not just the ones on these lists. See how many roles they have open, how many they've actually filled, and whether they re-list the same job.")}
          >
            <input
              type="search"
              value={cq}
              onChange={(e) => setCq(e.target.value)}
              placeholder={t("explore.checkPlaceholder", "Type a company name…")}
              aria-label={t("explore.checkTitle", "Check a specific employer")}
              className="w-full rounded-xl border border-border bg-card/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {cHits.length > 0 && (
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {cHits.map((h) => {
                  /* THE WARNING'S MOST USEFUL HOME. A reader typing a company
                     name has already decided to consider that employer; this is
                     the last moment before they leave for its board, and it is
                     the one place on the page where the answer covers all
                     24,931 employers rather than a twelve-row slice.
                     ACROSS ALL ITS FEEDS, worst first. An employer with four
                     ATS feeds merges into one row here (get_company_suggest
                     groups by display name), and the churn index is keyed by
                     token — so checking only tokens[0] would miss the churn
                     whenever it lives on a sibling feed. The one shown is the
                     highest-event token, so the sentence and the token that
                     earned it are the same. */
                  const worstToken = h.tokens
                    .filter((tk) => Array.isArray(repostIndex[tk]))
                    .sort((a, b) => (repostIndex[b]![0] ?? 0) - (repostIndex[a]![0] ?? 0))[0];
                  const worst = worstToken ? repostWarn(worstToken, "check") : null;
                  return (
                  <Link
                    key={h.name}
                    to={`/jobs/company/${encodeURIComponent(h.tokens[0])}?from=explore`}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-primary/50 hover:bg-card transition-colors"
                  >
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
                      {h.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground truncate">{h.name}</span>
                      {/* NO COUNT HERE. The facet's count applies neither serving
                          predicate, so printing it would state a number the
                          destination contradicts — the defect this page spent
                          the week removing. The company page carries the real
                          figures. */}
                      {h.tokens.length > 1 && (
                        <span className="block text-[11px] text-muted-foreground">
                          {t("explore.checkFeeds", "{{n}} job boards", { n: h.tokens.length })}
                        </span>
                      )}
                      {worst && <span className="block text-[11px] text-warning mt-0.5">{worst}</span>}
                    </span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  </Link>
                  );
                })}
              </div>
            )}
            {/* A GENUINE MISS. Only reachable when the lookup actually answered
                and returned nothing — never when it failed. */}
            {cState === "ok" && cHits.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t("explore.checkNone", "We don't carry that employer's job board — so we have nothing measured to show you.")}
              </p>
            )}
            {/* A BROKEN LOOKUP, said as such. This must never borrow the
                sentence above: "we don't carry them" is a claim about the
                employer, and we are in no position to make it when our own
                query did not answer. */}
            {cState === "error" && (
              <p className="mt-3 text-sm text-warning">
                {t("explore.checkErr", "Employer lookup is unavailable right now — this says nothing about that employer. Try again shortly.")}
              </p>
            )}
          </Section>
        </div>

        <div hidden={active !== "hiring"}>
        {/* The default answer, so this skeleton is the one a first-time visitor
            sees. Rendered under the real heading and blurb, which are static —
            only the cards are unknown, so only the cards are placeholders. */}
        {loading && hiring.length === 0 && (
          <Section icon={Activity} title={t("explore.hiringTitle", "Companies that actually fill roles")} blurb={t("explore.hiringBlurb", "Roles that stayed posted at least a week and then came down — a real fill signal from our own tracking. Companies whose takedowns are mostly re-listings are disqualified (they appear under Serial re-posters instead).")}>
            <GridSkeleton />
          </Section>
        )}
        {hiring.length > 0 && (
          <Section icon={Activity} note={NOTE.hiring} title={t("explore.hiringTitle", "Companies that actually fill roles")} blurb={t("explore.hiringBlurb", "Roles that stayed posted at least a week and then came down — a real fill signal from our own tracking. Companies whose takedowns are mostly re-listings are disqualified (they appear under Serial re-posters instead).")}>
            {/* tracking_days ships with the rebuilt RPC; rows from the old cache
                lack it — show only the open count then, never an unbacked claim. */}
            {/* THE CLOCK, when the sample supports it.
                p50_days_open answers "how long until this employer decides",
                which is the most decision-changing thing on the page — but a
                median over four dated closures is noise dressed as a deadline.
                Gated on dated_n >= 10 AND tracking_days >= 21, and it degrades
                to today's badge rather than to a number with no confidence
                behind it. Absent fields (a cache row written before the
                migration) take the same path. */}
            {/* The churn warning reaches here too, and this is the answer where
                it matters most: an employer can hold a genuine fill record and
                still re-list the same role forty times, and the fill record is
                the reason a reader is about to trust it. The disqualification
                inside the RPC only removes employers whose takedowns are
                MOSTLY re-listings; one that fills plenty and churns plenty
                passes it and says nothing. */}
            <CompanyGrid rows={hiring} intent="hiring" warn={(r) => repostWarn(r.company_token, "hiring")} badge={(r) => {
              if (!r.tracking_days) return t("explore.openRoles", "{{n}} open roles", { n: (r.open_roles ?? 0).toLocaleString() });
              const core = t("explore.hiringBadge", "{{filled}} filled in {{d}}d tracked · {{open}} open now",
                { filled: r.closed_90d ?? 0, d: r.tracking_days, open: (r.open_roles ?? 0).toLocaleString() });
              const showClock = r.p50_days_open != null && (r.dated_n ?? 0) >= 10 && r.tracking_days >= 21;
              return showClock
                ? `${core} · ${t("explore.hiringSpeed", "half came down within {{d}}d", { d: Math.round(r.p50_days_open as number) })}`
                : core;
            }} />
          </Section>
        )}
        </div>

        <div hidden={active !== "pay"}>
        {transparent.length > 0 && (
          <Section icon={BadgeDollarSign} note={NOTE.pay} title={t("explore.transparentTitle", "Transparent about pay")} blurb={t("explore.transparentBlurb", "Companies stating pay on at least 80% of their open roles — counted from their own posting text and ATS fields. A badge no one can buy: the only way in is to actually state pay.")}>
            {/* No salaryFloor on this link. "States pay" and "pays at least
                $X" are different populations, and salary_min_annual is
                annualised in the posting's own currency and never converted —
                a floor filter would quietly mean different things per row. */}
            <CompanyGrid rows={transparent} intent="pay" warn={(r) => repostWarn(r.company_token, "pay")} badge={(r) => {
              const parts = [t("explore.transparentBadge", "{{pct}}% of {{n}} roles state pay", { pct: r.pay_pct ?? 0, n: r.open_roles ?? 0 })];
              // A MEDIAN NEEDS A SAMPLE. The SQL computes this over whichever
              // of the employer's roles state USD pay, with no floor — so one
              // USD posting was enough to publish "median floor $X" beside a
              // company whose other 300 roles say nothing. The row carries no
              // usd_n, so the honest available gate is the employer's own
              // served-role count: below 20 the median is omitted rather than
              // shown with invisible uncertainty. Omission is the correct
              // degradation; a number with no sample behind it is not.
              if (r.median_usd_floor != null && (r.open_roles ?? 0) >= 20) {
                parts.push(t("explore.transparentMedian", "median floor ${{m}}", { m: Math.round(r.median_usd_floor).toLocaleString() }));
              }
              return parts.join(" · ");
            }} />
          </Section>
        )}
        </div>

        <div hidden={active !== "ghost"}>
        {reposters.length > 0 && (
          <Section icon={Repeat} note={NOTE.ghost} title={t("explore.repostTitle", "Serial re-posters")} blurb={t("explore.repostBlurb", "Companies that take roles down and re-list them again and again — measured from our own lifecycle tracking. Re-listing resets the posted date, so an opening can look brand-new long after it first appeared.")}>
            <CompanyGrid rows={reposters} intent="ghost" tone="warning" badge={(r) => {
              // A re-list count far above the tracking window is a data artifact
              // (bulk feed churn re-stamping ids), not something a reader should
              // take literally — audit 2026-07-26 measured "289× in 8d". Cap the
              // stated count at one re-list per tracked day and mark it as a
              // floor rather than printing an impossible number.
              const days = Math.max(1, r.tracking_days ?? 0);
              const raw = r.worst_count ?? 0;
              const capped = Math.min(raw, days);
              const core = t(capped < raw ? "explore.repostBadgeCapped" : "explore.repostBadge",
                capped < raw
                  ? "“{{title}}” re-listed {{n}}+× · {{events}} total in {{d}}d"
                  : "“{{title}}” re-listed {{n}}× · {{events}} total in {{d}}d",
                { title: (r.worst_title ?? "").slice(0, 34), n: capped, events: r.repost_events ?? 0, d: r.tracking_days ?? 0 });
              // ACROSS HOW MANY ROLES — the number that turns a count into a
              // diagnosis. 581 re-lists across 3 roles is one job advertised
              // forever; 769 across 298 is a big employer with ordinary churn.
              // Read as one number those look identical and the second company
              // is unfairly damned. reposted_roles is already in the cached
              // payload, so this costs nothing.
              //
              // Appended as its own key rather than reworded into the existing
              // badge: a locale VALUE overrides the inline default, and all
              // nine locales already carry the current sentence. Editing it
              // here would leave nine translations rendering the old string.
              return r.reposted_roles
                ? `${core} · ${t("explore.repostAcross", "across {{roles}} roles", { roles: r.reposted_roles })}`
                : core;
            }} />
          </Section>
        )}
        </div>

        {/* "Just added to the board" was here. Removed: same uncorrected
            snapshot counts as trending, and its "get in early" promise rested
            on first_added — the date WE discovered the board, not the date the
            roles went up. */}

        <div hidden={active !== "scale"}>
        {segments && orderedBands(segments).length > 0 && (
          <Section icon={Building2} title={t("explore.segTitle", "By how much they're hiring")} blurb={t("explore.segBlurb", "Banded by how many roles each company currently has open on our board — not by company size. A company with a thousand openings might be an employer of a hundred thousand, or a smaller one hiring hard.")}>
            {/* EVERY BAND'S AGGREGATE STAYS; ONLY ONE BAND'S CARDS RENDER.
                The four stat lines were already the most carefully-built
                sentences on this page, so they become the selector rather than
                headers over four stacked grids. 36 of 48 cards leave the
                viewport and nothing measured is lost. */}
            <div className="space-y-2">
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
                const open = activeBand === band;
                return (
                  <div key={band} className={`rounded-xl border transition-colors ${open ? "border-primary/40 bg-card/40" : "border-border"}`}>
                    <button
                      type="button"
                      onClick={() => setBand(open ? null : band)}
                      aria-expanded={open}
                      className="w-full text-left px-4 py-3"
                    >
                    <h3 className="text-sm font-bold text-foreground mb-1">{label}</h3>
                    <p className="text-[11px] text-muted-foreground">
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
                    </button>
                    {/* Two-number badge: our verified count and the company's own
                        advertised total when it exceeds it — the band label and
                        badge can never contradict each other. (Fallback fields
                        cover a frontend-before-migration deploy window.) */}
                    {(() => {
                      const segBadge = (r: CompanyRow) => {
                        const onBoard = r.on_board ?? r.open_roles ?? 0;
                        const total = r.company_total ?? r.feed_total ?? 0;
                        // BOTH numbers grouped. This read "3842 on our board ·
                        // 12,000 company-wide" — one raw, one grouped, in one
                        // sentence — because only `total` had .toLocaleString().
                        return total > onBoard
                          ? t("explore.segOpenBoth", "{{n}} on our board · {{total}} company-wide", { n: onBoard.toLocaleString(), total: total.toLocaleString() })
                          : t("explore.segOpen", "{{n}} open roles", { n: onBoard.toLocaleString() });
                        // THE EMPLOYEES AND YC-BATCH CHIPS ARE GONE, because
                        // they could never render. get_size_segments' `top`
                        // object emits exactly four keys — company,
                        // company_token, on_board, company_total
                        // (20260727212029:105-108). The 2026-07-27 rewrite
                        // dropped the company_profiles join and with it
                        // employees / employee_basis / yc_batch; the frontend
                        // was never updated, so `r.employees != null` and
                        // `r.yc_batch` have been dead since that day and
                        // ycAbbrev never executed once.
                        //
                        // This is the third field of the same rewrite to be
                        // caught: the comment above already records removing
                        // `with_headcount` for exactly this reason. One of
                        // three was removed and two were left, which is why the
                        // rule is now a test rather than a code comment.
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
                      return open ? (
                        <div className="px-4 pb-4">
                          <CompanyGrid rows={s.top} intent="scale" warn={(r) => repostWarn(r.company_token, "scale")} badge={segBadge} />
                        </div>
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        </div>

        <div hidden={active !== "entry"}>
        {entry.length > 0 && (
          <Section icon={GraduationCap} note={NOTE.entry} title={t("explore.entryTitle", "Entry-level friendly")} blurb={t("explore.entryBlurb", "Companies with the most roles open to people early in their careers.")}>
            {/* THE RATIO, NOT THE COUNT — and a link that carries the filter.
                This badge said "38 entry-level roles" and opened the company's
                whole board showing 900, so the number a reader clicked was not
                the number they landed on. Both figures are already in the
                payload, and the ratio is the actual signal: 40 entry roles out
                of 2,000 is not an entry-friendly employer, while 40 out of 60
                is. The link now carries ?experience=entry, which Jobs.tsx
                reads, so the destination shows what the card counted.

                New key, not a reworded one: all nine locales carry
                explore.entryBadge with a single {{n}}, and a locale value beats
                the inline default — editing in place would render the old
                sentence with a hole in it in nine languages. */}
            <CompanyGrid rows={entry} intent="entry" warn={(r) => repostWarn(r.company_token, "entry")} badge={(r) => (r.open_roles
              ? t("explore.entryBadgeRatio", "{{entry}} of {{open}} roles are entry-level", { entry: (r.entry_roles ?? 0).toLocaleString(), open: r.open_roles.toLocaleString() })
              : t("explore.entryBadge", "{{n}} entry-level roles", { n: r.entry_roles ?? 0 }))} />
          </Section>
        )}
        </div>

        {/* Folded into the pay answer. "Which employers state pay" and "which
            fields pay" are one question, and rendering them as two sections
            twenty screens apart made a reader choose between halves of the same
            answer. Everything between this and the transparent block is hidden
            whenever `pay` is active, so the two render adjacent without moving
            the code.

            No currency control here, deliberately: get_salary_benchmarks does
            DISTINCT ON (category), so each field appears exactly once in its
            dominant currency, and all 18 live rows are USD. A USD/EUR/GBP
            toggle would be a control with one real option — the dead-branch
            class this page has spent the week removing. */}
        <div hidden={active !== "pay"}>
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

        </div>

        {/* Browse by field — the classic taxonomy entry point, now its own
            answer rather than a footer.

            THE CHIPS NOW CARRY COUNTS. The note here used to read "a correct
            per-category number is a database change, and it is worth doing and
            not worth faking meanwhile" — get_explore_denominators is that
            change, and it counts under the SERVING predicates only
            (missing_since IS NULL, effective_posted within 30 days), which is
            exactly what job-board/index.ts:5529-5539 applies and nothing more.
            The chip's number and the page it opens count the same rows.

            Formatted through SERVE_COUNT_CAP, because the serving API stops
            counting at 10,000: an uncapped "38,412" here would open a page
            reading "10,000+". Same number, same presentation, both runtimes.

            Ordered biggest-first when counts are in hand — the point of a
            count on a browse control is to show where the board is deep — and
            falling back to the declared order when they are not, so a cache
            row written before this migration renders exactly today's page. */}
        <div hidden={active !== "fields"}>
        <Section icon={Briefcase} note={NOTE.fields} title={t("explore.fieldsTitle", "Browse by field")} blurb={t("explore.fieldsBlurb", "Jump straight into any field's live openings.")}>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CATEGORY_LABELS)
              .filter(([id]) => id !== "other")
              .sort((a, b) => (fields[b[0]] ?? 0) - (fields[a[0]] ?? 0))
              .map(([id, label]) => {
                const n = fields[id];
                return (
                  <Link
                    key={id}
                    to={`/jobs/field/${id}?from=explore`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-border bg-card/60 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
                  >
                    {t(`jobsPage.categories.${id}`, label)}
                    {/* A field below the 50-posting floor is absent from the
                        payload entirely and renders as a bare chip — the link
                        still works, it simply makes no claim about depth. A
                        thin field must not render "0". */}
                    {typeof n === "number" && n > 0 && (
                      <span className="text-[11px] tabular-nums text-muted-foreground/70">{fieldCount(n, i18n.language)}</span>
                    )}
                  </Link>
                );
              })}
          </div>
        </Section>

        </div>

        {/* The bottom CTA card is gone. "Know what you're looking for?" was the
            last thing a visitor read on a discovery page — an odd note to end
            on — and it sat forty screens below the fold where the people who
            did know what they wanted had long since left. The same escape now
            rides beside the chips, where it is reachable in one tap. */}
      </main>
      <Footer />
    </div>
  );
}
