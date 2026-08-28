// Live job board. Postings come from each company's OFFICIAL public
// job-board feed (Greenhouse / Lever / Ashby) via the job-board edge
// function — never scraped. Two honest actions per posting: scan your
// resume against it (JD handoff → the home scanner), or apply on the
// company's own site. We never fake an in-house "apply".

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
// The same structured salary parser the edge uses (pure TS, no Deno deps) —
// the detail panel parses the posting's stated pay client-side to compare it
// against the field's live benchmark in the SAME currency, never across.
import { parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";
// THE SAME PREDICATE THE NIGHTLY RUNNER RANKS BY, not a second copy of it.
// `SENDABLE_VENDORS` is already a hand-maintained mirror of the worker's
// adapters (kept honest by sendable-mirror.test.ts); a third copy in the app
// bundle would be a third thing to forget. Pure TS with no Deno imports, the
// same reason the salary parser above is imported straight out of _shared.
import { isSendableVendor } from "../../supabase/functions/_shared/apply-automation";
// Two statements from one module, deliberately: ats-coverage-counts.test.tsx
// pins the BOARD_SOURCE_LIST import line by spelling, and the vendor filter
// below needs the tiered list the same file exports.
import { ATS_VENDORS, NON_ATS_SOURCES } from "@/config/ats-vendors";
import { BOARD_SOURCE_LIST } from "@/config/ats-vendors";
import { MultiSelectFilter } from "@/components/board/MultiSelectFilter";
import { markDeadForRobots, clearDeadForRobots } from "@/lib/seo-robots";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAgentReach, reachPct } from "@/hooks/use-agent-reach";
import { useTranslation } from "react-i18next";
import { Activity, AlertTriangle, Bell, Bookmark, BookmarkCheck, Briefcase, ChevronDown, Clock, Compass, Copy, ExternalLink, FileText, Flag, Link2, Loader2, MapPin, MessageSquare, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Target, Upload, Info} from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ApplicationAnswers, REAL_QUESTION_PREFIXES } from "@/components/apply/ApplicationAnswers";
import { useProSubscription } from "@/hooks/use-pro-subscription";
import { CompanyClaim } from "@/components/jobs/CompanyClaim";
import { CompanyIntelPanel } from "@/components/jobs/CompanyIntelPanel";
import { PublicCompanyCard } from "@/components/jobs/PublicCompanyCard";
import { DeclaredWagesCard } from "@/components/jobs/DeclaredWagesCard";
import { EmployerContext } from "@/components/jobs/EmployerContext";
import { SavedSearchPills } from "@/components/jobs/SavedSearchPills";
import { getEmployerCtx, type EmployerCtx } from "@/lib/employer-context";
import { SimilarCompanies } from "@/components/jobs/SimilarCompanies";
import { TailoredResumeModal, type TailoredResumeContent } from "@/components/TailoredResumeModal";
import { supabase } from "@/integrations/supabase/client";
import { postTrackEvent, getVisitorId } from "@/lib/track-transport";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { searchName, searchToQuery } from "@/lib/job-search-params";
import { companyDisplayName, cleanJobTitle, decodeNameEntities } from "@/lib/company-display";
import { displaySalary } from "@/lib/salary-display";
import { adjacentRoles } from "@/lib/role-adjacency";
import { accentFor } from "@/lib/category-accent";
import { JobsCommandPalette, ShortcutsOverlay, useGlobalPaletteKeys, type PaletteAction } from "@/components/JobsCommandPalette";
import { isBoardCategory } from "@/lib/job-board-categories";

// user_applications gained board columns after the last typegen — untyped
// access until Lovable regenerates types.ts.
const appsTable = () => (supabase as unknown as { from: (t: string) => any }).from("user_applications");
const searchesTable = () => (supabase as unknown as { from: (t: string) => any }).from("user_job_searches");

/**
 * A CAP IS NOT A COUNT.
 *
 * `failedSources` is a SAMPLE: the refresh loop keeps `.slice(-120)` of the
 * failures it has seen, so the array length saturates at 120 and stops moving
 * while the real number keeps climbing. Measured 2026-08-25: the board rendered
 * exactly 120 on every poll for 45 minutes, then 112 once a pass landed — the
 * reader could not tell the ceiling from the census. The refresh loop publishes
 * the uncapped total separately as `failedCount` (job-board/index.ts writes it
 * into job_board_meta and the `status` action returns it — live status read 23
 * while the list's sample read 112 on the same minute), so prefer it whenever
 * it is present.
 *
 * When only the capped sample is available — every list exit today omits
 * failedCount — the honest render is "at least N", never a bare N: N is a floor
 * we can defend, and the sentence says so.
 *
 * Returns null when there is nothing to report, so the caller renders nothing
 * rather than "0 company feeds are unreachable".
 */
export function unreachableFeeds(
  failedCount: number | undefined,
  sampleLength: number,
): { count: number; exact: boolean } | null {
  if (typeof failedCount === "number" && Number.isFinite(failedCount) && failedCount >= 0) {
    return failedCount > 0 ? { count: failedCount, exact: true } : null;
  }
  return sampleLength > 0 ? { count: sampleLength, exact: false } : null;
}

/**
 * THE DETAIL "ROUTE" IS A QUERY PARAM, NOT A PATH SEGMENT.
 *
 * App.tsx routes exactly three board paths — /jobs, /jobs/field/:category and
 * /jobs/company/:companyToken — so a POSTING is addressed as /jobs?job=<id>.
 * That is the shape the sitemap emits (job-board/index.ts), the shape the
 * canonical link takes while a panel is open, and the `url` in the JobPosting
 * JSON-LD. Every job-title anchor must use this one, or the crawlable href and
 * the indexed URL disagree and the deep link is worthless.
 */
export function jobDetailHref(id: string): string {
  return `/jobs?job=${encodeURIComponent(id)}`;
}

/**
 * A modified click on a link is the user asking the BROWSER for it: cmd/ctrl
 * for a new tab, shift for a new window, alt to download, middle button for a
 * background tab. preventDefault-ing those is what makes an <a> feel like a
 * counterfeit link — the href exists for crawlers but "open in new tab" does
 * nothing. The plain left click still belongs to the detail panel.
 */
export function opensInNewContext(e: {
  metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number;
}): boolean {
  return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) || (e.button ?? 0) !== 0;
}

/**
 * THE SKIP LINK IS DEAD ON ARRIVAL, AND THE PRESS IS NOT RECOVERABLE LATER.
 *
 * index.html ships `<a href="#main-content">` as the first focusable element of
 * every page, but the id is added by React: the prerendered shell emits a bare
 * `<main class="pt-10 pb-20">` (verified live 2026-08-25 — "main-content"
 * occurs exactly ONCE in the served /jobs HTML, in the link's own href), so for
 * the whole 1.0-2.7s hydration window the first key a keyboard user presses
 * moves nothing. The browser still writes the fragment to the URL, so the press
 * leaves a trace: when the page mounts and the target finally exists, honour it.
 *
 * The real repair is in the prerender shell (see the report on
 * scripts/prerender-seo.mjs) — this is the half that belongs to this page.
 */
export function honourPendingSkipLink(hash: string, doc: Document = document): boolean {
  if (hash !== "#main-content") return false;
  const el = doc.getElementById("main-content") as HTMLElement | null;
  if (!el) return false;
  el.focus();
  return doc.activeElement === el;
}

interface BoardJob {
  id: string;
  // SEARCH ATTRIBUTION, stamped per row rather than read off the response.
  // "Load more" accumulates jobs while `data` holds only the LATEST page, so a
  // single response-level id would attribute a click on a page-one row to
  // whatever search fetched page three. Carrying it on the row keeps a click
  // tied to the search that actually produced it.
  searchId?: string;
  // 1-based ABSOLUTE rank (offset + index + 1). Position on the page would make
  // page two's first result look like a first-place click.
  rank?: number;
  token?: string; // company_token — used to look up the company's open-role count
  company: string;
  title: string;
  location: string;
  remote: boolean;
  department: string | null;
  postedAt: string | null;
  applyUrl: string;
  salary?: string | null;
  /** Definitive employer-stated work mode; null = the posting doesn't say (no tag shown). */
  workMode?: "remote" | "hybrid" | "onsite" | null;
  /** ISO-2 country when the feed or location text states one (serveList sends it). */
  country?: string | null;
  salaryMinAnnual?: number | null;
  salaryMaxAnnual?: number | null;
  salaryPeriod?: string | null;
  salaryCurrency?: string | null;
  experienceBand?: string | null;
  minYears?: number | null;
  /** Board category slug (serveList returns it; drives detail-panel "similar openings"). */
  category?: string | null;
  /** Last re-verification against the company's own feed (serveList last_seen). */
  /** INSERT-time only; semantically first_seen. Never render as freshness. */
  lastSeen?: string | null;
  /** job_board_verifications.verified_at — when this board's feed was last read. */
  recheckedAt?: string | null;
  /** Set once the employer's feed stopped listing this posting. */
  missingSince?: string | null;
  /** >1 when the server folded the same role posted in several locations into
   *  this row. The siblings are real, separately-applyable postings — they are
   *  collapsed for readability, never dropped. */
  /** DISTINCT places this fold covers — no longer the sibling-row count,
   *  which it silently was: 2.4% of served cards claimed locations that do
   *  not exist, the worst a single-location Kyiv role posted 85 times and
   *  captioned "84 more locations". */
  locationCount?: number;
  /** How many requisitions folded into this card. */
  postingCount?: number;
  /** A few of the other locations this role is open in (server-capped). */
  otherLocations?: string[];
  /** Tier-2 ranked search only: ts_headline fragment showing where a description-matched result matched ([[term]] delimiters). */
  snippet?: string;
  /** True on rows the trigram tier APPENDED to a thin exact-match page — the
   *  card labels these "close match"; they are never passed off as exact. */
  closeMatch?: boolean;
  /** Appended by the vector tier on a thin page: about the same thing, not
   *  the same words. A weaker claim than closeMatch, so it is labelled
   *  differently rather than folded in with it. */
  semanticMatch?: boolean;
  /** Which segment this row came from — a title hit, or description-only. */
  matchScope?: "title" | "description";
}

// A company with several fresh, still-open roles is demonstrably hiring — the
// anti-ghost-job signal. Show the count at/above this bar; below it, the number
// isn't a meaningful "actively hiring" tell, so we stay quiet.
const HIRING_INTENT_MIN = 8;

// Per-company hiring-health, from get_company_hiring_health (lifecycle data).
interface HiringHealth {
  open_roles: number;
  /** The company's own advertised posting total at last fetch (Workday feeds).
      When it exceeds our stored rows the fetch was windowed and open_roles is a
      floor — display "N+". Absent until the feed_total migration + function
      redeploy have both landed. */
  feed_total?: number | null;
  /** Genuine-tenure fills in the tracked window (≤90d): non-superseded closures
   *  that stayed posted 7+ days before coming down. NOT raw closures — churn
   *  (BoxLunch: 3093 closures, zero real fills) never counts here. */
  closed_90d: number;
  /** Same-title relistings in the tracked window — repost churn (absent until the RPC ships it). */
  superseded_90d?: number;
  median_days_open: number | null;
  median_days_to_close: number | null;
  /** Days of closure-log observation behind the counts (capped at 90). */
  tracking_days: number;
}
// Genuine fills needed before we'll call a company "actively hiring" — enough
// that it's a real pattern, not one data point (same bar as Explore's list).
// Below it we show only neutral facts.
const ACTIVELY_HIRING_MIN_CLOSED = 3;
// Urgency chip: only when the fill pattern is both proven (>= the fills floor)
// and actually fast — a 25-day median is not "apply early".
const URGENT_FILL_MAX_DAYS = 14;
// Repost caution: relisting the same titles this often in the tracked window is a pattern.
const REPOST_FLAG_MIN = 3;

// Experience bands mirror EXPERIENCE_BANDS in the edge function's experience.ts.
// The year range is baked into each localized label (jobsPage.experience.*).
const EXPERIENCE_IDS = ["entry", "mid", "senior", "expert"] as const;

// ── STEPS FOR THE FOUR CONTROLS THAT WERE NARROWER THAN THEIR OWN API ────────
//
// Every list below is a CHOICE OF STEPS, not a limit: the server accepts more
// than the page has ever offered, so a searcher who wanted the value in between
// two chips could only get it by hand-editing the URL.
//
// maxYears asks the JOB-SEEKER'S question — "does not demand more than n years"
// (min_years <= n) — not the employer's. min_years is populated on 162,032 of
// 559,805 servable rows (28.9%), so it is disclosed like every other partly
// populated column. Steps thin out as they climb: the difference between 1 and 2
// years decides whether someone can apply at all; the difference between 15 and
// 16 decides nothing.
const MAX_YEARS_STEPS = [1, 2, 3, 5, 7, 10, 15, 20] as const;
// The pay BAND. The floor steps are the seven this select has always offered;
// the ceiling is their mirror plus a low rung, because a band is most useful at
// the bottom of the market ("nothing above $80k" is how someone screens out
// roles they are overqualified for and will not be called about).
const SALARY_FLOOR_STEPS = [40_000, 60_000, 80_000, 100_000, 120_000, 150_000, 200_000] as const;
const SALARY_CEILING_STEPS = [60_000, 80_000, 100_000, 120_000, 150_000, 200_000, 250_000, 300_000] as const;
// Vendor: `source` on every posting, 100% populated — the one new filter that
// hides nothing, which is why its coverage line reads 100% rather than being
// omitted. ONE LIST, the same one the apply-agent tiers and the "Sources:" note
// read; a second hand-typed vendor list is how a platform we dropped stays
// selectable.
//
// EIGHT, matching VENDOR_LIMIT in filters.ts exactly. That cap REPORTS a
// truncated list rather than slicing quietly, so a control that stopped at five
// would refuse three choices the server would have honoured — and a control
// that allowed nine would hand the visitor a filter the server then names as
// only partly applied.
const VENDOR_LIMIT = 8;
const VENDOR_OPTIONS = [...ATS_VENDORS, ...NON_ATS_SOURCES].map((v) => ({ value: v.key, label: v.label }));

/**
 * THE ONE PLACE THIS PAGE TURNS ITS FILTER STATE INTO A REQUEST.
 *
 * Five call sites used to build this body by hand — the list fetch, the
 * filtered-category facet, the zero-result rescue probe, the disclosure
 * denominator, and the saved search — and they had already drifted: the rescue
 * probe sent `remote: remoteOnly` where the list sends
 * `(remoteOnly && !workMode)`, so every "remove this filter → N openings"
 * button was counted against a query the page was not showing. The edge
 * function keeps one normalizeFilters for exactly this reason; the client had
 * none.
 *
 * Exported and pure so it can be CALLED in a test rather than grepped for. A
 * guard that greps this file passes while the code is dead, which has caught
 * this repo nine times.
 *
 * Keys are OMITTED, never sent as null: `Object.keys()` of the result is the
 * client's answer to "is this board filtered at all", the same mechanical
 * derivation isUnfiltered() does server-side, so a new filter counts the moment
 * it exists here.
 */
export type BoardFilterState = {
  q: string;
  location: string;
  remoteOnly: boolean;
  /** Comma-joined subset of remote|hybrid|onsite; "" = any. A LIST, so
   *  "remote or hybrid" is askable — see the toggles in the controls row. */
  workMode: string;
  category: string;
  inclUncat: boolean;
  agentOnly: boolean;
  country: string;
  /** Comma-joined bands, exactly as the URL carries them. */
  experience: string;
  companyTokens: string[];
  salaryFloor: number;
  salaryCeiling: number;
  payBasis: "" | "hourly" | "salaried";
  statedPayOnly: boolean;
  includeUnstatedPay: boolean;
  maxYears: number;
  department: string;
  /** Comma-joined `source` values. */
  vendor: string;
  /**
   * The freshness window in DAYS, as a string, "" = any date.
   *
   * A string because that is what the URL carries and what this page's other
   * multi-value filters (category, country, experience, vendor) already are —
   * one shape from the address bar to the request body, converted to a number
   * in exactly one place, the `maxAgeDays` line above.
   */
  freshness: string;
};

export function boardFilterBody(s: BoardFilterState): Record<string, unknown> {
  const {
    q, location, remoteOnly, workMode, category, inclUncat, agentOnly, country,
    experience, companyTokens, salaryFloor, salaryCeiling, payBasis, statedPayOnly, includeUnstatedPay,
    maxYears, department, vendor, freshness,
  } = s;
  const body: Record<string, unknown> = {
    q: q.trim() || undefined,
    location: location.trim() || undefined,
    // ONE definition of Remote, and it now lives in one place instead of four
    // literals. `remote:true` is a strict subset of work_mode='remote', so
    // sending both ANDs them and drops matches the visitor's own filter should
    // include — 7.6% on {workMode:remote,country:GB}. The legacy boolean serves
    // only the standalone toggle, the one case where no work mode was picked.
    remote: (remoteOnly && !workMode) || undefined,
    workMode: workMode || undefined,
    category: category || undefined,
    includeUncategorised: category && inclUncat ? true : undefined,
    // Literal true only, at every send site: a truthy STRING here narrows the
    // board to ~5% and the server takes `=== true`.
    sendableOnly: agentOnly ? true : undefined,
    country: country || undefined,
    experience: experience || undefined,
    companies: companyTokens.length ? companyTokens : undefined,
    salaryFloor: salaryFloor || undefined,
    // SENT EVEN WHEN IT CONTRADICTS THE FLOOR. A ceiling below the floor is
    // refused by normalizeFilters and named in ignoredFilters, which is how the
    // visitor finds out; dropping it here instead would leave them looking at a
    // band the board never applied with nothing on screen saying so.
    salaryCeiling: salaryCeiling || undefined,
    payBasis: payBasis || undefined,
    hasStatedPay: statedPayOnly ? true : undefined,
    includeUnstatedPay: includeUnstatedPay ? true : undefined,
    maxYears: maxYears || undefined,
    department: department.trim() || undefined,
    vendor: vendor || undefined,
    // Company-stated dates only, never our discovery time — "Today" must mean
    // the company posted it today.
    maxAgeDays: Number(freshness) || undefined,
  };
  // DELETED, not left undefined. Object.keys() of the result is this page's
  // answer to "is the board filtered at all" — the client-side twin of
  // isUnfiltered() — so an off filter must not leave a key behind.
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return body;
}

/**
 * Which filters are narrowing the board right now — derived MECHANICALLY from
 * the body above rather than re-listed by hand.
 *
 * `q` is excluded because it lives in the always-visible search box rather than
 * behind the mobile Filters button, and `includeUncategorised` because it
 * WIDENS. Everything else counts, including any filter added later, which is
 * the whole point: the number on that button was a hand-maintained list and
 * went stale three times.
 */
export function activeBoardFilterKeys(s: BoardFilterState): string[] {
  return Object.keys(boardFilterBody(s)).filter((k) => k !== "q" && k !== "includeUncategorised");
}

interface BoardResponse {
  jobs: BoardJob[];
  // Issued by the server per list response; echoed back on click so relevance
  // can be measured by position instead of guessed at.
  searchId?: string;
  // null when the exact count timed out server-side (broad freshness windows on
  // the 570k table trip the statement limit). Never render a number from this
  // without a typeof check — the server sends null rather than a wrong 0.
  /**
   * The EXACT segment: postings whose TITLE matches. Always the published
   * figure, and monotone — filters are conjuncts, so it can only shrink.
   */
  total: number | null;
  /**
   * The RELATED segment: postings that match only in the description.
   *
   * Optional-ABSENT on purpose. `undefined` means the server did not compute a
   * second segment for this request; `0` means it did and found none. Collapsing
   * those two into one number is how "no related matches" becomes
   * indistinguishable from "this build does not have segments", which is the
   * emitter-with-no-reader shape all over again.
   */
  relatedTotal?: number;
  relatedCapped?: boolean;
  countUnavailable?: boolean;
  /** Proven floor when the exact total is unknowable (fuzzy tier at its cap):
   *  "at least this many match". Render as "M+", never as a total. */
  totalAtLeast?: number;
  /** Curated suggestion when the query exactly matches other people's typos
   *  ("manger") or a term the board's stock doesn't use ("krankenschwester").
   *  Results are untouched; this renders as a one-click banner. */
  didYouMean?: string;
  // The count stopped at the server's cap: the true figure is higher, so render
  // it as "10,000+" rather than as an exact total.
  countCapped?: boolean;
  ignoredFilters?: string[];
  droppedTerms?: string[];
  // ── DISCLOSURES THE SERVER HAS ALWAYS SENT AND NOTHING READ ───────────────
  // Ten keys were spread across all seven list exits, guarded by tests that
  // assert the SERVER emits them, and rendered by nothing. The tests passed the
  // whole time. Same shape as the keyset cursor that was null on every response
  // for five days: confirmed present, doing nothing.
  /**
   * Fraction of the board (0-1) each ACTIVE filter can even see. A searcher who
   * sets a pay floor and gets twelve results cannot otherwise tell whether the
   * market is empty or whether they are looking at a fifth of it.
   *
   * ONE BLOCK, NOT TWO. This used to carry an older measurement (pay 13.2%,
   * work mode 29.6%, experience 40.8%) stacked above the current one, so the
   * field documented two different answers to the same question and only the
   * lower block attached as JSDoc. Superseded numbers are replaced here, not
   * appended.
   *
   * Measured on the servable board, 2026-08-25, over 559,805 rows: pay stated
   * 112,524 (20.1%), salary_period 59,505 (10.6%), min_years 162,032 (28.9%),
   * work_mode 157,584 (28.1%), department 226,631 (40.5%), experience_band
   * usable 241,198 (43.1% — 318,607 of the non-null values are "unspecified"
   * and match nothing).
   *
   * `vendor` IS here and IS rendered, at 100%: `source` is populated on every
   * row, and "all of it" is a real answer to "what can this filter see".
   * Omitting it would make the line's silence about vendor indistinguishable
   * from its silence about a filter nobody switched on.
   */
  filterCoverage?: {
    salaryFloor?: number; workMode?: number; experience?: number; country?: number;
    salaryCeiling?: number; payBasis?: number; hasStatedPay?: number; maxYears?: number;
    department?: number; vendor?: number;
  };
  /** Phrases lifted OUT of the query and applied as filters instead — typing
   *  "work from home nurse" searches "nurse" among remote roles. The rewrite is
   *  good; doing it silently is not. */
  intentFilters?: string[];
  /** Terms the searcher asked NOT to see, via "not X" or "-x". Disclosed so
   *  a filter they cannot see is not one they cannot undo. */
  excludedTerms?: string[];
  /** A pay-sorted page excludes every posting with no stated salary. */
  salaryStatedOnly?: boolean;
  /** The location typed, and the places actually searched on its behalf. */
  locationExpandedFrom?: string;
  locationSearched?: string[];
  /** A pay figure was read out of the query TEXT and applied as a floor. */
  salaryFromQuery?: number;
  /** The freshness window asked for was wider than the board retains. */
  maxAgeClampedTo?: number;
  /** A "new since" window counts the employer's stated date, not our crawl. */
  postedAfterUsesStatedDate?: boolean;
  /** The query matched an employer name; this is the name that matched. */
  companyMatched?: string;
  /** Exact whole-word tier answered, rather than the ranked scorer. */
  exactWordMatch?: string;
  /** The query's tail was read as a place and the search re-run as q+location
   *  ("nurse london" -> nurse IN London). The board changed what was asked, so
   *  it says so — and offers to make the split real. */
  locationSplit?: { q: string; location: string };
  // Server-computed "a full page came back", so pagination survives a missing total.
  hasMore?: boolean;
  // Raw rows the server consumed for this page. Once same-role-different-location
  // clusters are folded, displayed rows no longer equal rows read, so paging by
  // jobs.length would re-show a collapsed result's siblings as new hits.
  nextOffset?: number;
  nextCursor?: { ep: string; id: string } | null;
  totalAllCompanies: number;
  /** The corpus INCLUDING closed postings. Optional: absent until the count
   *  has been taken, and never defaulted to totalAllCompanies — equating the
   *  two would assert something false about what is searchable. */
  trackedTotal?: number;
  // Untrimmed company count — the served `companies` array is capped (top-N by
  // count) for payload weight, so stat displays must use this, not .length.
  companiesCount?: number;
  companies: Array<{ token: string; name: string; count: number }>;
  categories?: Record<string, number>;
  // OPTIONAL ON PURPOSE, and it is not a style choice. Declared as
  // `string[]` this read `data.failedSources.length` with no guard and
  // TypeScript was satisfied — while the SALARY exit did not send the field at
  // all, so every pay-sorted keyword search threw and the whole page fell into
  // the error boundary (live on production until 2026-08-22). A response field
  // is only non-optional if EVERY server exit emits it, and nothing checks that
  // across the runtime boundary. Optional makes the compiler ask for the guard.
  failedSources?: string[];
  /** The UNCAPPED number of failing feeds, beside the capped sample above.
   *  Optional for the same reason as failedSources and then some: today NO
   *  list exit sends it (only `status` does), so the page must be able to say
   *  "at least N" from the sample alone. See unreachableFeeds(). */
  failedCount?: number;
  refreshedAt: string | null;
  /** Ranked path: role-alias phrases the server also searched (disclosed in the UI). */
  aliases?: string[];
  /** Typo fallback: the original query these are the CLOSEST (not exact) matches for. */
  fuzzy?: string;
  /** Set when results came from the SEMANTIC tier (nearest-by-meaning after
   *  every keyword tier found nothing). The UI must disclose it — these are
   *  related roles, never presented as exact matches. */
  semantic?: string;
  /** Ranked path served the page ordered by relevance. When absent on a typed
   *  search, the recency fallback answered — the sort line must not claim
   *  relevance ordering it didn't do. */
  ranked?: boolean;
  /** Set ONLY when a semantic retrieval FAILED — deadline, or the RPC errored —
   *  rather than looked and declined. "Nothing matched" leaves this absent, so
   *  its presence always means the search was not as complete as it looks and
   *  the page must not claim otherwise. */
  semanticDegraded?: string;
  /** Set when close-match rows were APPENDED to a thin exact page (the rows
   *  themselves carry closeMatch: true). Disclosed above the list. */
  fuzzyExtra?: { q: string; count: number };
}

// Mirrors JOB_CATEGORIES in the edge function — the filterable fields.
const CATEGORY_IDS = [
  "engineering", "data_ai", "design", "product", "marketing", "sales",
  "customer", "finance", "legal", "people_hr", "operations", "healthcare",
  "science", "education", "hospitality_retail", "security", "admin", "other",
] as const;

const PAGE = 60;

// Fallback company display name from a token, used only until the real name loads
// (e.g. "public-storage" → "Public Storage").
function prettyToken(token: string): string {
  return token.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// Localized country display names from the browser's own Intl data — no
// translation keys to maintain, falls back to the raw code if unknown.
function countryLabel(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}


function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

// Human re-verification age for the detail panel ("re-checked 43m ago").
// Coarse buckets — the point is trust, not a stopwatch.
function agoLabel(iso: string, t: (k: string, d: string, o?: Record<string, unknown>) => string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return t("jobsPage.agoJustNow", "just now");
  const min = Math.floor(ms / 60_000);
  if (min < 2) return t("jobsPage.agoJustNow", "just now");
  if (min < 60) return t("jobsPage.agoMinutes", "{{count}}m ago", { count: min });
  const h = Math.floor(min / 60);
  if (h < 48) return t("jobsPage.agoHours", "{{count}}h ago", { count: h });
  return t("jobsPage.agoDays", "{{count}}d ago", { count: Math.floor(h / 24) });
}

// Stored descriptions occasionally carry residual HTML entities the ingest
// text-extraction missed (&#xa0; was rendering literally in the panel) —
// decode the common ones at display time so every stored row is fixed at
// once, no re-ingest needed.
const decodeEntities = (s: string) =>
  s
    .replace(/&#x?[0-9a-f]+;/gi, (m) => {
      try {
        const hex = m[2]?.toLowerCase() === "x";
        const code = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
      } catch { return " "; }
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

// Rows are normalized ONCE as they land in state, so every render site (cards,
// panel, JSON-LD, kits) inherits the same fixes: residual HTML entities in
// titles/company names, and the duplicated-leading-phrase title artifact some
// ATS exports produce ("Registered Nurse Registered Nurse RN"). Pure display
// hygiene — nothing is invented, only vendor escaping/concatenation undone.
const normalizeRow = <T extends { title: string; company: string | null }>(j: T): T => {
  const title = cleanJobTitle(j.title);
  const company = j.company ? decodeNameEntities(j.company) : j.company;
  return title === j.title && company === j.company ? j : { ...j, title, company };
};

// Company-initial avatar: an honest visual anchor per card. We don't store
// company domains, so real logos aren't possible without guessing — a
// deterministic colored monogram scans just as fast and never shows the
// wrong company's logo.
const AVATAR_HUES = [212, 262, 330, 24, 160, 96, 45, 288] as const;
const avatarHue = (s: string) => AVATAR_HUES[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_HUES.length];

// The served employer facet is a HEAD (top 150) — the tail arrives from
// action:company-suggest. Local matches render instantly while the request is
// in flight, then merge with the server's, deduped by token. Local first so
// the list never reorders under the reader's cursor mid-type.
function mergeCompanyOptions(
  head: Array<{ token: string; name: string; count: number }>,
  remote: Array<{ token: string; name: string; count: number }>,
  query: string,
): Array<{ token: string; name: string; count: number }> {
  const q = query.toLowerCase();
  const out: Array<{ token: string; name: string; count: number }> = [];
  const seen = new Set<string>();
  for (const c of head) {
    if (!c?.name || !c.name.toLowerCase().includes(q) || seen.has(c.token)) continue;
    seen.add(c.token); out.push(c);
  }
  for (const c of remote) {
    if (!c?.name || seen.has(c.token)) continue;
    seen.add(c.token); out.push(c);
  }
  return out.slice(0, 12);
}


/**
 * WORK MODE IS A LIST, and these three keep every site agreeing on what that means.
 *
 * It was a single value all the way down — one string here, `.eq("work_mode", …)`
 * in the query builder, `p.work_mode = quote_literal(…)` in all three SQL
 * functions — so "remote or hybrid" could not be asked. Measured 2026-08-27: GB
 * has 1,476 remote and 3,765 hybrid, so the either-question is 5,241 postings
 * against the 1,476 a searcher could reach.
 *
 * Comma-joined rather than an array so the wire shape, the RPC parameter and the
 * saved-search rows all stay `text` — an unchanged p_work_mode signature is what
 * keeps a PGRST203 overload off the table.
 *
 * Canonical order, always, so two selections that mean the same thing produce
 * the same string: saved searches compare equal and the cache key does not
 * split "remote,hybrid" from "hybrid,remote".
 */
export const WORK_MODE_KEYS = ["remote", "hybrid", "onsite"] as const;
export type WorkModeKey = typeof WORK_MODE_KEYS[number];

const splitModes = (v: string): WorkModeKey[] =>
  WORK_MODE_KEYS.filter((k) => v.split(",").map((x) => x.trim()).includes(k));
const normalizeModes = (v: string): string => splitModes(v).join(",");
const hasMode = (v: string, m: WorkModeKey): boolean => splitModes(v).includes(m);
const withoutMode = (v: string, m: WorkModeKey): string =>
  splitModes(v).filter((x) => x !== m).join(",");
const toggleMode = (v: string, m: WorkModeKey): string =>
  hasMode(v, m) ? withoutMode(v, m) : normalizeModes(v ? `${v},${m}` : m);

export default function Jobs() {
  const { t } = useTranslation();
  // How far the agent actually reaches, from the DEPLOYED bundle rather than a
  // literal in this one. Shared with AgentReachNote so the two cannot disagree.
  const agentReach = useAgentReach();
  const navigate = useNavigate();
  // Pro state for the board's honest upgrade moments (milestone toasts etc.).
  // `pro.active` false-while-loading errs toward showing free users the
  // pitch, never toward pitching a paying user.
  const { pro: proSub } = useProSubscription();
  const isPro = proSub.active;
  // Deep-linkable filters: /jobs?q=nurse&category=healthcare&remote=1&company=oscar
  const initial = new URLSearchParams(window.location.search);
  const [q, setQ] = useState(initial.get("q") ?? "");
  const [location, setLocation] = useState(initial.get("location") ?? "");
  const [remoteOnly, setRemoteOnly] = useState(initial.get("remote") === "1");
  // Definitive work-mode filter (remote/hybrid/onsite; "" = any). The legacy
  // remote=1 URL param maps to "remote" so old links keep working.
  const [workMode, setWorkMode] = useState<string>(() => {
    // Accepts a list now. Old single-value links ("?mode=remote") and the legacy
    // "?remote=1" both still resolve to exactly what they always did.
    const m = (initial.get("mode") ?? "").split(",")
      .map((x) => x.trim()).filter((x) => WORK_MODE_KEYS.includes(x as WorkModeKey));
    if (m.length) return [...new Set(m)].join(",");
    return initial.get("remote") === "1" ? "remote" : "";
  });
  const { category: pathCategory, companyToken } = useParams<{ category?: string; companyToken?: string }>();
  const routeCategory = isBoardCategory(pathCategory) ? pathCategory : undefined;
  // /jobs/company/:token — the board scoped to one employer's verified openings.
  const routeCompany = companyToken || undefined;
  const [company, setCompany] = useState(initial.get("company") ?? routeCompany ?? "");
  // `company` may now carry a COMMA-SEPARATED list, so Explore can hand over a
  // whole collection ("the twelve employers that actually fill roles") rather
  // than one employer at a time. The server has always accepted an array —
  // filters.ts slices it to companyTokenLimit and names "companies" in
  // `ignored` if it drops any — but the client only ever sent one, so this was
  // a client-side limit wearing the costume of a server contract.
  //
  // Verified against production before shipping: four tokens returned 5,491
  // rows with ignored=None and results from several employers; one token
  // returned 756.
  //
  // Capped at 12, the size of an Explore collection, so a hand-edited URL
  // cannot turn a cheap query into an expensive one.
  const companyTokens = useMemo(
    () => company.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12),
    [company],
  );
  /**
   * ADD an employer to the scope, or take one back out.
   *
   * The state shape has carried a list since Explore needed to hand over a
   * collection, and the server has taken an array since long before that — the
   * one thing that still could not express it was the control a person uses.
   * Picking a second employer REPLACED the first, silently, so "show me
   * openings at these three" was reachable from a hand-written URL and from
   * nowhere on the site.
   *
   * Capped at the same 12 as companyTokens, so the typeahead cannot build a
   * scope the parser then truncates behind the visitor's back.
   */
  const toggleCompanyToken = useCallback((token: string) => {
    setCompany((prev) => {
      const tokens = prev.split(",").map((x) => x.trim()).filter(Boolean);
      if (tokens.includes(token)) return tokens.filter((x) => x !== token).join(",");
      if (tokens.length >= 12) return prev;
      return [...tokens, token].join(",");
    });
  }, []);
  const [category, setCategory] = useState(initial.get("category") ?? routeCategory ?? "");
  // ALSO SEARCH THE UNCATEGORISED BUCKET. `other` held 162,800 of 590,808
  // postings on 2026-08-05 — where a posting lands when its field could not be
  // read from the title — so choosing a field silently costs a quarter of the
  // board. Off by default, and never set on a /jobs/field/:slug lander: a page
  // titled "Engineering jobs" must not list postings whose field is unknown.
  const [inclUncat, setInclUncat] = useState(initial.get("inclUncat") === "1");
  // ONLY JOBS THE AGENT CAN APPLY TO — the filter form of the Sparkles badge.
  // 31,552 of 588,607 postings (5.4%, 2026-08-07) across the four drivable
  // vendors. A FILTER, deliberately not a sort: ranking by sendability is the
  // .order("category") timeout with a different column. Off by default; the
  // server derives the vendor list from the same SENDABLE_VENDORS mirror the
  // badge reads, so the chip and the filter cannot disagree.
  const [agentOnly, setAgentOnly] = useState(initial.get("agentOnly") === "1");
  // Lander identity tracks the LIVE filter, not the route param. The URL-sync
  // effect rewrites the address with history.replaceState, which React Router
  // does not observe — so useParams keeps returning the lander token forever.
  // Keying the H1, the "Yes — N verified open roles" answer, the count line
  // and the employer intel panels off the raw param meant that clearing the
  // company chip left "Open roles at Foo" rendered over the whole 573k board,
  // with the board-wide total presented as Foo's (bug sweep 2026-07-26).
  const landerCompany = routeCompany && company === routeCompany ? routeCompany : undefined;
  const landerCategory = routeCategory && category === routeCategory ? routeCategory : undefined;
  // Arrived from the Explore page? Captured once on mount (the URL-sync effect
  // strips unknown params), so we can offer a "Back to Explore" link instead
  // of leaving the user on a filtered board with no way back.
  const [cameFromExplore] = useState(() => initial.get("from") === "explore");
  // MULTI-SELECT, comma-joined, exactly like category and country. The server
  // has always taken a list here — filters.ts `asBands` accepts both an array
  // and a comma string, and names any member it could not use — while this
  // page sent one value, so "senior OR expert" was reachable from the API and
  // from nowhere on the site. Explore's ?experience=entry links are a
  // one-element list and keep working unchanged.
  const [experience, setExperience] = useState(initial.get("experience") ?? "");
  // "Does not demand more than n years" — min_years <= n. 0 = off.
  const [maxYears, setMaxYears] = useState<number>(() => {
    const n = Number(initial.get("maxYears"));
    return Number.isFinite(n) && n >= 1 && n <= 20 ? Math.floor(n) : 0;
  });
  // The employer's OWN team label, matched as a substring (ILIKE '%s%').
  // Sampled live 2026-08-25 across three queries: 79 of 120 rows carried one,
  // and they are as written by the employer — "Engineering", "Nursing",
  // "Sales", but also "680 - Engineering - CoreSuite Platform" and "Sycamore
  // Senior Living (SCL) - 6032". A substring box is the only control shape
  // that fits text like that, which is why this is not a dropdown. Today the
  // only way to reach it is to type into `q`, where it silently ORs with the
  // title and the company name.
  const [department, setDepartment] = useState(initial.get("department") ?? "");
  // hourly | salaried, from salary_period. A SCALPEL: 10.6% of the board states
  // a period at all, and rows with none are excluded while it is set, exactly
  // as workMode already excludes them.
  const [payBasis, setPayBasis] = useState<"" | "hourly" | "salaried">(() => {
    const v = initial.get("payBasis");
    return v === "hourly" || v === "salaried" ? v : "";
  });
  // "Only postings that state pay." Anyone who sets a salary floor is ALREADY
  // narrowed to this 20.1% and is never told; making it a control of its own is
  // the honest half of the same fact.
  const [statedPayOnly, setStatedPayOnly] = useState(initial.get("statedPay") === "1");
  const [includeUnstatedPay, setIncludeUnstatedPay] = useState(initial.get("inclUnstatedPay") === "1");
  const [industriesOpen, setIndustriesOpen] = useState(false);
  // Which ATS the posting came from. `source` is populated on every row, so
  // this is the only new filter that hides nothing. Until now the sole vendor
  // control was the agent-can-apply boolean, which pins the board to 5.4%.
  const [vendor, setVendor] = useState(() => {
    const known = new Set(VENDOR_OPTIONS.map((v) => v.value));
    return (initial.get("vendor") ?? "").split(",").map((v) => v.trim().toLowerCase())
      .filter((v) => known.has(v)).slice(0, VENDOR_LIMIT).join(",");
  });
  // Country: exact match on the deterministically extracted code. Postings
  // whose location can't be placed are excluded while active — disclosed, not
  // guessed. Facet counts come from get_country_facet at mount.
  const [country, setCountry] = useState(() => {
    // A LIST, because the URL already WRITES one. The picker produces
    // "?country=US,GB" and the chip reads "2 countries", but this reader
    // required exactly two letters — so "US,GB" failed the test and reset to ""
    // on every reload and on every shared link. The filter silently disappeared
    // for the one case a person is most likely to share.
    const parts = (initial.get("country") ?? "")
      .toUpperCase().split(",").map((c) => c.trim())
      .filter((c) => /^[A-Z]{2}$/.test(c));
    // FIVE, matching filters.ts's COUNTRY_LIMIT exactly. A UI that accepts more
    // than the server binds would show a filter chip for a country the board
    // silently drops — two spellings of one limit is how the screen and the
    // result set start disagreeing.
    return [...new Set(parts)].slice(0, 5).join(",");
  });
  const [countryFacet, setCountryFacet] = useState<Array<{ country: string; n: number }>>([]);

  // FILTER-AWARE CATEGORY COUNTS.
  //
  // The dropdown renders board-wide counts when nothing is filtered, and the
  // server correctly suppresses them the moment a filter is applied — a
  // board-wide "Design (4,320)" under a United States filter would be a global
  // number wearing a filtered label. The result today is no counts at exactly
  // the moment they matter most: while narrowing.
  //
  // So they are fetched separately, against the same filters, in their own
  // request. Deliberately NOT part of the list call: 18 grouped counts riding
  // every page view is the request-amplification shape that took the board
  // down on 2026-08-17. This runs once per filter change, after the list has
  // already painted, and the page is fully usable whether or not it arrives.
  const [filteredCats, setFilteredCats] = useState<Record<string, number> | null>(null);
  const catFacetSeq = useRef(0);

  // THE DIRECT FACET IS THE PRIMARY SOURCE OF COUNTRY COUNTS AGAIN.
  //
  // Both measurements, and both dates, because the second one only means
  // something next to the first:
  //
  //   2026-08-08 — get_country_facet returned error 57014 (statement timeout)
  //     on 10 of 10 calls, 3.20-3.32s each, and the delayed retry timed out
  //     too. The picker rendered 0% of the time, so no country was reachable
  //     except by hand-editing the URL, and the result-set fallback below was
  //     added to give the control something to show.
  //
  //   2026-08-25 — re-measured against production: it returns in 0.49s with
  //     US 253,609 / GB 20,625 / CA 19,220 / IN 14,568 / DE 11,413. Not one
  //     timeout. The old note claiming a permanent 57014 was describing a state
  //     the board had already left, and it was steering a real facet — with
  //     real counts on all twenty countries — behind a fallback that can only
  //     ever name the handful of countries on the current page and knows no
  //     counts at all.
  //
  // The FALLBACK STAYS. A filter that disappears when one RPC has a bad minute
  // is the failure this file's own comment records, and 57014 is a timeout, not
  // a fixed bug — it can come back the moment the table grows.
  useEffect(() => {
    let cancelled = false;
    const read = (rows: unknown) =>
      (Array.isArray(rows) ? rows as Array<{ country?: string; n?: number }> : [])
        .filter((r) => typeof r.country === "string" && r.country.length === 2)
        .map((r) => ({ country: String(r.country), n: Number(r.n) || 0 }))
        .slice(0, 20);
    const call = () => (supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown }>;
    }).rpc("get_country_facet");
    (async () => {
      let rows: Array<{ country: string; n: number }> = [];
      try { rows = read((await call()).data); } catch { /* the retry below covers it */ }
      if (cancelled) return;
      // ONE DELAYED RETRY, AND ONLY ON FAILURE. It used to run unconditionally,
      // so every mount paid a second 3s-delayed RPC after a call that had
      // already succeeded. Live-walk finding (rank 3): on deep-link entries the
      // picker was observed missing — a transient facet failure hides a FILTER,
      // which the fence forbids — so the retry is kept for the case it was
      // written for.
      if (rows.length === 0) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) return;
        try { rows = read((await call()).data); } catch { /* fallback serves this session */ }
        if (cancelled) return;
      }
      setCountryFacet(rows);
    })();
    return () => { cancelled = true; };
  }, []);
  // A SKIP-LINK PRESS THAT LANDED DURING HYDRATION IS STILL A PRESS.
  // The served HTML's #main-content target does not exist until React mounts
  // (the prerendered shell emits a bare <main>), so the first key a keyboard
  // user hits on the SEO landing surface moves nothing for 1.0-2.7s. The
  // browser does write the fragment, so the intent survives — honour it the
  // moment the target exists rather than making them press it twice.
  useEffect(() => { honourPendingSkipLink(window.location.hash); }, []);
  // Salary floor filters on the posting's OWN stated pay, annualized (hourly
  // ×2080 etc.) but never currency-converted — postings that don't state pay
  // are excluded while the floor is active.
  const [salaryFloor, setSalaryFloor] = useState<number>(() => {
    const n = Number(initial.get("salaryFloor"));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  // THE OTHER END OF THE SAME BAND. `.lte` on salary_rank_usd, symmetric with
  // the floor's `.gte` on that same column, and the API has taken any number
  // for it while the page offered none at all. A ceiling under the floor is a
  // contradiction the SERVER refuses and names in ignoredFilters — the page
  // sends it rather than quietly correcting it, so the visitor is told.
  const [salaryCeiling, setSalaryCeiling] = useState<number>(() => {
    const n = Number(initial.get("salaryCeiling"));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  // READ FROM THE URL, not just written to it. This state was set only by the
  // natural-language parser and by the UI control, while `fresh` was WRITTEN to
  // the query string on every change — so the param round-tripped visibly and
  // did nothing on arrival. A shared or bookmarked "posted today" link, and any
  // deep link from another page, silently produced an unfiltered board.
  // Validated rather than cast: an unknown value falls back to no filter.
  //
  // NOW A NUMBER OF DAYS, 0 = any date. The API has always taken 1..30 and the
  // page offered two of those thirty; "posted in the last fortnight" was
  // reachable only by hand-editing the URL. The two LEGACY SPELLINGS are still
  // read, because they are what every link minted before today carries — a
  // shared "?fresh=week" must not quietly become an unfiltered board, which is
  // the exact defect the comment above records for this same param.
  const [freshness, setFreshness] = useState<string>(() => {
    const f = initial.get("fresh");
    const legacy = f === "day" || f === "week" ? f : "";
    if (legacy) return legacy === "day" ? "1" : "7";
    const n = Number(f);
    return Number.isFinite(n) && n >= 1 && n <= 30 ? String(Math.floor(n)) : "";
  });
  // Natural-language search: the user describes what they want, an LLM maps
  // it to the board's REAL filters (never inventing one), and we show exactly
  // how it read the query with anything it couldn't map disclosed plainly.
  const [nlOpen, setNlOpen] = useState(false);
  const [nlQuery, setNlQuery] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [nlResult, setNlResult] = useState<{ interpreted: string[]; notMapped: string[] } | null>(null);
  const applyNlSearch = useCallback(async (override?: string) => {
    const raw = (override ?? nlQuery).trim();
    if (raw.length < 3 || nlLoading) return;
    setNlLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("nl-search", { body: { query: raw } });
      const f = (data as { filters?: Record<string, unknown> } | null)?.filters;
      if (error || !f) { toast({ title: t("jobsPage.nlFailed", "Couldn't read that — try the filters below instead.") }); return; }
      // Apply the parsed filters through the existing setters; reset the ones
      // NOT returned so the applied state matches the interpretation exactly.
      setQ(typeof f.q === "string" ? f.q : "");
      setCategory(typeof f.category === "string" ? f.category : "");
      // Company was the one filter this reset missed: an NL search run while a
      // company filter was active stayed silently scoped to that employer
      // while the interpretation chips said nothing about it.
      setCompany(typeof f.company === "string" ? f.company : "");
      setExperience(typeof f.experience === "string" ? f.experience : "");
      setRemoteOnly(false);
      setWorkMode(typeof f.workMode === "string" && f.workMode
        ? normalizeModes(f.workMode)
        : f.remote === true ? "remote" : "");
      setSalaryFloor(typeof f.salaryFloor === "number" ? f.salaryFloor : 0);
      setCountry(typeof f.country === "string" ? f.country : "");
      setLocation(typeof f.location === "string" ? f.location : "");
      // Any window the API takes, not just the two the chips used to offer —
      // the parser can now say "posted in the last fortnight" and be obeyed.
      setFreshness(
        typeof f.maxAgeDays === "number" && f.maxAgeDays >= 1 && f.maxAgeDays <= 30
          ? String(Math.floor(f.maxAgeDays)) : "",
      );
      // RESET THE ONES THE PARSER DOES NOT RETURN. nl-search maps a sentence
      // onto the board's filters and the interpretation chips list exactly what
      // it read; a filter left switched on from before is a constraint the
      // interpretation does not mention and the visitor cannot see the source
      // of. That is the defect the company reset above records, and every
      // filter added since has to join it or repeat it.
      setSalaryCeiling(0);
      setPayBasis("");
      setStatedPayOnly(false);
      setIncludeUnstatedPay(false);
      setMaxYears(0);
      setDepartment("");
      setVendor("");
      // Board CONTROLS the parser can now drive too (a query is a command):
      // "companies that actually hire" → the proven-fills filter; "highest
      // paying first" → salary sort. Reset like the other fields.
      setActivelyHiringOnly(f.activelyHiring === true);
      setSortMode(f.sort === "salary" ? "salary" : "newest");
      const d = data as { interpreted?: string[]; notMapped?: string[] };
      setNlResult({ interpreted: Array.isArray(d.interpreted) ? d.interpreted : [], notMapped: Array.isArray(d.notMapped) ? d.notMapped : [] });
      setNlOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch { toast({ title: t("jobsPage.nlFailed", "Couldn't read that — try the filters below instead.") }); }
    finally { setNlLoading(false); }
  }, [nlQuery, nlLoading, t]);
  const [companyQuery, setCompanyQuery] = useState<string | null>(null);
  // THE FACET IS A HEAD, NOT A CENSUS. The list response used to carry all
  // 1,433 employers — 70% of its bytes — so this typeahead could filter them
  // locally. It now carries the top 150 and the rest are reached through
  // action:company-suggest, which reads the same cached facet server-side.
  const [companySuggest, setCompanySuggest] = useState<Array<{ token: string; name: string; count: number }>>([]);
  // A selected employer outside the head would otherwise render its own
  // filter chip with no label, so every name we ever learn is remembered:
  // from the facet, from the rows on screen (each carries its employer), and
  // from whatever the reader picks out of the suggestions.
  const companyNames = useRef<Record<string, string>>({});
  const [companyIdx, setCompanyIdx] = useState(-1);
  // ⌘K palette + "?" shortcuts overlay + "/" search focus.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 1400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useGlobalPaletteKeys({
    onPalette: () => setPaletteOpen((v) => !v),
    onHelp: () => setHelpOpen((v) => !v),
    onSlash: () => (document.getElementById("board-search") as HTMLInputElement | null)?.focus(),
  });
  // E3: last few viewed jobs, restored across visits (localStorage snapshot).
  const [recentJobs, setRecentJobs] = useState<Array<{ id: string; title: string; company: string }>>(() => {
    try { return JSON.parse(localStorage.getItem("rb_recent_jobs") ?? "[]"); } catch { return []; }
  });
  // U2: honest "posted today" headline count (company-stated dates only).
  const [newToday, setNewToday] = useState<number | null>(null);
  // The board caps counting for speed, so a broad window comes back as exactly
  // the cap. "Posted today" measured 33,328 — far above it — so printing the
  // bare number would understate it as an exact 10,000.
  const [newTodayCapped, setNewTodayCapped] = useState(false);
  useEffect(() => {
    let alive = true;
    invokeBoard<{ total?: number; countCapped?: boolean }>({ action: "list", countOnly: true, includeFacets: false, maxAgeDays: 1 })
      .then(({ data }) => {
        if (alive && typeof data?.total === "number" && data.total > 0) {
          setNewToday(data.total);
          setNewTodayCapped(data.countCapped === true);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Sort: newest (default) or highest STATED salary (annualized floor, server-
  // side; unsalaried postings sort last). Fit ordering is owned by "For you".
  // Honors ?sort=salary from the URL (e.g. Explore's "Where the pay is" cards),
  // otherwise defaults to newest.
  const [sortMode, setSortMode] = useState<"newest" | "salary">(() => (initial.get("sort") === "salary" ? "salary" : "newest"));
  // S3: search results default to relevance ranking; this flips them to
  // strict newest-first (server bypasses the ranked path).
  const [searchNewestFirst, setSearchNewestFirst] = useState(false);
  const [fitRanking, setFitRanking] = useState(false);
  /** Postings whose fit call failed outright, so the UI can say so instead of
   *  presenting an unscored list as a ranked one. */
  const [fitFailedCount, setFitFailedCount] = useState(0);
  const [fits, setFits] = useState<Record<string, number | null>>({});
  // Top missing keywords per posting id — the "add these to compete" signal
  // rendered inline on each card once fit-ranking is on.
  const [misses, setMisses] = useState<Record<string, string[]>>({});
  const [hits, setHits] = useState<Record<string, string[]>>({});
  const [fitLoading, setFitLoading] = useState(false);
  // True once we've checked for a resume on mount, so the auto-enable only
  // fires once and never fights a user who deliberately toggled fit off.
  const fitAutoChecked = useRef(false);
  // null = not checked yet; false = definitively no resume (drives the
  // "For you" upsell banner); true = a resume exists somewhere.
  const [resumeAvailable, setResumeAvailable] = useState<boolean | null>(null);
  // The resume available for ranking: this tab's scan first, else the
  // signed-in user's latest saved version (fetched lazily on toggle).
  const fitResume = useRef<string | null>(null);
  // Inline résumé drop on the board (Batch 1): parse state + drag highlight.
  const [parsingResume, setParsingResume] = useState(false);
  const [resumeDragOver, setResumeDragOver] = useState(false);
  // Adaptive landing: first visit with zero intent signals gets an orientation
  // block instead of a raw newest-first firehose. Any expressed intent (params,
  // résumé, prior visit, explicit dismiss) suppresses it permanently.
  const [showOrientation, setShowOrientation] = useState<boolean>(() => {
    try {
      if (localStorage.getItem("rb_board_last_visit") || localStorage.getItem("rb_board_oriented")) return false;
      if (sessionStorage.getItem("rb_board_resume")) return false;
    } catch { /* storage blocked — treat as returning visitor */ return false; }
    for (const k of ["q", "category", "location", "remote", "country", "minSalary", "job", "from", "sort"]) {
      if (initial.get(k)) return false;
    }
    return true;
  });
  const dismissOrientation = useCallback(() => {
    setShowOrientation(false);
    try { localStorage.setItem("rb_board_oriented", "1"); } catch { /* session-only */ }
  }, []);
  // Batch 3: compare tray (client-side only — every compared field is already
  // loaded: fit/hits/misses, salary, age, company hiring-health).
  const [compareIds, setCompareIds] = useState<string[]>([]);
  // Employer context per compared company (slug-keyed, shared promise cache) —
  // fills the compare cards with headcount/public-co facts when they exist.
  const [compareCtx, setCompareCtx] = useState<Record<string, EmployerCtx>>({});
  const [compareOpen, setCompareOpen] = useState(false);
  useEffect(() => {
    if (!compareOpen) return;
    for (const id of compareIds) {
      const j = jobs.find((x) => x.id === id);
      if (!j?.token) continue;
      const slug = j.token.split("~")[0];
      if (compareCtx[slug]) continue;
      void getEmployerCtx(j.token).then((c) => setCompareCtx((prev) => ({ ...prev, [slug]: c })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareOpen, compareIds]);
  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => prev.includes(id)
      ? prev.filter((x) => x !== id)
      : prev.length >= 3 ? [...prev.slice(1), id] : [...prev, id]);
  }, []);
  // Batch 3: live activity strip — real measured numbers only.
  const [takedownsToday, setTakedownsToday] = useState<number | null>(null);
  const [recheckP50Min, setRecheckP50Min] = useState<number | null>(null);
  // Batch 4: hover prefetch — descriptions load per-open; warming the cache on
  // hover makes the panel open instantly. Map value: null = in flight.
  const descCache = useRef<Map<string, string | null>>(new Map());
  const prefetchDesc = useCallback((job: BoardJob) => {
    if (descCache.current.has(job.id)) return;
    descCache.current.set(job.id, null);
    invokeBoard<{ description?: string }>({ action: "detail", id: job.id })
      .then(({ data: res }) => descCache.current.set(job.id, res?.description ?? ""))
      .catch(() => descCache.current.delete(job.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Batch 4: swipe triage on touch — right saves, left dismisses. Only engages
  // when the gesture is clearly horizontal, so scrolling is never hijacked.
  const swipeRef = useRef<{ id: string; x: number; y: number; el: HTMLElement | null } | null>(null);
  const onCardTouchStart = (job: BoardJob) => (e: React.TouchEvent<HTMLLIElement>) => {
    const t0 = e.touches[0];
    swipeRef.current = { id: job.id, x: t0.clientX, y: t0.clientY, el: e.currentTarget };
  };
  const onCardTouchMove = (e: React.TouchEvent<HTMLLIElement>) => {
    const s = swipeRef.current;
    if (!s || !s.el) return;
    const t0 = e.touches[0];
    const dx = t0.clientX - s.x, dy = t0.clientY - s.y;
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      s.el.style.transform = `translateX(${dx}px)`;
      s.el.style.opacity = String(Math.max(0.5, 1 - Math.abs(dx) / 400));
    }
  };
  const onCardTouchEnd = (job: BoardJob) => (e: React.TouchEvent<HTMLLIElement>) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s || !s.el) return;
    const t0 = e.changedTouches[0];
    const dx = t0.clientX - s.x, dy = t0.clientY - s.y;
    s.el.style.transform = ""; s.el.style.opacity = "";
    if (Math.abs(dy) > 60 || Math.abs(dx) < 96) return;
    if (dx > 0) void saveJob(job); else dismissJob(job);
  };
  // Batch 4: scroll restore — coming back to the board lands where you left.
  // (The restore effect lives below the `jobs` declaration.)
  const scrollRestored = useRef(false);
  useEffect(() => () => {
    try { sessionStorage.setItem("rb_board_scroll", String(window.scrollY)); } catch { /* cosmetic */ }
  }, []);
  // Activity strip data — lazy, non-blocking, real numbers or nothing.
  useEffect(() => {
    let alive = true;
    const sb = supabase as unknown as { rpc: (f: string) => Promise<{ data: unknown }> };
    void sb.rpc("get_takedowns_today").then(({ data }) => {
      if (alive && typeof data === "number" && data > 0) setTakedownsToday(data);
    }).catch(() => { /* strip clause hides */ });
    void sb.rpc("get_freshness_stats").then(({ data }) => {
      const row = Array.isArray(data) ? (data[0] as { p50_min?: number } | undefined) : undefined;
      if (alive && typeof row?.p50_min === "number") setRecheckP50Min(Math.round(row.p50_min));
    }).catch(() => { /* strip clause hides */ });
    return () => { alive = false; };
  }, []);
  const [data, setData] = useState<BoardResponse | null>(null);
  const [jobs, setJobs] = useState<BoardJob[]>([]);
  /** How many of the RENDERED postings actually carry a numeric fit.
   *
   *  The ranking claim is derived from this, never from the `fitRanking`
   *  toggle. The toggle says what the user asked for; this says what we were
   *  able to do — and the board printed "ordered by fit to your résumé" over
   *  lists where those two disagreed completely.
   *
   *  Declared HERE, below `jobs` and `fits`, because the first draft put it up
   *  with the other fit state and referenced both before their declarations.
   *  The pre-commit typecheck caught it (TS2448) where a local `tsc --noEmit`
   *  run had just passed — worth remembering that the hook is the real gate. */
  /**
   * How many of the RENDERED postings the apply agent can actually submit to.
   *
   * The agent is the $99/mo product and the board is the biggest surface on the
   * site, and the word "agent" appeared exactly twice on /jobs: once as an
   * unlabelled filter checkbox, once inside a job title. "$99", "Morning Queue"
   * and "free trial" appeared zero times, and on mobile the word appeared not
   * at all because the filter row collapses behind a button.
   *
   * Counted from THIS page rather than quoting a board-wide figure, and using
   * the same isSendableVendor predicate as the per-card Sparkles badge — so the
   * number a visitor reads is the number of badges they can count on screen. A
   * board-wide "37,000 postings" would be true and unverifiable; this is true
   * and checkable, which is the difference the rest of this product trades on.
   */
  const agentReadyOnPage = useMemo(
    () => jobs.reduce((n, j) => n + (isSendableVendor(j.id) ? 1 : 0), 0),
    [jobs],
  );

  const scoredCount = useMemo(
    () => jobs.reduce((n, j) => n + (typeof fits[j.id] === "number" ? 1 : 0), 0),
    [jobs, fits],
  );
  // Scroll restore (Batch 4): once the first page of results is in, jump back
  // to where the visitor left — unless they deep-linked straight to a job.
  useEffect(() => {
    if (scrollRestored.current || jobs.length === 0 || initial.get("job")) return;
    scrollRestored.current = true;
    try {
      const y = Number(sessionStorage.getItem("rb_board_scroll"));
      if (y > 200) window.scrollTo({ top: y });
    } catch { /* cosmetic */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fitFetching, setFitFetching] = useState<string | null>(null);
  const [error, setError] = useState(false);
  // "query" = the CDN WAF rejected the search string; "load" = anything else.
  const [errorKind, setErrorKind] = useState<"load" | "query">("load");
  // Separate from `error`: a failed "Load more" leaves the list rendered and
  // shows an inline retry under it, rather than replacing a full page of
  // results with an error card.
  const [loadMoreError, setLoadMoreError] = useState(false);
  const reqSeq = useRef(0);
  // WHICH FILTER SET THE VISIBLE LIST WAS BUILT FROM.
  //
  // reqSeq answers "is this the newest request?" but never "does this response
  // describe the filters currently on screen?", and those come apart in one
  // ordinary sequence: change a filter (seq N), then press Load more before the
  // new page paints (seq N+1). The load-more is NEWER, so it survives the seq
  // check and appends — while the page-0 request for the same filters is
  // discarded for being older. The list is then permanently a mix of two filter
  // sets, and no further interaction repairs it.
  //
  // The server emits appliedSignature for exactly this, but on the facets exit
  // only — zero of the eight list exits carry it, and comparing against it would
  // mean the client rebuilding the server's normalised filter object field for
  // field. That copy would go stale, which is the failure this repo keeps
  // finding. The client already holds the thing it needs: the body it sent.
  const listSig = useRef("");
  const { session } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  // Postings the user has ALREADY APPLIED to (tracker status beyond saved) —
  // rendered as a quiet check on cards/compare so no one re-reads a job they
  // already acted on without knowing it.
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  // Live small-screen check: drives mobile-only ordering and collapsed-by-
  // default JD sections. Must be a LISTENER, not a mount-time snapshot — a
  // hidden/prerendered tab measures 0px wide at mount and a snapshot would
  // lock the mobile layout in permanently (live incident during verification).
  const [isSmallScreen, setIsSmallScreen] = useState<boolean>(() =>
    typeof window !== "undefined" && window.innerWidth > 0
      ? window.matchMedia("(max-width: 640px)").matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsSmallScreen(window.innerWidth > 0 ? mq.matches : false);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // Anonymous first-visit welcome: three one-tap entries into the board's
  // distinctive muscle. Dissolves permanently once used or dismissed.
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try { return localStorage.getItem("rb_board_welcomed") !== "1"; } catch { return false; }
  });
  const dismissWelcome = () => {
    setShowWelcome(false);
    try { localStorage.setItem("rb_board_welcomed", "1"); } catch { /* ignore */ }
  };
  // Company-page hiring-health (lifecycle-derived; only fetched on a company page).
  const [hiringHealth, setHiringHealth] = useState<HiringHealth | null>(null);
  // Board-card hiring-health, batched per visible company token → "Actively hiring"
  // badge + filter. Auto-activates as the closure log accrues real data.
  const [healthByToken, setHealthByToken] = useState<Record<string, HiringHealth>>({});
  // Also linkable. Same gap as `fresh`: the toggle existed in the UI and the
  // NL parser could set it, but no URL could, so Explore had no way to hand a
  // reader an employers-that-close-roles destination. (That copy used to
  // promise a fill record; the lifecycle log observes a posting disappearing,
  // not a hire, so both surfaces now say what is measured.)
  const [activelyHiringOnly, setActivelyHiringOnly] = useState(initial.get("activelyHiring") === "1");
  /**
   * EVERY FILTER, ONCE, IN ONE OBJECT — the argument to boardFilterBody().
   *
   * activelyHiringOnly is deliberately NOT here: it has no board predicate and
   * is applied in the browser against the fill record, so putting it in a
   * request body would send a parameter the server does not know. The saved
   * search names it for the same reason rather than saving it.
   */
  const filterState: BoardFilterState = useMemo(() => ({
    q, location, remoteOnly, workMode, category, inclUncat, agentOnly, country,
    experience, companyTokens, salaryFloor, salaryCeiling, payBasis, statedPayOnly, includeUnstatedPay,
    maxYears, department, vendor, freshness,
  }), [q, location, remoteOnly, workMode, category, inclUncat, agentOnly, country,
    experience, companyTokens, salaryFloor, salaryCeiling, payBasis, statedPayOnly, includeUnstatedPay,
    maxYears, department, vendor, freshness]);
  const healthAttempted = useRef<Set<string>>(new Set());
  const [healthFailed, setHealthFailed] = useState(false);
  // Apply-agent: the posting whose questions we're drafting (with its fetched JD
  // and whether the user already applied — the dedup guard), and which card is
  // currently loading its description.
  const [prepareJob, setPrepareJob] = useState<{ job: BoardJob; description: string | null; alreadyApplied: boolean } | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  // Report-a-posting: which card's reason menu is open, and which postings this
  // tab already reported (prevents repeat submissions, shows the thanks state).
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  // P0 layout state: the trust explainer folds away (the old four-paragraph
  // hero pushed the first job 2.5 screens down on mobile — the measured 76%
  // bounce), and on mobile the secondary filters live behind one button.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Dismissed postings: hidden on this device only (localStorage — works
  // signed-out). Nothing is deleted; a restore control brings them all back.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("rb_dismissed_jobs") ?? "[]");
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
    } catch { return new Set(); }
  });
  // Session continuity: postings you've opened dim on subsequent visits
  // (device-local), and the board remembers when you last looked so it can
  // mark what's new since then. Job searching is a daily ritual — the board
  // should visibly remember yesterday.
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("rb_viewed_jobs") ?? "[]");
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
    } catch { return new Set(); }
  });
  const lastVisitRef = useRef<number | null>(null);
  useEffect(() => {
    try {
      const prev = Number(localStorage.getItem("rb_board_last_visit"));
      lastVisitRef.current = Number.isFinite(prev) && prev > 0 ? prev : null;
      localStorage.setItem("rb_board_last_visit", String(Date.now()));
    } catch { /* private mode — session-only */ }
  }, []);
  // True while a filter change refetches over an already-loaded list — the list
  // stays visible (locally filtered) instead of blanking behind a spinner.
  const [refreshing, setRefreshing] = useState(false);
  const jobsCount = useRef(0);
  // The q/location the visible list actually came from: while the typed values
  // differ (debounce window + roundtrip), the list filters locally so typing
  // feels instant. Never applied to settled server results — the server also
  // matches department, which a local title/company filter would wrongly hide.
  const servedQuery = useRef({ q: "", location: "" });
  // Per-application resume rewrite (uses the already-deployed generate-tailored-resume).
  const [tailoredOpen, setTailoredOpen] = useState(false);
  const [tailoredLoading, setTailoredLoading] = useState(false);
  const [tailoredContent, setTailoredContent] = useState<TailoredResumeContent | null>(null);
  // Per-application cover letter (uses the already-deployed generate-cover-letter).
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverText, setCoverText] = useState<string | null>(null);
  // Likely interview questions for the role (generate-interview-coach, deployed).
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachQuestions, setCoachQuestions] = useState<Array<{ category?: string; question: string; whyAsked?: string }> | null>(null);

  // Which postings are already in the user's application tracker.
  useEffect(() => {
    if (!session) return;
    appsTable()
      .select("job_id,status")
      .not("job_id", "is", null)
      .then(({ data }: { data: Array<{ job_id: string; status: string }> | null }) => {
        setSavedIds(new Set((data ?? []).map((r) => r.job_id)));
        setAppliedIds(new Set((data ?? []).filter((r) => r.status && r.status !== "saved").map((r) => r.job_id)));
      }, () => {});
  }, [session]);

  const requireAuth = () => {
    toast({
      title: t("jobsPage.signInToSaveTitle", "Sign in to track jobs"),
      description: t("jobsPage.signInToSave", "Saved jobs and searches live in your free account."),
    });
    navigate("/auth");
  };

  // Save = a 'saved' row in the SAME application tracker Account already
  // shows. Best effort afterwards: pull the description so the tracker's
  // deterministic fit check is one click instead of a paste.
  const saveJob = async (job: BoardJob) => {
    if (!session) return requireAuth();
    if (savedIds.has(job.id)) return;
    setSavedIds((prev) => new Set(prev).add(job.id));
    // Attach the latest scan as the working resume version — keeps "sent
    // version" and outcome analytics coherent when this row gets applied.
    let latestScan: { id: string; ats_score: number | null; resume_text: string | null } | null = null;
    try {
      const { data: scans } = await (supabase as unknown as { from: (t: string) => any })
        .from("user_scans")
        .select("id, ats_score, resume_text")
        .order("created_at", { ascending: false })
        .limit(1);
      latestScan = scans?.[0] ?? null;
    } catch { /* fine without */ }
    const { error: err } = await appsTable().insert({
      user_id: session.user.id,
      company: job.company,
      role: job.title,
      status: "saved",
      job_id: job.id,
      apply_url: job.applyUrl,
      location: job.location,
      scan_id: latestScan?.id ?? null,
      scan_score: latestScan?.ats_score ?? null,
    });
    if (err) {
      if (err.code !== "23505") {
        setSavedIds((prev) => { const n = new Set(prev); n.delete(job.id); return n; });
        toast({ title: t("jobsPage.saveFailed", "Couldn't save — try again.") });
      }
      return;
    }
    // Milestone moments: save #1 and save #12 are different situations — by
    // the 5th/12th save the user is assembling a PIPELINE, which is exactly
    // the workload batch prep and the Morning Queue exist for. The claims are
    // factual (the trial is a real 7-day trial; the agent never auto-submits)
    // and Pro users never see the pitch. Counts land on 5 and 12 once each.
    const savedCount = savedIds.size + 1;
    if (!isPro && (savedCount === 5 || savedCount === 12)) {
      toast({
        title: t("jobsPage.savedMilestone", "That's {{n}} jobs in your pipeline", { n: savedCount }),
        description: t("jobsPage.savedMilestoneDesc", "The Apply Agent can prep tailored answers for all of them in one batch — 7-day free trial, and you always hit send yourself."),
      });
    } else {
      toast({ title: t("jobsPage.jobSaved", "Saved to your application tracker") });
    }
    try {
      const { data: res } = await invokeBoard<{ description?: string }>({ action: "detail", id: job.id });
      const description = (res as { description?: string })?.description;
      if (!description) return;
      await appsTable().update({ job_posting: description.slice(0, 20000) }).eq("user_id", session.user.id).eq("job_id", job.id);
      // Auto fit-check: deterministic keyword coverage of the resume they'd
      // send — the tracker becomes a ranked queue, not just a list.
      if (latestScan?.resume_text) {
        const { data: fit } = await supabase.functions.invoke("application-fit", {
          body: { jobPosting: description, resumeText: latestScan.resume_text },
        });
        if ((fit as { success?: boolean })?.success) {
          const { pct, missing } = (fit as { data: { pct: number | null; missing: string[] } }).data;
          await appsTable().update({ fit_pct: pct, fit_missing: missing }).eq("user_id", session.user.id).eq("job_id", job.id);
        }
      }
    } catch { /* enrichment is a bonus — the save already landed */ }
  };

  // The tracker fills itself on Apply clicks (below) but did so silently —
  // surface it when the user comes back from the company's site, so they know
  // the row exists and can fix it if they didn't actually submit.
  const appliedNotice = useRef<{ company: string; role: string; ts: number } | null>(null);
  useEffect(() => {
    const onVisible = () => {
      const n = appliedNotice.current;
      if (document.visibilityState !== "visible" || !n) return;
      if (Date.now() - n.ts > 45 * 60_000) { appliedNotice.current = null; return; }
      appliedNotice.current = null;
      toast({
        title: t("jobsPage.appliedMarkedTitle", "Marked as applied in your tracker"),
        description: t("jobsPage.appliedMarkedBody", "{{role}} at {{company}} — if you didn't submit, change its status in your account.", { role: n.role, company: n.company }),
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [t]);

  // Signed-in Apply clicks promote the row to 'applied' (never downgrading
  // a richer status) — the tracker fills itself.
  const promoteApplied = async (job: BoardJob) => {
    if (!session) return;
    appliedNotice.current = { company: job.company, role: job.title, ts: Date.now() };
    if (savedIds.has(job.id)) {
      await appsTable().update({ status: "applied", applied_at: new Date().toISOString().slice(0, 10) })
        .eq("user_id", session.user.id).eq("job_id", job.id).eq("status", "saved");
    } else {
      setSavedIds((prev) => new Set(prev).add(job.id));
      await appsTable().insert({
        user_id: session.user.id,
        company: job.company,
        role: job.title,
        status: "applied",
        job_id: job.id,
        apply_url: job.applyUrl,
        location: job.location,
      }).then(() => {}, () => {});
    }
  };

  // `alert` = the caller promised the user an email ("Alert me when this
  // exists"). A plain save stays email-silent — clicking Save is not consent
  // to be mailed; clicking an alert CTA is, and it gets the daily cadence.
  const saveCurrentSearch = async (alert = false) => {
    if (!session) return requireAuth();
    // Every active filter must ride along: a saved search is a promise to mail
    // THIS query. country and the freshness window were dropped, so a US-only
    // zero-result "Alert me when this exists" saved an all-countries search
    // and mailed postings the user's screen excluded (bug sweep 2026-07-26).
    const params = {
      q: q || undefined,
      category: category || undefined,
      includeUncategorised: category && inclUncat ? true : undefined,
      sendableOnly: agentOnly ? true : undefined,
      experience: experience || undefined,
      location: location || undefined,
      // ONE definition of Remote — see the note at the other call site. Sending
      // remote:true alongside workMode ANDed a strict subset onto the user's own
      // choice and dropped matches (7.6% on {workMode:remote,country:GB}).
      remote: (remoteOnly && !workMode) || undefined,
      workMode: workMode || undefined,
      // ONE TOKEN OR NONE, and the multi-employer case is named in the toast
      // instead. send-search-digest hand-lists the params it forwards and sends
      // `companies: p.company ? [p.company] : undefined` — one array element —
      // so a comma-joined "a,b" saved here reaches the board as a single
      // employer token spelled "a,b", which matches nothing. The digest would
      // then never fire and never say why. Saving what the runner can honour
      // and naming what it cannot is the same rule activelyHiring follows.
      company: companyTokens.length === 1 ? companyTokens[0] : undefined,
      country: country || undefined,
      salaryFloor: salaryFloor || undefined,
      maxAgeDays: Number(freshness) || undefined,
      // The seven that were named in the "left out" toast instead of saved.
      // The digest forwards them since the parity change, so a saved search
      // finally mails THIS query — band, basis, years, department, vendor and
      // all. Only multi-employer and Actively hiring remain genuinely
      // un-mailable (no server predicate), and they stay named below.
      salaryCeiling: salaryCeiling || undefined,
      payBasis: payBasis || undefined,
      hasStatedPay: statedPayOnly || undefined,
      includeUnstatedPay: includeUnstatedPay || undefined,
      // || not ??: this control's rest state is 0 ("0 = off"), and filters.ts
      // refuses 0 outright (1..20) — saving it stamped a phantom "≤0 yrs" into
      // every saved search's name and a standing ignoredFilters warning into
      // every digest run (review finding, caught before shipping).
      maxYears: maxYears || undefined,
      department: department || undefined,
      vendor: vendor || undefined,
    };
    const name = searchName(
      params,
      category ? t(`jobsPage.categories.${category}`, category) : undefined,
      experience
        ? (experience.split(",").filter(Boolean).length === 1
          ? t(`jobsPage.experience.${experience}`, experience)
          : t("jobsPage.nExperience", "{{n}} levels", { n: experience.split(",").filter(Boolean).length }))
        : undefined,
    );
    let { error: err } = await searchesTable().insert({
      user_id: session.user.id, name, params,
      ...(alert ? { digest_opt_in: true, digest_cadence: "daily" } : {}),
    });
    // Deploy-skew guard (same as watchCompany): a missing cadence column must
    // not fail the save — fall back to opt-in without it.
    if (err && alert && /digest_cadence/.test(err.message ?? "")) {
      ({ error: err } = await searchesTable().insert({
        user_id: session.user.id, name, params, digest_opt_in: true,
      }));
    }
    if (err && err.code === "23505") {
      toast({ title: t("jobsPage.searchExists", "You already saved this search.") });
      return;
    }
    if (err) {
      toast({ title: t("jobsPage.saveFailed", "Couldn't save — try again.") });
      return;
    }
    const filterLabel = (k: string) => t(`jobsPage.filterName.${k}`, k);
    // WAS seven filters longer. salaryCeiling, payBasis, hasStatedPay,
    // includeUnstatedPay, maxYears, department and vendor are SAVED now and the
    // digest forwards them — naming a filter as un-mailable while mailing it
    // would be the same drift this toast exists to prevent, inverted. Only the
    // genuinely un-mailable remain: a multi-employer scope (the digest runner
    // sends one token) and Actively hiring (browser-side, no server predicate).
    const unsavedFilters = [
      companyTokens.length > 1 ? filterLabel("companies") : "",
    ].filter(Boolean);
    // ACTIVELY HIRING CANNOT RIDE ALONG, SO IT IS NAMED INSTEAD OF SAVED.
    // It filters the fetched page in the browser (jobs.filter on the fill
    // record); the board has no such predicate, so the nightly runner cannot
    // reproduce it. Putting it in params would save a parameter nothing
    // honours — the same shape as the country/freshness drop this function's
    // comment already records, just one layer further on. Naming it is the
    // only honest option available without a server-side predicate.
    toast({
      title: t("jobsPage.searchSaved", "Search saved"),
      description: [
        t("jobsPage.searchSavedDesc", "Your account shows how many new postings match since your last look."),
        activelyHiringOnly ? t("jobsPage.savedWithoutActivelyHiring", "The Actively hiring filter is applied in your browser, not on the board, so this saved search does not include it.") : "",
        // THE FILTERS THE NIGHTLY RUNNER CANNOT REPRODUCE, NAMED RATHER THAN
        // SAVED. send-search-digest builds its board call from a hand-listed
        // set of params; anything outside that list is stored and ignored, and
        // a saved search that quietly drops half its filters mails postings the
        // screen it was saved from excluded. Measured against the deployed
        // function's own body, which forwards exactly q, category, location,
        // remote, workMode, companies, experience, country, salaryFloor and
        // maxAgeDays.
        unsavedFilters.length
          ? t("jobsPage.savedWithoutFilters", "These are applied on the board but not in the email yet, so the alert leaves them out: {{filters}}.", { filters: unsavedFilters.join(", ") })
          : "",
        t("jobsPage.queueBridge", "Want ready-to-review picks every morning instead? The Apply Agent runs your search nightly — Morning Queue, in your account."),
      ].filter(Boolean).join(" "),
    });
  };

  // Company facet arrives once and is cached — refetches skip it (it can be
  // hundreds of KB at full catalog size) and splice the cache back in.
  const companiesCache = useRef<BoardResponse["companies"]>([]);

  // Ask the server only for what the head cannot answer, and only once the
  // reader has typed enough to mean something. 180ms is below the pause
  // between keystrokes for a name being typed deliberately.
  useEffect(() => {
    const term = (companyQuery ?? "").trim();
    if (term.length < 2) { setCompanySuggest([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke("job-board", { body: { action: "company-suggest", q: term } });
        const rows = ((data as { companies?: Array<{ token: string; name: string; count: number }> } | null)?.companies) ?? [];
        if (cancelled) return;
        for (const c of rows) if (c.token && c.name) companyNames.current[c.token] = c.name;
        setCompanySuggest(rows);
      } catch { /* the head still answers — a failed suggest must not clear it */ }
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [companyQuery]);


  // One quiet retry for board calls: a refresh slice hitting the function's
  // resource ceiling can bounce a single request off the worker pool.
  const invokeBoard = async <T,>(body: Record<string, unknown>): Promise<{ data: T | null; error: { message?: string } | null }> => {
    const first = await supabase.functions.invoke("job-board", { body });
    if (!first.error && first.data != null) return first as { data: T; error: null };
    await new Promise((r) => setTimeout(r, 1200));
    return await supabase.functions.invoke("job-board", { body }) as { data: T | null; error: { message?: string } | null };
  };

  // The keyset successor from the last page served. Offset paging over a board
  // inserting ~70k rows/day duplicated and skipped rows on "Load more"
  // (measured 2026-08-18: 4 of 8 transitions overlapped, worst 9/60 duplicated
  // + 9 hidden). Sent only when continuing a list (offset > 0); a fresh load
  // starts from the top and takes a fresh cursor from its own response.
  const nextCursorRef = useRef<{ ep: string; id: string } | null>(null);

  // Refetch whenever the filter set changes. Debounced so dragging a salary
  // slider does not fire eighteen counts per pixel, and sequence-guarded so a
  // slow response for last filter set cannot paint over the current one.
  useEffect(() => {
    // DERIVED, not re-listed. This was a hand-written disjunction of eleven
    // filters, which is a list that goes stale the first time a twelfth is
    // added — and then the effect asks a board-wide question underneath a
    // narrowed page, which is the exact defect this whole file guards.
    const activeFilters = Object.keys(boardFilterBody(filterState)).length > 0;
    if (!activeFilters) { setFilteredCats(null); return; } // unfiltered: the cached board-wide facet is correct
    const seq = ++catFacetSeq.current;
    const timer = setTimeout(async () => {
      try {
        const { data: res } = await supabase.functions.invoke("job-board", {
          body: {
            action: "list", facetCounts: true,
            ...boardFilterBody(filterState),
            // The facet answers "how many in each field", so it must not be
            // pre-narrowed to one field.
            category: undefined, includeUncategorised: undefined,
          },
        });
        if (seq !== catFacetSeq.current) return; // a newer filter set superseded this
        const c = (res as { categories?: Record<string, number> } | null)?.categories;
        setFilteredCats(c && Object.keys(c).length ? c : null);
      } catch { /* counts are an enhancement — the dropdown works without them */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [q, filterState]);

  const fetchJobs = useCallback(
    async (offset: number) => {
      const seq = ++reqSeq.current;
      // A new result set is a new context: the user's "I closed the pane"
      // intent applied to the list they were looking at, not this one.
      if (offset === 0) userClosed.current = false;
      // A filter change over an already-loaded list refreshes in place (the
      // visible list locally filters meanwhile); only a true first load or
      // recovery-from-error blanks to the spinner.
      offset === 0 ? (jobsCount.current > 0 ? setRefreshing(true) : setLoading(true)) : setLoadingMore(true);
      setError(false);
      setLoadMoreError(false);
      try {
        const body = {
          action: "list",
          // EVERY filter, from the one derivation. The eighteen hand-written
          // lines this replaces are where the client's filter defects came
          // from: four bodies, four chances for one of them to be missing the
          // filter the visitor can see on screen.
          ...boardFilterBody(filterState),
          // Searches default to relevance ranking; the toggle bypasses it.
          sort: sortMode === "salary" ? "salary" : q && searchNewestFirst ? "newest" : undefined,
          limit: PAGE,
          offset,
          cursor: offset > 0 ? nextCursorRef.current ?? undefined : undefined,
          includeFacets: companiesCache.current.length === 0,
        };
        // Everything in the body EXCEPT where we are in it. Two requests with
        // the same signature describe the same result set, so their rows may be
        // concatenated; two with different signatures may not, at any offset.
        const sig = JSON.stringify({ ...body, offset: 0, cursor: undefined, includeFacets: undefined });
        let { data: res, error: err } = await supabase.functions.invoke("job-board", { body });
        if (err || !res?.jobs) {
          // One quiet retry: a refresh slice hitting the function's resource
          // ceiling can bounce a single request; the next instance serves fine.
          await new Promise((r) => setTimeout(r, 1200));
          if (seq !== reqSeq.current) return;
          ({ data: res, error: err } = await supabase.functions.invoke("job-board", { body }));
        }
        if (seq !== reqSeq.current) return; // a newer filter superseded this request — abandon quietly
        if (err || !res?.jobs) throw new Error(err?.message ?? "no jobs field");
        const br = res as BoardResponse;
        // Every page carries its own successor (or null on paths that still
        // page by offset — the fallback body sends offset regardless).
        nextCursorRef.current = br.nextCursor ?? null;
        if (br.companies?.length) companiesCache.current = br.companies;
        else br.companies = companiesCache.current;
        for (const c of br.companies ?? []) if (c.token && c.name) companyNames.current[c.token] = c.name;
        // The rows name their own employers, which covers a selected company
        // that sits outside the served head.
        for (const j of br.jobs ?? []) {
          const tk = (j as { token?: string }).token, nm = (j as { company?: string }).company;
          if (tk && nm) companyNames.current[tk] = nm;
        }
        servedQuery.current = { q, location };
        br.jobs = br.jobs.map((row, i) => ({
          ...normalizeRow(row),
          searchId: br.searchId,
          rank: offset + i + 1,
        }));
        // A page-0 response DEFINES the current list; a later page may only
        // extend one built from the same filters. Refusing the mismatch is the
        // whole fix — appending it is what stranded the list.
        if (offset > 0 && listSig.current !== sig) return;
        listSig.current = sig;
        setData(br);
        setJobs((prev) => (offset === 0 ? br.jobs : [...prev, ...br.jobs]));
      } catch (e) {
        if (seq !== reqSeq.current) return; // superseded request failed — not user-visible, don't log or flag
        console.error("[Jobs] list failed:", e);
        // A query carrying SQL-ish metacharacters is bounced by the CDN WAF
        // BEFORE it reaches the function, and the reply is an HTML challenge
        // page the client can't parse (audit 2026-07-26). Blaming "the board"
        // sends the user to retry the same doomed query; naming the real cause
        // lets them fix it in one edit.
        // AN APOSTROPHE IS NOT AN ATTACK. This regex matched a bare ' so
        // "Kohl's", "St. Luke's", "Lowe's" and "Macy's" were classified as
        // hostile queries: the visitor was told their own search was the
        // problem, given no retry, and offered only a button that throws away
        // what they typed. Every one of those is a real employer on this board.
        //
        // The classification now needs a genuine SQL-ish SEQUENCE, not a
        // single punctuation mark that occurs in ordinary English possessives.
        // And even then it is only a HINT: a retry is always offered, because
        // the WAF is not the only reason a request fails and a dead end during
        // an ordinary outage is worse than a slightly wrong explanation.
        setErrorKind(/--|\/\*|\bunion\s+select\b|\bdrop\s+table\b|;\s*\w+\s+(select|insert|update|delete)\b/i.test(q) ? "query" : "load");
        // Scope the failure to the request that failed. A "Load more" that
        // fails must not delete the jobs already on screen — that is several
        // minutes of someone's scrolling destroyed by one flaky request, with
        // no way back. Only a first-page failure replaces the list.
        if (offset === 0) setError(true);
        else setLoadMoreError(true);
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [filterState, q, sortMode, searchNewestFirst],
  );

  // Keep the URL shareable — filters in, defaults out. A category lander
  // (/jobs/field/engineering) keeps its crawlable URL while its category is
  // the only active filter; touching any other filter moves to query form.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (location) p.set("location", location);
    if (remoteOnly) p.set("remote", "1");
    if (workMode) p.set("mode", workMode);
    if (company) p.set("company", company);
    if (category) p.set("category", category);
    if (category && inclUncat) p.set("inclUncat", "1");
    if (agentOnly) p.set("agentOnly", "1");
    // READ ON MOUNT, NEVER WRITTEN — the same defect the comment below records
    // for freshness and sort, on a third control. Explore links to
    // /jobs?activelyHiring=1 under the words "employers with a proven fill
    // record"; this effect rebuilt the query string without it, so the address
    // bar lost the promise before first paint and a reload or a shared link
    // served the whole board instead. The guarding test asserted only the READ
    // side, which is exactly how it survived.
    if (activelyHiringOnly) p.set("activelyHiring", "1");
    if (experience) p.set("experience", experience);
    if (country) p.set("country", country);
    if (salaryFloor) p.set("salaryFloor", String(salaryFloor));
    // WRITTEN AS WELL AS READ. Every filter added to this page that was read on
    // mount and never written back produced the same bug three times: the
    // control works, the address bar loses it, and a reload or a shared link
    // silently serves an unfiltered board under a chip that still says it is on.
    if (salaryCeiling) p.set("salaryCeiling", String(salaryCeiling));
    if (payBasis) p.set("payBasis", payBasis);
    if (statedPayOnly) p.set("statedPay", "1");
    if (includeUnstatedPay) p.set("inclUnstatedPay", "1");
    if (maxYears) p.set("maxYears", String(maxYears));
    if (department) p.set("department", department);
    if (vendor) p.set("vendor", vendor);
    // The detail panel's ?job= deep link isn't filter state — preserve it, or
    // this rewrite clobbers a shared link on mount before the panel can open.
    const jobParam = new URLSearchParams(window.location.search).get("job");
    if (jobParam) p.set("job", jobParam);
    // Freshness and sort were never written, so "Today"/"This week" and a
    // salary-sorted board both silently reverted on reload and could not be
    // shared. Measured: freshness narrowed 3,940 -> 965 in-session and came back
    // 3,940 after reloading the app's OWN url; ?sort=salary survived 0 of 1
    // mounts, which also broke Explore's "Where the pay is" links.
    if (freshness) p.set("fresh", freshness);
    if (sortMode === "salary") p.set("sort", sortMode);
    // `from` is only read into state at mount, so this rewrite stripped it and
    // took the Back-to-Explore affordance with it.
    const fromParam = new URLSearchParams(window.location.search).get("from");
    if (fromParam) p.set("from", fromParam);
    const qs = p.toString();
    // !workMode belongs in both gates: without it, picking Hybrid on a lander
    // kept the bare lander URL and reload/share silently dropped the filter.
    // agentOnly and inclUncat are filters too, and the lander form carries no
    // query string — dropping into it with either one on silently discards it
    // from a shared or reloaded link while the chip still shows on screen.
    // EVERY filter belongs in both gates. The lander form carries no query
    // string, so dropping into it with one of these on discards it from a
    // shared or reloaded link while the chip on screen still says it applies —
    // measured for workMode, agentOnly and inclUncat before, and true by
    // construction for each filter added since.
    const extraFilters = !!(salaryCeiling || payBasis || statedPayOnly || includeUnstatedPay || maxYears || department || vendor);
    if (landerCompany && company === landerCompany && !q && !location && !remoteOnly && !workMode && !category && !experience && !salaryFloor && !country && !freshness && !agentOnly && !extraFilters && sortMode !== "salary") {
      window.history.replaceState({}, "", `/jobs/company/${landerCompany}${jobParam ? `?job=${encodeURIComponent(jobParam)}` : ""}`);
      return;
    }
    if (landerCategory && category === landerCategory && !q && !location && !remoteOnly && !workMode && !company && !experience && !salaryFloor && !country && !freshness && !agentOnly && !inclUncat && !extraFilters && sortMode !== "salary") {
      window.history.replaceState({}, "", `/jobs/field/${landerCategory}${jobParam ? `?job=${encodeURIComponent(jobParam)}` : ""}`);
      return;
    }
    window.history.replaceState({}, "", qs ? `/jobs?${qs}` : "/jobs");
  }, [q, location, remoteOnly, workMode, company, category, inclUncat, agentOnly, activelyHiringOnly, experience, country, salaryFloor, salaryCeiling, payBasis, statedPayOnly, includeUnstatedPay, maxYears, department, vendor, freshness, sortMode, landerCategory, landerCompany]);

  // Category salary benchmarks: median advertised pay floor per field, computed
  // live from postings that state pay (RPC self-gates at n>=30 — a thin sample
  // returns no row and we show nothing). Fetched once, on first category view.
  const [benchmarks, setBenchmarks] = useState<Record<string, { n: number; median: number; currency: string }> | null>(null);
  const benchmarksAttempted = useRef(false);
  useEffect(() => {
    // Once per session, on mount: the category line needs it when a field is
    // selected, and the detail panel's salary context needs it for ANY posting.
    if (benchmarksAttempted.current) return;
    benchmarksAttempted.current = true;
    (async () => {
      // Promise.resolve assimilates the PostgREST builder (a thenable WITHOUT
      // .catch — calling .catch on it throws) into a real Promise.
      const call = () => Promise.resolve((supabase as unknown as { rpc: (fn: string) => Promise<{ data: unknown }> }).rpc("get_salary_benchmarks"));
      let { data: rows } = await call().catch(() => ({ data: null }));
      // Cold-cache RPCs can time out once and succeed warm — one spaced retry.
      if (!Array.isArray(rows) || rows.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        ({ data: rows } = await call().catch(() => ({ data: null })));
      }
      if (!Array.isArray(rows)) return;
      const map: Record<string, { n: number; median: number; currency: string }> = {};
      for (const r of rows as Array<{ category: string; currency?: string; n: number; median_annual_min: number }>) {
        if (r.category && r.n >= 30 && Number.isFinite(Number(r.median_annual_min))) {
          // Pre-currency RPC rows (no currency column yet) default to USD —
          // the dominant bucket — until the migration lands; post-migration
          // rows carry the real dominant currency per category.
          map[r.category] = { n: r.n, median: Number(r.median_annual_min), currency: r.currency ?? "USD" };
        }
      }
      setBenchmarks(map);
    })();
  }, []);

  // Debounced re-query on filter change (immediate on first mount).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      fetchJobs(0);
      return;
    }
    const h = setTimeout(() => fetchJobs(0), 400);
    return () => clearTimeout(h);
  }, [fetchJobs]);

  // Feature 1 (verify-on-apply): confirm a posting is still live on the
  // company's own board at the moment of interaction — the refresh window
  // means the board can be up to a slice-cycle behind a takedown. Returns
  // true if live (or unverifiable — never a false close); on a confirmed
  // close, drops the card for everyone here and tells the user.
  const verifyJob = async (job: BoardJob): Promise<boolean> => {
    try {
      const { data } = await supabase.functions.invoke("job-board", { body: { action: "verify", ids: [job.id] } });
      const live = (data as { live?: Record<string, boolean> })?.live;
      if (live && live[job.id] === false) {
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
        toast({
          title: t("jobsPage.postingClosedTitle", "That posting just closed"),
          description: t("jobsPage.postingClosedBody", "{{company}} took this one down. It's off the board now — the openings below are still live.", { company: job.company }),
        });
        return false;
      }
    } catch { /* unverifiable — don't block the user */ }
    return true;
  };

  // P1 detail panel: click a card → slide-over with the full stored JD, fit,
  // health and actions — the board becomes the destination instead of a list
  // of exits. ?job=id makes any posting shareable; the detail action returns
  // the posting row itself, so deep links work even when the posting isn't in
  // the currently loaded list.
  const [detailJob, setDetailJob] = useState<BoardJob | null>(null);
  const [detailDesc, setDetailDesc] = useState<string | null>(null);
  // Google for Jobs: schema.org JobPosting JSON-LD for the OPEN posting.
  // Client-rendered structured data is officially supported (Google indexes
  // after JS execution), and posting deep links are now in a sitemap, so a
  // crawler landing on /jobs?job=<id> renders the panel and finds this tag.
  // HONESTY FENCE: only fields we actually hold go into the markup —
  // datePosted only when the COMPANY stated a date, description only when
  // the real JD text is loaded (Google requires it, so no-desc postings emit
  // nothing), no invented salary. The tag is removed when the panel closes so
  // stale markup never lingers on other views.
  //
  // validThrough IS emitted, and it clears the fence because it is not the
  // company's application deadline (which we do not know and must not invent):
  // it is posted_at + 30 days — THIS BOARD's own serving guarantee. The board
  // hard-drops any dated posting past 30 days (FRESH_WINDOW_DAYS), so the URL
  // in this markup genuinely stops serving the posting at that instant. That is
  // exactly what validThrough means for the page it is on, it is one of
  // Google's three sanctioned expiry signals, and it is the only one that works
  // IN ADVANCE: Google learns the expiry on a routine recrawl of the LIVE page,
  // before the URL dies — instead of soft-404-classifying the corpse later
  // (GSC flagged exactly that on 2026-08-07, with ~16k URLs/day aging out).
  useEffect(() => {
    const TAG_ID = "job-posting-ld";
    document.getElementById(TAG_ID)?.remove();

    // CANONICAL: the prerendered /jobs page ships canonical=/jobs, which told
    // Google every ?job=<id> deep link — all ~70k sitemap URLs — was the same
    // page, silently defeating the per-posting sitemaps. While a posting is
    // open, the canonical points at ITS deep link; on close it is restored,
    // so filter/browse states still fold into /jobs as intended.
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const originalCanonical = canonical?.getAttribute("href") ?? null;
    if (canonical && detailJob) {
      canonical.setAttribute("href", `https://resumebooster.work/jobs?job=${encodeURIComponent(detailJob.id)}`);
    }
    const restoreCanonical = () => {
      if (canonical && originalCanonical) canonical.setAttribute("href", originalCanonical);
    };

    // JSON-LD gate: Google REQUIRES title, description, datePosted,
    // hiringOrganization, and a location (physical or TELECOMMUTE). A posting
    // missing any of them emits NOTHING — invalid markup is worse than none,
    // and inventing a date or place to satisfy the schema is off the table.
    const hasDate = !!detailJob?.postedAt;
    const hasPlace = detailJob?.workMode === "remote"
      ? !!(detailJob?.country || detailJob?.location)
      : !!detailJob?.location;
    if (!detailJob || !detailDesc || detailDesc.length < 100 || !hasDate || !hasPlace) {
      return restoreCanonical;
    }
    const ld: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: detailJob.title,
      description: detailDesc.slice(0, 4000),
      // Clamp to today (UTC): Workday date-only stamps parse as a future UTC
      // midnight for western timezones, and Google rejects future datePosted.
      // A company-stated "tomorrow" is, for every honest purpose, "today".
      datePosted: (detailJob.postedAt!.slice(0, 10) > new Date().toISOString().slice(0, 10)
        ? new Date().toISOString().slice(0, 10)
        : detailJob.postedAt!.slice(0, 10)),
      // The board's serving window, not a company deadline — see the fence
      // note above. Computed from the RAW postedAt (not the clamped
      // datePosted) so an already-old posting gets a validThrough in the
      // past, which Google correctly reads as "expired" — true, since the
      // 30-day cap is about to drop it.
      validThrough: new Date(Date.parse(detailJob.postedAt!.slice(0, 10)) + 30 * 86_400_000)
        .toISOString().slice(0, 10),
      hiringOrganization: { "@type": "Organization", name: detailJob.company },
      url: `https://resumebooster.work/jobs?job=${encodeURIComponent(detailJob.id)}`,
      directApply: false,
      identifier: { "@type": "PropertyValue", name: detailJob.company, value: detailJob.id },
      ...(detailJob.workMode === "remote"
        ? {
            jobLocationType: "TELECOMMUTE",
            // TELECOMMUTE requires applicantLocationRequirements when no
            // physical jobLocation is given — emit it only from a KNOWN
            // country; without one, fall back to the location text as a Place.
            ...(detailJob.country
              ? { applicantLocationRequirements: { "@type": "Country", name: detailJob.country } }
              : detailJob.location
                ? { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: detailJob.location.slice(0, 120) } } }
                : {}),
          }
        : { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: detailJob.location.slice(0, 120) } } }),
    };
    const tag = document.createElement("script");
    tag.type = "application/ld+json";
    tag.id = TAG_ID;
    tag.textContent = JSON.stringify(ld);
    document.head.appendChild(tag);
    return () => { document.getElementById(TAG_ID)?.remove(); restoreCanonical(); };
  }, [detailJob, detailDesc]);
  const [detailLoading, setDetailLoading] = useState(false);
  // The description could not be FETCHED — distinct from "this employer wrote
  // none", which renders as ordinary empty. Conflating the two told visitors a
  // falsehood about a named company and cached it.
  const [detailFailed, setDetailFailed] = useState(false);
  // URL mode per selection: an explicit card click PUSHES history (back button
  // closes the panel); keyboard/auto-selection REPLACES (arrowing through 30
  // postings must not create 30 history entries). Close undoes whichever the
  // current selection used.
  const detailPushed = useRef(false);
  // Per-open sequence for the detail fetch, and a flag recording that the user
  // deliberately closed the pane — desktop auto-select must not re-summon a
  // panel the user just dismissed (bug sweep 2026-07-26).
  const detailSeq = useRef(0);
  const userClosed = useRef(false);
  const swipeStartY = useRef<number | null>(null); // mobile sheet swipe-down-to-close
  // A11y focus contract for the overlay: focus moves INTO the dialog when it
  // opens and returns to wherever the user was when it closes.
  const overlayRef = useRef<HTMLElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (detailJob) {
      lastFocusRef.current = (document.activeElement as HTMLElement) ?? null;
      overlayRef.current?.focus();
    } else {
      lastFocusRef.current?.focus?.();
    }
  }, [detailJob]);
  const openDetail = useCallback(async (job: BoardJob, urlMode: "push" | "replace" | "none" = "push") => {
    // Race guard (same contract as similarSeq): arrowing down the list fires
    // openDetail per keystroke, and invokeBoard retries after 1.2s — so a slow
    // response for job A could land after the user moved to job B and paint
    // A's description under B's title (and into B's JSON-LD).
    const seq = ++detailSeq.current;
    userClosed.current = false; // an explicit open clears the "don't re-open" flag
    setDetailJob(job);
    // OPENS ARE LOGGED ONLY WHEN DELIBERATE. openDetail fires once per keystroke
    // while arrowing down the list, and again when a deep link restores a
    // posting on load — logging those raw would bury the real signal and inflate
    // click-through with rows nobody chose. The urlMode already separates them:
    // arrow navigation passes "replace", deep-link restore passes "none", and
    // every genuine click takes the "push" default.
    if (urlMode === "push") trackClick(job, "open");
    setDetailDesc(null);
    setDetailLoading(true);
    setDetailFailed(false);
    setViewedIds((prev) => {
      if (prev.has(job.id)) return prev;
      const next = new Set(prev).add(job.id);
      try { localStorage.setItem("rb_viewed_jobs", JSON.stringify([...next].slice(-1000))); } catch { /* session-only */ }
      return next;
    });
    // Jump-back-in strip: keep a tiny snapshot of the last few viewed jobs.
    try {
      const prevRecent: Array<{ id: string; title: string; company: string }> =
        JSON.parse(localStorage.getItem("rb_recent_jobs") ?? "[]");
      const nextRecent = [{ id: job.id, title: job.title, company: job.company },
        ...prevRecent.filter((r) => r.id !== job.id)].slice(0, 4);
      localStorage.setItem("rb_recent_jobs", JSON.stringify(nextRecent));
      setRecentJobs(nextRecent);
    } catch { /* cosmetic */ }
    if (urlMode !== "none") {
      const p = new URLSearchParams(window.location.search);
      p.set("job", job.id);
      const url = `${window.location.pathname}?${p.toString()}`;
      if (urlMode === "push" && !detailPushed.current) {
        window.history.pushState({ job: job.id }, "", url);
        detailPushed.current = true;
      } else {
        window.history.replaceState({ job: job.id }, "", url);
      }
    }
    // Verify-on-view: a posting not re-checked in 24h+ gets a background live
    // re-verify the moment someone actually looks at it — the postings people
    // SEE are the freshest, regardless of rotation position. Fire-and-forget.
    // Re-specified against recheckedAt (real feed-fetch time) with a 6h
    // threshold — the true feed p50 is ~1.5h, so 24h against a genuine value
    // would essentially never fire. NOTE: `!recheckedAt` must NOT trigger a
    // verify; the field is absent whenever the lookup failed or the posting is
    // already flagged missing, and firing there would hit the vendor on every
    // panel open for every visitor.
    if (job.recheckedAt && Date.now() - Date.parse(job.recheckedAt) > 6 * 3600_000) {
      invokeBoard({ action: "verify", ids: [job.id] }).catch(() => {});
    }
    // Hover-prefetch cache first: a warmed description opens the panel with
    // zero wait. Empty string = fetched-and-none; null = fetch in flight.
    const cached = descCache.current.get(job.id);
    if (typeof cached === "string") {
      if (seq !== detailSeq.current) return;
      setDetailDesc(cached || null);
      setDetailLoading(false);
      return;
    }
    try {
      // invokeBoard RETURNS errors, it does not throw — so the catch below
      // never fired on a failed fetch. `res` came back undefined, and
      // `res?.description ?? ""` wrote EMPTY STRING to the cache, which this
      // cache defines as "fetched, and this employer wrote no description".
      // A transient failure therefore became a permanent, confident, false
      // statement about a named company, and the cache meant it never
      // self-corrected for the rest of the session.
      const { data: res, error: detErr } = await invokeBoard<{ description?: string }>({ action: "detail", id: job.id });
      if (seq !== detailSeq.current) return; // superseded — never paint a stale JD
      if (detErr || !res) {
        // Do NOT cache. The next open retries, which is the behaviour a
        // visitor expects from something that failed.
        descCache.current.delete(job.id);
        setDetailFailed(true);
      } else {
        descCache.current.set(job.id, res.description ?? "");
        setDetailDesc(res.description ?? null);
      }
    } catch {
      if (seq !== detailSeq.current) return;
      descCache.current.delete(job.id);
      setDetailFailed(true);
    }
    if (seq !== detailSeq.current) return;
    setDetailLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openRecent = useCallback(async (id: string) => {
    const inList = jobs.find((j) => j.id === id);
    if (inList) { void openDetail(inList); return; }
    try {
      const { data: res } = await invokeBoard<{ job?: BoardJob | null }>({ action: "detail", id });
      if (res?.job) void openDetail(normalizeRow(res.job)); // last entry point that skipped hygiene
    } catch { /* posting may have closed — honest no-op */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);
  const closeDetail = useCallback((viaHistory = false) => {
    userClosed.current = true; // suppress desktop auto-select until the list changes
    setDetailJob(null);
    if (!viaHistory && new URLSearchParams(window.location.search).has("job")) {
      if (detailPushed.current) {
        detailPushed.current = false;
        window.history.back(); // pops the ?job entry we pushed
      } else {
        const p = new URLSearchParams(window.location.search);
        p.delete("job");
        const qs = p.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      }
    }
    if (viaHistory) detailPushed.current = false;
  }, []);
  // S3 in-panel discovery: real similar-roles via the ranked search (title
  // stripped of seniority/location noise), not just same-category rows from
  // the currently loaded page. Same-company rows are excluded — the
  // more-at-company drill-down owns those. Race-guarded per panel open.
  const [similarJobs, setSimilarJobs] = useState<BoardJob[]>([]);
  const similarSeq = useRef(0);
  useEffect(() => {
    setSimilarJobs([]);
    if (!detailJob) return;
    const seq = ++similarSeq.current;
    const NOISE = new Set(["senior", "sr", "junior", "jr", "staff", "lead", "principal", "associate", "assistant", "head", "director", "vp", "intern", "i", "ii", "iii", "iv", "v", "remote", "hybrid", "onsite", "contract", "temporary", "the", "of", "and", "for", "a", "an"]);
    const terms = detailJob.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !NOISE.has(w))
      .slice(0, 4)
      .join(" ");
    if (!terms) return;
    invokeBoard<{ jobs?: BoardJob[] }>({ action: "list", q: terms, limit: 12, includeFacets: false })
      .then(({ data }) => {
        if (seq !== similarSeq.current || !Array.isArray(data?.jobs)) return;
        setSimilarJobs(
          data.jobs
            .filter((j) => j.id !== detailJob.id && j.token !== detailJob.token)
            .slice(0, 5)
            .map(normalizeRow),
        );
      })
      .catch(() => { /* the same-category fallback still renders */ });
  }, [detailJob?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back button closes the panel; Escape too. Deep link opens it on load.
  useEffect(() => {
    const onPop = () => {
      if (!new URLSearchParams(window.location.search).has("job")) closeDetail(true);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDetail(); };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("keydown", onKey); };
  }, [closeDetail]);
  const deepLinkTried = useRef(false);
  // A shared ?job= link whose posting has closed. null = no dead link; title
  // present when the closure log knew the posting, so we can offer a search
  // for live siblings instead of a shrug.
  const [deadLink, setDeadLink] = useState<{ title: string | null; company: string | null } | null>(null);

  // GSC "Soft 404" (2026-08-07): a dead ?job= deep link renders this banner
  // under a head that says index,follow — the textbook soft-404 shape, and with
  // ~16k postings/day aging out of the 30-day window the dead-URL stream is
  // permanent, not a one-off from the 27k purge. noindex is the only expiry
  // signal a static SPA can send per-URL (no status-code lever on Lovable
  // hosting; Googlebot gets byte-identical HTML — verified). Google picks it up
  // when it re-renders each orphaned URL. Symmetric on purpose: cleared the
  // moment the state clears, so a crawler-visible flag can never linger over a
  // live board view reached from the same tab.
  useEffect(() => {
    if (!deadLink) return;
    const prevTitle = document.title;
    markDeadForRobots(t("jobsPage.deadLinkDocTitle", "Posting no longer available — Resume Booster"));
    return () => { clearDeadForRobots(); document.title = prevTitle; };
  }, [deadLink, t]);
  useEffect(() => {
    if (deepLinkTried.current) return;
    const id = new URLSearchParams(window.location.search).get("job");
    if (!id) { deepLinkTried.current = true; return; }
    const inList = jobs.find((j) => j.id === id);
    if (inList) {
      deepLinkTried.current = true;
      void openDetail(inList, "none");
    } else if (!loading) {
      // Loaded list doesn't contain it — the detail action resolves the row.
      // Gated on the FIRST LOAD SETTLING, not on jobs.length: a shared link
      // whose other filters happen to match nothing left the visitor with a
      // generic zero-state and no answer about the posting they clicked.
      deepLinkTried.current = true;
      (async () => {
        // Owns the panel from here — stamp the sequence so no concurrent
        // openDetail can paint its description under this posting.
        const seq = ++detailSeq.current;
        try {
          const { data: res } = await invokeBoard<{ job?: BoardJob | null; description?: string; closed?: { title: string; company: string | null; closedAt: string } }>({ action: "detail", id });
          if (seq !== detailSeq.current) return;
          if (res?.job) {
            setDetailJob(normalizeRow(res.job));
            setDetailDesc(res.description ?? null);
          } else if (res?.closed) {
            // The link's posting closed and we watched it happen — say so,
            // with what it was, and offer the search for live siblings. Closure
            // rows are stored verbatim from the feed, so they need the same
            // display hygiene every live row gets.
            setDeadLink({
              title: res.closed.title ? cleanJobTitle(res.closed.title) : res.closed.title,
              company: res.closed.company ? decodeNameEntities(res.closed.company) : res.closed.company,
            });
          } else {
            setDeadLink({ title: null, company: null });
          }
        } catch {
          // Dead link with no closure record: still tell the user their link
          // went somewhere real that is gone now, not just render the board
          // as if they never clicked anything.
          setDeadLink({ title: null, company: null });
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, loading]);

  // Report-a-posting: log the report, then honor it honestly — a "gone" report
  // triggers the same live re-check applying does, so a confirmed-dead posting
  // is pruned for everyone on the spot instead of sitting in a review queue.
  const reportJob = async (job: BoardJob, reason: "gone" | "misleading" | "other") => {
    setReportingId(null);
    setReportedIds((prev) => new Set(prev).add(job.id));
    try {
      await supabase.functions.invoke("job-board", { body: { action: "report", id: job.id, reason } });
    } catch { /* the report is best-effort — never block the user on telemetry */ }
    if (reason === "gone") {
      const stillLive = await verifyJob(job); // prunes + toasts if confirmed gone
      if (stillLive) {
        toast({
          title: t("jobsPage.reportCheckedTitle", "We just re-checked it"),
          description: t("jobsPage.reportCheckedBody", "{{company}}'s own board still lists this role as open. Thanks for flagging — we log every report.", { company: job.company }),
        });
      }
    } else {
      toast({
        title: t("jobsPage.reportThanksTitle", "Report received"),
        description: t("jobsPage.reportThanksBody", "Thanks — every report is logged and factors into which company boards we keep listing."),
      });
    }
  };

  const dismissJob = (job: BoardJob) => {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(job.id);
      try { localStorage.setItem("rb_dismissed_jobs", JSON.stringify([...next].slice(-500))); } catch { /* storage full/blocked — session-only */ }
      return next;
    });
  };
  const restoreDismissed = () => {
    setDismissedIds(new Set());
    try { localStorage.removeItem("rb_dismissed_jobs"); } catch { /* ignore */ }
  };

  // Watch-company: a saved search scoped to this employer — new postings show
  // up in the account's "new since last look" counts and the weekly digest.
  // Pure reuse of the saved-search machinery; nothing new to go stale.
  const watchCompany = async () => {
    if (!landerCompany) return;
    if (!session) return requireAuth();
    // digest_opt_in was never set here, so "watching" fed the account counts
    // but produced NO email, ever — the watch list had no outbound consumer.
    // A watch click is an explicit ask to hear about new roles: opt the
    // search into the DAILY alert loop (per-search unsubscribe in every
    // email), and the toast below says exactly that.
    let { error: err } = await searchesTable().insert({
      user_id: session.user.id,
      name: t("jobsPage.watchName", "New roles at {{company}}", { company: landerCompanyName }),
      params: { company: landerCompany },
      digest_opt_in: true,
      digest_cadence: "daily",
    });
    // Deploy-skew guard: if the cadence migration hasn't applied yet the
    // column doesn't exist — save the watch WITHOUT it rather than failing
    // the user's click on our own rollout gap (weekly emails until it lands).
    if (err && /digest_cadence/.test(err.message ?? "")) {
      ({ error: err } = await searchesTable().insert({
        user_id: session.user.id,
        name: t("jobsPage.watchName", "New roles at {{company}}", { company: landerCompanyName }),
        params: { company: landerCompany },
        digest_opt_in: true,
      }));
    }
    if (err && err.code === "23505") {
      toast({ title: t("jobsPage.watchExists", "You're already watching {{company}}.", { company: landerCompanyName }) });
      return;
    }
    if (err) {
      toast({ title: t("jobsPage.saveFailed", "Couldn't save — try again.") });
      return;
    }
    toast({
      title: t("jobsPage.watchSaved", "Watching {{company}}", { company: landerCompanyName }),
      description: `${t("jobsPage.watchSavedDescAlert", "We'll email you when they post new roles (daily at most — unsubscribe any time), and your account shows the new-since-last-look count.")} ${t("jobsPage.queueBridge", "Want ready-to-review picks every morning instead? The Apply Agent runs your search nightly — Morning Queue, in your account.")}`,
    });
  };

  const checkFit = async (job: BoardJob) => {
    setFitFetching(job.id);
    try {
      if (!(await verifyJob(job))) return;
      const { data: res, error: err } = await invokeBoard<{ description?: string }>({ action: "detail", id: job.id });
      const description: string | undefined = res?.description;
      if (err || !description) throw new Error(err?.message ?? "no description");
      sessionStorage.setItem(
        "rb_jd_handoff",
        JSON.stringify({ jd: description, title: job.title, company: job.company, applyUrl: job.applyUrl }),
      );
      navigate("/#upload");
    } catch (e) {
      console.error("[Jobs] detail failed:", e);
      toast({
        title: t("jobsPage.fitFetchErrorTitle", "Couldn't load that posting"),
        description: t("jobsPage.fitFetchError", "The company's feed didn't return the description. Open the posting and paste it into the scanner instead."),
      });
    } finally {
      setFitFetching(null);
    }
  };

  // Apply-agent entry point from a board card. Needs the user's resume (their
  // latest scan) and the posting's JD; then opens the drafting modal, which pulls
  // the REAL Greenhouse questions and grounds every answer in that resume.
  const prepareApplication = async (job: BoardJob) => {
    if (!session) return requireAuth();
    setPreparingId(job.id);
    try {
      const resume = await resolveFitResume();
      if (!resume) {
        toast({
          title: t("jobsPage.prepNeedsResumeTitle", "Scan your resume first"),
          description: t("jobsPage.prepNeedsResume", "Run the free scan (or save a resume version in your account) so the agent can ground every answer in your real experience."),
        });
        navigate("/#upload");
        return;
      }
      // Dedup guard: if this posting is already marked applied, warn before we
      // draft — re-applying to the same role is a known self-inflicted red flag.
      let alreadyApplied = false;
      try {
        const { data: existing } = await appsTable()
          .select("status, applied_at")
          .eq("user_id", session.user.id)
          .eq("job_id", job.id)
          .limit(1);
        alreadyApplied = Array.isArray(existing) && existing.some((r: { status?: string; applied_at?: string | null }) => r.status === "applied" || !!r.applied_at);
      } catch { /* dedup is advisory — never block on it */ }
      // The JD gives grounding context (and, for non-Greenhouse, the inferred
      // questions). Best-effort — drafting still works from the resume alone.
      let description: string | null = null;
      try {
        const { data: res } = await invokeBoard<{ description?: string }>({ action: "detail", id: job.id });
        description = res?.description ?? null;
      } catch { /* JD is optional */ }
      setPrepareJob({ job, description, alreadyApplied });
    } finally {
      setPreparingId(null);
    }
  };

  // Rewrite the résumé for the posting currently open in the prepare modal.
  // Grounded by generate-tailored-resume (deployed): it rewrites summary/bullets
  // toward the JD's real keywords and flags gaps — never invents experience.
  const tailorForRole = async () => {
    if (tailoredLoading || !prepareJob || !fitResume.current) return;
    setTailoredOpen(true);
    setTailoredLoading(true);
    setTailoredContent(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-tailored-resume", {
        body: {
          resumeText: fitResume.current,
          jobTitle: prepareJob.job.title,
          jobCompany: prepareJob.job.company,
          jobDescription: prepareJob.description || `${prepareJob.job.title} at ${prepareJob.job.company}.`,
        },
      });
      const d = data as (TailoredResumeContent & { success?: boolean }) | null;
      if (error || !d?.success) {
        const status = (error as { context?: { status?: number } })?.context?.status;
        toast({
          title: status === 429 ? t("jobsPage.tailorLimitTitle", "Hourly limit reached") : t("jobsPage.tailorErrorTitle", "Couldn't tailor your résumé"),
          description: status === 429
            // Honest 429: it's YOUR per-hour tailoring limit resetting, not
            // "the tailor is busy" — a personal quota misdescribed as load.
            ? t("jobsPage.tailorLimit", "You\u2019ve used this hour\u2019s résumé-tailoring runs \u2014 they reset within the hour. Everything you\u2019ve generated is saved.")
            : t("jobsPage.tailorError", "Something went wrong tailoring your résumé. Please try again."),
        });
        setTailoredOpen(false);
        return;
      }
      setTailoredContent(d);
    } catch {
      toast({ title: t("jobsPage.tailorErrorTitle", "Couldn't tailor your résumé"), description: t("jobsPage.tailorError", "Something went wrong tailoring your résumé. Please try again.") });
      setTailoredOpen(false);
    } finally {
      setTailoredLoading(false);
    }
  };

  // Draft a cover letter for the posting open in the prepare modal, grounded in
  // the user's résumé by the already-deployed generate-cover-letter.
  const draftCoverLetter = async () => {
    if (coverLoading || !prepareJob || !fitResume.current) return;
    setCoverOpen(true);
    setCoverLoading(true);
    setCoverText(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-cover-letter", {
        body: {
          resumeText: fitResume.current,
          jobTitle: prepareJob.job.title,
          jobCompany: prepareJob.job.company,
          jobDescription: prepareJob.description || `${prepareJob.job.title} at ${prepareJob.job.company}.`,
        },
      });
      const d = data as { success?: boolean; data?: { coverLetter?: string } } | null;
      const letter = d?.data?.coverLetter;
      if (error || !d?.success || !letter) {
        const status = (error as { context?: { status?: number } })?.context?.status;
        toast({
          title: status === 429 ? t("jobsPage.coverBusyTitle", "Busy right now") : t("jobsPage.coverErrorTitle", "Couldn't draft a cover letter"),
          description: status === 429
            ? t("jobsPage.coverBusy", "The cover-letter writer is busy — try again in a moment.")
            : t("jobsPage.coverError", "Something went wrong drafting your cover letter. Please try again."),
        });
        setCoverOpen(false);
        return;
      }
      setCoverText(letter);
    } catch {
      toast({ title: t("jobsPage.coverErrorTitle", "Couldn't draft a cover letter"), description: t("jobsPage.coverError", "Something went wrong drafting your cover letter. Please try again.") });
      setCoverOpen(false);
    } finally {
      setCoverLoading(false);
    }
  };

  // Likely interview questions for the posting open in the prepare modal, grounded
  // in the résumé + target role by the already-deployed generate-interview-coach.
  const prepInterview = async () => {
    if (coachLoading || !prepareJob || !fitResume.current) return;
    setCoachOpen(true);
    setCoachLoading(true);
    setCoachQuestions(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-interview-coach", {
        body: { resumeText: fitResume.current, targetRole: prepareJob.job.title, mode: "generate" },
      });
      const d = data as { success?: boolean; data?: { questions?: Array<{ category?: string; question?: string; whyAsked?: string }> } } | null;
      const qs = d?.data?.questions;
      if (error || !d?.success || !Array.isArray(qs) || qs.length === 0) {
        const status = (error as { context?: { status?: number } })?.context?.status;
        toast({
          title: status === 429 ? t("jobsPage.coachBusyTitle", "Busy right now") : t("jobsPage.coachErrorTitle", "Couldn't prep interview questions"),
          description: status === 429
            ? t("jobsPage.coachBusy", "The interview coach is busy — try again in a moment.")
            : t("jobsPage.coachError", "Something went wrong preparing questions. Please try again."),
        });
        setCoachOpen(false);
        return;
      }
      setCoachQuestions(qs.filter((x): x is { category?: string; question: string; whyAsked?: string } => typeof x?.question === "string" && !!x.question.trim()));
    } catch {
      toast({ title: t("jobsPage.coachErrorTitle", "Couldn't prep interview questions"), description: t("jobsPage.coachError", "Something went wrong preparing questions. Please try again.") });
      setCoachOpen(false);
    } finally {
      setCoachLoading(false);
    }
  };

  // Funnel events on the new decision surfaces — so the NEXT UX round is
  // picked by evidence, not judgment. Fire-and-forget, production-only
  // (postTrackEvent no-ops on localhost).
  const trackBoard = (variant: string, metadata?: Record<string, unknown>) => {
    const visitorId = getVisitorId();
    postTrackEvent({ testName: "job_board", variant, eventType: "view", visitorId, metadata });
  };
  /**
   * The click half of the relevance loop.
   *
   * Separate from trackApply on purpose. trackApply writes into the generic A/B
   * events table as {testName:"job_board", variant:"apply_click"} with company
   * and title — no query, no position, no search id — so it can say a click
   * happened but never which search earned it, which is the only thing that
   * makes relevance measurable. It also rides the analytics path that recorded
   * NOTHING for weeks when bad visitorId 400s were swallowed.
   *
   * Fire-and-forget by design: this runs as the visitor navigates to an
   * employer's site, so it must never block or throw into that path. The
   * failure is logged rather than silently dropped.
   */
  const trackClick = (job: BoardJob, kind: "open" | "apply") => {
    void supabase.functions
      .invoke("job-board", {
        body: {
          action: "click",
          postingId: job.id,
          searchId: job.searchId,
          position: job.rank,
          q: servedQuery.current?.q ?? "",
          kind,
        },
      })
      .catch((e) => console.warn("[Jobs] click beacon failed:", e));
  };

  const trackApply = (job: BoardJob) => {
    trackClick(job, "apply");
    const visitorId = getVisitorId();
    postTrackEvent({
      testName: "job_board",
      variant: "apply_click",
      eventType: "view",
      visitorId,
      metadata: { company: job.company, title: job.title.slice(0, 120) },
    });
  };

  // Résumé dropped straight onto the board: parse (same server parsers the
  // scanner uses), stash for this tab, and flip the board into fit-ranked mode
  // immediately — browsing becomes personal in one gesture.
  const handleBoardResumeFile = async (file: File) => {
    if (parsingResume) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: t("jobsPage.dropTooLarge", "That file is over 10 MB — export a lighter copy and try again."), variant: "destructive" });
      return;
    }
    setParsingResume(true);
    try {
      const name = file.name.toLowerCase();
      let text = "";
      if (file.type === "text/plain" || name.endsWith(".txt")) {
        text = await file.text();
      } else {
        const fn = file.type === "application/pdf" || name.endsWith(".pdf") ? "parse-pdf" : "parse-docx";
        const fd = new FormData();
        fd.append("file", file);
        const { data: parsed, error } = await supabase.functions.invoke(fn, { body: fd });
        const p = parsed as { success?: boolean; text?: string } | null;
        if (error || !p?.text) throw new Error("parse failed");
        text = p.text;
      }
      text = text.trim();
      if (text.length < 100) {
        toast({ title: t("jobsPage.dropTooShort", "We couldn't read enough text from that file — try the full scanner instead."), variant: "destructive" });
        return;
      }
      fitResume.current = text;
      try { sessionStorage.setItem("rb_board_resume", text); } catch { /* tab-only */ }
      fitAutoChecked.current = true;
      setResumeAvailable(true);
      setFitRanking(true);
      setShowOrientation(false);
      toast({ title: t("jobsPage.dropParsed", "Résumé loaded — ranking every opening around you.") });
    } catch {
      toast({ title: t("jobsPage.dropFailed", "Couldn't parse that file. The full free scan handles trickier formats."), variant: "destructive" });
    } finally {
      setParsingResume(false);
    }
  };

  const resolveFitResume = async (): Promise<string | null> => {
    if (fitResume.current) return fitResume.current;
    // 0) A résumé dropped directly on the board this session (the inline
    //    strip) — most immediate signal, survives reloads within the tab.
    try {
      const dropped = (sessionStorage.getItem("rb_board_resume") ?? "").trim();
      if (dropped.length >= 100) {
        fitResume.current = dropped;
        return dropped;
      }
    } catch { /* storage blocked — fall through */ }
    // 1) The account's PINNED matching résumé — an explicit choice beats every
    //    implicit source (matching_* columns postdate typegen → untyped access).
    if (session) {
      try {
        const { data: prof } = await (supabase as unknown as { from: (t: string) => any })
          .from("user_profiles")
          .select("matching_scan_id, matching_resume_text")
          .eq("user_id", session.user.id)
          .maybeSingle();
        const pinnedText = ((prof?.matching_resume_text as string | null) ?? "").trim();
        if (pinnedText.length >= 100) {
          fitResume.current = pinnedText;
          return pinnedText;
        }
        if (prof?.matching_scan_id) {
          const { data: pinned } = await (supabase as unknown as { from: (t: string) => any })
            .from("user_scans").select("resume_text").eq("id", prof.matching_scan_id).maybeSingle();
          const t = ((pinned?.resume_text as string | null) ?? "").trim();
          if (t.length >= 100) {
            fitResume.current = t;
            return t;
          }
        }
      } catch { /* fall through to implicit sources */ }
    }
    // 2) This session's fresh scan stash.
    try {
      const stashed = sessionStorage.getItem("rb_resume_for_fit");
      if (stashed && stashed.length >= 100) {
        fitResume.current = stashed;
        return stashed;
      }
    } catch { /* ignore */ }
    // 3) Latest scan (the long-standing default).
    if (session) {
      const { data } = await (supabase as unknown as { from: (t: string) => any })
        .from("user_scans")
        .select("resume_text")
        .not("resume_text", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      const text = data?.[0]?.resume_text;
      if (typeof text === "string" && text.length >= 100) {
        fitResume.current = text;
        return text;
      }
    }
    return null;
  };

  const toggleFitRanking = async () => {
    // Any manual interaction hands control to the user for the rest of the
    // session — auto-enable must never fight a deliberate choice.
    fitAutoChecked.current = true;
    if (fitRanking) {
      setFitRanking(false);
      return;
    }
    const resume = await resolveFitResume();
    if (!resume) {
      toast({
        title: t("jobsPage.fitNeedsResumeTitle", "Scan your resume first"),
        description: t("jobsPage.fitNeedsResume", "Run the free scan (or save a resume version in your account) and the board can rank every posting against it."),
      });
      navigate("/#upload");
      return;
    }
    setFitRanking(true);
  };

  // Score whatever's loaded whenever ranking is on.
  useEffect(() => {
    if (!fitRanking || jobs.length === 0) return;
    const unscored = jobs.filter((j) => !(j.id in fits)).map((j) => j.id);
    if (unscored.length === 0) return;
    (async () => {
      setFitLoading(true);
      try {
        const resume = await resolveFitResume();
        if (!resume) return;
        // A FAILED SCORING RUN USED TO LOOK EXACTLY LIKE A SUCCESSFUL ONE.
        //
        // This destructured only `{ data }`, so when the edge function returned
        // `{"code":"WORKER_RESOURCE_LIMIT","message":"Function failed due to not
        // having enough compute resources"}` the payload simply had no `fits`
        // key, every score stayed undefined, and nothing anywhere said so. The
        // board went on rendering "ordered by fit to your résumé" over an
        // unchanged list. Measured live: one landing page scored 5 of 60, and a
        // 60-id batch that returned WORKER_RESOURCE_LIMIT scored 60/60 on retry
        // — so this is a transient the user should be told about, not a
        // permanent limit, and silently swallowing it turns a retryable blip
        // into "the fit feature does nothing".
        let failed = 0;
        for (let i = 0; i < unscored.length; i += 60) {
          const { data, error } = await supabase.functions.invoke("job-board", {
            body: { action: "fit-batch", resumeText: resume, ids: unscored.slice(i, i + 60) },
          });
          const payload = data as { fits?: Record<string, number | null>; missing?: Record<string, string[]>; matched?: Record<string, string[]>; code?: string } | null;
          // No `fits` key is a failure, whether or not the transport errored —
          // the function can return 200 with an error body.
          if (error || !payload?.fits) {
            failed += Math.min(60, unscored.length - i);
            continue;
          }
          if (payload?.fits) setFits((prev) => ({ ...prev, ...payload.fits }));
          if (payload?.missing) setMisses((prev) => ({ ...prev, ...payload.missing }));
          if (payload?.matched) setHits((prev) => ({ ...prev, ...payload.matched }));
        }
        setFitFailedCount(failed);
      } finally {
        setFitLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRanking, jobs]);

  // Fit-first by default: the moment we can tell there's a resume to score
  // against (a fresh scan stashed this session, or the signed-in user's latest
  // scan), turn ranking on automatically so the board opens personalized — no
  // extra click. We only *lock* auto-management once a resume is actually found
  // (or the user manually toggles), so a null->signed-in session transition
  // still gets a shot at the DB lookup rather than being pre-empted by the
  // first, session-less run.
  useEffect(() => {
    if (fitAutoChecked.current || fitRanking) return;
    let cancelled = false;
    (async () => {
      const resume = await resolveFitResume();
      if (cancelled) return;
      setResumeAvailable(!!resume); // drives the "For you" upsell banner
      if (!resume) return; // no resume yet — stay unlocked, retry when session lands
      fitAutoChecked.current = true;
      setFitRanking(true);
    })();
    return () => { cancelled = true; };
    // session gates the DB lookup inside resolveFitResume; re-run when it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Batch-fetch hiring-health for the visible company tokens (one lookup each,
  // deduped via a ref so a missing RPC or repeat tokens never loop).
  useEffect(() => {
    const batch = Array.from(new Set(jobs.map((j) => j.token).filter((x): x is string => !!x)))
      .filter((tok) => !healthAttempted.current.has(tok))
      .slice(0, 200);
    if (batch.length === 0) return;
    batch.forEach((t) => healthAttempted.current.add(t));
    // A failure here used to vanish: badges simply did not render and the
    // "Actively hiring" filter quietly matched nothing, with the page giving no
    // sign anything was missing. Measured non-deterministic at the batch size
    // this very effect sends (26 tokens: 500 at 15.8s, then 200 at 7.1s on
    // retry). Absent data must read as absent, not as "no employer is hiring".
    setHealthFailed(false);
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as {
          rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_company_hiring_health", { p_tokens: batch });
        if (cancelled || !Array.isArray(data)) return;
        setHealthByToken((prev) => {
          const next = { ...prev };
          for (const row of data as Array<HiringHealth & { company_token?: string }>) {
            if (row?.company_token) next[row.company_token] = row;
          }
          return next;
        });
      } catch { if (!cancelled) setHealthFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [jobs]);

  const isActivelyHiring = useCallback(
    (tok?: string) => {
      if (!tok) return false;
      const h = healthByToken[tok];
      // Churn-dominated boards (more re-lists than fills) don't qualify — same
      // disqualifier the Explore fills list applies.
      return !!h && h.closed_90d >= ACTIVELY_HIRING_MIN_CLOSED && (h.superseded_90d ?? 0) <= h.closed_90d;
    },
    [healthByToken],
  );

  useEffect(() => { jobsCount.current = jobs.length; }, [jobs]);

  const displayJobs = useMemo(() => {
    let list = activelyHiringOnly ? jobs.filter((j) => isActivelyHiring(j.token)) : jobs;
    if (dismissedIds.size > 0) list = list.filter((j) => !dismissedIds.has(j.id));
    // Instant search: from the first keystroke until the server result for the
    // typed q/location lands, the visible list filters locally on the same
    // substring semantics — typing feels immediate, the server result (which
    // also matches department) replaces it moments later.
    if (q !== servedQuery.current.q || location !== servedQuery.current.location) {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      const locTerm = location.trim().toLowerCase();
      if (terms.length > 0 || locTerm) {
        const filtered = list.filter((j) => {
          const hay = `${j.title} ${j.company}`.toLowerCase();
          return terms.every((t) => hay.includes(t)) && (!locTerm || (j.location ?? "").toLowerCase().includes(locTerm));
        });
        // Only narrow when the loaded page actually contains matches — flashing
        // "no results" while the real query is still in flight would be a lie.
        if (filtered.length > 0) list = filtered;
      }
    }
    // A MISSING SCORE IS A DATA GAP, NOT A BAD MATCH.
    //
    // This was `(fits[b.id] ?? -1) - (fits[a.id] ?? -1)`, which sorts every
    // UNSCORED posting below every scored one — including below a posting that
    // scored 0. A posting is unscored when the employer publishes no description
    // we store, which says nothing whatever about the candidate's fit. Result:
    // an unscored Senior Software Engineer ranked beneath a 0%-fit warehouse
    // role, under a header claiming the list was ordered by fit.
    //
    // Now a stable partition: scored rows rise in descending score, unscored
    // rows keep their existing relevance/recency order behind them. Array.sort
    // is stable in every engine we target, so the second group is untouched.
    if (fitRanking) {
      const scored = list.filter((j) => typeof fits[j.id] === "number");
      const unscored = list.filter((j) => typeof fits[j.id] !== "number");
      scored.sort((a, b) => (fits[b.id] as number) - (fits[a.id] as number));
      list = [...scored, ...unscored];
    }
    return list;
  }, [jobs, fitRanking, fits, activelyHiringOnly, isActivelyHiring, dismissedIds, refreshing, q, location]);

  // De-dupe near-identical postings: the same role cross-posted across locations
  // (same company + same title) collapses into ONE card with a "+N more locations"
  // expander. Nothing is deleted — every posting is a real, distinct opening and
  // stays applyable inside the group; this only stops it flooding the list.
  // Countries visible in the rows we already hold. Used only when the facet RPC
  // fails; no counts are shown for these, because we genuinely do not know them.
  const fallbackCountries = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.country).filter((c): c is string => !!c))).sort(),
    [jobs],
  );

  /**
   * Weave employers together on the DEFAULT browse only.
   *
   * Off whenever the reader has expressed an intent the weave would fight:
   *  - a company filter or a /jobs/company lander — they asked for one employer
   *  - salary sort or fit ranking — an explicit ordering, and reordering it
   *    would make the sort label false
   *  - a search query — relevance order is the answer to what they typed
   * Freshness/recency browsing stays woven, which is the case that was broken.
   */
  const interleaveEmployers =
    !company && !landerCompany && !q && sortMode !== "salary" && !fitRanking;

  const groupedJobs = useMemo(() => {
    const map = new Map<string, { primary: BoardJob; siblings: BoardJob[] }>();
    const order: Array<{ primary: BoardJob; siblings: BoardJob[] }> = [];
    // Drop repeated ids BEFORE grouping. Pages are appended, and the corpus
    // shifts under a paginating reader (the cap deletes, ingest inserts), so the
    // same posting can legitimately arrive twice — measured up to 14 repeats per
    // 240 appended rows. Grouping keys on company+title, so a duplicate id
    // became a phantom "+1 more locations" sibling AND inflated both the
    // "Showing N" line and the load-more gate. One posting, one card.
    const seenIds = new Set<string>();
    for (const j of displayJobs) {
      if (seenIds.has(j.id)) continue;
      seenIds.add(j.id);
      const key = `${(j.token ?? j.company).toLowerCase()}|${j.title.trim().toLowerCase()}`;
      const g = map.get(key);
      if (g) {
        g.siblings.push(j);
      } else {
        const ng = { primary: j, siblings: [] as BoardJob[] };
        map.set(key, ng);
        order.push(ng);
      }
    }

    // PAGE 1 OF A 598,066-JOB BOARD WAS ELEVEN EMPLOYERS.
    //
    // The server sorts `effective_posted DESC, id ASC`, and `id` is
    // `vendor:token:jobid` — so every date tie collapses into a per-company
    // block. Measured live on the default view: 60 rows, 11 distinct companies,
    // including one unbroken run of 24 Republic postings and 13 PNC. On
    // /jobs/field/engineering, 20 companies with a 12-run of Parsons.
    //
    // A first-time visitor scrolls past two dozen near-identical rows from one
    // employer and concludes this is a scrape — the precise opposite of the
    // "verified, straight from the employer" claim in the hero above it. It
    // also hides the agent: 59 of the 60 default rows are Workday (walled), so
    // the "Agent can apply" chip never fires on the one screen everyone sees.
    //
    // ROUND-ROBIN, NOT A CAP. Nothing is dropped and nothing is hidden — the
    // same rows in a different order — so "Showing N" stays true, pagination is
    // unaffected, and no employer's postings become unreachable. Order WITHIN
    // each employer is preserved, so the newest role at any company still
    // outranks its older ones.
    //
    // Strict date order is genuinely relaxed, so the sort label says so rather
    // than claiming "newest first" and quietly meaning something else.
    if (!interleaveEmployers) return order;
    const byCompany = new Map<string, Array<{ primary: BoardJob; siblings: BoardJob[] }>>();
    for (const g of order) {
      const k = (g.primary.token ?? g.primary.company ?? "").toLowerCase();
      const bucket = byCompany.get(k);
      if (bucket) bucket.push(g); else byCompany.set(k, [g]);
    }
    // Buckets keep first-appearance order, so the employer holding the single
    // newest posting still leads the page.
    const buckets = [...byCompany.values()];
    const woven: typeof order = [];
    for (let round = 0; woven.length < order.length; round++) {
      let placed = false;
      for (const b of buckets) {
        if (round < b.length) { woven.push(b[round]); placed = true; }
      }
      if (!placed) break; // exhausted — cannot loop forever
    }
    return woven;
  }, [displayJobs, interleaveEmployers]);

  // What the summary may honestly call "shown". `jobs.length` was the FETCHED
  // page, but the rendered list is narrowed further by the Actively-hiring
  // toggle and by dismissals — turning that toggle on left 6 cards on screen
  // under a line reading "Showing 60". Counting grouped rows also matches what
  // a user can actually point at, since collapsed duplicates render as one card.
  const shownCount = groupedJobs.length;
  /**
   * How many postings this search reaches, across BOTH segments.
   *
   * `data.total` is the exact segment — titles that match — and a page can hold
   * rows from the related segment too, so anything reading `total` alone as
   * "how many results" prints 0 over a full page. Falls back to the rows on
   * screen when the server sent no total at all, which is what the branches
   * below did individually before they shared one definition.
   */
  const pageTotalCount = (data?.total ?? 0) + (data?.relatedTotal ?? 0) || (data?.total ?? jobs.length);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // New-since-last-visit: where the divider goes in the (recency-sorted) list —
  // the first posting dated before your previous visit. Only meaningful on the
  // default sort with no fit re-ordering; -1 disables the divider.
  const newSinceIndex = useMemo(() => {
    const last = lastVisitRef.current;
    if (!last || sortMode !== "newest" || fitRanking) return -1;
    const idx = groupedJobs.findIndex((g) => {
      const p = g.primary.postedAt ? new Date(g.primary.postedAt).getTime() : 0;
      return p <= last;
    });
    return idx > 0 ? idx : -1; // 0 = nothing new; -1 = everything new / unknown
  }, [groupedJobs, sortMode, fitRanking]);

  // Split-pane auto-select: on wide screens the right column should never sit
  // empty — select the top result once the list settles. replace-mode URL so
  // browsing never piles up history entries.
  useEffect(() => {
    if (loading || refreshing || detailJob || groupedJobs.length === 0) return;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    // Never steal a pending deep link. Gating on deepLinkTried was NOT enough
    // (measured in production after the first fix): effects run in declaration
    // order, so the deep-link effect above flips that flag synchronously before
    // its async fetch resolves, and auto-select still replaceState'd the top
    // card's id over the shared URL. The live check is "does the URL name a
    // posting we haven't opened yet" — true from load until the deep link
    // resolves, dead-ends, or the user opens something themselves.
    const pendingJob = new URLSearchParams(window.location.search).get("job");
    if (pendingJob && pendingJob !== detailJob?.id) return;
    // Never re-summon a panel the user closed — the ✕/Escape/Back used to be
    // instantly undone here, so the pane could not be closed at all on desktop.
    if (userClosed.current) return;
    void openDetail(groupedJobs[0].primary, "replace");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, refreshing, detailJob, groupedJobs]);

  // Keyboard browsing: ↑/↓ (or j/k) move the selection through the list,
  // Enter opens Apply for the selected posting (desktop split-pane only).
  // Never intercepts keys while the user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      // Enter on a focused CONTROL belongs to that control. Without this the
      // window handler also fired for every button/link keypress — activating
      // "Save" or a card title by keyboard opened the selected job's apply tab
      // AND wrote a tracker row marked applied for a job the user never
      // applied to (bug sweep 2026-07-26).
      if (typeof el?.closest === "function" && el.closest("button, a, [role='button'], summary, label")) return;
      const list = groupedJobs.map((g) => g.primary);
      if (list.length === 0) return;
      // ARROWS SCROLL A PAGE. THAT IS NOT NEGOTIABLE, AND WE TOOK IT AWAY.
      //
      // This handler is on `window` and the guards above only exempt form
      // fields and controls — so on a cold load, where nothing is focused and
      // e.target is <body>, ArrowDown reached here and was preventDefault'd.
      // The results page is 16,038px tall on desktop and 21,971px on mobile,
      // and neither arrow key moved it. Every keyboard user, every session,
      // on the two keys most likely to be pressed first.
      //
      // So the arrows only steer the list when the reader is actually IN the
      // list; anywhere else the browser scrolls as it always should. j/k stay
      // global because they scroll nothing natively — nothing is taken away
      // by claiming them.
      const inList = typeof el?.closest === "function" && !!el.closest("[data-job-id]");
      const isVim = e.key === "j" || e.key === "k";
      const isDown = (e.key === "ArrowDown" && inList) || e.key === "j";
      const isUp = (e.key === "ArrowUp" && inList) || e.key === "k";
      if (!isVim && (e.key === "ArrowDown" || e.key === "ArrowUp") && !inList) return;
      if (isDown || isUp) {
        e.preventDefault();
        const idx = detailJob ? list.findIndex((j) => j.id === detailJob.id) : -1;
        const next = isDown ? Math.min(idx + 1, list.length - 1) : Math.max(idx - 1, 0);
        const job = list[next];
        if (job && job.id !== detailJob?.id) {
          void openDetail(job, "replace");
          document.querySelector(`[data-job-id="${CSS.escape(job.id)}"]`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "Enter" && detailJob && window.matchMedia("(min-width: 1024px)").matches) {
        window.open(detailJob.applyUrl, "_blank", "noopener,noreferrer");
        trackApply(detailJob);
        void promoteApplied(detailJob);
        void verifyJob(detailJob);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedJobs, detailJob]);

  // Aggregate the per-card tiers into one motivating headline for the personalized
  // view — the reason a returning seeker stays. Counts only SCORED postings among
  // the ones loaded (same thresholds as the card tiers), so "these openings" is
  // honest: it's what's on the board here, not a claim about all 164k.
  const fitSummary = useMemo(() => {
    if (!fitRanking) return null;
    let strong = 0, possible = 0, scored = 0;
    for (const j of jobs) {
      const f = fits[j.id];
      if (typeof f !== "number") continue;
      scored++;
      if (f >= 20) strong++;
      else if (f >= 10) possible++;
    }
    return { strong, possible, scored };
  }, [fitRanking, jobs, fits]);

  // Skill-unlock: the single missing keyword that appears across the most of
  // the user's scored postings, weighted toward near-misses (Possible band —
  // the ones closest to becoming Strong). Honest framing only: we report where
  // the keyword is missing, never a promised tier jump (the client can't
  // recompute exact coverage). Floor of 3 occurrences — no advice off noise.
  // JD boilerplate is excluded: "add requirements to your résumé" is not advice.
  const JD_NOISE = useMemo(() => new Set([
    "requirements", "requirement", "responsibilities", "responsibility", "qualifications",
    "qualification", "benefits", "description", "opportunity", "opportunities", "candidate",
    "candidates", "applicant", "applicants", "employment", "position", "positions", "duties",
    "role", "roles", "job", "jobs", "salary", "compensation", "company", "employer",
  ]), []);
  const skillUnlock = useMemo(() => {
    if (!fitRanking) return null;
    const counts = new Map<string, { n: number; possible: number }>();
    for (const j of jobs) {
      const f = fits[j.id];
      const miss = misses[j.id];
      if (typeof f !== "number" || !miss) continue;
      for (const k of miss) {
        if (JD_NOISE.has(k.toLowerCase().trim())) continue;
        const e = counts.get(k) ?? { n: 0, possible: 0 };
        e.n++;
        if (f >= 10 && f < 20) e.possible++;
        counts.set(k, e);
      }
    }
    let best: { k: string; n: number; possible: number } | null = null;
    for (const [k, e] of counts) {
      if (!best || e.possible > best.possible || (e.possible === best.possible && e.n > best.n)) best = { k, ...e };
    }
    return best && best.n >= 3 ? best : null;
  }, [fitRanking, jobs, fits, misses, JD_NOISE]);

  // Per-company open-role counts from the (global) company facet, so each card
  // can show a hiring-intent signal. The facet holds the top companies by count —
  // exactly the ones where "actively hiring" is worth surfacing; smaller ones
  // simply don't get the chip.
  const companyCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data?.companies ?? []) m.set(c.token, c.count);
    return m;
  }, [data]);

  // Display name for a company landing page: the real name from a loaded posting
  // (or the facet), falling back to the prettified token until data arrives.
  const landerCompanyName = useMemo(() => {
    if (!landerCompany) return undefined;
    return jobs.find((j) => j.token === landerCompany)?.company
      ?? data?.companies?.find((c) => c.token === landerCompany)?.name
      ?? prettyToken(landerCompany);
  }, [landerCompany, jobs, data]);

  // Company-page hiring-health: one lifecycle-derived lookup per company page.
  useEffect(() => {
    if (!landerCompany) { setHiringHealth(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: rows } = await (supabase as unknown as {
          rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_company_hiring_health", { p_tokens: [landerCompany] });
        const row = Array.isArray(rows) ? (rows[0] as HiringHealth | undefined) : undefined;
        if (!cancelled) setHiringHealth(row ?? null);
      } catch {
        if (!cancelled) setHiringHealth(null); // non-fatal — the panel just hides
      }
    })();
    return () => { cancelled = true; };
  }, [landerCompany]);

  // Category-lander intel: how fast roles in THIS field actually close, from
  // the closure log (get_category_fill_speed, n>=300 per category — the RPC
  // returns no row below the floor, and we show nothing rather than a guess).
  const [fillSpeed, setFillSpeed] = useState<{ median: number; p75: number; n: number; window: number } | null>(null);
  useEffect(() => {
    if (!landerCategory) { setFillSpeed(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: rows } = await (supabase as unknown as {
          rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_category_fill_speed");
        const row = Array.isArray(rows)
          ? (rows as Array<{ category: string; closures: number; median_days_open: number; p75_days_open: number; window_days: number }>)
              .find((r) => r.category === landerCategory)
          : undefined;
        if (!cancelled) {
          setFillSpeed(row ? { median: Number(row.median_days_open), p75: Number(row.p75_days_open), n: Number(row.closures), window: Number(row.window_days) } : null);
        }
      } catch {
        if (!cancelled) setFillSpeed(null); // additive — the lander stands without it
      }
    })();
    return () => { cancelled = true; };
  }, [landerCategory]);

  const companies = useMemo(
    () => (data?.companies ?? []).filter((c) => c.count > 0 || c.token === company).sort((a, b) => a.name.localeCompare(b.name)),
    [data, company],
  );

  // Badge on the mobile Filters button: how many secondary filters are active
  // (q lives in the always-visible search bar, so it doesn't count).
  const activeFilterCount = useMemo(
    // DERIVED, not re-listed. This was a hand-written array and it is the badge
    // that tells a phone user how much is hiding behind the Filters button — a
    // filter missing from it is a filter narrowing the board invisibly.
    // activelyHiringOnly is added on because it is a browser-side filter with no
    // request key, so the mechanical derivation cannot see it.
    () => activeBoardFilterKeys(filterState).length + (activelyHiringOnly ? 1 : 0),
    [filterState, activelyHiringOnly],
  );

  // Keep the last facet we were handed, and use it to replace a vague capped
  // total with the exact one when the ONLY thing narrowing the board is a single
  // category. The facet is computed over the same serving rule as the results, so
  // for `category=X and nothing else` the facet count IS that filter's true
  // total — we were rendering "10,000+" beside a facet reading 67,929.
  //
  // Conditions are deliberately narrow. The facet knows counts per category and
  // nothing else, so the moment a second filter is active (a country, a query, a
  // work mode) the facet describes a DIFFERENT question than the results, and
  // substituting it would print a confidently wrong number in place of an
  // honestly vague one. That trade only goes one way.
  // exactCategoryTotal REMOVED (added earlier today, reverted the same day).
  //
  // The idea was sound — a lone category filter makes the facet count the same
  // question, so show 67,929 instead of a vague "10,000+". The facet is not that
  // number. get_job_board_facets counts the whole table with NO serving-rule
  // predicate, while every page the board actually serves is filtered by
  // `missing_since IS NULL` and the 30-day window. So the figure includes
  // postings the board itself refuses to show, and I published it as an EXACT
  // total, in place of a caveated one.
  //
  // Trading an honestly vague number for a confidently wrong one is the wrong
  // direction, and it is exactly what the fence forbids: we show nothing rather
  // than a guess. "10,000+" is true. Restoring it.
  //
  // A correct version needs a serving-rule-filtered per-category count, which is
  // a DB change, not a frontend one — worth doing, not worth faking meanwhile.

  // Removable chips for every active filter — what's narrowing your results
  // should be visible and one click to undo, not buried in the controls.
  const activeFilters = useMemo(() => {
    const f: Array<{ key: string; label: string; clear: () => void }> = [];
    if (q) f.push({ key: "q", label: `“${q}”`, clear: () => setQ("") });
    if (location) f.push({ key: "location", label: location, clear: () => setLocation("") });
    // A comma-joined selection cannot be a translation key — asking for
    // `categories.design,legal` resolves to nothing and the chip renders the raw
    // slug list. One field names itself; several get a count, the same way the
    // employer chip already does rather than printing a wall of tokens.
    if (category) {
      const cats = category.split(",").filter(Boolean);
      f.push({
        key: "category",
        label: cats.length === 1
          ? t(`jobsPage.categories.${cats[0]}`, cats[0])
          : t("jobsPage.nFields", "{{n}} fields", { n: cats.length }),
        clear: () => setCategory(""),
      });
    }
    // A comma-joined selection cannot be a translation key, the same trap the
    // category chip above records: `experience.senior,expert` resolves to
    // nothing and the chip prints the raw slug list.
    if (experience) {
      const bands = experience.split(",").filter(Boolean);
      f.push({
        key: "experience",
        label: bands.length === 1
          ? t(`jobsPage.experience.${bands[0]}`, bands[0])
          : t("jobsPage.nExperience", "{{n}} levels", { n: bands.length }),
        clear: () => setExperience(""),
      });
    }
    if (maxYears) f.push({ key: "maxYears", label: t("jobsPage.maxYearsOption", "Asks {{n}} yrs or fewer", { n: maxYears }), clear: () => setMaxYears(0) });
    // A multi-employer filter gets a count, not a 400-character wall of raw
    // tokens. One employer still shows its name — the resolved display name
    // where the facet knows it, the token only as a last resort.
    if (companyTokens.length > 1) {
      f.push({ key: "company", label: t("jobsPage.companiesChip", "{{n}} companies", { n: companyTokens.length }), clear: () => setCompany("") });
    } else if (company) {
      f.push({ key: "company", label: companies.find((c) => c.token === company)?.name ?? company, clear: () => setCompany("") });
    }
    if (country) {
      const cs = country.split(",").filter(Boolean);
      f.push({
        key: "country",
        label: cs.length === 1 ? cs[0] : t("jobsPage.nCountries", "{{n}} countries", { n: cs.length }),
        clear: () => setCountry(""),
      });
    }
    if (salaryFloor > 0) f.push({ key: "salaryFloor", label: `$${salaryFloor / 1000}k+`, clear: () => setSalaryFloor(0) });
    if (salaryCeiling > 0) f.push({ key: "salaryCeiling", label: `≤$${salaryCeiling / 1000}k`, clear: () => setSalaryCeiling(0) });
    if (payBasis) f.push({ key: "payBasis", label: payBasis === "hourly" ? t("jobsPage.payBasisHourly", "Paid hourly") : t("jobsPage.payBasisSalaried", "Salaried"), clear: () => setPayBasis("") });
    if (statedPayOnly) f.push({ key: "statedPay", label: t("jobsPage.statedPay", "States pay"), clear: () => setStatedPayOnly(false) });
    if (includeUnstatedPay) f.push({ key: "inclUnstatedPay", label: t("jobsPage.inclUnstatedPay", "Incl. unstated pay"), clear: () => setIncludeUnstatedPay(false) });
    if (department) f.push({ key: "department", label: department, clear: () => setDepartment("") });
    if (vendor) {
      const vs = vendor.split(",").filter(Boolean);
      f.push({
        key: "vendor",
        label: vs.length === 1
          ? (VENDOR_OPTIONS.find((v) => v.value === vs[0])?.label ?? vs[0])
          : t("jobsPage.nVendors", "{{n}} sources", { n: vs.length }),
        clear: () => setVendor(""),
      });
    }
    if (remoteOnly && !workMode) f.push({ key: "remote", label: t("jobsPage.remoteBadge", "Remote"), clear: () => setRemoteOnly(false) });
    // ONE CHIP PER MODE, each independently removable. Interpolating the whole
    // value into `jobsPage.workMode.${workMode}` would ask for a key like
    // "workMode.remote,hybrid", which does not exist — the fallback would print
    // the raw comma-joined string at a visitor.
    for (const m of splitModes(workMode)) {
      f.push({
        key: `mode:${m}`,
        label: t(`jobsPage.workMode.${m}`, m),
        // FUNCTIONAL UPDATE, because "Clear all" invokes every chip's clear() in
        // one pass. Each closure captured the SAME `workMode`, so removing
        // "remote" queued "hybrid" and removing "hybrid" queued "remote" — last
        // write won and the board stayed filtered by one mode after the visitor
        // asked for no filters at all. Reading `prev` makes the removals compose
        // instead of overwrite, and fixes rapid successive chip clicks too.
        clear: () => { setWorkMode((prev) => withoutMode(prev, m)); setRemoteOnly(false); },
      });
    }
    // A LABEL PER STEP, not a two-way guess. With only "day" and "week" in the
    // state a ternary covered it; over 1..30 the same ternary would print "This
    // week" on a fourteen-day window.
    if (freshness) {
      f.push({
        key: "freshness",
        label: freshness === "1"
          ? t("jobsPage.freshDay", "Today")
          : freshness === "7"
          ? t("jobsPage.freshWeek", "This week")
          : t("jobsPage.freshDays", "Last {{n}} days", { n: Number(freshness) }),
        clear: () => setFreshness(""),
      });
    }
    // THREE FILTERS USED TO NARROW THE BOARD WITH NO CHIP AND NO WAY OUT.
    //
    // "Clear all" is literally `activeFilters.forEach((f) => f.clear())`, so
    // this array IS the definition of what a filter is. agentOnly, inclUncat and
    // activelyHiringOnly were never in it: they survived Clear all, they were
    // missing from activeFilterCount (the number on the mobile Filters button),
    // and nothing on screen said they were on. agentOnly is the most aggressive
    // filter the board has — it hides ~95% of postings, keeping only the ~5% on
    // vendors the apply agent can drive — and a visitor could leave it switched
    // on believing they had cleared everything.
    if (agentOnly) f.push({ key: "agentOnly", label: t("jobsPage.chipAgentOnly", "Agent can apply"), clear: () => setAgentOnly(false) });
    if (activelyHiringOnly) f.push({ key: "activelyHiring", label: t("jobsPage.chipActivelyHiring", "Actively hiring"), clear: () => setActivelyHiringOnly(false) });
    // A WIDENING toggle, so it gets a chip for visibility and for Clear all, but
    // it only means anything alongside a category.
    if (category && inclUncat) f.push({ key: "inclUncat", label: t("jobsPage.chipInclUncat", "+ unsorted"), clear: () => setInclUncat(false) });
    return f;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, location, category, experience, maxYears, company, companyTokens, country, salaryFloor, salaryCeiling, payBasis, statedPayOnly, department, vendor, remoteOnly, workMode, freshness, companies, agentOnly, activelyHiringOnly, inclUncat, t]);
  // S1: search suggestions — recent searches (local), matching companies
  // (served facet), matching category pages, and a curated common-role list.
  // Everything suggested is real and clickable; nothing invented.
  // D2: list density — compact triples postings per screen for power scanning.
  const [density, setDensity] = useState<"comfortable" | "compact">(() => {
    // GUARDED, like every other storage read in this file except this one was.
    // localStorage ACCESS THROWS — not returns null — when site data is blocked
    // (Chrome "Block all cookies", some in-app and embedded browsers, a
    // sandboxed iframe). This runs in a useState initializer, so the throw
    // happened during render and took the entire board down before first paint:
    // a blank page, not a lost preference.
    try {
      return localStorage.getItem("rb_density") === "compact" ? "compact" : "comfortable";
    } catch {
      return "comfortable";
    }
  });
  const toggleDensity = () => setDensity((d) => {
    const next = d === "comfortable" ? "compact" : "comfortable";
    try { localStorage.setItem("rb_density", next); } catch { /* session-only */ }
    return next;
  });
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("rb_recent_searches") ?? "[]"); } catch { return []; }
  });
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return;
    const id = setTimeout(() => {
      setRecentSearches((prev) => {
        const next = [term, ...prev.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 6);
        try { localStorage.setItem("rb_recent_searches", JSON.stringify(next)); } catch { /* cosmetic */ }
        return next;
      });
    }, 2500); // only remember searches the user actually dwelt on
    return () => clearTimeout(id);
  }, [q]);
  const COMMON_ROLES = ["software engineer", "product manager", "data analyst", "registered nurse", "project manager", "account executive", "customer success", "marketing manager", "designer", "accountant", "devops", "recruiter"];
  const suggestions = useMemo(() => {
    const term = q.trim().toLowerCase();
    const recents = (term ? recentSearches.filter((r) => r.toLowerCase().includes(term) && r.toLowerCase() !== term) : recentSearches).slice(0, 4);
    const comps = term.length >= 2 ? companies.filter((c) => c.name.toLowerCase().includes(term)).slice(0, 4) : [];
    const cats = term.length >= 2
      ? CATEGORY_IDS.filter((c) => t(`jobsPage.categories.${c}`, c).toLowerCase().includes(term)).slice(0, 3)
      : [];
    const roles = term.length >= 2 ? COMMON_ROLES.filter((r) => r.includes(term) && r !== term).slice(0, 4) : COMMON_ROLES.slice(0, 6);
    return { recents, comps, cats, roles, count: recents.length + comps.length + cats.length + roles.length };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, recentSearches, companies, t]);
  const flatSuggestions = useMemo(() => [
    ...suggestions.recents.map((v) => ({ kind: "recent" as const, value: v, label: v })),
    ...suggestions.roles.map((v) => ({ kind: "role" as const, value: v, label: v })),
    ...suggestions.comps.map((c) => ({ kind: "company" as const, value: c.token, label: c.name })),
    ...suggestions.cats.map((c) => ({ kind: "category" as const, value: c, label: t(`jobsPage.categories.${c}`, c) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [suggestions, t]);
  const applySuggestion = useCallback((sug: { kind: string; value: string }) => {
    if (sug.kind === "company") { setCompany(sug.value); setQ(""); }
    else if (sug.kind === "category") { setCategory(sug.value); setQ(""); }
    else setQ(sug.value);
    setSuggestOpen(false); setSuggestIdx(-1);
  }, []);

  const paletteActions: PaletteAction[] = useMemo(() => [
    { id: "search", label: t("jobsPage.paFocusSearch", "Search postings"), hint: "/", run: () => (document.getElementById("board-search") as HTMLInputElement | null)?.focus() },
    { id: "remote", label: hasMode(workMode, "remote") ? t("jobsPage.paRemoteOff", "Show all locations") : t("jobsPage.paRemoteOn", "Remote only"), run: () => { setWorkMode(toggleMode(workMode, "remote")); setRemoteOnly(false); } },
    { id: "week", label: t("jobsPage.paWeek", "Posted this week"), run: () => setFreshness("7") },
    { id: "today", label: t("jobsPage.paToday", "Posted today"), run: () => setFreshness("1") },
    { id: "entry", label: t("jobsPage.paEntry", "Entry-level roles"), run: () => setExperience("entry") },
    { id: "salary100", label: t("jobsPage.paSalary", "Stated pay $100k+"), run: () => setSalaryFloor(100000) },
    { id: "clear", label: t("jobsPage.paClear", "Clear all filters"), run: () => activeFilters.forEach((f) => f.clear()) },
    { id: "saved", label: t("jobsPage.paSaved", "My saved jobs & tracker"), run: () => { window.location.href = "/account"; } },
    { id: "ghost", label: t("jobsPage.paGhost", "Ghost Job Index"), run: () => { window.location.href = "/ghost-job-index"; } },
    { id: "scan", label: t("jobsPage.paScan", "Scan my resume (free)"), run: () => { window.location.href = "/#scan"; } },
    { id: "help", label: t("jobsPage.paHelp", "Keyboard shortcuts"), hint: "?", run: () => setHelpOpen(true) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [remoteOnly, workMode, activeFilters, t]);


  // Smart zero-result help: when the server really has nothing for this
  // combination, measure which single relaxation helps most (a few cheap
  // countOnly calls, cached per filter signature) and offer it as a button —
  // an actionable exit instead of a dead end. Feeds the same honest instinct
  // as the zero-result telemetry: never pad results, just say what would work.
  const [zeroHelp, setZeroHelp] = useState<Array<{ key: string; label: string; count: number; capped: boolean; clear: () => void }> | null>(null);
  const zeroSigRef = useRef("");
  useEffect(() => {
    // ROWS ON SCREEN MEAN THIS IS NOT A ZERO RESULT. `data.total` is the EXACT
    // segment, so a query matching only in descriptions has total 0 and a full
    // page — and without the second term every such search burned a four-probe
    // countOnly burst to offer "remove a filter" help underneath results the
    // visitor is already reading.
    if (loading || refreshing || error || !data || data.total !== 0 || jobs.length > 0) { setZeroHelp(null); return; }
    const sig = JSON.stringify([boardFilterBody(filterState), jobs.length > 0]);
    if (zeroSigRef.current === sig) return;
    zeroSigRef.current = sig;
    // The probe must carry EVERY active filter. It used to build its own body
    // and had already drifted twice: it omitted workMode and country (each
    // "remove X → N results" button was counted against a looser query than the
    // one on screen), and it sent `remote: remoteOnly` where the list sends
    // `(remoteOnly && !workMode)`. A rescue count that overstates is a broken
    // promise at the exact moment the visitor is most likely to give up, so
    // this now asks the SAME derivation the page was served from.
    // A RELAXATION IS A CHANGE OF STATE, NOT A PATCH TO THE BODY. Each entry
    // switches one control off and the body is DERIVED again, so a relaxation
    // can never disagree with the request the page was served from — the way
    // the body patches it replaced already had: they patched `companies` while
    // the list sends it from companyTokens, and `remote` while the list sends
    // `(remoteOnly && !workMode)`.
    //
    // One entry per chip key. A chip with no entry relaxes nothing, so its
    // button would re-count the identical query and hand a stuck visitor a way
    // out that leads back to the same zero.
    const RELAX: Record<string, Partial<BoardFilterState>> = {
      q: { q: "" }, location: { location: "" }, category: { category: "" },
      experience: { experience: "" }, company: { companyTokens: [] },
      salaryFloor: { salaryFloor: 0 }, remote: { remoteOnly: false }, freshness: { freshness: "" },
      mode: { workMode: "", remoteOnly: false }, country: { country: "" },
      salaryCeiling: { salaryCeiling: 0 }, payBasis: { payBasis: "" },
      statedPay: { statedPayOnly: false }, maxYears: { maxYears: 0 },
      department: { department: "" }, vendor: { vendor: "" },
      agentOnly: { agentOnly: false }, inclUncat: { inclUncat: false },
    };
    const candidates = activeFilters.slice(0, 4);
    let cancelled = false;
    (async () => {
      const results = await Promise.all(candidates.map(async (c) => {
        try {
          // countCapped was dropped by the type parameter, so a relaxation
          // whose count hit the server ceiling advertised the cap as an exact
          // figure: "Remove country — 10,000 openings" when the truth is more.
          // This is the same defect just fixed server-side, surviving on the
          // client because the flag was never asked for.
          const { data: r } = await invokeBoard<{ total?: number; relatedTotal?: number; countCapped?: boolean; relatedCapped?: boolean }>({
            action: "list", countOnly: true, includeFacets: false,
            ...boardFilterBody({ ...filterState, ...RELAX[c.key] }),
          });
          // BOTH SEGMENTS, and before the `> 0` filter below. Counting only the
          // exact segment would advertise "1 opening" for a relaxation that
          // surfaces 94 rows, or drop the button entirely when the relaxation
          // surfaces nothing but description matches — which is the case a
          // stuck visitor most needs offered.
          return { ...c, count: (r?.total ?? 0) + (r?.relatedTotal ?? 0), capped: r?.countCapped === true || r?.relatedCapped === true };
        } catch { return { ...c, count: 0, capped: false }; }
      }));
      if (!cancelled) setZeroHelp(results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count));
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, refreshing, error, data, activeFilters, filterState]);

  // Disclosure-aware filtering: some filters can only match postings whose
  // employer DISCLOSED the field, so switching one on silently drops every
  // posting that simply didn't say. Measured on the live board: a $80k floor
  // takes 572,348 postings to 10,374 — a 98% collapse that is mostly silence,
  // not low pay (only ~4% of postings state salary at all; work mode ~8%).
  // Without this the user reads a small number as "this board is empty" instead
  // of "this many employers were willing to tell me". One extra countOnly with
  // the disclosure filter dropped gives the honest denominator; it only fires
  // while such a filter is active, so the common path costs nothing.
  const [disclosure, setDisclosure] = useState<{ kind: "salary" | "workMode"; shown: number; hidden: number } | null>(null);
  const discSigRef = useRef("");
  useEffect(() => {
    // Category is the same defect in a different coat: 35% of the board was
    // unclassifiable at the last audit, and picking a field silently drops all
    // of it. The honest denominator here is NOT "everything without the filter"
    // (the user doesn't want other fields) — it's specifically the postings we
    // couldn't classify, so we count category='other' against the same filters.
    // EVERY pay control counts as the pay disclosure, not just the floor. The
    // ceiling, the hourly/salaried basis and the stated-pay flag all read the
    // same published figure and hide the same silent majority; only the floor
    // used to trigger this line, so the three new ways to ask the question
    // would each have hidden 80% of the board without the sentence that says so.
    const kind: "salary" | "workMode" | null =
      (salaryFloor || salaryCeiling || payBasis || statedPayOnly) ? "salary"
        : (workMode || remoteOnly) ? "workMode" : null;
    if (!kind || loading || refreshing || error || !data || typeof data.total !== "number" || data.total === 0) {
      setDisclosure(null);
      discSigRef.current = "";
      return;
    }
    const sig = JSON.stringify([kind, boardFilterBody(filterState), data.total]);
    if (discSigRef.current === sig) return;
    discSigRef.current = sig;
    let cancelled = false;
    (async () => {
      try {
        const { data: r } = await invokeBoard<{ total?: number; countCapped?: boolean }>({
          action: "list", countOnly: true, includeFacets: false,
          // Drop ONLY the disclosure-dependent controls and re-derive; every
          // other constraint stays. The whole pay BAND goes together — floor,
          // ceiling, basis and the stated-pay flag all narrow to the same
          // published figure, so dropping one and keeping the others would
          // count a denominator that is still hiding the postings this line
          // exists to count.
          ...boardFilterBody({
            ...filterState,
            ...(kind === "salary"
              ? { salaryFloor: 0, salaryCeiling: 0, payBasis: "" as const, statedPayOnly: false }
              : { workMode: "" as const, remoteOnly: false }),
          }),
        });
        const without = r?.total;
        if (cancelled || typeof without !== "number") return;
        // The server caps this count at 10,000 and flags it. Subtracting the
        // filtered total from a CAPPED total and presenting the difference as
        // exact understates it without bound: measured hidden 9,863 against a
        // true 19,361 — 49.1% short. If the denominator is capped we cannot
        // state the gap, so we say nothing rather than a comfortable number.
        if (r?.countCapped) { setDisclosure(null); return; }
        const hidden = without - data.total;
        // Only worth saying when the silent majority is actually large.
        setDisclosure(hidden > data.total ? { kind, shown: data.total, hidden } : null);
      } catch { /* advisory only — never block the board */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, refreshing, error, data, salaryFloor, salaryCeiling, payBasis, statedPayOnly, workMode, remoteOnly, filterState]);

  // Inline keyword highlighting: the posting's own text with the fit
  // keywords marked in place — green for terms the resume covers, amber for
  // gaps. Only possible because we hold both sides; no other board can.
  // JD headings that mark a section start. Conservative: a short standalone
  // line matching a known heading — anything else renders as before. EN plus
  // the highest-frequency DE/FR/ES equivalents on the board.
  const JD_HEADING = /^\s*(what you(?:'|’)ll (?:do|be doing)|responsibilities|your (?:role|mission|profile|tasks)|the role|role overview|requirements|qualifications|what (?:you(?:'|’)ll|we(?:'|’)re looking for|you bring|we offer|we expect)|about (?:you|us|the role|the team|the job)|who you are|nice to have(?:s)?|bonus points|benefits|perks|compensation|why (?:join|you(?:'|’)ll love it)|skills(?: (?:&|and) experience)?|duties|deine aufgaben|dein profil|wir bieten|vos missions|votre profil|tus funciones|requisitos|beneficios|ofrecemos)\s*:?\s*$/i;

  const descContent = useMemo(() => {
    if (!detailDesc || !detailJob) return null;
    const clean = decodeEntities(detailDesc);
    const hitList = (hits[detailJob.id] ?? []).filter((k) => k.length > 1);
    const missList = (misses[detailJob.id] ?? []).filter((k) => k.length > 1);
    const hitSet = new Set(hitList.map((k) => k.toLowerCase()));
    const missSet = new Set(missList.map((k) => k.toLowerCase()));
    const esc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = hitList.length + missList.length > 0
      ? new RegExp(`(${[...hitList, ...missList].map(esc).join("|")})`, "gi")
      : null;
    const renderText = (text: string, keyBase: string) => {
      if (!re) return <>{text}</>;
      return (
        <>
          {text.split(re).map((part, i) => {
            const lower = part.toLowerCase();
            if (hitSet.has(lower)) return <mark key={`${keyBase}-${i}`} className="bg-success/20 text-success rounded px-0.5">{part}</mark>;
            if (missSet.has(lower)) return <mark key={`${keyBase}-${i}`} className="bg-warning/20 text-warning rounded px-0.5">{part}</mark>;
            return part;
          })}
        </>
      );
    };
    // Sectionize: split on heading lines; needs >=2 real headings to engage.
    const lines = clean.split("\n");
    const sections: Array<{ title: string | null; body: string[] }> = [{ title: null, body: [] }];
    for (const line of lines) {
      if (line.trim().length <= 60 && JD_HEADING.test(line)) {
        sections.push({ title: line.trim().replace(/:\s*$/, ""), body: [] });
      } else {
        sections[sections.length - 1].body.push(line);
      }
    }
    const titled = sections.filter((sec) => sec.title);
    if (titled.length < 2) {
      return { sections: null, plain: renderText(clean, "p") };
    }
    return {
      plain: null,
      sections: sections
        .map((sec) => ({ title: sec.title, text: sec.body.join("\n").trim() }))
        .filter((sec) => sec.title !== null ? true : sec.text.length > 0)
        .map((sec, si) => ({ title: sec.title, node: renderText(sec.text, `s${si}`) })),
    };
  }, [detailDesc, detailJob, hits, misses]);
  const descHasHighlights = !!detailJob && ((hits[detailJob.id]?.length ?? 0) + (misses[detailJob.id]?.length ?? 0)) > 0;

  // Salary context: the posting's own stated pay vs the field's live median —
  // shown only when the currencies MATCH (never converted, never mixed) and a
  // real benchmark exists (n>=30 gate lives in the RPC).
  const detailSalaryContext = useMemo(() => {
    if (!detailJob?.salary || !detailJob.category || !benchmarks) return null;
    const b = benchmarks[detailJob.category];
    if (!b) return null;
    const p = parseSalaryStructured(detailJob.salary);
    if (!p?.annualMin || !p.currency || p.currency !== b.currency) return null;
    const pct = Math.round(((p.annualMin - b.median) / b.median) * 100);
    return { median: b.median, currency: b.currency, n: b.n, pct };
  }, [detailJob, benchmarks]);

  // Detail content rendered by BOTH containers — the overlay drawer below
  // lg and the inline split-pane column on lg+. Only one is visible at a
  // time (responsive classes), so duplicate mounting is harmless.
  const detailInner = detailJob ? (
    <>
            {/* Below lg the header sticks (the bottom bar owns actions there);
                on lg+ it scrolls and the actions row sticks instead — two
                bars both pinned to top-0 painted over each other (live-walk
                a11y finding: the actions bar covered the title mid-scroll). */}
            <div className="sticky lg:static top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-5 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold leading-snug">{detailJob.title}</h2>
                <p className="text-sm text-muted-foreground">
                  <Link to={`/jobs/company/${detailJob.token}`} className="text-primary hover:underline" onClick={() => closeDetail()}>
                    {detailJob.company}
                  </Link>
                  {detailJob.location ? <> · {detailJob.location}</> : null}
                </p>
              </div>
              {/* 40px tap target with a visible resting state — the bare 20px
                  glyph was effectively invisible on phones (a11y finding). */}
              <button
                type="button"
                aria-label={t("jobsPage.detailClose", "Close")}
                className="shrink-0 inline-flex items-center justify-center w-10 h-10 -mr-2 -mt-1 rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted text-xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => closeDetail()}
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 text-success">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {t("jobsPage.trustBadge", "Verified direct from {{company}}", { company: companyDisplayName(detailJob.company) })}
                </span>
                {/* recheckedAt comes from job_board_verifications.verified_at —
                    when we last fetched THIS BOARD's feed. It replaces lastSeen,
                    which is written at INSERT only and never rewritten, so the
                    old chip was showing discovery time under a tooltip claiming
                    re-verification. Absent => render nothing rather than
                    substitute a weaker value. */}
                {detailJob.recheckedAt && (
                  <span
                    className="text-muted-foreground"
                    title={t("jobsPage.recheckedTip", "When we last re-read this company's own feed")}
                  >
                    {t("jobsPage.rechecked", "feed re-read {{ago}}", { ago: agoLabel(detailJob.recheckedAt, t) })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}/jobs?job=${encodeURIComponent(detailJob.id)}`;
                    const done = (ok: boolean) => toast({ title: ok
                      ? t("jobsPage.shareCopied", "Link copied — anyone can open this posting")
                      : t("jobsPage.shareFailed", "Couldn't copy the link") });
                    try {
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
                      } else {
                        // Clipboard API unavailable (e.g. embedded preview) — legacy path.
                        const ta = document.createElement("textarea");
                        ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
                        document.body.appendChild(ta); ta.select();
                        const ok = document.execCommand("copy");
                        ta.remove(); done(ok);
                      }
                    } catch { done(false); }
                  }}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  title={t("jobsPage.shareTip", "Copy a direct link to this posting")}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  {t("jobsPage.share", "Share")}
                </button>
                {(detailJob.workMode || (detailJob.remote ? "remote" : null)) && (
                  <Badge variant="secondary" className="text-[10px]">
                    {t(`jobsPage.workMode.${detailJob.workMode ?? "remote"}`, detailJob.workMode ?? "remote")}
                  </Badge>
                )}
                {/* Same chip, on the panel where the decision is actually made.
                    The card is skimmed; this is read. */}
                {isSendableVendor(detailJob.id) && (
                  <Link
                    to="/agent"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    title={t("jobsPage.agentAppliesTip", "This employer's application form is one our apply agent can fill and submit on its own — no CAPTCHA and no account needed. It still hands the application back to you if the employer asks something we can't answer from your profile. Needs the Apply Agent subscription.")}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {t("jobsPage.agentAppliesChip", "Agent can apply")}
                  </Link>
                )}
                {detailJob.experienceBand && detailJob.experienceBand !== "unspecified" && (
                  <span className="px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                    {t(`jobsPage.experience.${detailJob.experienceBand}`, detailJob.experienceBand)}
                  </span>
                )}
                {daysAgo(detailJob.postedAt) !== null && (
                  <span
                    className="text-muted-foreground"
                    title={t("jobsPage.postedProvenance", "Posting age from the date the company states on its own careers feed — undated postings show no age, never a guess")}
                  >
                    {daysAgo(detailJob.postedAt) === 0
                      ? t("jobsPage.postedToday", "today")
                      : t("jobsPage.postedDaysAgo", "{{count}}d ago", { count: daysAgo(detailJob.postedAt) })}
                    {" · "}
                    <span className="text-[11px]">{t("jobsPage.companyStated", "company-stated")}</span>
                  </span>
                )}
                {/* Same positive form as the list card: an undated posting
                    states its observation window instead of nothing. Muted,
                    never fresh-styled — discovery is not freshness. */}
                {daysAgo(detailJob.postedAt) === null && daysAgo(detailJob.lastSeen ?? null) !== null && (
                  <span
                    className="text-muted-foreground"
                    title={t("jobsPage.firstSeenProvenance", "This employer states no posting date, so no age is shown. This is when the posting first appeared on our board — it caps how old the posting can be, but it is our discovery date, not the employer's.")}
                  >
                    {daysAgo(detailJob.lastSeen ?? null) === 0
                      ? t("jobsPage.firstSeenToday", "first seen today")
                      : t("jobsPage.firstSeenDaysAgo", "first seen {{count}}d ago", { count: daysAgo(detailJob.lastSeen ?? null) })}
                  </span>
                )}
                {isActivelyHiring(detailJob.token) && (
                  <span className="inline-flex items-center gap-1 text-success">
                    <Activity className="w-3 h-3" />
                    {t("jobsPage.hhActive", "Actively hiring")}
                  </span>
                )}
              </div>
              {detailJob.salary && (
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    <span title={detailJob.salary}>
                      {displaySalary(detailJob.salary)}
                      {detailJob.salaryMinAnnual != null && detailJob.salaryPeriod && detailJob.salaryPeriod !== "year" && (
                        <span className="text-muted-foreground font-normal">
                          {" · "}
                          {t("jobsPage.salaryAnnualized", "≈{{range}}/year as stated", {
                            range: detailJob.salaryMaxAnnual && detailJob.salaryMaxAnnual > detailJob.salaryMinAnnual
                              ? `${Math.round(detailJob.salaryMinAnnual / 1000)}k–${Math.round(detailJob.salaryMaxAnnual / 1000)}k`
                              : `${Math.round(detailJob.salaryMinAnnual / 1000)}k`,
                          })}
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] font-normal text-muted-foreground"> · {t("jobsPage.salaryVerbatim", "as stated in the posting")}</span>
                  </p>
                  {detailSalaryContext && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {t("jobsPage.salaryContext", "Field median floor: {{sym}}{{median}} ({{currency}}, from {{n}} postings that state pay)", {
                        sym: { USD: "$", EUR: "€", GBP: "£" }[detailSalaryContext.currency] ?? "",
                        median: Math.round(detailSalaryContext.median).toLocaleString(),
                        currency: detailSalaryContext.currency,
                        n: detailSalaryContext.n,
                      })}
                      {/* Basis suffix: the median blends hourly/monthly rates
                          annualized (hourly ×2080) — without saying so the
                          number reads as a pure annual-salary median. */}
                      {" · "}{t("jobsPage.salaryContextBasis", "hourly, daily and monthly rates annualized (hourly ×2080, daily ×260); part-time and casual rates are left un-annualized")}
                      {detailSalaryContext.pct !== 0 && (
                        <span className={detailSalaryContext.pct > 0 ? "text-success" : "text-warning"}>
                          {" · "}
                          {detailSalaryContext.pct > 0
                            ? t("jobsPage.salaryAbove", "{{pct}}% above the median floor", { pct: detailSalaryContext.pct })
                            : t("jobsPage.salaryBelow", "{{pct}}% below the median floor", { pct: Math.abs(detailSalaryContext.pct) })}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              )}
              {/* Sticky on the lg+ pane only. Below lg this row scrolls with
                  the content: it and the sticky title header were both pinned
                  to top-0 and painted over each other (live-walk a11y
                  finding) — and the pinned bottom bar keeps Apply/Save in
                  thumb reach there anyway. */}
              {/* THE INBOUND ACTION COMES FIRST AND IS THE FILLED ONE.
                  This pane used to lead with "Apply on company site" as the
                  primary while "Check my fit — free scan" sat second in outline
                  — so at the moment of highest intent, the loudest thing on
                  screen sent the visitor OFF the site for good. The board's
                  whole argument is "check your fit before you spend an
                  application"; the buttons argued the opposite.
                  Apply is still right here, one tap away, just not shouting. */}
              <div className="flex flex-wrap gap-2 lg:sticky top-0 z-10 bg-card/95 backdrop-blur-sm py-2 -mt-2">
                <Button size="sm" className="gap-1.5" disabled={fitFetching === detailJob.id} onClick={() => checkFit(detailJob)}>
                  {fitFetching === detailJob.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
                  {t("jobsPage.checkFit", "Check my fit — free scan")}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" asChild>
                  <a
                    href={detailJob.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => { trackApply(detailJob); void promoteApplied(detailJob); void verifyJob(detailJob); }}
                  >
                    {t("jobsPage.applyShort", "Apply on company site")}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </Button>
                {REAL_QUESTION_PREFIXES.some((p) => detailJob.id.startsWith(p)) && (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={preparingId === detailJob.id} onClick={() => prepareApplication(detailJob)}>
                    {preparingId === detailJob.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                    {t("jobsPage.prepAnswers", "Prep answers")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="px-2" aria-label={t("jobsPage.saveJob", "Save")} onClick={() => saveJob(detailJob)}>
                  {savedIds.has(detailJob.id) ? <BookmarkCheck className="w-4 h-4 text-primary" /> : <Bookmark className="w-4 h-4" />}
                </Button>
                {/* Desktop-only close: this row is the part that stays pinned
                    on lg+, so without it the pane's only ✕ (in the header)
                    scrolls out of reach and the pane can't be dismissed. */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="hidden lg:inline-flex px-2 ml-auto"
                  aria-label={t("jobsPage.detailClose", "Close")}
                  onClick={() => closeDetail()}
                >
                  <span aria-hidden="true" className="text-base leading-none">✕</span>
                </Button>
              </div>
              {/* Company drill-down: every posting viewed is a jumping-off
                  point — the count comes from the same live facet the company
                  filter uses. Shown from 2 roles (1 = just this posting). */}
              {(() => {
                const cnt = detailJob.token ? companies.find((c) => c.token === detailJob.token)?.count : undefined;
                return typeof cnt === "number" && cnt >= 2 ? (
                  <button
                    type="button"
                    className="text-[12px] text-primary hover:underline text-left"
                    onClick={() => { setCompany(detailJob.token!); closeDetail(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  >
                    {t("jobsPage.moreAtCompany", "{{n}} more open roles at {{company}} — see them all", { n: cnt - 1, company: detailJob.company })}
                  </button>
                ) : null;
              })()}
              {/* Decision synthesis — "should I apply?" from data we OWN: fit
                  score, the company's stated posting age, its genuine-fill
                  record, and its re-listing churn. Every clause renders only
                  when its data exists; the close-time clause stays gated on
                  >= 21d of tracking (right-censoring rule). */}
              {(() => {
                const hh = detailJob.token ? healthByToken[detailJob.token] : undefined;
                const f = fits[detailJob.id];
                const age = daysAgo(detailJob.postedAt);
                const fills = hh?.closed_90d ?? 0;
                const churn = hh?.superseded_90d ?? 0;
                const clauses: string[] = [];
                if (typeof f === "number") {
                  clauses.push(f >= 20
                    ? t("jobsPage.verdictFitStrong", "strong keyword fit for your résumé")
                    : f >= 10
                      ? t("jobsPage.verdictFitPossible", "possible fit — check the gaps below")
                      : t("jobsPage.verdictFitStretch", "a stretch for your current résumé"));
                }
                if (typeof age === "number" && age <= 3) clauses.push(t("jobsPage.verdictFresh", "posted {{d}}d ago — early applicants get read", { d: age }));
                if (hh && fills >= 3 && churn <= fills) clauses.push(t("jobsPage.verdictFills", "this company genuinely fills roles ({{n}} in our tracking)", { n: fills }));
                if (hh && churn > fills && churn >= 10) clauses.push(t("jobsPage.verdictChurn", "re-lists roles often ({{n}}×) — responses may be slow", { n: churn }));
                if (hh && hh.median_days_to_close != null && hh.tracking_days >= 21 && hh.median_days_to_close <= 14) {
                  clauses.push(t("jobsPage.verdictSpeed", "typically fills within ~{{d}} days", { d: Math.round(hh.median_days_to_close) }));
                }
                if (clauses.length === 0) return null;
                const caution = churn > fills && churn >= 10;
                const go = !caution && typeof f === "number" && f >= 20 && fills >= 3 && typeof age === "number" && age <= 7;
                return (
                  <div className={`rounded-xl border p-3 text-sm ${go ? "border-success/40 bg-success/5" : caution ? "border-warning/40 bg-warning/5" : "border-border bg-muted/30"}`}>
                    <p className={`font-semibold mb-0.5 ${go ? "text-success" : caution ? "text-warning" : "text-foreground"}`}>
                      {go
                        ? t("jobsPage.verdictGo", "Worth applying now")
                        : caution
                          ? t("jobsPage.verdictCaution", "Apply with expectations")
                          : t("jobsPage.verdictNeutral", "What the data says")}
                    </p>
                    <p className="text-[13px] text-muted-foreground">{clauses.join(" · ")}</p>
                  </div>
                );
              })()}
              {/* About this employer: the sourced company facts (headcount,
                  SEC financials, declared H-1B wages) at the decision point —
                  previously lander-only. On small screens it renders after the
                  description instead, so the JD leads. */}
              {!isSmallScreen && (
                <EmployerContext companyToken={detailJob.token} companyName={detailJob.company} postingTitle={detailJob.title} />
              )}
              {/* Inline fit: never leave the posting to learn your score. With
                  a resume on file but ranking off, one click scores in place;
                  while scores load, say so; without a resume the actions row's
                  "Check my fit" owns the scan handoff. */}
              {typeof fits[detailJob.id] !== "number" && resumeAvailable && !fitRanking && (
                <button
                  type="button"
                  onClick={toggleFitRanking}
                  className="w-full rounded-xl border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors p-3 text-sm text-left flex items-center gap-2"
                >
                  <Target className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-foreground font-medium">
                    {t("jobsPage.detailFitCta", "Show my fit score for this role — uses your saved resume")}
                  </span>
                </button>
              )}
              {fitRanking && fits[detailJob.id] === undefined && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("jobsPage.detailFitLoading", "Scoring this posting against your resume…")}
                </div>
              )}
              {typeof fits[detailJob.id] === "number" && (
                <div className="rounded-xl border border-border bg-card p-3 text-sm">
                  <p className="font-semibold mb-1">
                    {t("jobsPage.detailFit", "Your keyword fit: {{pct}}%", { pct: fits[detailJob.id] })}
                  </p>
                  {(hits[detailJob.id]?.length ?? 0) > 0 && (
                    <p className="text-[12px] text-muted-foreground">
                      {t("jobsPage.matchedKeywords", "You already have:")} {hits[detailJob.id]!.slice(0, 6).join(", ")}
                    </p>
                  )}
                  {(misses[detailJob.id]?.length ?? 0) > 0 && (
                    <p className="text-[12px] text-muted-foreground">
                      {t("jobsPage.missingKeywords", "Missing from your resume:")} {misses[detailJob.id]!.slice(0, 6).join(", ")}
                    </p>
                  )}
                </div>
              )}
              {detailLoading ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </div>
              ) : detailFailed ? (
                /* A FETCH FAILURE, not an employer who wrote nothing. The
                   difference matters: the old code rendered the second message
                   for both, so a transient error became a false statement
                   about a named company — and it was cached, so reopening the
                   job repeated it. A retry is offered because it usually
                   works. */
                <div className="py-6 text-center">
                  <p className="text-sm text-muted-foreground mb-3">
                    {t("jobsPage.descFailed", "We couldn't load this description just now.")}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => detailJob && void openDetail(detailJob)}>
                    {t("jobsPage.retry", "Try again")}
                  </Button>
                </div>
              ) : detailDesc ? (
                <div>
                  {descHasHighlights && (
                    <p className="text-[11px] text-muted-foreground mb-2">
                      <mark className="bg-success/20 text-success rounded px-1">{t("jobsPage.hlHave", "in your resume")}</mark>{" · "}
                      <mark className="bg-warning/20 text-warning rounded px-1">{t("jobsPage.hlMissing", "missing from it")}</mark>
                    </p>
                  )}
                  {descContent?.sections ? (
                    <div className="max-w-[72ch] space-y-1">
                      {descContent.sections.map((sec, i) => sec.title ? (
                        <details key={i} open={!isSmallScreen && i <= 2} className="group rounded-lg border border-border/60"
                          onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) trackBoard("jd_section_open", { title: sec.title?.slice(0, 40) }); }}>
                          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-foreground list-none flex items-center justify-between focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-lg">
                            {sec.title}
                            <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                          </summary>
                          <div className="px-3 pb-3 text-sm text-muted-foreground whitespace-pre-line leading-7">{sec.node}</div>
                        </details>
                      ) : (
                        <div key={i} className="text-sm text-muted-foreground whitespace-pre-line leading-7">{sec.node}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground whitespace-pre-line leading-7 max-w-[72ch]">{descContent?.plain}</div>
                  )}
                  {isSmallScreen && (
                    <div className="mt-3">
                      <EmployerContext companyToken={detailJob.token} companyName={detailJob.company} postingTitle={detailJob.title} />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {t("jobsPage.detailNoDesc", "This company's feed doesn't publish the full description — the complete posting is on their own site via Apply.")}
                </p>
              )}
              {/* Similar roles: title-similarity from the ranked search across
                  the WHOLE board (excluding this company); while that loads —
                  or when it finds nothing — fall back to same-category rows
                  from the loaded page, which is what this list always was. */}
              {(() => {
                const fallback = jobs.filter((j) => j.category === detailJob.category && j.id !== detailJob.id).slice(0, 4);
                const list = similarJobs.length > 0 ? similarJobs : fallback;
                return list.length > 0 ? (
                  <div className="pt-2 border-t border-border">
                    <p className="text-[12px] font-semibold text-muted-foreground mb-2">{t("jobsPage.detailSimilar", "Similar openings on the board")}</p>
                    <ul className="space-y-1.5">
                      {list.map((j) => (
                        <li key={j.id}>
                          <button type="button" className="text-left text-sm text-primary hover:underline" onClick={() => void openDetail(j)}>
                            {j.title}
                          </button>
                          <span className="text-[11px] text-muted-foreground"> · {j.company}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null;
              })()}
            </div>
    </>
  ) : null;

  // THE RESUME DROP, RENDERED IN TWO PLACES FROM ONE DEFINITION.
  //
  // On a phone this panel sat above the results: 91px of a paid-conversion
  // surface between the reader and the first job, on a page where the first
  // card already began 1,054px down. It now appears after the third card on
  // mobile — still early, but behind evidence that the board has jobs worth
  // ranking — and stays where it was on desktop, where it costs nothing.
  //
  // One definition, two call sites: duplicating forty lines of drag handlers
  // is how the two copies drift.
  const resumeDropPanel = (display: string) => (
              <div
                onDragOver={(e) => { e.preventDefault(); setResumeDragOver(true); }}
                onDragLeave={() => setResumeDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setResumeDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleBoardResumeFile(f);
                }}
                className={`rounded-xl border px-3 py-2 mb-3 ${display} flex-wrap items-center gap-x-3 gap-y-1.5 transition-colors ${
                  resumeDragOver ? "border-primary bg-primary/10 border-dashed" : "border-primary/30 bg-primary/5"
                }`}
              >
                {parsingResume ? <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" /> : <Upload className="w-4 h-4 text-primary shrink-0" />}
                <p className="text-[13px] text-foreground flex-1 min-w-[200px]">
                  {parsingResume
                    ? t("jobsPage.dropParsing", "Reading your résumé…")
                    : t("jobsPage.dropTitleScoped", "Drop your résumé here — we'll rank the openings on this page against it in seconds.")}
                </p>
                <label className="inline-flex">
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    disabled={parsingResume}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleBoardResumeFile(f);
                      e.target.value = "";
                    }}
                  />
                  <span className="cursor-pointer inline-flex items-center rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold px-3 py-1 hover:bg-primary/90">
                    {t("jobsPage.dropBrowse", "Choose file")}
                  </span>
                </label>
                {/* Secondary link folds away below sm — it wrapped the banner to
                    a third row on 375px screens; the primary path stays. */}
                <button onClick={() => navigate("/#upload")} className="hidden sm:block text-[12px] text-muted-foreground hover:text-foreground hover:underline">
                  {t("jobsPage.dropScannerLink", "or run the full free scan")}
                </button>
              </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={landerCategory
          ? t("jobsPage.landerSeoTitle", "Live {{category}} Jobs — From Official Company Job Boards", { category: t(`jobsPage.categories.${landerCategory}`, landerCategory) })
          : landerCompany
          ? t("jobsPage.companySeoTitle", "Is {{company}} hiring? — Real, verified open roles", { company: landerCompanyName })
          : t("jobsPage.seoTitle", "Live Jobs From Companies' Own Boards — Check Your Fit Before You Apply")}
        description={landerCategory
          ? t("jobsPage.landerSeoDescription", "Live {{category}} openings pulled straight from companies' own official job boards — no aggregators, no reposts, re-verified all day. Check your resume's fit free, then apply on the company's own site.", { category: t(`jobsPage.categories.${landerCategory}`, landerCategory) })
          : landerCompany
          ? t("jobsPage.companySeoDescription", "Is {{company}} hiring right now? See {{company}}'s verified open roles, pulled straight from their own job board and re-checked today — no aggregators, no ghost postings. Check your resume's fit against any role free, then apply on {{company}}'s own site.", { company: landerCompanyName })
          : t("jobsPage.seoDescription", "Real openings pulled straight from thousands of companies' own official job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR, Recruitee, Teamtailor, Personio, Breezy) — no aggregators, no reposts, re-verified all day and checked live when you apply. See how your resume fits any posting free, then apply on the company's own site.")}
        path={landerCompany ? `/jobs/company/${landerCompany}` : landerCategory ? `/jobs/field/${landerCategory}` : "/jobs"}
      />
      <Header />
      {/* The site-wide skip link is the first focusable element in the
          document and targets #main-content — an id only the home page
          rendered, so on the board (the SEO landing surface) the very first
          thing a keyboard user pressed did nothing. tabIndex={-1} makes it a
          real focus destination rather than just an anchor. */}
      <main id="main-content" tabIndex={-1} className="pt-20 pb-20 focus:outline-none">
        {/* ONE REGION THAT ALWAYS SPEAKS. The existing live region sits inside
            the `!loading && !error` arm of a four-way branch, so the three
            transitions a screen-reader user most needs — the results arriving,
            a filter emptying the list, and an outright error — were all
            silent. A sighted user watches 60 rows swap; everyone else got
            nothing. This one lives OUTSIDE the branch, carries no layout, and
            says only what changed. role="status" is polite by definition, so
            it never interrupts. */}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {loading
            ? t("jobsPage.a11yLoading", "Loading openings…")
            : error
            ? t("jobsPage.a11yError", "Could not load openings. Try again.")
            : shownCount === 0
            ? t("jobsPage.a11yNoResults", "No openings match these filters.")
            : t("jobsPage.a11yResults", "{{count}} openings shown.", { count: shownCount })}
        </p>
        <div className="container max-w-4xl lg:max-w-[1400px]">
          {/* Back to Explore: when the user arrived from a discovery collection,
              give them a clear way back so the board isn't a one-way dead end. */}
          {cameFromExplore && (
            <Link to="/explore" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary mb-2 -mt-2">
              <ChevronDown className="w-3.5 h-3.5 rotate-90" />
              {t("jobsPage.backToExplore", "Back to Explore")}
            </Link>
          )}
          {/* P0 compressed hero: one headline, one live-count line, three tiny
              trust badges, everything else folded — the first posting must be
              visible without scrolling (the old four-paragraph hero measured a
              76% bounce; mobile showed zero jobs for 2.5 screens). */}
          <div className="flex items-center gap-2 mb-1">
            <Briefcase className="w-5 h-5 text-primary" />
            <h1 className="text-2xl md:text-3xl font-bold">{landerCompany
              ? t("jobsPage.companyH1", "Open roles at {{company}}", { company: landerCompanyName })
              : landerCategory
              ? t("jobsPage.landerH1", "Live {{category}} jobs", { category: t(`jobsPage.categories.${landerCategory}`, landerCategory) })
              : t("jobsPage.h1", "Live job board")}</h1>
          </div>
          {/* Direct answer to "is {company} hiring?" — the exact high-intent query
              this page targets. Three honesty rules (live-walk finding, rank 5):
              a capped count renders "10,000+", never as an exact figure; zero
              open roles gets a plain honest "No … right now" instead of the
              question hanging unanswered; and counts are locale-formatted. */}
          {landerCompany && ((data?.total ?? 0) + (data?.relatedTotal ?? 0)) > 0 && (
            <p className="text-sm font-semibold text-success mb-1">
              {data.countCapped
                // Past the count cap the true figure is HIGHER — "10,000+" is
                // the honest rendering; the exact-looking bare number was not.
                ? t("jobsPage.companyYesHiringCapped", "Yes — {{n}}+ verified open roles right now, straight from {{company}}'s own job board.", {
                    n: data.total.toLocaleString(),
                    company: landerCompanyName,
                  })
                : t("jobsPage.companyYesHiring", "Yes — {{count}} verified open {{roleWord}} right now, straight from {{company}}'s own job board.", {
                    count: data.total,
                    roleWord: data.total === 1 ? "role" : "roles",
                    company: landerCompanyName,
                  })}
            </p>
          )}
          {/* THE SHIP-BLOCKER. `total` is the EXACT segment now, so a company page
                whose query matches only in descriptions has total 0 and a full
                page of that company's roles. Measured: /jobs/company/bayada with
                q="benefits" is 0 title matches and 1,314 description matches —
                this branch would have printed "BAYADA has no open roles on their
                job board at the moment" directly above 1,314 BAYADA roles, on an
                indexed page. Both segments decide whether the board is empty. */}
            {landerCompany && ((data?.total ?? 0) + (data?.relatedTotal ?? 0)) === 0 && !loading && !refreshing && (
            <p className="text-sm font-semibold text-muted-foreground mb-1">
              {t("jobsPage.companyNotHiring", "Not right now — {{company}} has no open roles on their job board at the moment. Watch the company below and we'll email you when new roles appear.", { company: landerCompanyName })}
            </p>
          )}
          <p className="text-sm text-muted-foreground mb-2">
            {landerCompany
              ? t("jobsPage.companySubtitle", "Every {{company}} opening here comes straight from {{company}}'s own careers system — verified, still open, and re-checked the moment you apply.", { company: landerCompanyName })
              // A category lander's headline count must be THAT category's —
              // the board-wide 574k under an "Engineering jobs" H1 claimed
              // 574k engineering openings (scope-integrity finding).
              // THE COUNT THAT WON THE CLICK MUST SURVIVE THE CLICK.
              //
              // This required `data.categories[landerCategory]` — a FACET, and
              // facets only arrive on the first uncached fetch, so on a lander
              // it is usually absent and the whole line fell through to the
              // generic subtitle with NO number at all. Google's snippet for
              // /jobs/field/engineering promises "68,370+ Live Openings" and
              // the page then said nothing about how many jobs it had; the only
              // figure in the hero was a CLOSURE count, so the first fact a
              // visitor read on a jobs page was about jobs going away.
              //
              // data.total is the correct fallback and NOT the bug the original
              // comment warns about. That bug was rendering `totalAllCompanies`
              // — board-wide — under an "Engineering jobs" H1. On a lander the
              // category filter IS applied, so data.total is already scoped to
              // this category. Board-wide totals stay barred from this line.
              //
              // Capped counts render "10,000+", never as an exact figure —
              // same honesty rule the company lander above already follows.
              : landerCategory && ((data?.categories?.[landerCategory] ?? 0) > 0 || (data?.total ?? 0) > 0)
              ? t("jobsPage.landerCountLine", "{{total}} live {{category}} openings — every one straight from the company's own hiring system.", {
                  total: (() => {
                    const facet = data?.categories?.[landerCategory] ?? 0;
                    if (facet > 0) return facet.toLocaleString();
                    const tot = data?.total ?? 0;
                    return data?.countCapped ? `${tot.toLocaleString()}+` : tot.toLocaleString();
                  })(),
                  category: t(`jobsPage.categories.${landerCategory}`, landerCategory),
                })
              : !landerCategory && data?.totalAllCompanies
              ? t("jobsPage.countLine", "{{total}} live openings from {{companyFeeds}} company feeds — every one straight from the company's own hiring system.", {
                  total: data.totalAllCompanies.toLocaleString(),
                  companyFeeds: (data.companiesCount ?? companies.length).toLocaleString(),
                })
              : t("jobsPage.subtitleShort", "Every job straight from the company's own careers system — verified, fresh, re-checked when you apply.")}
            {/* Live activity strip: the board IS alive — say so with measured
                numbers only (each clause renders only when its data exists). */}
            {!landerCompany && (takedownsToday !== null || recheckP50Min !== null || !!data?.trackedTotal) && (
              <span className="block text-[12px] text-muted-foreground mt-0.5">
                {/* THE TRACKED CORPUS, and it is deliberately not the headline.
                    The line above counts what a visitor can page to; this one
                    counts every posting the board holds INCLUDING the ~91k that
                    have since closed. Publishing the bigger number as "live
                    openings" would overstate the searchable board by 17% and
                    break the claim the whole page rests on — but stated as what
                    it is, it is the asset a live feed cannot match: a record of
                    what closed, not just what is open. */}
                {!!data?.trackedTotal && t("jobsPage.trackedCorpus", "{{n}} postings tracked including closed roles", { n: data.trackedTotal.toLocaleString() })}
                {!!data?.trackedTotal && (takedownsToday !== null || recheckP50Min !== null) && " · "}
                {takedownsToday !== null && t("jobsPage.takedownsToday", "{{n}} roles filled or closed today", { n: takedownsToday.toLocaleString() })}
                {takedownsToday !== null && recheckP50Min !== null && " · "}
                {recheckP50Min !== null && t("jobsPage.recheckLine", "median feed re-checked {{m}} min ago", { m: recheckP50Min })}
              </span>
            )}
            {!landerCompany && newToday !== null && (
              <span className="inline-flex items-center gap-1.5 ml-2 text-success whitespace-nowrap">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-success animate-pulse motion-reduce:animate-none" />
                {t("jobsPage.newTodayLine", "{{n}} posted today.", { n: `${newToday.toLocaleString()}${newTodayCapped ? "+" : ""}` })}
              </span>
            )}
          </p>
          {/* Lander intel: sourced headcount/band, weekly net-new, salary
              median, top fields — each clause renders only when its data
              exists. Then claim-your-profile (identity, never data editing). */}
          {/* Field fill-speed: lifecycle-measured, labeled with its sample size
              and window — renders only when the RPC clears its 300-closure
              floor for this category. */}
          {landerCategory && fillSpeed && (
            <p className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground mb-2">
              <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
              {t("jobsPage.fillSpeedLine", "Roles in this field typically stay open ~{{median}} days (75% close within {{p75}} days) — measured from {{n}} tracked closings over the last {{window}} days.", {
                median: fillSpeed.median,
                p75: fillSpeed.p75,
                n: fillSpeed.n.toLocaleString(),
                window: fillSpeed.window,
              })}
            </p>
          )}
          {landerCompany && <CompanyIntelPanel companyToken={landerCompany} />}
          {/* SEC-sourced financial context for US-listed employers. */}
          {landerCompany && <PublicCompanyCard companyToken={landerCompany} />}
          {/* DOL-sourced declared wages (H-1B filings) — labeled, never
              presented as company-wide pay. */}
          {landerCompany && (
            <DeclaredWagesCard companyToken={landerCompany} companyName={landerCompanyName ?? landerCompany} />
          )}
          {landerCompany && (
            <CompanyClaim companyToken={landerCompany} companyName={landerCompanyName ?? landerCompany} />
          )}
          {/* Single row on phones (scrolls; mask hints overflow) — wrapped to
              two rows this band cost 24px of the 812px mobile fold. */}
          <div className="flex flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-visible [mask-image:linear-gradient(to_right,black_92%,transparent)] sm:[mask-image:none] items-center gap-x-3 gap-y-1 mb-3 text-[11px] text-muted-foreground whitespace-nowrap sm:whitespace-normal">
            <span className="inline-flex items-center gap-1 shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" />
              {t("jobsPage.badgeOfficial", "Official feeds only")}
            </span>
            <span className="inline-flex items-center gap-1" title={t("jobsPage.guaranteeFreshTip", "Any role whose posting date passes 30 days is automatically dropped from the board — the ghost/pipeline postings other boards leave up for months never appear here.")}>
              <Clock className="w-3.5 h-3.5 text-success shrink-0" />
              {t("jobsPage.badgeFresh", "30-day freshness cap")}
            </span>
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5 text-success shrink-0" />
              {t("jobsPage.badgeLive", "Re-checked when you apply")}
            </span>
            <button
              type="button"
              onClick={() => setAboutOpen((v) => !v)}
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              {t("jobsPage.aboutToggle", "How this board works")}
              <ChevronDown className={`w-3 h-3 transition-transform ${aboutOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
          {aboutOpen && (
            <div className="rounded-xl border border-border bg-card p-4 mb-4 text-[13px] text-muted-foreground space-y-2">
              <p>
                {t("jobsPage.subtitle", "Every job here comes straight from the company's own careers system — no aggregators, no reposts, no dead links — and each is re-checked live the moment you apply.")}
              </p>
              <p>{t("jobsPage.guaranteeFresh", "Posted in the last 30 days — stale postings auto-dropped")}. {t("jobsPage.guaranteeFreshTip", "Any role whose posting date passes 30 days is automatically dropped from the board — the ghost/pipeline postings other boards leave up for months never appear here.")}</p>
              <p>
                {t("jobsPage.honestyNote", "Then we do the part other boards skip: check your resume against any posting free and see exactly what to add — so you apply prepared, not hoping.")}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                <Link to="/ghost-job-index" className="text-primary hover:underline">
                  {t("jobsPage.dataPagesGhost", "Ghost Job Index")}
                </Link>
                <Link to="/hiring-trends" className="text-primary hover:underline">
                  {t("jobsPage.dataPagesTrends", "Weekly hiring trends")}
                </Link>
                <Link to="/entry-level-index" className="text-primary hover:underline">
                  {t("jobsPage.dataPagesEntry", "Entry-Level Index")}
                </Link>
              </div>
            </div>
          )}

          {/* Company-page Hiring-Health: the lifecycle signal aggregators can't
              build — open roles now + how fast this company actually fills roles.
              Honest + staged: the "actively hiring" label needs genuine fills
              (tenure-vetted closures) PLUS live openings — a dead board is not
              hiring — and with no fills yet we say we're still gathering, never
              "doesn't hire". */}
          {landerCompany && hiringHealth && (hiringHealth.open_roles > 0 || hiringHealth.closed_90d > 0) && (
            <div className="rounded-xl border border-border bg-card p-4 mb-6 max-w-xl">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-primary shrink-0" />
                <h2 className="text-sm font-semibold text-foreground">{t("jobsPage.hhTitle", "Hiring Health")}</h2>
                {hiringHealth.open_roles > 0 && hiringHealth.closed_90d >= ACTIVELY_HIRING_MIN_CLOSED
                  && (hiringHealth.superseded_90d ?? 0) <= hiringHealth.closed_90d && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/10 text-success">
                    {t("jobsPage.hhActive", "Actively hiring")}
                  </span>
                )}
              </div>
              <ul className="space-y-1 text-[13px] text-muted-foreground">
                {hiringHealth.open_roles > 0 && (
                  <li>
                    {/* feed_total > stored rows = windowed fetch: our count is a floor,
                        so say "N+" rather than claim false precision. */}
                    <span className="text-foreground font-semibold">{hiringHealth.open_roles}{(hiringHealth.feed_total ?? 0) > hiringHealth.open_roles ? "+" : ""}</span>{" "}
                    {t("jobsPage.hhOpen", "open roles verified on the board right now")}
                  </li>
                )}
                {hiringHealth.closed_90d > 0 ? (
                  <li>
                    {t("jobsPage.hhFilledPre", "Filled")}{" "}
                    <span className="text-foreground font-semibold">{hiringHealth.closed_90d}</span>{" "}
                    {hiringHealth.tracking_days > 0
                      ? t("jobsPage.hhFilledPost", "roles in {{d}}d of tracking — each stayed posted a week or more, then came down", { d: hiringHealth.tracking_days })
                      : t("jobsPage.hhFilledPostUntracked", "roles since we began tracking — each stayed posted a week or more, then came down")}
                    {/* Right-censored early: a young record can't contain slow closes,
                        so the median reads fake-fast. Withheld until >= 21d tracked. */}
                    {hiringHealth.median_days_to_close != null && hiringHealth.tracking_days >= 21 && (
                      <> · {t("jobsPage.hhSpeed", "typically within ~{{d}} days", { d: Math.round(hiringHealth.median_days_to_close) })}</>
                    )}
                  </li>
                ) : (
                  <li className="italic text-muted-foreground/80">
                    {t("jobsPage.hhGathering", "We just started tracking this company's role closures — hiring-health fills in as roles close.")}
                  </li>
                )}
                {(hiringHealth.superseded_90d ?? 0) >= REPOST_FLAG_MIN && (
                  <li className="text-warning/90">
                    {t("jobsPage.hhRepostsTracked", "Relisted the same role title {{n}} times during our tracking — routine reposting or roles that keep reopening.", { n: hiringHealth.superseded_90d })}
                  </li>
                )}
              </ul>
              <p className="text-[10px] text-muted-foreground/70 mt-2">
                {t("jobsPage.hhFootnote", "Computed from the full lifecycle of this company's official postings — when they open and when they close — not a one-time snapshot.")}
              </p>
            </div>
          )}

          {/* Watch-company: one click on any company page — a saved search under
              the hood, so account new-since counts and the digest just work. */}
          {landerCompany && (
            <div className="flex flex-wrap items-center gap-2 mb-6 -mt-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={watchCompany}>
                <BookmarkCheck className="w-3.5 h-3.5" />
                {t("jobsPage.watchCta", "Watch {{company}}", { company: landerCompanyName })}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {t("jobsPage.watchNote", "Your account will count their new postings since your last look.")}
              </span>
            </div>
          )}

          {/* Natural-language search: describe the search in plain words; an
              LLM maps it to the board's real filters and shows how it read it. */}
          <div className="mb-2">
            {!nlOpen ? (
              <button
                type="button"
                onClick={() => setNlOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t("jobsPage.nlOpen", "Search in plain language")}
              </button>
            ) : (
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-2.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={nlQuery}
                    autoFocus
                    onChange={(e) => setNlQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void applyNlSearch(); }
                      else if (e.key === "Escape") setNlOpen(false);
                    }}
                    placeholder={t("jobsPage.nlPlaceholder", "e.g. remote product roles over $150k posted this week")}
                    className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <Button size="sm" disabled={nlLoading || nlQuery.trim().length < 3} onClick={() => void applyNlSearch()}>
                    {nlLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("jobsPage.nlGo", "Search")}
                  </Button>
                  <Button size="sm" variant="ghost" className="px-2" aria-label={t("jobsPage.nlClose", "Close")} onClick={() => setNlOpen(false)}>✕</Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {t("jobsPage.nlHintLong", "We map it to real filters and show exactly how we read it — adjust anything below.")}
                </p>
              </div>
            )}
          </div>

          {/* P0 filter bar: the primary search row stays put (sticky) while the
              list scrolls; on mobile the secondary controls collapse behind one
              "Filters" button with an active-count badge, so the first posting
              is on-screen instead of a wall of seven controls. */}
          <div className="sticky top-16 z-20 -mx-4 px-4 py-2 bg-background/90 backdrop-blur mb-2">
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setSuggestOpen(true); setSuggestIdx(-1); setNlResult(null); }}
                  onFocus={() => setSuggestOpen(true)}
                  onBlur={() => setTimeout(() => { setSuggestOpen(false); setSuggestIdx(-1); }, 150)}
                  onKeyDown={(e) => {
                    if (!suggestOpen || flatSuggestions.length === 0) return;
                    if (e.key === "ArrowDown") { e.preventDefault(); setSuggestIdx((i) => Math.min(i + 1, flatSuggestions.length - 1)); }
                    else if (e.key === "ArrowUp") { e.preventDefault(); setSuggestIdx((i) => Math.max(i - 1, -1)); }
                    else if (e.key === "Enter" && suggestIdx >= 0 && flatSuggestions[suggestIdx]) { e.preventDefault(); applySuggestion(flatSuggestions[suggestIdx]); }
                    else if (e.key === "Escape") { setSuggestOpen(false); setSuggestIdx(-1); }
                  }}
                  role="combobox"
                  aria-expanded={suggestOpen && flatSuggestions.length > 0}
                  aria-controls="search-suggest-list"
                  aria-activedescendant={suggestIdx >= 0 ? `search-sug-${suggestIdx}` : undefined}
                  id="board-search"
                  placeholder={t("jobsPage.searchPlaceholder", "Title or keyword — e.g. product designer")}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {/* Long queries read like sentences — offer the AI parse right
                    where they typed it (salary, remote, dates, sort, proven
                    hirers all become real filters, visibly). */}
                {q.trim().split(/\s+/).length >= 4 && !nlLoading && (
                  <button
                    type="button"
                    onClick={() => { setNlQuery(q); void applyNlSearch(q); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 rounded-full px-2 py-0.5 hover:bg-primary/20"
                    title={t("jobsPage.nlHintTip", "Understands pay, remote, dates, fields, and 'companies that actually hire' — turns your sentence into real filters.")}
                  >
                    <Sparkles className="w-3 h-3" /> {t("jobsPage.nlHint", "AI parse")}
                  </button>
                )}
                {suggestOpen && flatSuggestions.length > 0 && (
                  <div id="search-suggest-list" role="listbox" className="absolute z-30 mt-1 left-0 right-0 max-h-80 overflow-auto rounded-lg border border-border bg-background shadow-lg text-sm py-1">
                    {flatSuggestions.map((sug, si) => (
                      <button
                        key={`${sug.kind}:${sug.value}`}
                        id={`search-sug-${si}`}
                        role="option"
                        aria-selected={si === suggestIdx}
                        type="button"
                        className={`w-full flex items-center justify-between text-left px-3 py-2 ${si === suggestIdx ? "bg-muted" : "hover:bg-muted/60"}`}
                        onMouseDown={() => applySuggestion(sug)}
                      >
                        <span className="truncate">{sug.label}</span>
                        <span className="text-[10px] text-muted-foreground ml-3 shrink-0">
                          {sug.kind === "recent" ? t("jobsPage.sugRecent", "recent")
                            : sug.kind === "company" ? t("jobsPage.sugCompany", "company")
                            : sug.kind === "category" ? t("jobsPage.sugCategory", "category")
                            : t("jobsPage.sugRole", "role")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative hidden md:block w-[180px]">
                <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t("jobsPage.locationPlaceholder", "Location")}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={`md:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm shrink-0 ${filtersOpen ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                aria-expanded={filtersOpen}
              >
                <SlidersHorizontal className="w-4 h-4" />
                {t("jobsPage.filtersBtn", "Filters")}
                {activeFilterCount > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold inline-flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>
          <div className={`${filtersOpen ? "flex" : "hidden"} md:flex flex-wrap gap-2 mb-3`}>
            <div className="relative w-full md:hidden">
              <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t("jobsPage.locationPlaceholder", "Location")}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            {/* THREE FIELDS AT ONCE. The board has unioned comma-joined fields
                since the unsorted bucket shipped, so this control is catching up
                with the API rather than extending it. The cap is measured, not
                chosen: one field costs 0.26-0.35s, three ~0.45s, six 0.75-0.79s
                — the same cost class as the two-value cliff the two-subset pager
                exists to avoid. */}
            <MultiSelectFilter
              value={category}
              onChange={setCategory}
              max={3}
              options={CATEGORY_IDS.map((c) => ({
                value: c,
                label: t(`jobsPage.categories.${c}`, c),
                count: filteredCats?.[c] ?? data?.categories?.[c],
              }))}
              allLabel={t("jobsPage.allFields", "All fields")}
              ariaLabel={t("jobsPage.allFields", "All fields")}
              selectedLabel={(n) => t("jobsPage.nFields", "{{n}} fields", { n })}
              atMaxNote={t("jobsPage.fieldsAtMax", "Three fields at a time — more than that is slow enough to be worse than a second search.")}
              clearLabel={t("jobsPage.clearFields", "Clear fields")}
            />
            {/* THE QUARTER OF THE BOARD A FIELD CHOICE HIDES.
                `other` is where a posting lands when its field could not be
                read from the title — 162,800 of 590,808 on 2026-08-05 — not a
                junk drawer, and plenty of them are ordinary engineering,
                operations and healthcare roles. Shown only once a field is
                chosen, because with "All fields" they are already included.
                The live count comes from the same facets that fill the select,
                so the number is measured rather than asserted. */}
            {/* THE FILTER FORM OF THE SPARKLES BADGE. Same icon, same phrase,
                same SENDABLE_VENDORS mirror server-side — the chip on a card
                and this toggle must never disagree about what "agent can
                apply" means. Always visible (unlike the unsorted opt-in it
                sits beside, which only means something once a field is
                chosen), because sendability is a property of the employer's
                form, not of any other filter. */}
            <label
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background text-sm whitespace-nowrap text-muted-foreground cursor-pointer"
              title={t("jobsPage.agentOnlyTip", "Show only postings whose application form our apply agent can fill and submit for you. The Sparkles badge on a job card means the same thing — this filters the whole board to those.")}
            >
              <input
                type="checkbox"
                checked={agentOnly}
                onChange={(e) => setAgentOnly(e.target.checked)}
                className="accent-[hsl(var(--primary))]"
              />
              <Sparkles className="w-3.5 h-3.5" />
              {t("jobsPage.agentOnly", "Agent can apply")}
            </label>
            {/* `category` is comma-joined once a selection is multi-value, so
                the old `!== "other"` test passes for "design,other" — the
                control would render, be tickable, and be silently discarded by
                the server, which drops the opt-in when the bucket is already in
                the selection. Ask the question the server asks. */}
            {category && !category.split(",").includes("other") && (
              <label
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background text-sm whitespace-nowrap ${
                  sortMode === "salary" ? "opacity-50 cursor-not-allowed text-muted-foreground/60" : "text-muted-foreground cursor-pointer"
                }`}
                title={sortMode === "salary"
                  ? t("jobsPage.inclUncatSalaryTip", "Not available while sorting by salary — that combination is too slow to serve, so we don't pretend to apply it.")
                  : t("jobsPage.inclUncatTip", "Some postings can't be sorted into a field from their job title. They're excluded when you pick one — this puts them back.")}
              >
                {/* DISABLED UNDER A SALARY SORT, matching what the server does.
                    normalizeFilters drops the flag there and reports it in
                    `ignored`, because ordering the unsorted bucket by salary
                    returns a 500 after ~17s. A box that stays ticked while the
                    server ignores it is the silent-filter failure this codebase
                    has a whole contract against. */}
                <input
                  type="checkbox"
                  checked={inclUncat && sortMode !== "salary"}
                  disabled={sortMode === "salary"}
                  onChange={(e) => setInclUncat(e.target.checked)}
                  className="accent-[hsl(var(--primary))]"
                />
                {t("jobsPage.inclUncat", "+ unsorted")}
                {data?.categories?.other ? (
                  <span className="text-muted-foreground/70">({data.categories.other.toLocaleString()})</span>
                ) : null}
              </label>
            )}
            {/* THE TWO WAYS A POSTING STATES WHAT IT WANTS FROM YOU, named as
                one group so a screen reader hears "Experience level" once and
                then the two distinct controls inside it. They are separate
                columns with separate coverage (experience_band usable on 43.1%,
                min_years on 28.9%) and they AND together, so they cannot be one
                control. */}
            <div role="group" aria-label={t("jobsPage.experienceFieldLabel", "Experience level")} className="flex flex-wrap gap-2">
              {/* FOUR BANDS AT ONCE. The cap IS the list, so nothing is ever
                  disabled — but the at-max note still fires at 4 of 4, and it
                  has to. Picking every band is NOT the same as picking none:
                  318,607 rows read "unspecified" and match no band at all, so
                  a full selection still hides them. `asBands` in filters.ts has
                  accepted a comma list since the day it was written; only this
                  control refused to send one. */}
              <MultiSelectFilter
                value={experience}
                onChange={setExperience}
                max={EXPERIENCE_IDS.length}
                options={EXPERIENCE_IDS.map((x) => ({ value: x, label: t(`jobsPage.experience.${x}`, x) }))}
                allLabel={t("jobsPage.allExperience", "Any experience")}
                ariaLabel={t("jobsPage.experienceBandsLabel", "Seniority bands")}
                selectedLabel={(n) => t("jobsPage.nExperience", "{{n}} levels", { n })}
                atMaxNote={t("jobsPage.experienceAtMax", "That is every band the board records.")}
                clearLabel={t("jobsPage.clearExperience", "Clear experience")}
                title={t("jobsPage.experienceTip", "The band read from the posting's own wording. Postings that don't say are excluded while this is on — that is most of the board.")}
              />
              {/* THE JOB-SEEKER'S QUESTION, not the employer's: "does not demand
                  more than n years". min_years <= n. */}
              <select
                value={maxYears || ""}
                onChange={(e) => setMaxYears(Number(e.target.value) || 0)}
                className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={t("jobsPage.maxYearsFieldLabel", "Maximum years of experience required")}
                title={t("jobsPage.maxYearsTip", "Hides postings that ask for more than this many years. Only postings that state a number can be matched — 29% of the board — so the rest are hidden while this is on.")}
              >
                <option value="">{t("jobsPage.anyMaxYears", "Any years required")}</option>
                {MAX_YEARS_STEPS.map((y) => (
                  <option key={y} value={y}>
                    {t("jobsPage.maxYearsOption", "Asks {{n}} yrs or fewer", { n: y })}
                  </option>
                ))}
              </select>
            </div>
            {/* THE DIRECT FACET FIRST, THE RESULT SET ONLY IF IT FAILS.
                get_country_facet DID return 57014 on 10 of 10 calls (3.20-3.32s,
                2026-08-08), which is why the fallback exists and why this
                control is not gated on the facet arriving. Re-measured against
                production on 2026-08-25 it answers in 0.49s with US 253,609 /
                GB 20,625 / CA 19,220 / IN 14,568 / DE 11,413 — twenty countries
                with real counts, which the fallback can never produce: it can
                only name the handful of countries on the page in front of you,
                with no counts at all. So the facet is the source and the result
                set is the safety net, not the other way round. Counts are an
                enrichment; their absence must never remove the filter itself. */}
            {(countryFacet.length > 0 || fallbackCountries.length > 0) && (
              <MultiSelectFilter
                value={country}
                onChange={setCountry}
                max={5}
                options={(countryFacet.length ? countryFacet : fallbackCountries.map((c) => ({ country: c, n: 0 }))).map((c) => ({
                  value: c.country,
                  label: countryLabel(c.country),
                  count: c.n,
                }))}
                allLabel={t("jobsPage.allCountries", "All countries")}
                ariaLabel={t("jobsPage.allCountries", "All countries")}
                selectedLabel={(n) => t("jobsPage.nCountries", "{{n}} countries", { n })}
                atMaxNote={t("jobsPage.countriesAtMax", "Five countries at a time.")}
                clearLabel={t("jobsPage.clearCountries", "Clear countries")}
                title={t("jobsPage.countryTip", "Country read from each posting's own location text — postings we can't place are excluded while this is on, never guessed.")}
              />
            )}
            {/* U4: at ~25k companies a dropdown is unusable — type-ahead over the
                served facet (top slice by count; the full set stays searchable
                through the q box, which matches company names server-side). */}
            <div className="relative">
              <input
                type="text"
                role="combobox"
                aria-expanded={companyQuery !== null}
                aria-controls="company-typeahead-list"
                aria-activedescendant={companyQuery !== null && companyIdx >= 0 ? `company-opt-${companyIdx}` : undefined}
                // Several employers cannot be spelled into one text box, so the
                // box says how many and the chip row names them — the same
                // choice the multi-select trigger and the company chip already
                // make rather than printing a wall of tokens.
                value={companyQuery !== null
                  ? companyQuery
                  : companyTokens.length > 1
                  ? t("jobsPage.companiesChip", "{{n}} companies", { n: companyTokens.length })
                  : (companies.find((c) => c.token === company)?.name ?? companyNames.current[company] ?? "")}
                onChange={(e) => { setCompanyQuery(e.target.value); setCompanyIdx(-1); }}
                onFocus={() => setCompanyQuery(companyQuery ?? "")}
                onBlur={() => setTimeout(() => { setCompanyQuery(null); setCompanyIdx(-1); }, 150)}
                onKeyDown={(e) => {
                  if (companyQuery === null) return;
                  const opts = mergeCompanyOptions(companies, companySuggest, companyQuery);
                  if (e.key === "ArrowDown") { e.preventDefault(); setCompanyIdx((i) => Math.min(i + 1, opts.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setCompanyIdx((i) => Math.max(i - 1, -1)); }
                  else if (e.key === "Enter" && companyIdx >= 0 && opts[companyIdx]) {
                    e.preventDefault(); toggleCompanyToken(opts[companyIdx].token); setCompanyQuery(""); setCompanyIdx(-1);
                  } else if (e.key === "Escape") { setCompanyQuery(null); setCompanyIdx(-1); }
                }}
                placeholder={t("jobsPage.companySearch", "Company…")}
                className="px-3 py-2 rounded-lg bg-background border border-border text-sm w-36 focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={t("jobsPage.companyFieldLabel", "Employer")}
              />
              {companyQuery !== null && (
                <div id="company-typeahead-list" role="listbox" className="absolute z-30 mt-1 w-64 max-h-72 overflow-auto rounded-lg border border-border bg-background shadow-lg text-sm">
                  {company && (
                    <button type="button" className="block w-full text-left px-3 py-2 hover:bg-muted text-muted-foreground" onMouseDown={(e) => { e.preventDefault(); setCompany(""); setCompanyQuery(null); }}>
                      {t("jobsPage.allCompanies", "All companies")}
                    </button>
                  )}
                  {mergeCompanyOptions(companies, companySuggest, companyQuery)
                    .map((c, ci) => (
                      <button
                        key={c.token}
                        id={`company-opt-${ci}`}
                        role="option"
                        // TWO STATES, TWO ATTRIBUTES. aria-selected on a listbox
                        // option means "chosen", and it was carrying the
                        // keyboard cursor instead — with one token that was
                        // nearly the same thing, but a list that accumulates has
                        // a highlighted row and several chosen ones at once.
                        aria-selected={companyTokens.includes(c.token)}
                        aria-current={ci === companyIdx ? "true" : undefined}
                        type="button"
                        className={`block w-full text-left px-3 py-2 hover:bg-muted ${ci === companyIdx ? "bg-muted" : ""}`}
                        onMouseDown={(e) => { e.preventDefault(); toggleCompanyToken(c.token); setCompanyIdx(-1); }}
                      >
                        <span className={`mr-1.5 ${companyTokens.includes(c.token) ? "text-primary" : "text-transparent"}`} aria-hidden="true">✓</span>
                        {c.name} <span className="text-muted-foreground">({c.count})</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            {/* PAY, AS A BAND AND AS A BASIS — three controls over the same
                published figure, grouped so they read as one question.
                The floor was the only one of them the page had, and it silently
                implied the third: setting it already restricts you to the 20.1%
                of postings that state pay, which is what "States pay" now says
                out loud on its own. */}
            <div role="group" aria-label={t("jobsPage.payFieldLabel", "Pay")} className="flex flex-wrap gap-2">
              <select
                value={salaryFloor || ""}
                onChange={(e) => setSalaryFloor(Number(e.target.value) || 0)}
                className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={t("jobsPage.salaryFieldLabel", "Minimum stated pay")}
                title={t("jobsPage.salaryFloorTip", "Filters on pay the posting itself states (hourly and monthly rates annualized). Postings that don't publish pay are hidden while this is on — that's most of them.")}
              >
                <option value="">{t("jobsPage.anySalary", "Any salary")}</option>
                {SALARY_FLOOR_STEPS.map((f) => (
                  <option key={f} value={f}>
                    {t("jobsPage.salaryFloorOption", "{{amount}}k+ stated", { amount: f / 1000 })}
                  </option>
                ))}
              </select>
              {/* THE CEILING, beside the floor because together they are one
                  band. Not clamped to the floor here: a ceiling under the floor
                  is refused by the server and named in ignoredFilters, and the
                  visitor learning that is better than the page quietly picking
                  a number for them. */}
              <select
                value={salaryCeiling || ""}
                onChange={(e) => setSalaryCeiling(Number(e.target.value) || 0)}
                className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={t("jobsPage.salaryCeilingFieldLabel", "Maximum stated pay")}
                title={t("jobsPage.salaryCeilingTip", "The other end of the band, on the same annualized figure as the floor. Useful for screening out roles you're overqualified for — and, like the floor, it can only see the fifth of postings that publish pay.")}
              >
                <option value="">{t("jobsPage.anyCeiling", "No maximum")}</option>
                {SALARY_CEILING_STEPS.map((c) => (
                  <option key={c} value={c}>
                    {t("jobsPage.salaryCeilingOption", "up to {{amount}}k stated", { amount: c / 1000 })}
                  </option>
                ))}
              </select>
              {/* HOURLY vs SALARIED, from salary_period. The thinnest filter on
                  the board — 59,505 of 559,805 rows say which — and the
                  coverage line beneath the results says so whenever it is on. */}
              <select
                value={payBasis}
                onChange={(e) => setPayBasis(e.target.value as "" | "hourly" | "salaried")}
                className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={t("jobsPage.payBasisFieldLabel", "Pay basis")}
                title={t("jobsPage.payBasisTip", "Whether the posting quotes an hourly rate or a salary. Only one posting in ten says which, and the rest are hidden while this is on — this is a scalpel, not a broad filter.")}
              >
                <option value="">{t("jobsPage.anyPayBasis", "Any pay basis")}</option>
                <option value="hourly">{t("jobsPage.payBasisHourly", "Paid hourly")}</option>
                <option value="salaried">{t("jobsPage.payBasisSalaried", "Salaried")}</option>
              </select>
              {/* THE HALF OF THE PAY FLOOR NOBODY WAS TOLD ABOUT, on its own.
                  salary_min_annual IS NOT NULL — 112,524 rows. Someone who only
                  wants postings that name a figure, at any figure, had no way to
                  ask for that except by setting a floor they did not mean. */}
              <label
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background text-sm whitespace-nowrap text-muted-foreground cursor-pointer"
                title={t("jobsPage.statedPayTip", "Show only postings that publish a pay figure, whatever it is. About a fifth of the board does. Setting a pay floor already does this silently — this makes it a choice.")}
              >
                <input
                  type="checkbox"
                  checked={statedPayOnly}
                  onChange={(e) => setStatedPayOnly(e.target.checked)}
                  className="accent-[hsl(var(--primary))]"
                />
                {t("jobsPage.statedPay", "States pay")}
              </label>
              {/* ONLY WHERE IT MEANS SOMETHING. This relaxes an ACTIVE floor to
                  admit postings with no stated pay; with no floor set there is
                  nothing to relax and every unpriced row is already included.
                  Rendering it always would offer a control that does nothing,
                  which reads as a broken filter rather than an inapplicable one.

                  It exists because a floor silently discarded about four fifths
                  of the board: salary_rank_usd is NULL for every posting whose
                  employer states no pay, and NULL fails every comparison. The
                  cut was disclosed by the coverage line; what there was no way
                  to do was decline it. */}
              {salaryFloor > 0 && (
                <label
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background text-sm whitespace-nowrap text-muted-foreground cursor-pointer"
                  title={t("jobsPage.inclUnstatedPayTip", "Keep postings that don't publish a salary. Only about a fifth of employers state pay, so a pay floor hides the rest — this puts them back.")}
                >
                  <input
                    type="checkbox"
                    checked={includeUnstatedPay}
                    onChange={(e) => setIncludeUnstatedPay(e.target.checked)}
                    className="accent-[hsl(var(--primary))]"
                  />
                  {t("jobsPage.inclUnstatedPay", "Incl. unstated pay")}
                </label>
              )}
            </div>
            {/* THE EMPLOYER'S OWN TEAM LABEL, matched as a substring. 226,631
                rows carry one. Until now it was reachable only by typing into
                the search box, where it ORs with the title and the company name
                instead of narrowing anything. */}
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder={t("jobsPage.departmentPlaceholder", "Department…")}
              className="px-3 py-2 rounded-lg bg-background border border-border text-sm w-36 focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={t("jobsPage.departmentFieldLabel", "Department")}
              title={t("jobsPage.departmentTip", "Matches the team name the employer wrote on the posting, anywhere inside it — “nurs” finds Nursing. Two postings in five carry one, and employers spell them however they like, so this narrows rather than proves.")}
            />
            {/* WHICH ATS THE POSTING CAME FROM. Every row has a source, so this
                is the one new filter that hides nothing at all — and the only
                vendor control before it was the agent-can-apply toggle, which
                pins the board to the 5.4% the agent can drive. */}
            <MultiSelectFilter
              value={vendor}
              onChange={setVendor}
              max={VENDOR_LIMIT}
              options={VENDOR_OPTIONS}
              allLabel={t("jobsPage.allVendors", "Any source")}
              ariaLabel={t("jobsPage.vendorFieldLabel", "Job board source")}
              selectedLabel={(n) => t("jobsPage.nVendors", "{{n}} sources", { n })}
              atMaxNote={t("jobsPage.vendorsAtMax", "Eight sources at a time — the same cap the board applies.")}
              clearLabel={t("jobsPage.clearVendors", "Clear sources")}
              title={t("jobsPage.vendorTip", "The platform the employer publishes on. Every posting has one, so this filter hides nothing that isn't from another source.")}
            />
            {/* Definitive work-mode filter: only employer-stated tags match;
                postings that don't say are excluded by the filter, honestly. */}
            {/* TOGGLES, NOT A SELECT. A <select> can hold one value, which is
                why "remote or hybrid" was unaskable — and hybrid is the larger
                bucket almost everywhere, so "either" is the ordinary question.
                Nothing selected means any mode, exactly as the empty option did. */}
            <div
              role="group"
              aria-label={t("jobsPage.workMode.label", "Work mode")}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1"
            >
              {(WORK_MODE_KEYS).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={hasMode(workMode, m)}
                  onClick={() => { setWorkMode(toggleMode(workMode, m)); setRemoteOnly(false); }}
                  className={`px-2.5 py-1 rounded-md text-sm transition-colors ${
                    hasMode(workMode, m)
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`jobsPage.workMode.${m}`, m === "onsite" ? "On-site" : m === "remote" ? "Remote" : "Hybrid")}
                </button>
              ))}
            </div>
            {(q || activeBoardFilterKeys(filterState).length > 0) && (
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => saveCurrentSearch()}>
                <BookmarkCheck className="w-3.5 h-3.5" />
                {t("jobsPage.saveSearch", "Save this search")}
              </Button>
            )}
          </div>

          {/* Active-filter chips: everything narrowing the results, one click
              to undo each. Hidden while nothing is active. */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {activeFilters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={f.clear}
                  className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
                >
                  {f.label}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
              {activeFilters.length > 1 && (
                <button
                  type="button"
                  onClick={() => activeFilters.forEach((f) => f.clear())}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-1"
                >
                  {t("jobsPage.clearAll", "Clear all")}
                </button>
              )}
            </div>
          )}

          {/* Freshness + fit-ranking row */}
          <div className="flex flex-wrap items-center gap-2 mb-1.5 lg:mb-3 -mt-2">
            {/* FIVE WINDOWS OUT OF THE THIRTY THE API TAKES, not two. The step
                list is deliberately short — a chip row is not a slider — but it
                now spans the whole serving window instead of stopping at a
                week, which was the only reason "posted in the last fortnight"
                required hand-editing the URL. */}
            {([
              ["", t("jobsPage.freshAll", "Any date")],
              ["1", t("jobsPage.freshDay", "Today")],
              ["3", t("jobsPage.fresh3", "Last 3 days")],
              ["7", t("jobsPage.freshWeek", "This week")],
              ["14", t("jobsPage.fresh14", "Last 2 weeks")],
              ["30", t("jobsPage.fresh30", "Last 30 days")],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setFreshness(v)}
                // The selected chip was distinguished by colour and weight
                // only, so a screen reader read three identical buttons and
                // could not tell which date window was applied.
                aria-pressed={freshness === v}
                title={v ? t("jobsPage.freshHint", "Counts company-stated posting dates only") : undefined}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  freshness === v ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
            {freshness && (
              <span className="text-[11px] text-muted-foreground">
                {t("jobsPage.freshHint", "Counts company-stated posting dates only")}
              </span>
            )}
            {/* S2: the board's breadth, visible — live per-category counts as
                one-tap pills (facet data the dropdown was hiding). */}
            {/* COLLAPSED TO ONE ROW, NOT SCROLLED SIDEWAYS.
                The fold constraint here is real and stays honoured: wrapping
                this to a two-row cloud by default pushed the first job card
                below a 720px fold (measured y=820, 2026-07-26), so the
                collapsed state is still exactly one row tall.
                What changed is how the overflow is REACHED. It used to be a
                horizontal scroll behind an edge mask — a gesture with no
                affordance on a trackpad or mouse, so the industries past the
                right edge were effectively invisible. Now the row clips and an
                explicit control opens the rest, wrapped, all at once. Same
                collapsed height, no sideways scrolling, and the overflow is
                something you can see and click instead of something you have
                to discover.
                The cap also goes: it was .slice(0, 10) of 18, so eight
                industries could not be reached at all, scroll or no scroll.
                Hidden on company pages: the counts are BOARD-wide, and under
                "Open roles at {company}" they read as that company's
                (scope-integrity finding). */}
            {!landerCompany && (() => {
              const cats = CATEGORY_IDS
                .filter((c) => (data?.categories?.[c] ?? 0) > 0)
                .sort((a, b) => {
                  // "Other" is the biggest bucket but the least useful pill —
                  // always last regardless of count.
                  if (a === "other") return 1;
                  if (b === "other") return -1;
                  return (data?.categories?.[b] ?? 0) - (data?.categories?.[a] ?? 0);
                });
              // Below this there is no overflow to reveal on any width worth
              // designing for, and a toggle that expands nothing is noise.
              const worthToggling = cats.length > 6;
              return (
            <div className="basis-full min-w-0 w-full flex items-start gap-2">
              {/* SWIPE ON TOUCH, EXPANDER ON DESKTOP — the same split this
                  file already uses for the disclosure row above.
                  A sideways swipe is a real, discoverable gesture on a phone,
                  and vertical space is scarcest there, so mobile keeps the
                  scrolling row and its edge mask exactly as before. On desktop
                  that same row is the problem: there is no swipe, the mask is
                  the only hint, and the industries past the right edge simply
                  go unseen. sm+ therefore clips to one row and reveals the rest
                  through a control you can see.
                  44px is MEASURED, not guessed: these pills inherit the board's
                  44px minimum touch target, so their real height is 44 and not
                  the 28 that padding plus line-height suggests. Clipping to the
                  smaller number cut the row in half and left NO pill fully
                  visible — caught in the browser, not in review. */}
              {/* min-w-0 IS LOAD-BEARING. A flex item defaults to
                  min-width:auto, so this row refused to shrink below its
                  content and grew to 3,255px inside a 375px viewport — the
                  overflow-x-auto never engaged and THE PAGE scrolled sideways
                  instead of the row. Measured, not reviewed. */}
              <div className={`min-w-0 flex-1 flex items-center gap-2 flex-nowrap overflow-x-auto pb-1 -mb-1 [mask-image:linear-gradient(to_right,black_92%,transparent)] sm:pb-0 sm:mb-0 sm:flex-wrap sm:[mask-image:none] ${industriesOpen || !worthToggling ? "sm:overflow-visible" : "sm:max-h-[44px] sm:overflow-hidden"}`}>
                {cats
                  .map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(category === c ? "" : c)}
                      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors ${
                        category === c ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentFor(c) }} />
                      {t(`jobsPage.categories.${c}`, c)}
                      <span className="opacity-70">{(data?.categories?.[c] ?? 0).toLocaleString()}</span>
                    </button>
                  ))}
              </div>
              {worthToggling && (
                <button
                  type="button"
                  onClick={() => setIndustriesOpen((v) => !v)}
                  aria-expanded={industriesOpen}
                  className="shrink-0 hidden sm:inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground whitespace-nowrap transition-colors"
                >
                  {industriesOpen
                    ? t("jobsPage.industriesLess", "Fewer")
                    : t("jobsPage.industriesAll", "All industries")}
                  <ChevronDown className={`w-3 h-3 transition-transform motion-reduce:transition-none ${industriesOpen ? "rotate-180" : ""}`} />
                </button>
              )}
            </div>
              );
            })()}
            {/* For you | All jobs — the board's differentiator as a first-class
                mode, not a pill to discover. "For you" without a resume routes
                to the free scan (toggleFitRanking owns that flow). */}
            <div className="inline-flex rounded-full border border-border overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => { if (!fitRanking) toggleFitRanking(); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                  fitRanking ? "bg-success/15 text-success font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {fitLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
                {t("jobsPage.forYou", "For you")}
              </button>
              <button
                type="button"
                onClick={() => { if (fitRanking) toggleFitRanking(); }}
                className={`px-3 py-1.5 transition-colors border-l border-border ${
                  !fitRanking ? "bg-muted/60 text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("jobsPage.allJobs", "All jobs")}
              </button>
            </div>
            {/* Below lg the quick-chip row already carries this exact toggle —
                rendering it twice cost a wrapped row of the mobile fold. */}
            <button
              type="button"
              onClick={() => setActivelyHiringOnly((v) => !v)}
              className={`hidden lg:inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                activelyHiringOnly ? "border-success bg-success/10 text-success font-semibold" : "border-border text-muted-foreground hover:text-foreground"
              }`}
              // Two false claims in one tooltip: "actually filled" (the
              // lifecycle log observes a posting disappearing, which may be a
              // fill, a cancelled req or a paused budget) and the implication
              // that this filters the board (it filters the rows already
              // fetched). Both corrected.
              title={t("jobsPage.activelyHiringTip", "Filters the openings already loaded on this page (not the whole board) down to employers whose postings have closed and stayed closed — we can see a posting disappear, but not whether it was filled.")}
            >
              <Activity className="w-3 h-3" />
              {t("jobsPage.activelyHiringFilter", "Actively hiring")}
            </button>
            <button
              type="button"
              onClick={toggleDensity}
              aria-pressed={density === "compact"}
              className="hidden lg:block px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
              title={t("jobsPage.densityTip", "Switch list density")}
            >
              {density === "compact" ? t("jobsPage.densityComfortable", "Comfortable view") : t("jobsPage.densityCompact", "Compact view")}
            </button>
            {/* The select must SHOW the order actually applied. With a query
                active the board ranks by relevance, but this control kept
                displaying "Newest first" — a wrong displayed fact (live-walk
                finding, rank 4). A Relevance option now appears and is
                selected whenever it is what's happening; choosing Newest
                routes through the existing searchNewestFirst toggle. */}
            <select
              value={sortMode === "salary" ? "salary" : (q.trim() && !searchNewestFirst ? "relevance" : "newest")}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "salary") { setSortMode("salary"); return; }
                setSortMode("newest");
                if (q.trim()) setSearchNewestFirst(v === "newest");
              }}
              className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-background text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={t("jobsPage.sortLabel", "Sort")}
            >
              {q.trim() && <option value="relevance">{t("jobsPage.sortRelevance", "Relevance")}</option>}
              <option value="newest">{t("jobsPage.sortNewest", "Newest first")}</option>
              <option value="salary">{t("jobsPage.sortSalary", "Highest stated salary")}</option>
            </select>
            {/* Why this order: the board explains its data everywhere else —
                the ranking shouldn't be the one unexplained thing. */}
            <span className="hidden sm:inline text-[11px] text-muted-foreground">

              {/* THE ORDER CLAIM HAS TO SURVIVE A SCORING FAILURE.
                  `fitRanking` is only a toggle, so this said "ordered by fit to
                  your résumé" over a list where nothing had been scored — the
                  sort at :1952 is a no-op when every fit is null, and the
                  fit-batch call can fail silently. Measured live: 5 of 60
                  scored on one landing page. Now it states the coverage, and
                  when nothing scored it does not claim an ordering at all. */}
              {fitRanking
                ? (scoredCount === 0
                    ? t("jobsPage.orderFitNone", "not ranked — no posting on this page could be scored yet")
                    : scoredCount < jobs.length
                      ? t("jobsPage.orderFitPartial", "ordered by fit — {{n}} of {{m}} scored", { n: scoredCount, m: jobs.length })
                      : t("jobsPage.orderFit", "ordered by fit to your résumé"))
                : sortMode === "salary"
                  ? t("jobsPage.orderSalary", "ordered by stated salary floor — postings without stated pay sort last")
                  : q
                    ? t("jobsPage.orderRelevance", "ordered by relevance to your search")
                    : interleaveEmployers
                      ? t("jobsPage.orderNewestWoven", "newest first, spread across employers so one company can't fill the page")
                      : t("jobsPage.orderNewest", "newest first, company-stated dates before undated")}
            </span>
            {salaryFloor > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {t("jobsPage.salaryFloorNote", "Only postings that state pay of ${{amount}}k+ (annualized) — most companies don't publish pay, so this hides them.", { amount: salaryFloor / 1000 })}
              </span>
            )}
            {!q && !company && (
              <span className="basis-full"><SavedSearchPills /></span>
            )}
            {recentJobs.length > 0 && !detailJob && (
              <span className="flex items-center gap-2 basis-full mt-1 overflow-x-auto md:overflow-visible md:flex-wrap [mask-image:linear-gradient(to_right,black_92%,transparent)] md:[mask-image:none]">
                <span className="text-[11px] text-muted-foreground shrink-0">{t("jobsPage.jumpBackIn", "Jump back in:")}</span>
                {recentJobs.slice(0, 3).map((r) => (
                  <button key={r.id} type="button" onClick={() => void openRecent(r.id)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors max-w-[220px] truncate shrink-0">
                    {r.title} · {r.company}
                  </button>
                ))}
              </span>
            )}
            {/* U5: guided starting points — one-tap honest filter combos for the
                blank-page moment. Hidden once any filter is active. */}
            {/* A ZERO-INTENT ARRIVAL, derived rather than re-listed: any filter
                at all — including the six added since this line was written —
                means the visitor has expressed an intent and does not need the
                orientation panel. */}
            {recentJobs.length === 0 && !q && activeBoardFilterKeys(filterState).length === 0 && (
              <span className="hidden sm:inline-flex flex-wrap items-center gap-2 ml-1">
                <span className="text-[11px] text-muted-foreground">{t("jobsPage.tryLabel", "Try:")}</span>
                <button type="button" onClick={() => { setWorkMode("remote"); setRemoteOnly(false); setExperience("entry"); setCountry("US"); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
                  {t("jobsPage.presetRemoteEntry", "Remote · Entry-level · US")}
                </button>
                <button type="button" onClick={() => { setCategory("engineering"); setFreshness("7"); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
                  {t("jobsPage.presetEngWeek", "Engineering · This week")}
                </button>
                <button type="button" onClick={() => { setSalaryFloor(100000); setFreshness("7"); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
                  {t("jobsPage.presetSalary", "$100k+ · This week")}
                </button>
                <button type="button" onClick={() => { setCategory("healthcare"); setCountry("US"); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
                  {t("jobsPage.presetHealth", "Healthcare · US")}
                </button>
              </span>
            )}

            {activelyHiringOnly && displayJobs.length === 0 && (
              <span className="text-[11px] text-muted-foreground">
                {t("jobsPage.activelyHiringEmpty", "No proven-active companies in these results yet — hiring-health data is still accruing. Turn this off to see all verified roles.")}
              </span>
            )}
            {fitRanking && (
              <span className="text-[11px] text-muted-foreground">
                {t("jobsPage.fitRankingNote", "Deterministic keyword coverage vs your scanned resume — postings without stored descriptions show no score.")}
              </span>
            )}
            {/* A SCORING FAILURE IS RETRYABLE, AND SAYING SO IS THE DIFFERENCE
                BETWEEN A BLIP AND "THIS FEATURE DOES NOTHING". The fit call
                returns WORKER_RESOURCE_LIMIT under load; measured live, a batch
                that failed scored 60/60 on retry. Silence made a transient look
                permanent, so the person concluded the product was broken rather
                than pressing again. */}
            {fitRanking && fitFailedCount > 0 && (
              <span className="text-[11px] text-warning">
                {t("jobsPage.fitFailedNote", "{{n}} postings could not be scored just now — this is usually temporary.", { n: fitFailedCount })}{" "}
                <button
                  type="button"
                  onClick={() => { setFitFailedCount(0); setFits({}); }}
                  className="underline hover:text-foreground"
                >
                  {t("jobsPage.fitRetry", "Try again")}
                </button>
              </span>
            )}
          </div>

          {/* Mobile quick filters: the board's best weapons as one-tap chips —
              on desktop the sidebar owns these, so lg:hidden. Single scrollable
              row: wrapped, this block alone cost 96px of a 812px mobile fold. */}
          <div className="flex lg:hidden flex-nowrap gap-2 mb-1.5 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_92%,transparent)]">
            {([
              { key: "week", active: freshness === "7", label: t("jobsPage.chipWeek", "Posted this week"), toggle: () => setFreshness(freshness === "7" ? "" : "7") },
              { key: "remote", active: hasMode(workMode, "remote"), label: t("jobsPage.workMode.remote", "Remote"), toggle: () => { setWorkMode(toggleMode(workMode, "remote")); setRemoteOnly(false); } },
              { key: "hybrid", active: hasMode(workMode, "hybrid"), label: t("jobsPage.workMode.hybrid", "Hybrid"), toggle: () => { setWorkMode(toggleMode(workMode, "hybrid")); setRemoteOnly(false); } },
              { key: "pay", active: salaryFloor >= 100000, label: t("jobsPage.chip100k", "$100k+"), toggle: () => setSalaryFloor(salaryFloor >= 100000 ? 0 : 100000) },
              { key: "hiring", active: activelyHiringOnly, label: t("jobsPage.chipHiring", "Actively hiring"), toggle: () => setActivelyHiringOnly(!activelyHiringOnly) },
              // Density lives here below lg (its standalone button is desktop-
              // only) so the controls row above stops wrapping on phones.
              { key: "density", active: density === "compact", label: density === "compact" ? t("jobsPage.densityComfortable", "Comfortable view") : t("jobsPage.densityCompact", "Compact view"), toggle: toggleDensity },
            ] as const).map((c) => (
              <button
                key={c.key}
                onClick={c.toggle}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full border text-[13px] font-medium transition-colors ${
                  c.active ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Adaptive landing: a zero-intent first visit gets orientation, not a
              560k-row newest-first firehose. Every path out of this block IS an
              intent signal, so it never shows twice. */}
          {showOrientation && !landerCompany && !q && !category && !fitRanking && (
            <div className="hidden sm:block rounded-2xl border border-border bg-card p-5 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Compass className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-bold text-foreground">
                  {/* NO COUNT RATHER THAN A STALE ONE. The fallback was a
                      hardcoded "500,000+", which is a claim frozen at the
                      moment it was typed and drifts silently in whichever
                      direction the board moves. When the read fails the
                      question still works without a number in front of it. */}
                  {data?.totalAllCompanies
                    ? t("jobsPage.orientTitle", "{{total}} verified openings — where do you want to start?", {
                        total: data.totalAllCompanies.toLocaleString(),
                      })
                    : t("jobsPage.orientTitlePlain", "Verified openings — where do you want to start?")}
                </h2>
              </div>
              <p className="text-[13px] text-muted-foreground mb-3">
                {t("jobsPage.orientSub", "Pick a field, drop your résumé below for personal ranking, or just browse the newest.")}
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {Object.entries(data?.categories ?? {})
                  .filter(([c]) => c !== "other")
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .slice(0, 8)
                  .map(([c, n]) => (
                    <button
                      key={c}
                      onClick={() => { setCategory(c); dismissOrientation(); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-sm text-foreground hover:border-primary/50 transition-colors"
                    >
                      {t(`jobsPage.categories.${c}`, c)}
                      <span className="text-[11px] text-muted-foreground">{(n as number).toLocaleString()}</span>
                    </button>
                  ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={dismissOrientation} className="text-sm font-semibold text-primary hover:underline">
                  {t("jobsPage.orientBrowse", "Browse newest openings →")}
                </button>
                <Link to="/explore" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                  {t("jobsPage.orientExplore", "Or explore by signal — who's hiring, who fills, where the pay is")}
                </Link>
              </div>
            </div>
          )}

          {/* The one thing no other board offers on arrival: match scores on
              every opening — now one gesture away. Drop a résumé HERE (parsed by
              the same server parsers as the scanner) and the board re-ranks
              itself instantly; the full scan stays one link away. Shown only to
              visitors we KNOW have no résumé yet. */}
          {resumeAvailable === false && !fitRanking && resumeDropPanel("hidden lg:flex")}

          {/* Split-pane on lg+: list column left, detail column right. */}
          <div className="lg:grid lg:grid-cols-[minmax(0,46%)_minmax(0,54%)] lg:gap-6 lg:items-start">
          <div className="min-w-0">
          {/* WHY THIS SITS ABOVE THE RESULTS/EMPTY SPLIT, NOT INSIDE IT.

              Every one of these used to live in the results branch of
              `jobs.length === 0 ? (zero state) : (results)`, so a search that
              returned NOTHING explained nothing — which is precisely the moment
              a searcher needs them. Verified: q + salaryFloor=300000 with zero
              rows rendered no coverage line at all. "Pay is stated on 13% of
              postings" is advice on an empty page and trivia on a full one, and
              it was showing only on the full one. */}
          {/* ONE PERSISTENT LIVE REGION, MOUNTED WHETHER OR NOT IT HAS ANYTHING TO SAY.

              Each of these lines used to carry its own role="status", which is a
              live region that only exists while the message does. A region
              mounted at the same moment as its content is generally not
              announced at all — assistive tech watches regions that were
              already present for CHANGES. So the honesty work was, to a screen
              reader, silent: the coverage line, the rewritten query, the
              dropped filter, none of them spoke.

              The wrapper is always in the tree and the messages appear inside
              it, which is the shape that actually announces. Nested regions are
              removed with the same change — a region inside a region announces
              twice. */}
          <div aria-live="polite" aria-atomic="false">
            {!loading && !error && (
              <>
                  {/* The server names any filter it could not honour. Until now nothing
                      read the field: the fence was satisfied in the payload and broken
                      on screen — an active filter chip, results that ignore it, and no
                      word to the user. A filter that did nothing has to SAY so where
                      the results are, not only in the JSON. */}
                  {Array.isArray(data?.droppedTerms) && data.droppedTerms.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("jobsPage.droppedTerms", "Searched titles for the rest — ignored {{words}}, which don't appear in job titles.", {
                        words: data.droppedTerms.map((w) => `"${w}"`).join(", "),
                      })}
                    </p>
                  )}
                  {/* TWO KINDS OF DROP, AND ONE SENTENCE CANNOT COVER BOTH.
                      Most ignored filters NARROW: "those results are unfiltered
                      by it" is then true and useful. But includeUncategorised
                      WIDENS — it asks to ADD unsorted postings — and it is dropped
                      when sorting by pay. Measured live: {includeUncategorised:
                      true, category:"design", sort:"salary"} returns
                      ignoredFilters:["includeUncategorised"], and the old copy
                      rendered "We couldn't apply includeUncategorised — those
                      results are unfiltered by it": a raw camelCase identifier,
                      and the precise opposite of what happened. That page is MORE
                      filtered than asked, not less. */}
                  {(() => {
                    const ig = Array.isArray(data?.ignoredFilters) ? data.ignoredFilters : [];
                    if (!ig.length) return null;
                    const WIDENING = new Set(["includeUncategorised"]);
                    const narrowed = ig.filter((f) => !WIDENING.has(f));
                    const widened = ig.filter((f) => WIDENING.has(f));
                    const name = (f: string) => t(`jobsPage.filterName.${f}`, f);
                    return (
                      <>
                        {narrowed.length > 0 && (
                          <p className="text-xs text-warning mb-2">
                            {t("jobsPage.ignoredFilters", "We couldn't apply {{filters}} — those results are unfiltered by it. Everything else you selected did apply.", { filters: narrowed.map(name).join(", ") })}
                          </p>
                        )}
                        {widened.length > 0 && (
                          <p className="text-xs text-warning mb-2">
                            {t("jobsPage.ignoredWidening", "We couldn't add {{filters}} to this page, so those postings are left out here.", { filters: widened.map(name).join(", ") })}
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {/* WHAT A FILTER CAN EVEN SEE.
                      The single most useful thing on this page and it shipped mute.
                      A pay filter searches the 13% of postings that state pay; the
                      other 87% are not "jobs that pay less", they are jobs that did
                      not say. Without this line a thin result set reads as a verdict
                      on the market instead of on the data. */}
                  {(() => {
                    const fc = data?.filterCoverage;
                    if (!fc) return null;
                    const parts: string[] = [];
                    if (typeof fc.salaryFloor === "number") parts.push(t("jobsPage.coveragePay", "pay on {{pct}}%", { pct: Math.round(fc.salaryFloor * 100) }));
                    if (typeof fc.workMode === "number") parts.push(t("jobsPage.coverageWorkMode", "work mode on {{pct}}%", { pct: Math.round(fc.workMode * 100) }));
                    if (typeof fc.experience === "number") parts.push(t("jobsPage.coverageExperience", "experience level on {{pct}}%", { pct: Math.round(fc.experience * 100) }));
                    // Country was the only one of the four filters with no
                    // caveat, while being the thinnest on some vendors.
                    if (typeof fc.country === "number") parts.push(t("jobsPage.coverageCountry", "a country on {{pct}}%", { pct: Math.round(fc.country * 100) }));
                    // THE FIVE NEW PARTLY-POPULATED FILTERS, on the same line
                    // and by the same rule: a filter over a column employers
                    // often leave blank must publish what it can even see, or a
                    // thin page reads as a verdict on the market instead of on
                    // the data. `vendor` follows them, and the note beside it
                    // says why a 100% figure is still worth printing.
                    if (typeof fc.salaryCeiling === "number") parts.push(t("jobsPage.coverageCeiling", "a pay figure to cap on {{pct}}%", { pct: Math.round(fc.salaryCeiling * 100) }));
                    if (typeof fc.hasStatedPay === "number") parts.push(t("jobsPage.coverageStatedPay", "any pay at all on {{pct}}%", { pct: Math.round(fc.hasStatedPay * 100) }));
                    if (typeof fc.payBasis === "number") parts.push(t("jobsPage.coveragePayBasis", "hourly or salaried on {{pct}}%", { pct: Math.round(fc.payBasis * 100) }));
                    if (typeof fc.maxYears === "number") parts.push(t("jobsPage.coverageMaxYears", "years of experience on {{pct}}%", { pct: Math.round(fc.maxYears * 100) }));
                    if (typeof fc.department === "number") parts.push(t("jobsPage.coverageDepartment", "a department on {{pct}}%", { pct: Math.round(fc.department * 100) }));
                    // 100%, and rendered anyway. The server emits it, and the
                    // honest answer to "how much of the board can this filter
                    // see" is sometimes "all of it" — leaving it out would make
                    // the line's silence about vendor indistinguishable from the
                    // silence about a filter nobody switched on.
                    if (typeof fc.vendor === "number") parts.push(t("jobsPage.coverageVendor", "which system they post on for {{pct}}%", { pct: Math.round(fc.vendor * 100) }));
                    if (!parts.length) return null;
                    return (
                      <p className="text-xs text-muted-foreground mb-2">
                        {t("jobsPage.filterCoverage", "Employers state {{fields}} of postings. A filter can only search what was published — roles that don't say are hidden here, not absent.", { fields: parts.join(", ") })}
                      </p>
                    );
                  })()}
                  {/* We rewrote their query. Say so. */}
                  {Array.isArray(data?.intentFilters) && data.intentFilters.length > 0 && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.intentFilters", "Read {{phrases}} as a filter and applied it, rather than searching for those words.", {
                        phrases: data.intentFilters.map((p) => `“${p}”`).join(", "),
                      })}
                    </p>
                  )}
                  {/* And when we removed results on their behalf. "engineer not
                      manager" used to return managers — the words were dropped
                      and the rest re-read as a conjunction, giving the opposite
                      of what was asked. */}
                  {Array.isArray(data?.excludedTerms) && data.excludedTerms.length > 0 && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.excludedTerms", "Hiding results that mention {{terms}}. Remove the “not” or the “-” to see them.", {
                        terms: data.excludedTerms.map((p) => `“${p}”`).join(", "),
                      })}
                    </p>
                  )}
                  {/* A pay-sorted page is a filtered page. It never said so. */}
                  {data?.salaryStatedOnly && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.salaryStatedOnly", "Sorted by pay, so only roles that state a salary appear here.")}
                    </p>
                  )}
                  {data?.locationExpandedFrom && Array.isArray(data?.locationSearched) && data.locationSearched.length > 0 && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.locationExpanded", "Searched {{from}} as {{places}}.", {
                        from: `“${data.locationExpandedFrom}”`,
                        places: data.locationSearched.join(", "),
                      })}
                    </p>
                  )}
                  {typeof data?.salaryFromQuery === "number" && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.salaryFromQuery", "Read {{amount}} in your search as a minimum pay filter.", {
                        amount: data.salaryFromQuery.toLocaleString(),
                      })}
                    </p>
                  )}
                  {typeof data?.maxAgeClampedTo === "number" && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.maxAgeClamped", "The board keeps {{days}} days of postings, so that is the window searched.", {
                        days: data.maxAgeClampedTo,
                      })}
                    </p>
                  )}
                  {data?.postedAfterUsesStatedDate && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.postedAfterStatedDate", "Counted from the date each employer stated, not from when we found the posting.")}
                    </p>
                  )}
                  {data?.companyMatched && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.companyMatched", "Matched an employer name — showing roles at {{company}}.", { company: data.companyMatched })}
                    </p>
                  )}
                  {data?.exactWordMatch && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.exactWordMatch", "Showing exact whole-word matches for “{{q}}”.", { q: data.exactWordMatch })}
                    </p>
                  )}
                  {data?.locationSplit && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {t("jobsPage.locationSplit", "Read “{{place}}” as a location — showing “{{q}}” jobs in {{place}}.", {
                        q: data.locationSplit.q, place: data.locationSplit.location,
                      })}{" "}
                      {/* Make the guess undoable AND committable. Clicking moves
                          the place into the real location filter, so paging,
                          counts and every later refinement run on the honest
                          query instead of re-deriving the split each time. */}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => { setQ(data.locationSplit!.q); setLocation(data.locationSplit!.location); }}
                      >
                        {t("jobsPage.locationSplitApply", "Set it as the location filter")}
                      </button>
                    </p>
                  )}
                  {data?.didYouMean && (
                    <p className="text-xs text-muted-foreground mb-2">
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => setQ(data.didYouMean!)}
                      >
                        {t("jobsPage.didYouMean", "Did you mean “{{q}}”?", { q: data.didYouMean })}
                      </button>
                    </p>
                  )}
              </>
            )}
          </div>
          {/* Results */}
          {loading ? (
            // Skeleton cards: the page keeps its shape while the first load
            // lands — no spinner void, no layout jump when cards arrive.
            <ul className="space-y-3" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => (
                <li key={i} className="rounded-2xl border border-border bg-card p-4 animate-pulse">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-muted/60 shrink-0 hidden sm:block" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted/60 rounded w-2/3" />
                      <div className="h-3 bg-muted/40 rounded w-1/2" />
                      <div className="h-3 bg-muted/30 rounded w-1/3" />
                      <div className="flex gap-2 pt-1">
                        <div className="h-8 bg-muted/40 rounded w-36" />
                        <div className="h-8 bg-muted/50 rounded w-20" />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : error ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                {errorKind === "query"
                  ? t("jobsPage.errorQuery", "That search contains characters our security filter blocks (quotes, semicolons, slashes). Try the words on their own.")
                  : t("jobsPage.error", "The board couldn't load right now.")}
              </p>
              {/* A RETRY IS ALWAYS OFFERED. The query branch used to show only
                  "Clear the search", so a visitor whose search was misjudged
                  as hostile — every possessive company name qualified — had no
                  way to try again and one button that discarded their typing. */}
              <Button variant="outline" size="sm" onClick={() => fetchJobs(0)}>
                {t("jobsPage.retry", "Try again")}
              </Button>
              {errorKind === "query" && (
                <Button variant="ghost" size="sm" onClick={() => setQ("")}>
                  {t("jobsPage.clearSearch", "Clear the search")}
                </Button>
              )}
            </div>
          ) : jobs.length === 0 ? (
            /* Server-zero: an actionable exit, never a dead end. Each button is
               a measured single relaxation with its real result count. */
            <div className="rounded-2xl border border-border bg-card p-6 text-center my-4">
              {/* "No openings match" is a claim about the CORPUS. It is only
                  honest if every tier actually ran — and when the meaning-match
                  tier fails (deadline or RPC error) it returns nothing, which is
                  indistinguishable from finding nothing. Say which happened
                  rather than asserting an answer the search did not produce. */}
              <p className="font-semibold text-foreground mb-1">
                {data?.semanticDegraded
                  ? t("jobsPage.zeroTitleDegraded", "No exact matches — and our meaning-match search didn't finish")
                  : t("jobsPage.zeroTitle", "No verified openings match all of that")}
              </p>
              <p className="text-sm text-muted-foreground mb-3">
                {data?.semanticDegraded
                  ? t("jobsPage.zeroBodyDegraded", "That second pass looks for jobs that mean the same thing as what you typed, and it timed out this time. Try again in a moment, or loosen a filter:")
                  : t("jobsPage.zeroBody", "We only list postings verified from companies' own systems — nothing gets padded in. Loosening one filter helps:")}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {(zeroHelp ?? []).map((s) => (
                  <Button key={s.key} size="sm" variant="outline" onClick={s.clear}>
                    {t("jobsPage.zeroRemove", "Remove {{label}} — {{n}} openings", { label: s.label, n: `${s.count.toLocaleString()}${s.capped ? "+" : ""}` })}
                  </Button>
                ))}
                {zeroHelp === null && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
              {/* The catalog turns over daily — "nothing today" is not
                  "nothing ever". Saving the search wires it into the existing
                  alert loop, so the dead end becomes the reason to come back. */}
              {(q || location || category || company) && (
                <div className="mt-4 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("jobsPage.zeroAlertHint", "New postings land here every day. Get an email when roles matching this search appear:")}
                  </p>
                  <Button size="sm" variant="default" className="gap-1.5" onClick={() => saveCurrentSearch(true)}>
                    <Bell className="w-3.5 h-3.5" />
                    {t("jobsPage.zeroAlertCta", "Alert me when this exists")}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Dead deep link: the shared posting closed. Say what it was
                  (when the closure log knows) and offer live siblings — a
                  visible answer where there used to be silence. */}
              {deadLink && (
                <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/5 px-3.5 py-2.5 mb-4">
                  <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <div className="text-[13px] min-w-0">
                    <p className="text-foreground">
                      {deadLink.title
                        ? t("jobsPage.deadLinkKnown", "“{{title}}”{{at}} is no longer live — it was filled or taken down.", { title: deadLink.title, at: deadLink.company ? ` ${t("jobsPage.deadLinkAt", "at")} ${deadLink.company}` : "" })
                        : t("jobsPage.deadLinkUnknown", "The posting in that link is no longer live — it was filled or taken down.")}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {deadLink.title && (
                        <button
                          type="button"
                          className="text-[13px] font-semibold text-primary hover:underline"
                          onClick={() => { setQ(deadLink.title ?? ""); setDeadLink(null); }}
                        >
                          {t("jobsPage.deadLinkSearch", "Find similar live roles")}
                        </button>
                      )}
                      <button type="button" className="text-[13px] text-muted-foreground hover:underline" onClick={() => setDeadLink(null)}>
                        {t("jobsPage.deadLinkDismiss", "Dismiss")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {disclosure && (
                <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 mb-4">
                  <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="text-[13px] min-w-0">
                    <p className="text-foreground">
                      {disclosure.kind === "salary"
                        ? t("jobsPage.discSalary", "{{shown}} of these employers publish pay. Another {{hidden}} openings match everything else you asked for, but don't state a salary — so this filter hides them.", { shown: disclosure.shown.toLocaleString(), hidden: disclosure.hidden.toLocaleString() })
                        : t("jobsPage.discWorkMode", "{{shown}} of these employers state where the work happens. Another {{hidden}} openings match everything else, but don't say remote, hybrid, or on-site — so this filter hides them.", { shown: disclosure.shown.toLocaleString(), hidden: disclosure.hidden.toLocaleString() })}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (disclosure.kind === "salary") setSalaryFloor(0);
                        else { setWorkMode(""); setRemoteOnly(false); }
                      }}
                      className="mt-1 text-[13px] font-semibold text-primary hover:underline"
                    >
                      {t("jobsPage.discShowAll", "Show those too")}
                    </button>
                  </div>
                </div>
              )}
              {fitSummary && (fitSummary.strong > 0 || fitSummary.possible > 0) && (
                <div className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/5 px-3.5 py-2.5 mb-4">
                  <Target className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  <div className="text-sm min-w-0">
                    <p className="font-semibold text-foreground">
                      {fitSummary.strong > 0
                        ? t("jobsPage.fitSummaryStrong", "You're a strong fit for {{count}} of these openings", { count: fitSummary.strong })
                        : t("jobsPage.fitSummaryPossible", "You're a possible fit for {{count}} of these openings", { count: fitSummary.possible })}
                      {fitSummary.strong > 0 && fitSummary.possible > 0 && (
                        <span className="font-normal text-muted-foreground">
                          {" · "}{t("jobsPage.fitSummaryAndPossible", "and a possible fit for {{count}} more", { count: fitSummary.possible })}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("jobsPage.fitSummaryHow", "Ranked to the top by how well your resume covers each posting's keywords — open any card to see what to add.")}
                    </p>
                    {/* Skill-unlock: the highest-leverage missing keyword across
                        the user's scored postings. Honest counts, no promised
                        tier jumps; links into the scanner/builder loop. */}
                    {skillUnlock && (
                      <p className="text-xs mt-1.5">
                        <span className="font-semibold text-primary">{t("jobsPage.skillUnlockLead", "Skill unlock:")}</span>{" "}
                        <span className="text-foreground font-medium">{skillUnlock.k}</span>{" "}
                        <span className="text-muted-foreground">
                          {skillUnlock.possible > 0
                            ? t("jobsPage.skillUnlockPossible", "is missing from {{n}} of these postings — including {{p}} where you're already a possible match.", { n: skillUnlock.n, p: skillUnlock.possible })
                            : t("jobsPage.skillUnlockPlain", "is missing from {{n}} of these postings.", { n: skillUnlock.n })}
                        </span>{" "}
                        <Link to="/#upload" className="text-primary hover:underline">
                          {t("jobsPage.skillUnlockCta", "Have it? Add it to your resume honestly →")}
                        </Link>
                      </p>
                    )}
                  </div>
                </div>
              )}
              {/* ONE DEFINITION OF "HOW MANY", SHARED BY EVERY BRANCH.
                  `total` is the EXACT segment now — titles that match. A page
                  can hold rows from both segments, so a headline built from
                  `total` alone reads "Showing 60 of 0" on any query that matches
                  only in descriptions. Every branch of the summary below sums
                  them; the split is disclosed on its own line rather than
                  crammed into four separate strings. */}
              <p className="text-xs text-muted-foreground mb-3" aria-live="polite">
                {/* WHEN THERE ARE TWO SEGMENTS, THE SEGMENTED LINE IS THE
                    HEADLINE — it does not sit beside one.
                    Rendering both let the page print a single summed figure,
                    and that figure is not comparable across searches: the
                    related segment is only COMPUTED when the exact one is thin,
                    so a fat search reports exact-only while a narrower one
                    reports exact+related. Measured after deploy: PT+manager read
                    "of 223" and PT+manager+hybrid — a strict subset — read
                    "of 254". Smaller than the 234/266 it replaced, and still the
                    same lie. One number that changes meaning between two
                    searches cannot be compared, so this stops offering one. */}
                {/* A CLIENT-SIDE FILTER MAKES EVERY SERVER COUNT WRONG.
                    "Actively hiring" filters the rows already fetched, while
                    every total on this line came from the unfiltered query —
                    measured by the audit at 7 rows under a 10,000 headline.
                    The server counts cannot describe this page, so the page
                    stops quoting them and states only what it is showing,
                    the same withdrawal the server performs when its own count
                    is disproved. */}
                {activelyHiringOnly
                  ? t("jobsPage.resultsSummaryNoTotal", "Showing {{shown}} matching openings", { shown: shownCount })
                  : typeof data?.relatedTotal === "number" && data.relatedTotal > 0
                  ? t("jobsPage.resultsSummarySegmented", "Showing {{shown}} — {{exact}} exact and {{related}} where the term appears in the description", {
                      shown: shownCount,
                      exact: (data?.total ?? 0).toLocaleString(),
                      related: `${data.relatedTotal.toLocaleString()}${data.relatedCapped ? "+" : ""}`,
                    })
                  : data?.countUnavailable
                  // The server couldn't compute an exact total for this filter.
                  // Say what we actually know instead of printing jobs.length as
                  // if it were the total — that would claim 20 matches when the
                  // filter really matches six figures.
                  ? (typeof data?.totalAtLeast === "number" && data.totalAtLeast > shownCount
                      ? t("jobsPage.resultsSummaryFloor", "Showing {{shown}} of {{floor}}+ matching openings", {
                          shown: shownCount, floor: data.totalAtLeast.toLocaleString(),
                        })
                      : t("jobsPage.resultsSummaryNoTotal", "Showing {{shown}} matching openings", { shown: shownCount }))
                  : landerCompany
                  ? t("jobsPage.companyResultsSummary", "Showing {{shown}} of {{total}} open roles at {{company}}", {
                      shown: shownCount,
                      // The two branches below already do both of these; this one
                      // did neither, so a company lander printed a bare capped
                      // count and an unseparated five-digit number.
                      total: data?.countCapped || data?.relatedCapped
                        ? `${pageTotalCount.toLocaleString()}+`
                        : pageTotalCount.toLocaleString(),
                      company: landerCompanyName,
                    })
                  // "across N companies" only when nothing narrows the list:
                  // companiesCount is BOARD-WIDE (measured: a category filter
                  // matching 1,429 companies still reported 22,944), and the
                  // client's company facet is cached from the first load — so
                  // under any filter the honest move is to drop the clause,
                  // not to print a wrong number.
                  : (q.trim() || country || activeFilterCount > 0)
                  ? t("jobsPage.resultsSummaryFiltered", "Showing {{shown}} of {{total}} matching openings", {
                  shown: shownCount,
                  total: data?.countCapped || data?.relatedCapped
                    ? `${pageTotalCount.toLocaleString()}+`
                    : pageTotalCount.toLocaleString(),
                })
                  : t("jobsPage.resultsSummary", "Showing {{shown}} of {{total}} matching openings across {{companyFeeds}} company feeds", {
                  shown: shownCount,
                  // The server caps counting for speed; above the cap it says so,
                  // and we render "10,000+" rather than passing the cap off as exact.
                  total: data?.countCapped || data?.relatedCapped
                    ? `${pageTotalCount.toLocaleString()}+`
                    : pageTotalCount.toLocaleString(),
                  companyFeeds: (data?.companiesCount ?? companies.length).toLocaleString(),
                })}
                {/* THE REVENUE PRODUCT, ON THE SURFACE THAT CARRIES THE TRAFFIC.
                    Placed here rather than in the hero deliberately: a visitor
                    reading the results line is looking at real roles, which is
                    the moment "something could apply to these for me" means
                    anything. In the hero it would be an ad before they had seen
                    a job.

                    EVERY NUMBER IS COUNTED, NOT CLAIMED. agentReadyOnPage uses
                    the same predicate as the Sparkles badge on the cards below,
                    so a sceptic can count the badges and get the same figure.
                    It renders only when there is at least one — a pitch saying
                    "0 of these" is worse than silence, and quoting a board-wide
                    total here would be true but uncheckable.

                    The 6.3% is stated rather than hidden. The agent covers four
                    hiring systems, not the whole board, and a visitor who finds
                    that out AFTER paying is a refund and a bad review. */}
                {agentReadyOnPage > 0 && !agentOnly && (
                  <span className="block text-[12px] text-muted-foreground mt-1">
                    <Sparkles className="inline w-3 h-3 text-primary -mt-0.5" aria-hidden />{" "}
                    {t("jobsPage.agentPitchCounted", "The apply agent can fill and submit {{n}} of these for you — it reads your CV, writes each application separately, and answers the employer's own screening questions.", { n: agentReadyOnPage })}{" "}
                    <Link to="/agent" className="text-primary underline underline-offset-2">
                      {t("jobsPage.agentPitchCta", "See how it works — 7 days free, then $99/mo")}
                    </Link>
                    <span className="block text-[11px] opacity-80 mt-0.5">
                      {/* BOTH NUMBERS WERE WRONG, IN ALL NINE LOCALES. This said
                          "four hiring systems — about 6% of the board" while
                          SENDABLE_VENDORS held FIVE and the live figure was 8.2%.
                          A count of something that grows cannot be a literal, and
                          the old key is deleted from the locale files rather than
                          edited, because a locale value overrides an inline
                          default — nine translated copies of "four" would have
                          gone on rendering. Interpolated as digits so a vendor
                          landing never costs nine translations again. */}
                      {agentReach
                        ? t("jobsPage.agentPitchScopeLive", "It applies on {{n}} hiring systems — about {{pct}}% of the board — and never on sites that gate applications behind a CAPTCHA. Everywhere else it prepares the application and you send it.", { n: agentReach.vendors, pct: Math.round(reachPct(agentReach)) })
                        : t("jobsPage.agentPitchScopePlain", "It applies on the hiring systems that allow it, and never on sites that gate applications behind a CAPTCHA. Everywhere else it prepares the application and you send it.")}
                    </span>
                  </span>
                )}
                {/* refreshedAt is the last FULL-ROTATION stamp, not "when this
                    board was updated" — measured 2026-07-28 it read 931 min
                    while the site's own measured re-check median was 112 min
                    and the footer below promised 10-15 minutes. Three different
                    freshness numbers across two pages of one product, and the
                    biggest one carried the vaguest label. Publish the MEASURED
                    stat (the same p50 the Ghost Job Index publishes) so the two
                    pages cannot disagree, and say plainly what it measures. */}
                {recheckP50Min !== null && (
                  <span> · {t("jobsPage.recheckedAgo", "median feed re-checked {{min}} min ago", { min: recheckP50Min })}</span>
                )}
                {/* Board-wide feed-health note — on a single-company page it
                    reads as a claim about THAT company, so it stays off there. */}
                {healthFailed && (
              <span className="text-muted-foreground">
                {t("jobsPage.healthUnavailable", "hiring-pace data unavailable right now")}
              </span>
            )}
            {/* A CAP RENDERED AS A COUNT. failedSources is the last 120
                failures, so this line read exactly 120 for 45 minutes straight
                (2026-08-25) and then 112 — a ceiling and a census, printed in
                the same sentence with no way to tell them apart. unreachableFeeds
                prefers the uncapped failedCount and, when only the sample is
                available, says "at least" — which is the true claim. */}
            {!landerCompany && data && (() => {
                  const feeds = unreachableFeeds(data.failedCount, data.failedSources?.length ?? 0);
                  if (!feeds) return null;
                  return (
                    <span> · {feeds.exact
                      ? t("jobsPage.sourcesDown", {
                          count: feeds.count,
                          defaultValue_one: "{{count}} company feed is unreachable right now",
                          defaultValue_other: "{{count}} company feeds are unreachable right now",
                        })
                      : t("jobsPage.sourcesDownAtLeast", {
                          count: feeds.count,
                          defaultValue_one: "at least {{count}} company feed is unreachable right now",
                          defaultValue_other: "at least {{count}} company feeds are unreachable right now",
                        })}</span>
                  );
                })()}
                {refreshing && <span className="text-primary"> · {t("jobsPage.updating", "updating…")}</span>}
                {dismissedIds.size > 0 && (
                  <span>
                    {" · "}
                    {t("jobsPage.hiddenCount", "{{count}} hidden", { count: dismissedIds.size })}{" "}
                    <button type="button" className="text-primary hover:underline" onClick={restoreDismissed}>
                      {t("jobsPage.restoreHidden", "restore")}
                    </button>
                  </span>
                )}
              </p>
              {/* NL-search interpretation: show exactly how the plain-language
                  query was read (chips = applied filters) and disclose anything
                  we couldn't map — never silently drop a concept. */}
              {nlResult && (nlResult.interpreted.length > 0 || nlResult.notMapped.length > 0) && (
                <div className="mb-2 -mt-1 text-xs">
                  {nlResult.interpreted.length > 0 && (
                    <p className="text-muted-foreground flex flex-wrap items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span>{t("jobsPage.nlInterpreted", "Read as:")}</span>
                      {nlResult.interpreted.map((c) => (
                        <span key={c} className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5">{c}</span>
                      ))}
                      <button type="button" className="text-muted-foreground hover:text-foreground underline ml-1" onClick={() => setNlResult(null)}>
                        {t("jobsPage.nlDismiss", "dismiss")}
                      </button>
                    </p>
                  )}
                  {nlResult.notMapped.length > 0 && (
                    <p className="text-warning/90 mt-1">
                      {t("jobsPage.nlNotMapped", "Couldn't filter by: {{terms}} — no filter for that yet, so it wasn't applied.", { terms: nlResult.notMapped.join(", ") })}
                    </p>
                  )}
                </div>
              )}
              {/* Typo fallback disclosure: never pass fuzzy matches off as
                  exact — say plainly these are the closest titles we found. */}
              {data?.fuzzy && (
                <p className="text-xs text-warning/90 mb-2 -mt-1">
                  {t("jobsPage.fuzzyLine", "No exact matches for “{{q}}” — showing the closest job titles instead.", { q: data.fuzzy })}
                </p>
              )}
              {/* Semantic-tier disclosure: same honesty rule as the fuzzy line —
                  nearest-by-meaning results are labeled, never passed off as
                  keyword matches. */}
              {data?.semantic && (
                <p className="text-xs text-warning/90 mb-2 -mt-1">
                  {t("jobsPage.semanticLine", "No title matches for “{{q}}” — showing the closest roles by meaning.", { q: data.semantic })}
                </p>
              )}
              {/* +N close matches appended to a thin exact-match page: same
                  honesty rule — the appended rows carry their own chip, and
                  this line says why they're there. */}
              {data?.fuzzyExtra && (
                <p className="text-xs text-warning/90 mb-2 -mt-1">
                  {t("jobsPage.fuzzyExtraLine", "Only a few exact matches for “{{q}}” — {{count}} close-match titles are included below, labeled.", { q: data.fuzzyExtra.q, count: data.fuzzyExtra.count })}
                </p>
              )}
              {q.trim() && sortMode !== "salary" && !data?.fuzzy && !data?.semantic && (
                <p className="text-[11px] text-muted-foreground mb-2 -mt-1">
                  {/* The relevance claim is only made when the ranked path
                      actually served this page. If it errored, the recency
                      fallback answered — saying "sorted by relevance" over
                      recency-ordered rows would be a lie about the one thing
                      this line exists to disclose. */}
                  {searchNewestFirst
                    ? t("jobsPage.sortedNewest", "Sorted by newest first")
                    : data?.ranked
                      ? t("jobsPage.sortedRelevance", "Sorted by relevance — title matches first")
                      : t("jobsPage.sortedNewestFallback", "Sorted by newest first (relevance ranking briefly unavailable)")}
                  {" · "}
                  <button type="button" className="text-primary hover:underline" onClick={() => setSearchNewestFirst((v) => !v)}>
                    {searchNewestFirst
                      ? t("jobsPage.switchRelevance", "switch to relevance")
                      : t("jobsPage.switchNewest", "switch to newest")}
                  </button>
                  {" · "}
                  <span title={t("jobsPage.phraseTipLong", "Search also looks inside job descriptions. Wrap words in quotes to match an exact phrase.")}>
                    {t("jobsPage.phraseTip", 'tip: "quotes" match exact phrases')}
                  </span>
                  {!searchNewestFirst && data?.aliases && data.aliases.length > 0 && (
                    <span className="text-foreground/80">
                      {" · "}
                      {t("jobsPage.aliasLine", "also matching: {{terms}}", { terms: data.aliases.join(", ") })}
                    </span>
                  )}
                </p>
              )}
              {/* Adjacent-role discovery: the roles next to the one searched are
                  often a wider real market than people realize. Curated, honest,
                  one-tap — never a silent rewrite. Shown whenever a query maps to
                  a seed role (most valuable exactly when results are thin). */}
              {q.trim() && (() => {
                const adj = adjacentRoles(q);
                return adj.length > 0 ? (
                  <p className="text-xs text-muted-foreground mb-2 -mt-1 flex flex-wrap items-center gap-1.5">
                    <span>{t("jobsPage.relatedRoles", "Related roles:")}</span>
                    {adj.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => { setQ(r); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                        className="inline-flex items-center rounded-full border border-border bg-card/60 px-2.5 py-0.5 text-[11px] text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                      >
                        {r}
                      </button>
                    ))}
                  </p>
                ) : null;
              })()}
              {category && benchmarks?.[category] && (
                <p
                  className="text-xs text-muted-foreground mb-3 -mt-2"
                  title={t("jobsPage.benchmarkTip", "Median of the annualized lower bounds companies publish themselves (hourly and monthly rates annualized), computed over this field's dominant stated currency only — never converted, never mixed. Live from this board — not a survey or an estimate.")}
                >
                  {t("jobsPage.benchmarkLine", "Advertised pay in this field: median floor {{symbol}}{{median}} ({{currency}}) — from {{n}} postings here that state pay", {
                    symbol: { USD: "$", EUR: "€", GBP: "£" }[benchmarks[category].currency] ?? "",
                    median: Math.round(benchmarks[category].median).toLocaleString(),
                    currency: benchmarks[category].currency,
                    n: benchmarks[category].n,
                  })}
                </p>
              )}
              {showWelcome && !session && !q && !category && !company && !workMode && (
                // DESKTOP ONLY. Measured on a 375x812 phone: this panel is
                // 189px — the single largest block between the top of the
                // page and the first job card, which sat 1,054px down (1.3
                // screens) behind 40 interactive controls. Its three starter
                // chips are also already duplicated on mobile by the
                // lg:hidden quick-filter row above ("Posted this week" /
                // "Actively hiring" / "$100k+"), so on a phone it cost a
                // screen of scrolling to repeat affordances the reader had
                // just passed. The trust sentence it carries is likewise
                // already on screen above, in the hero and the badge row.
                <div className="hidden lg:flex rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 mb-3 flex-wrap items-center gap-2">
                  <p className="text-[13px] text-foreground basis-full sm:basis-auto sm:flex-1">
                    {t("jobsPage.welcomeLine", "Every posting here is verified live from the company's own system. Start where this board is strongest:")}
                  </p>
                  <button type="button" onClick={() => { trackBoard("welcome_posted_today"); dismissWelcome(); setFreshness("1"); }}
                    className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                    {t("jobsPage.welcomePostedToday", "Posted today")}
                  </button>
                  <button type="button" onClick={() => { trackBoard("welcome_actively_hiring"); dismissWelcome(); setActivelyHiringOnly(true); }}
                    className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                    {t("jobsPage.welcomeFillers", "Companies that fill roles")}
                  </button>
                  <button type="button" onClick={() => { trackBoard("welcome_stated_pay"); dismissWelcome(); setSalaryFloor(1); }}
                    className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                    {t("jobsPage.welcomeStatedPay", "Stated pay only")}
                  </button>
                  <button type="button" onClick={dismissWelcome} aria-label={t("jobsPage.welcomeDismiss", "Dismiss")}
                    className="text-muted-foreground/60 hover:text-foreground text-sm px-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded">
                    ×
                  </button>
                </div>
              )}
              <ul className="space-y-3">
                {/* On mobile the resume drop sits after the third card rather
                    than above the list — far enough in that the reader has
                    seen real openings first, early enough to still be found.
                    On a page with fewer than four results it falls back to the
                    last card so it never disappears entirely. */}
                {groupedJobs.map(({ primary: job, siblings }, gi) => {
                  const mobileDropAt = Math.min(3, Math.max(groupedJobs.length - 1, 0));
                  const d = daysAgo(job.postedAt);
                  const openRoles = job.token ? companyCounts.get(job.token) : undefined;
                  const fit = fitRanking ? fits[job.id] : undefined;
                  const gaps = fitRanking ? (misses[job.id] ?? []) : [];
                  const strengths = fitRanking ? (hits[job.id] ?? []) : [];
                  // Calibrated on live data: full JDs are keyword-dense, so a
                  // strong same-field resume covers ~20-24% of recognized terms
                  // and a cross-field one ~3%. Show a qualitative tier (precise
                  // coverage in the tooltip) so a genuinely strong 22% doesn't
                  // read as a bad match to a layperson.
                  const tier = typeof fit === "number" ? (fit >= 20 ? "strong" : fit >= 10 ? "possible" : "stretch") : null;
                  return (
                    <Fragment key={job.id}>
                    {gi === mobileDropAt && resumeAvailable === false && !fitRanking && (
                      <li className="lg:hidden">{resumeDropPanel("flex")}</li>
                    )}
                    {gi === newSinceIndex && (
                      <li aria-hidden="true" className="flex items-center gap-3 py-1">
                        <span className="flex-1 h-px bg-border" />
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {t("jobsPage.seenLastVisit", "posted before your last visit")}
                        </span>
                        <span className="flex-1 h-px bg-border" />
                      </li>
                    )}
                    <li
                      data-job-id={job.id}
                      onMouseEnter={() => prefetchDesc(job)}
                      onTouchStart={onCardTouchStart(job)}
                      onTouchMove={onCardTouchMove}
                      onTouchEnd={onCardTouchEnd(job)}
                      style={{ borderLeft: `3px solid ${accentFor(job.category)}` }}
                      className={`animate-in fade-in slide-in-from-bottom-1 duration-200 rounded-2xl border bg-card ${density === "compact" ? "px-4 py-2" : "p-4"} cursor-pointer transition-all duration-150 hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        detailJob?.id === job.id ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                      onClick={(e) => {
                        // The whole card opens the detail panel — except clicks
                        // on its own controls (apply/save/fit/report/etc.).
                        if ((e.target as HTMLElement).closest("button, a, select, input, label")) return;
                        void openDetail(job);
                      }}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <div
                          aria-hidden="true"
                          className="w-9 h-9 rounded-lg shrink-0 hidden sm:flex items-center justify-center text-sm font-bold select-none"
                          style={{ backgroundColor: `hsl(${avatarHue(job.token || job.company)} 42% 22%)`, color: `hsl(${avatarHue(job.token || job.company)} 85% 76%)` }}
                        >
                          {(job.company || "?").charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-[220px]">
                          {/* The title IS the open-details control: a real
                              control screen readers can find (the li's Enter
                              handler was invisible to them), clamped to two
                              lines so multi-segment ATS titles can't wall the
                              list (full text in the tooltip).

                              IT IS NOW AN ANCHOR, because as a <button> it gave
                              the page NO CRAWLABLE PATH TO A JOB: measured on
                              the hydrated board, all 60 a[href^="/jobs/"] were
                              /jobs/company/<token> links and zero pointed at a
                              posting. Every posting is in the sitemap as
                              /jobs?job=<id>, and the only in-page route to it
                              was a JS click handler — a crawler (and anyone
                              cmd-clicking, middle-clicking, or copying a link)
                              got nothing.

                              The interaction is unchanged for the mouse: a
                              plain left click is preventDefault-ed and the
                              detail panel opens exactly as before, including
                              its history push. Modified clicks are left to the
                              browser so "open in new tab" genuinely opens the
                              posting. Still ONE tab stop per card — this
                              replaces the button, it does not join it. */}
                          <Link
                            to={jobDetailHref(job.id)}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (opensInNewContext(e)) return; // the browser's job, not ours
                              e.preventDefault();
                              void openDetail(job);
                            }}
                            title={job.title}
                            className={`block text-left font-semibold leading-snug line-clamp-2 focus-visible:outline-none focus-visible:underline ${viewedIds.has(job.id) && detailJob?.id !== job.id ? "text-muted-foreground" : "text-foreground"}`}
                          >
                            {job.title}
                          </Link>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {job.token
                              ? <Link to={`/jobs/company/${job.token}`} className="hover:text-primary hover:underline">{job.company}</Link>
                              : job.company}
                            {job.location ? ` · ${job.location}` : ""}
                            {job.department ? ` · ${job.department}` : ""}
                          </p>
                          {/* Same role, several locations. The siblings are real
                              postings we folded for readability, so say how many
                              and name a few — never imply the others vanished. */}
                          {/* Same-place repeats are OPENINGS, not places. */}
                          {(job.locationCount ?? 1) === 1 && (job.postingCount ?? 1) > 1 && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t("jobsPage.sameLocationOpenings", "{{count}} openings at this location", { count: job.postingCount })}
                            </p>
                          )}
                          {(job.locationCount ?? 1) > 1 && (
                            <p
                              className="text-xs text-muted-foreground mt-0.5"
                              title={(job.otherLocations ?? []).join(" · ")}
                            >
                              {t("jobsPage.alsoInLocations", "Also hiring in {{count}} more locations", { // resolves via _one/_other

                                count: (job.locationCount ?? 1) - 1,
                              })}
                              {(job.otherLocations ?? []).length > 0 && `: ${(job.otherLocations ?? []).slice(0, 3).join(", ")}`}
                            </p>
                          )}
                          {job.salary && (
                            <p className="text-xs text-success font-medium mt-0.5" title={job.salary}>{displaySalary(job.salary)}</p>
                          )}
                          {/* Niche searches match inside descriptions — without showing
                              WHERE, a title that lacks the search term reads as a broken
                              result. The server sends a ts_headline fragment with [[ ]]
                              around matched words; split client-side, no HTML injected. */}
                          {job.snippet && (
                            <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                              {t("jobsPage.matchedInDesc", "In the description:")}{" "}
                              …{job.snippet.split(/\[\[|\]\]/).map((part, i) =>
                                i % 2 === 1 ? <mark key={i} className="bg-primary/20 text-foreground rounded px-0.5 not-italic">{part}</mark> : part)}…
                            </p>
                          )}
                          {/* Appended by the trigram tier onto a thin exact
                              page — labeled so it is never mistaken for an
                              exact match (the disclosure line above the list
                              explains why it's here). */}
                          {job.closeMatch && (
                            <span className="inline-flex items-center text-[11px] text-warning mt-1 mr-1.5 border border-warning/40 rounded-full px-2 py-0.5">
                              {t("jobsPage.closeMatchChip", "close match")}
                            </span>
                          )}
                          {/* A DIFFERENT CLAIM FROM "close match", and it has to
                              read as one. A close match says the searcher may
                              have misspelled something; this says nothing else
                              matched and these are about the same THING. The
                              vector tier always returns something — it has no
                              notion of "nothing is close" — so a row it supplied
                              must never sit unlabelled among keyword hits.
                              Suppressed when the close-match chip is already
                              there: two hedges on one card say less than one. */}
                          {(job as { semanticMatch?: boolean }).semanticMatch && !job.closeMatch && (
                            <span className="inline-flex items-center text-[11px] text-muted-foreground mt-1 mr-1.5 border border-border rounded-full px-2 py-0.5">
                              {t("jobsPage.semanticMatchChip", "related by meaning")}
                            </span>
                          )}
                          {/* WHY THIS ROW IS HERE. A description-only match is a
                              real answer — a skill lives in the description by
                              definition — but it is not the same claim as a title
                              match, and an unlabelled mix is how "manager" ended
                              up returning Data Steward. Suppressed when the row
                              already carries the close-match chip: two hedges on
                              one card say less than one. */}
                          {(job as { matchScope?: string }).matchScope === "description" && !(job as { closeMatch?: boolean }).closeMatch && (
                            <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {t("jobsPage.descriptionMatchChip", "in description")}
                            </span>
                          )}
                          {/* Experience level: the cited minimum years when the posting
                              states one (the precise fact), else the band's range. */}
                          {job.experienceBand && (
                            <span className="inline-flex items-center text-[11px] text-muted-foreground mt-1 border border-border rounded-full px-2 py-0.5">
                              {typeof job.minYears === "number"
                                ? t("jobsPage.minYears", "{{n}}+ yrs", { n: job.minYears })
                                : t(`jobsPage.experience.${job.experienceBand}`, job.experienceBand)}
                            </span>
                          )}
                          {/* Trust moat: every posting is pulled straight from the
                              company's own ATS feed (Greenhouse/Lever/Ashby/…),
                              never an aggregator or a scrape. Always true, so it's
                              always shown. */}
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-success/90 mt-1"
                            title={t("jobsPage.trustBadgeTip", "Pulled directly from this company's official applicant-tracking feed — not an aggregator or a scraped copy. Re-checked live when you click Apply.")}
                          >
                            <ShieldCheck className="w-3 h-3 text-success shrink-0" />
                            {t("jobsPage.trustBadge", "Verified direct from {{company}}", { company: companyDisplayName(job.company) })}
                          </span>
                          {/* Hiring-intent signal: a company with many fresh, still-open
                              roles is demonstrably hiring — the anti-ghost-job tell. The
                              count is that company's verified open roles on the board. */}
                          {typeof openRoles === "number" && openRoles >= HIRING_INTENT_MIN && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground mt-1 ml-2"
                              title={t("jobsPage.openRolesTip", "This company has {{count}} verified openings live on the board right now — a real, active hiring signal.", { count: openRoles })}
                            >
                              <Briefcase className="w-3 h-3 shrink-0" />
                              {t("jobsPage.openRoles", "{{count}} open roles", { count: openRoles })}
                            </span>
                          )}
                          {/* Hiring-Health: proven-active companies (from the closure
                              log) — the signal aggregators can't build. Self-activates
                              as closures accrue; silent until a real pattern exists. */}
                          {job.token && isActivelyHiring(job.token) && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-success mt-1 ml-2"
                              title={t("jobsPage.hhBadgeTipFills", "This company has filled {{n}} roles in our tracking so far — each stayed posted at least a week before coming down. A proven, active hiring pattern, not just open listings.", { n: healthByToken[job.token].closed_90d })}
                            >
                              <Activity className="w-3 h-3 shrink-0" />
                              {t("jobsPage.hhBadge", "Actively hiring")}
                            </span>
                          )}
                          {/* Urgency: a proven, FAST fill pattern from the closure log —
                              honest data-backed "apply early", not a fake scarcity badge. */}
                          {job.token && (() => {
                            const hh = healthByToken[job.token];
                            if (!hh || hh.closed_90d < ACTIVELY_HIRING_MIN_CLOSED) return null;
                            const m = hh.median_days_to_close;
                            if (typeof m !== "number" || m > URGENT_FILL_MAX_DAYS) return null;
                            return (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-warning mt-1 ml-2"
                                title={t("jobsPage.urgencyTipFills", "Based on {{n}} genuine fills in our tracking (roles that stayed posted a week or more, then closed within 30 days of posting), a typical role here closes in about {{d}} days — worth applying early.", { n: hh.closed_90d, d: Math.round(m) })}
                              >
                                <Clock className="w-3 h-3 shrink-0" />
                                {t("jobsPage.urgencyChip", "Typically fills in ~{{d}}d", { d: Math.round(m) })}
                              </span>
                            );
                          })()}
                          {/* THE AGENT CAN FINISH THIS ONE. Until now this fact
                              existed only inside the morning queue — visible
                              after the agent had already picked a posting, and
                              invisible on the page where people decide what to
                              save. Four vendors have an adapter and they are
                              5.3% of the board, so this chip is absent on most
                              rows, and its absence is the honest signal.

                              It describes the FORM, not the service: an
                              adapter exists and the vendor has no bot wall.
                              Whether a given application actually completes
                              still depends on the employer's own screening
                              questions — 7 of 8 measured forms, not 8 — and on
                              having the agent. The tooltip says so rather than
                              letting a green chip imply a promise. */}
                          {isSendableVendor(job.id) && (
                            <Link
                              to="/agent"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary mt-1 ml-2 hover:underline"
                              title={t("jobsPage.agentAppliesTip", "This employer's application form is one our apply agent can fill and submit on its own — no CAPTCHA and no account needed. It still hands the application back to you if the employer asks something we can't answer from your profile. Needs the Apply Agent subscription.")}
                            >
                              <Sparkles className="w-3 h-3 shrink-0" />
                              {t("jobsPage.agentAppliesChip", "Agent can apply")}
                            </Link>
                          )}
                          {/* Repost caution: frequent same-title relistings — shown as a
                              neutral fact so the seeker can weigh it, never hidden. */}
                          {job.token && (healthByToken[job.token]?.superseded_90d ?? 0) >= REPOST_FLAG_MIN && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground mt-1 ml-2"
                              title={t("jobsPage.repostTipTracked", "This company relisted the same role title {{n}} times during our tracking. That can mean routine reposting or roles that keep reopening — worth knowing before you invest in an application.", { n: healthByToken[job.token].superseded_90d })}
                            >
                              <RefreshCw className="w-3 h-3 shrink-0" />
                              {t("jobsPage.repostChipTracked", "Relists roles often ({{n}}×)", { n: healthByToken[job.token].superseded_90d })}
                            </span>
                          )}
                          {/* Explainable fit — the "why you match" half: the posting's
                              own keywords already in the résumé, so the score isn't a
                              bare number. */}
                          {strengths.length > 0 && (
                            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                              <span className="text-success font-medium">{t("jobsPage.youHave", "You already have:")}</span>{" "}
                              {strengths.join(", ")}
                            </p>
                          )}
                          {/* Missing-keyword nudge — turns the score into an action:
                              "Strong match · add Kubernetes, gRPC". */}
                          {gaps.length > 0 && (
                            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                              <span className="text-primary font-medium">{t("jobsPage.addToCompete", "Add to compete:")}</span>{" "}
                              {gaps.join(", ")}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {tier && (
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${tier === "strong" ? "bg-success/10 text-success" : tier === "possible" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}
                              title={t("jobsPage.matchCoverage", "{{pct}}% of this posting's recognized keywords are already in your resume", { pct: fit })}
                            >
                              {tier === "strong"
                                ? t("jobsPage.matchStrong", "Strong match")
                                : tier === "possible"
                                ? t("jobsPage.matchPossible", "Possible match")
                                : t("jobsPage.matchStretch", "Stretch")}
                            </span>
                          )}
                          {(job.workMode || (job.remote ? "remote" : null)) && (
                            <Badge variant="secondary" className="text-[10px]">
                              {t(`jobsPage.workMode.${job.workMode ?? "remote"}`, job.workMode ?? "remote")}
                            </Badge>
                          )}
                          {appliedIds.has(job.id) && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-success shrink-0">
                              ✓ {t("jobsPage.appliedBadge", "Applied")}
                            </span>
                          )}
                          {savedIds.has(job.id) && (
                            <Link to="/account" onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                              title={t("jobsPage.savedTip", "In your application tracker — click to open it")}>
                              <BookmarkCheck className="w-3 h-3" />
                              {t("jobsPage.savedBadge", "Saved")}
                            </Link>
                          )}
                          {d !== null && (
                            <span
                              className={`text-[11px] whitespace-nowrap ${d <= 2 ? "text-success font-medium" : "text-muted-foreground"}`}
                              title={t("jobsPage.postedProvenance", "Posting age from the date the company states on its own careers feed — undated postings show no age, never a guess")}
                            >
                              {d === 0 ? t("jobsPage.postedToday", "today") : t("jobsPage.postedDaysAgo", "{{count}}d ago", { count: d })}
                            </span>
                          )}
                          {/* THE POSITIVE FORM FOR UNDATED POSTINGS. ~89k
                              postings (14.6%) carry no employer-stated date,
                              and until now their card said nothing — honest,
                              but silence where a true sentence exists. lastSeen
                              is INSERT-time (semantically first_seen), so
                              "first seen Xd ago" states our observation window:
                              it CAPS how old the posting can be without
                              claiming to know its age. Deliberately never
                              styled as fresh (no success color at d<=2 like the
                              posted badge above) — discovery time must never
                              read as freshness, which is the exact substitution
                              behind the 2.8-day-median incident. */}
                          {d === null && daysAgo(job.lastSeen ?? null) !== null && (
                            <span
                              className="text-[11px] whitespace-nowrap text-muted-foreground"
                              title={t("jobsPage.firstSeenProvenance", "This employer states no posting date, so no age is shown. This is when the posting first appeared on our board — it caps how old the posting can be, but it is our discovery date, not the employer's.")}
                            >
                              {daysAgo(job.lastSeen ?? null) === 0
                                ? t("jobsPage.firstSeenToday", "first seen today")
                                : t("jobsPage.firstSeenDaysAgo", "first seen {{count}}d ago", { count: daysAgo(job.lastSeen ?? null) })}
                            </span>
                          )}
                          {/* The receipt. The whole product rests on "every posting
                              is real and still open", and until now the only place
                              a user could see evidence of that was inside the
                              detail panel — after they had already decided to
                              click. recheckedAt is job_board_verifications
                              .verified_at, the moment we last re-read THIS
                              company's own feed, and it is already in the list
                              payload (attachRecheckedAt), so this costs no extra
                              query. Absent => render nothing; a missing stamp must
                              never be dressed up as a weaker one. */}
                          {job.recheckedAt && !job.missingSince && (
                            <span
                              className="text-[11px] whitespace-nowrap text-muted-foreground inline-flex items-center gap-1"
                              title={t("jobsPage.recheckedTip", "When we last re-read this company's own feed")}
                            >
                              <ShieldCheck className="w-3 h-3 text-success" aria-hidden />
                              {t("jobsPage.verifiedAgo", "checked {{ago}}", { ago: agoLabel(job.recheckedAt, t) })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={`flex flex-wrap items-center gap-2 mt-3 ${density === "compact" ? "hidden" : ""}`}>
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={fitFetching === job.id} onClick={() => checkFit(job)}>
                          {fitFetching === job.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
                          {t("jobsPage.checkFit", "Check my fit — free scan")}
                        </Button>
                        {REAL_QUESTION_PREFIXES.some((p) => job.id.startsWith(p)) && (
                          <Button size="sm" variant="outline" className="gap-1.5" disabled={preparingId === job.id} onClick={() => prepareApplication(job)}>
                            {preparingId === job.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                            {t("jobsPage.prepAnswers", "Prep answers")}
                          </Button>
                        )}
                        <Button size="sm" className="gap-1.5" asChild>
                          <a
                            href={job.applyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t("jobsPage.apply", "Apply on {{company}}'s site", { company: job.company })}
                            onClick={() => { trackApply(job); void promoteApplied(job); void verifyJob(job); }}
                          >
                            {t("jobsPage.applyBtn", "Apply")}
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5 px-2"
                          aria-label={savedIds.has(job.id) ? t("jobsPage.savedBadge", "Saved") : t("jobsPage.saveJob", "Save")}
                          onClick={() => saveJob(job)}
                        >
                          {savedIds.has(job.id)
                            ? <BookmarkCheck className="w-4 h-4 text-primary" />
                            : <Bookmark className="w-4 h-4" />}
                        </Button>
                        {reportedIds.has(job.id) ? (
                          <span className="text-[11px] text-muted-foreground">{t("jobsPage.reportedBadge", "Reported — thanks")}</span>
                        ) : reportingId === job.id ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px]">
                            <button type="button" className="px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground" onClick={() => reportJob(job, "gone")}>
                              {t("jobsPage.reportGone", "Posting is gone")}
                            </button>
                            <button type="button" className="px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground" onClick={() => reportJob(job, "misleading")}>
                              {t("jobsPage.reportMisleading", "Looks misleading")}
                            </button>
                            <button type="button" className="px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground" onClick={() => reportJob(job, "other")}>
                              {t("jobsPage.reportOther", "Something else")}
                            </button>
                            <button type="button" className="px-1.5 py-1 text-muted-foreground hover:text-foreground" aria-label={t("jobsPage.reportCancel", "Cancel")} onClick={() => setReportingId(null)}>
                              ✕
                            </button>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-2 text-muted-foreground"
                            aria-label={t("jobsPage.reportCta", "Report this posting")}
                            title={t("jobsPage.reportTip", "Something wrong with this posting? A 'gone' report re-checks it against the company's own board immediately.")}
                            onClick={() => setReportingId(job.id)}
                          >
                            <Flag className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-2 text-muted-foreground"
                          aria-label={t("jobsPage.dismissCta", "Hide this posting")}
                          title={t("jobsPage.dismissTip", "Hide this posting on this device. Restore all hidden postings any time.")}
                          onClick={() => dismissJob(job)}
                        >
                          ✕
                        </Button>
                        {/* Compare tray toggle: pick up to 3, see them side by side. */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleCompare(job.id); }}
                          className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${
                            compareIds.includes(job.id)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "text-muted-foreground border-border hover:border-primary/50"
                          }`}
                          title={t("jobsPage.compareTip", "Add to compare (up to 3)")}
                          aria-label={t("jobsPage.compareTip", "Add to compare (up to 3)")}
                        >
                          {t("jobsPage.compareToggle", "⇄")}
                        </button>
                      </div>
                      {/* Near-identical siblings: the same role at other locations,
                          collapsed under this card — each still a real, applyable
                          posting from the company's own feed. */}
                      {siblings.length > 0 && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => setExpandedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(job.id)) next.delete(job.id); else next.add(job.id);
                              return next;
                            })}
                            className="text-[11px] text-primary font-medium hover:underline"
                          >
                            {expandedGroups.has(job.id)
                              ? t("jobsPage.hideLocations", "Hide other locations")
                              : t("jobsPage.moreLocations", "Same role in {{count}} more locations", { count: siblings.length })}
                          </button>
                          {expandedGroups.has(job.id) && (
                            <ul className="mt-1.5 space-y-1 border-l-2 border-border/60 pl-3">
                              {siblings.map((sib) => (
                                <li key={sib.id} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  <span className="flex-1 min-w-0 truncate">{sib.location || t("jobsPage.locationUnlisted", "Location unlisted")}</span>
                                  <a
                                    href={sib.applyUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => { trackApply(sib); void promoteApplied(sib); void verifyJob(sib); }}
                                    className="shrink-0 text-primary font-medium hover:underline"
                                  >
                                    {t("jobsPage.applyArrow", "Apply →")}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                    </Fragment>
                  );
                })}
              </ul>
              {/* THE SERVER'S "NO MORE" IS AUTHORITATIVE. This gate used hasMore
                  only as a fallback when total was missing, and trusted the
                  count comparison otherwise — but a terminal page's total counts
                  UNGROUPED rows while the page serves grouped cards, so on 36 of
                  82 measured terminal browse pages (43.9%, median shortfall
                  7.3%) the button survived its own last page. Clicking it
                  refetched the same terminal page forever. No postings were
                  missing — the same jobs were folded into fewer cards — but a
                  control that promises more and delivers nothing is a small lie
                  on almost half of all terminal pages. hasMore:false now ends
                  paging regardless of what the counts suggest. */}
              {data && data.hasMore !== false && (typeof data.total === "number" ? jobs.length < pageTotalCount : true) && (
                <div className="text-center mt-6">
                  {/* A failed "Load more" keeps every job already on screen and
                      retries in place. It used to replace the whole list with
                      an error card — one flaky request on a phone wiping out
                      several minutes of scrolling, with no way back to it. */}
                  {loadMoreError && (
                    <p className="text-sm text-muted-foreground mb-2">
                      {t("jobsPage.loadMoreFailed", "Couldn't load more just now — your results are still here.")}
                    </p>
                  )}
                  <Button variant="outline" disabled={loadingMore} onClick={() => fetchJobs(data?.nextOffset ?? jobs.length)} className="gap-2">
                    {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                    {loadMoreError ? t("jobsPage.loadMoreRetry", "Try again") : t("jobsPage.loadMore", "Load more")}
                  </Button>
                </div>
              )}
            </>
          )}

          </div>
          {/* Pinned below the fixed site header (64px) PLUS the sticky search
              row (~58px) — top-24 sat underneath the search bar and clipped
              the panel's title once the page scrolled. */}
          <div className="hidden lg:block sticky top-[132px] max-h-[calc(100vh-9rem)] overflow-y-auto rounded-2xl border border-border bg-card min-w-0">
            {detailJob ? detailInner : (
              <div className="p-10 text-center text-sm text-muted-foreground">
                {t("jobsPage.paneEmpty", "Select a posting — or use the ↑ ↓ keys to move through the list.")}
              </div>
            )}
          </div>
          </div>

          <p className="text-[11px] text-muted-foreground mt-10">
            {/* The platform list is INTERPOLATED from ats-vendors.ts, never
                typed out here. It used to be spelled out in this default and
                again in all nine locales — ten copies of one fact, each of
                which goes stale silently the moment a vendor is added. This
                default had already drifted: it named ten platforms and omitted
                Workday, our single largest source. Nobody saw it, because the
                en.json key overrides the default — so the stale copy was
                invisible right up until a missing translation would have
                rendered it. Now there is one list, and it is the one the code
                obeys. */}
            {t("jobsPage.sourceNote", "Sources: the official public job-board APIs companies publish on {{vendors}}. The largest boards are re-checked most often and the whole catalog rotates around the clock \u2014 the live median and 95th-percentile re-check ages are published on the Ghost Job Index \u2014 and postings a company takes down disappear on the next pass. A feed that stops responding drops off the board rather than breaking it.", { vendors: BOARD_SOURCE_LIST })}
          </p>
        </div>
      </main>

      {/* Detail panel, overlay mode (below lg): slide-over drawer. On lg+ the
          same content renders inline in the split-pane column instead. */}
      {detailJob && (
        <div className="lg:hidden">
          <div className="fixed inset-0 z-40 bg-black/50 animate-in fade-in duration-150" onClick={() => closeDetail()} />
          <aside
            ref={overlayRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={detailJob.title}
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[560px] sm:max-w-[92vw] bg-background border-l border-border overflow-y-auto animate-in slide-in-from-right duration-200 focus:outline-none"
            onTouchStart={(e) => { swipeStartY.current = e.currentTarget.scrollTop === 0 ? e.touches[0].clientY : null; }}
            onTouchMove={(e) => {
              // Swipe-down-to-close, only from the very top of the sheet so it
              // never fights with scrolling the description.
              if (swipeStartY.current === null) return;
              if (e.touches[0].clientY - swipeStartY.current > 90) {
                swipeStartY.current = null;
                closeDetail();
              }
            }}
          >
            {detailInner}
            {/* Thumb-reach action bar: Apply and Save stay pinned while the
                description scrolls (mobile overlay only — the desktop pane
                keeps actions at the top where the cursor already is). */}
            <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t border-border px-4 py-3 flex gap-2">
              <Button className="flex-1 gap-1.5" asChild>
                <a
                  href={detailJob.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => { trackApply(detailJob); void promoteApplied(detailJob); void verifyJob(detailJob); }}
                >
                  {t("jobsPage.applyShort", "Apply on company site")}
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Button>
              <Button
                variant="outline"
                className="px-3"
                aria-label={savedIds.has(detailJob.id) ? t("jobsPage.savedBadge", "Saved") : t("jobsPage.saveJob", "Save")}
                onClick={() => saveJob(detailJob)}
              >
                {savedIds.has(detailJob.id) ? <BookmarkCheck className="w-4 h-4 text-primary" /> : <Bookmark className="w-4 h-4" />}
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Apply-agent: draft grounded answers to a Greenhouse posting's real
          questions. Human reviews/edits, then applies on the company's own site. */}
      <Dialog open={!!prepareJob} onOpenChange={(o) => { if (!o) setPrepareJob(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {prepareJob && (
            <>
              <DialogHeader>
                <DialogTitle>{t("jobsPage.prepTitle", "Prepare your application")}</DialogTitle>
                <DialogDescription>
                  {t("jobsPage.prepSubtitle", "Grounded answers to {{company}}'s real application questions, drawn from your scanned resume. Review and edit each one, then apply on {{company}}'s own site — we never submit for you.", { company: prepareJob.job.company })}
                </DialogDescription>
              </DialogHeader>
              {(() => {
                // Reuse the board's fit tier (same 20/10 thresholds + labels) so
                // the user sees how strong a match this posting is before drafting.
                const fit = fits[prepareJob.job.id];
                if (typeof fit !== "number") return null;
                const tier = fit >= 20 ? "strong" : fit >= 10 ? "possible" : "stretch";
                return (
                  <span
                    className={`inline-flex w-fit text-[11px] px-2 py-0.5 rounded-full font-bold ${tier === "strong" ? "bg-success/10 text-success" : tier === "possible" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}
                    title={t("jobsPage.matchCoverage", "{{pct}}% of this posting's recognized keywords are already in your resume", { pct: fit })}
                  >
                    {tier === "strong"
                      ? t("jobsPage.matchStrong", "Strong match")
                      : tier === "possible"
                      ? t("jobsPage.matchPossible", "Possible match")
                      : t("jobsPage.matchStretch", "Stretch")}
                  </span>
                );
              })()}
              {prepareJob.alreadyApplied && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[12px] text-warning flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {t("jobsPage.prepAlreadyApplied", "You've already marked this posting as applied. Re-applying to the same role can count against you — double-check before you submit again.")}
                </div>
              )}
              <ApplicationAnswers
                resumeText={fitResume.current}
                jobTitle={prepareJob.job.title}
                jobCompany={prepareJob.job.company}
                jobDescription={prepareJob.description}
                jobId={prepareJob.job.id}
                jobCategory={prepareJob.job.category}
                experienceBand={prepareJob.job.experienceBand}
                autoStart
              />
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
                <Button size="sm" variant="outline" className="gap-1.5" disabled={tailoredLoading} onClick={tailorForRole}>
                  {tailoredLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {t("jobsPage.tailorResume", "Tailor my résumé for this role")}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={coverLoading} onClick={draftCoverLetter}>
                  {coverLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                  {t("jobsPage.coverLetter", "Draft a cover letter")}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={coachLoading} onClick={prepInterview}>
                  {coachLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
                  {t("jobsPage.prepInterview", "Prep interview questions")}
                </Button>
                <a
                  href={prepareJob.job.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => { trackApply(prepareJob.job); void promoteApplied(prepareJob.job); void verifyJob(prepareJob.job); }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  {t("jobsPage.apply", "Apply on {{company}}'s site", { company: prepareJob.job.company })}
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <TailoredResumeModal
        isOpen={tailoredOpen}
        onClose={() => setTailoredOpen(false)}
        content={tailoredContent}
        isLoading={tailoredLoading}
      />

      <Dialog open={coverOpen} onOpenChange={(o) => { if (!o) setCoverOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("jobsPage.coverTitle", "Your cover letter")}</DialogTitle>
            <DialogDescription>{t("jobsPage.coverSubtitle", "Grounded in your résumé for this role — review and edit before you send. We never invent experience you don't have.")}</DialogDescription>
          </DialogHeader>
          {coverLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("jobsPage.coverLoading", "Writing your cover letter…")}
            </div>
          )}
          {!coverLoading && coverText && (
            <div className="space-y-3">
              <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{coverText}</p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 w-fit"
                onClick={() => navigator.clipboard?.writeText(coverText).then(() => toast({ title: t("jobsPage.copied", "Copied") }))}
              >
                <Copy className="w-3.5 h-3.5" /> {t("jobsPage.copyCoverLetter", "Copy cover letter")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={coachOpen} onOpenChange={(o) => { if (!o) setCoachOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("jobsPage.coachTitle", "Likely interview questions")}</DialogTitle>
            <DialogDescription>{t("jobsPage.coachSubtitle", "Grounded in your résumé for this role — practice these before you apply, so the interview isn't the first time you answer them.")}</DialogDescription>
          </DialogHeader>
          {coachLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("jobsPage.coachLoading", "Preparing your questions…")}
            </div>
          )}
          {!coachLoading && coachQuestions && (
            <div className="space-y-2.5">
              {coachQuestions.map((qq, i) => (
                <div key={i} className="rounded-lg border border-border/60 bg-background p-2.5">
                  {qq.category && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">{qq.category}</span>
                  )}
                  <p className="text-[13px] font-medium text-foreground mt-1">{qq.question}</p>
                  {qq.whyAsked && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      <span className="font-medium">{t("jobsPage.coachWhy", "Why they ask:")}</span> {qq.whyAsked}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-20 lg:bottom-6 right-4 z-40 rounded-full border border-border bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-lg hover:border-primary/50 transition-colors"
          aria-label={t("jobsPage.backToTop", "Back to top")}
        >
          ↑ {t("jobsPage.backToTop", "Back to top")}
        </button>
      )}
      <JobsCommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      <ShortcutsOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      {/* Compare tray: fixed bar while picking; side-by-side sheet on open.
          Every compared field is data already on the client — nothing fetched. */}
      {compareIds.length > 0 && !compareOpen && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full border border-border bg-card shadow-lg px-4 py-2">
          <span className="text-sm text-foreground font-medium">
            {t("jobsPage.compareCount", "Comparing {{n}} of 3", { n: compareIds.length })}
          </span>
          <button
            onClick={() => { trackBoard("compare_open", { n: compareIds.length }); setCompareOpen(true); }}
            disabled={compareIds.length < 2}
            className="rounded-full bg-primary text-primary-foreground text-sm font-semibold px-3 py-1 disabled:opacity-50"
          >
            {t("jobsPage.compareOpen", "Compare")}
          </button>
          <button onClick={() => setCompareIds([])} className="text-sm text-muted-foreground hover:text-foreground">
            {t("jobsPage.compareClear", "Clear")}
          </button>
        </div>
      )}
      {compareOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCompareOpen(false)}>
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-4xl w-full max-h-[85vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-foreground">{t("jobsPage.compareTitle", "Side by side")}</h2>
              <button onClick={() => setCompareOpen(false)} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
            </div>
            <div
              className="grid gap-3 grid-cols-1 sm:[grid-template-columns:var(--cmp-cols)]"
              style={{ "--cmp-cols": `repeat(${Math.min(compareIds.length, 3)}, minmax(220px, 1fr))` } as React.CSSProperties}
            >
              {compareIds.map((id) => {
                const j = jobs.find((x) => x.id === id);
                if (!j) return null;
                const f = fits[id];
                const hh = j.token ? healthByToken[j.token] : undefined;
                const age = daysAgo(j.postedAt);
                return (
                  <div key={id} className="rounded-xl border border-border p-3 min-w-0">
                    <p className="text-sm font-semibold text-foreground leading-tight">{j.title}</p>
                    <p className="text-[12px] text-muted-foreground mb-2">{j.company}{j.location ? ` · ${j.location}` : ""}</p>
                    <ul className="space-y-1.5 text-[12px] text-muted-foreground">
                      {typeof f === "number" && (
                        <li><span className="text-foreground font-semibold">{f}%</span> {t("jobsPage.compareFit", "keyword fit")}</li>
                      )}
                      {(hits[id]?.length ?? 0) > 0 && (
                        <li>{t("jobsPage.matchedKeywords", "You already have:")} {hits[id]!.slice(0, 4).join(", ")}</li>
                      )}
                      {(misses[id]?.length ?? 0) > 0 && (
                        <li>{t("jobsPage.missingKeywords", "Missing from your resume:")} {misses[id]!.slice(0, 4).join(", ")}</li>
                      )}
                      {j.salary && <li>{j.salary}</li>}
                      {j.workMode && (
                        <li>{t(`jobsPage.workMode.${j.workMode}`, j.workMode)}</li>
                      )}
                      {appliedIds.has(id) && (
                        <li className="text-success">✓ {t("jobsPage.appliedBadge", "Applied")}</li>
                      )}
                      {(() => {
                        const ctx = j.token ? compareCtx[j.token.split("~")[0]] : undefined;
                        if (!ctx) return null;
                        return (
                          <>
                            {ctx.employees != null && (
                              <li>{t("jobsPage.employerCtx.employees", "≈{{n}} employees ({{basis}})", {
                                n: ctx.employees.toLocaleString(),
                                basis: ctx.employeeBasis === "yc_self_reported"
                                  ? t("jobsPage.intel.basisYc", "YC profile")
                                  : t("jobsPage.intel.basisPr", "public records"),
                              })}</li>
                            )}
                            {ctx.ticker && ctx.revenue != null && (
                              <li>
                                {ctx.exchange}: {ctx.ticker} · {ctx.revenue >= 1e9 ? `$${(ctx.revenue / 1e9).toFixed(1)}B` : `$${Math.round(ctx.revenue / 1e6)}M`}
                                {ctx.netIncome != null && (
                                  <span className={ctx.netIncome > 0 ? " text-success" : " text-destructive"}>
                                    {" "}· {ctx.netIncome > 0 ? t("jobsPage.employerCtx.profitable", "profitable") : t("jobsPage.employerCtx.unprofitable", "operating at a loss")}
                                  </span>
                                )}
                              </li>
                            )}
                          </>
                        );
                      })()}
                      {age !== null && (
                        <li>{age === 0 ? t("jobsPage.postedToday", "today") : t("jobsPage.postedDaysAgo", "{{count}}d ago", { count: age })}</li>
                      )}
                      {hh && (hh.closed_90d ?? 0) >= 3 && (hh.superseded_90d ?? 0) <= (hh.closed_90d ?? 0) && (
                        <li className="text-success">{t("jobsPage.verdictFills", "this company genuinely fills roles ({{n}} in our tracking)", { n: hh.closed_90d })}</li>
                      )}
                      {hh && (hh.superseded_90d ?? 0) > (hh.closed_90d ?? 0) && (hh.superseded_90d ?? 0) >= 10 && (
                        <li className="text-warning">{t("jobsPage.verdictChurn", "re-lists roles often ({{n}}×) — responses may be slow", { n: hh.superseded_90d })}</li>
                      )}
                    </ul>
                    <button
                      onClick={() => { setCompareOpen(false); void openDetail(j); }}
                      className="mt-3 w-full rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold py-1.5 hover:bg-primary/90"
                    >
                      {t("jobsPage.compareView", "View & apply")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* Lander hub: other companies hiring in this company's dominant field. */}
      {landerCompany && <SimilarCompanies companyToken={landerCompany} />}
      <Footer />
    </div>
  );
}
