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
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, AlertTriangle, Bookmark, BookmarkCheck, Briefcase, ChevronDown, Clock, Compass, Copy, ExternalLink, FileText, Flag, Link2, Loader2, MapPin, MessageSquare, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Target, Upload } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ApplicationAnswers } from "@/components/apply/ApplicationAnswers";
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
import { postTrackEvent } from "@/lib/track-transport";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { searchName, searchToQuery } from "@/lib/job-search-params";
import { displaySalary } from "@/lib/salary-display";
import { adjacentRoles } from "@/lib/role-adjacency";
import { accentFor } from "@/lib/category-accent";
import { JobsCommandPalette, ShortcutsOverlay, useGlobalPaletteKeys, type PaletteAction } from "@/components/JobsCommandPalette";
import { isBoardCategory } from "@/lib/job-board-categories";

// user_applications gained board columns after the last typegen — untyped
// access until Lovable regenerates types.ts.
const appsTable = () => (supabase as unknown as { from: (t: string) => any }).from("user_applications");
const searchesTable = () => (supabase as unknown as { from: (t: string) => any }).from("user_job_searches");

interface BoardJob {
  id: string;
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
  salaryMinAnnual?: number | null;
  salaryMaxAnnual?: number | null;
  salaryPeriod?: string | null;
  salaryCurrency?: string | null;
  experienceBand?: string | null;
  minYears?: number | null;
  /** Board category slug (serveList returns it; drives detail-panel "similar openings"). */
  category?: string | null;
  /** Last re-verification against the company's own feed (serveList last_seen). */
  lastSeen?: string | null;
  /** Tier-2 ranked search only: ts_headline fragment showing where a description-matched result matched ([[term]] delimiters). */
  snippet?: string;
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

interface BoardResponse {
  jobs: BoardJob[];
  total: number;
  totalAllCompanies: number;
  // Untrimmed company count — the served `companies` array is capped (top-N by
  // count) for payload weight, so stat displays must use this, not .length.
  companiesCount?: number;
  companies: Array<{ token: string; name: string; count: number }>;
  categories: Record<string, number>;
  failedSources: string[];
  refreshedAt: string | null;
  /** Ranked path: role-alias phrases the server also searched (disclosed in the UI). */
  aliases?: string[];
  /** Typo fallback: the original query these are the CLOSEST (not exact) matches for. */
  fuzzy?: string;
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

// Company-initial avatar: an honest visual anchor per card. We don't store
// company domains, so real logos aren't possible without guessing — a
// deterministic colored monogram scans just as fast and never shows the
// wrong company's logo.
const AVATAR_HUES = [212, 262, 330, 24, 160, 96, 45, 288] as const;
const avatarHue = (s: string) => AVATAR_HUES[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_HUES.length];

export default function Jobs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Deep-linkable filters: /jobs?q=nurse&category=healthcare&remote=1&company=oscar
  const initial = new URLSearchParams(window.location.search);
  const [q, setQ] = useState(initial.get("q") ?? "");
  const [location, setLocation] = useState(initial.get("location") ?? "");
  const [remoteOnly, setRemoteOnly] = useState(initial.get("remote") === "1");
  // Definitive work-mode filter (remote/hybrid/onsite; "" = any). The legacy
  // remote=1 URL param maps to "remote" so old links keep working.
  const [workMode, setWorkMode] = useState<"" | "remote" | "hybrid" | "onsite">(() => {
    const m = initial.get("mode");
    if (m === "remote" || m === "hybrid" || m === "onsite") return m;
    return initial.get("remote") === "1" ? "remote" : "";
  });
  const { category: pathCategory, companyToken } = useParams<{ category?: string; companyToken?: string }>();
  const landerCategory = isBoardCategory(pathCategory) ? pathCategory : undefined;
  // /jobs/company/:token — the board scoped to one employer's verified openings.
  const landerCompany = companyToken || undefined;
  const [company, setCompany] = useState(initial.get("company") ?? landerCompany ?? "");
  const [category, setCategory] = useState(initial.get("category") ?? landerCategory ?? "");
  // Arrived from the Explore page? Captured once on mount (the URL-sync effect
  // strips unknown params), so we can offer a "Back to Explore" link instead
  // of leaving the user on a filtered board with no way back.
  const [cameFromExplore] = useState(() => initial.get("from") === "explore");
  const [experience, setExperience] = useState(initial.get("experience") ?? "");
  // Country: exact match on the deterministically extracted code. Postings
  // whose location can't be placed are excluded while active — disclosed, not
  // guessed. Facet counts come from get_country_facet at mount.
  const [country, setCountry] = useState(() => {
    const c = (initial.get("country") ?? "").toUpperCase();
    return /^[A-Z]{2}$/.test(c) ? c : "";
  });
  const [countryFacet, setCountryFacet] = useState<Array<{ country: string; n: number }>>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as {
          rpc: (fn: string) => Promise<{ data: unknown }>;
        }).rpc("get_country_facet");
        if (cancelled || !Array.isArray(data)) return;
        setCountryFacet(
          (data as Array<{ country?: string; n?: number }>)
            .filter((r) => typeof r.country === "string" && r.country.length === 2)
            .map((r) => ({ country: String(r.country), n: Number(r.n) || 0 }))
            .slice(0, 20),
        );
      } catch { /* facet RPC not applied yet — the picker simply stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // Salary floor filters on the posting's OWN stated pay, annualized (hourly
  // ×2080 etc.) but never currency-converted — postings that don't state pay
  // are excluded while the floor is active.
  const [salaryFloor, setSalaryFloor] = useState<number>(() => {
    const n = Number(initial.get("salaryFloor"));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const [freshness, setFreshness] = useState<"" | "day" | "week">("");
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
      setExperience(typeof f.experience === "string" ? f.experience : "");
      setRemoteOnly(false);
      setWorkMode(f.workMode === "remote" || f.workMode === "hybrid" || f.workMode === "onsite"
        ? f.workMode : f.remote === true ? "remote" : "");
      setSalaryFloor(typeof f.salaryFloor === "number" ? f.salaryFloor : 0);
      setCountry(typeof f.country === "string" ? f.country : "");
      setLocation(typeof f.location === "string" ? f.location : "");
      setFreshness(f.maxAgeDays === 1 ? "day" : f.maxAgeDays === 7 ? "week" : "");
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
  useEffect(() => {
    let alive = true;
    invokeBoard<{ total?: number }>({ action: "list", countOnly: true, includeFacets: false, maxAgeDays: 1 })
      .then(({ data }) => { if (alive && typeof data?.total === "number" && data.total > 0) setNewToday(data.total); })
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
  const reqSeq = useRef(0);
  const { session } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  // Company-page hiring-health (lifecycle-derived; only fetched on a company page).
  const [hiringHealth, setHiringHealth] = useState<HiringHealth | null>(null);
  // Board-card hiring-health, batched per visible company token → "Actively hiring"
  // badge + filter. Auto-activates as the closure log accrues real data.
  const [healthByToken, setHealthByToken] = useState<Record<string, HiringHealth>>({});
  const [activelyHiringOnly, setActivelyHiringOnly] = useState(false);
  const healthAttempted = useRef<Set<string>>(new Set());
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
      .select("job_id")
      .not("job_id", "is", null)
      .then(({ data }: { data: Array<{ job_id: string }> | null }) => {
        setSavedIds(new Set((data ?? []).map((r) => r.job_id)));
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
    toast({ title: t("jobsPage.jobSaved", "Saved to your application tracker") });
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

  // Signed-in Apply clicks promote the row to 'applied' (never downgrading
  // a richer status) — the tracker fills itself.
  const promoteApplied = async (job: BoardJob) => {
    if (!session) return;
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

  const saveCurrentSearch = async () => {
    if (!session) return requireAuth();
    const params = {
      q: q || undefined,
      category: category || undefined,
      experience: experience || undefined,
      location: location || undefined,
      remote: remoteOnly || workMode === "remote" || undefined,
      workMode: workMode || undefined,
      company: company || undefined,
      salaryFloor: salaryFloor || undefined,
    };
    const name = searchName(
      params,
      category ? t(`jobsPage.categories.${category}`, category) : undefined,
      experience ? t(`jobsPage.experience.${experience}`, experience) : undefined,
    );
    const { error: err } = await searchesTable().insert({ user_id: session.user.id, name, params });
    if (err && err.code === "23505") {
      toast({ title: t("jobsPage.searchExists", "You already saved this search.") });
      return;
    }
    if (err) {
      toast({ title: t("jobsPage.saveFailed", "Couldn't save — try again.") });
      return;
    }
    toast({
      title: t("jobsPage.searchSaved", "Search saved"),
      description: `${t("jobsPage.searchSavedDesc", "Your account shows how many new postings match since your last look.")} ${t("jobsPage.queueBridge", "Want ready-to-review picks every morning instead? The Apply Agent runs your search nightly — Morning Queue, in your account.")}`,
    });
  };

  // Company facet arrives once and is cached — refetches skip it (it can be
  // hundreds of KB at full catalog size) and splice the cache back in.
  const companiesCache = useRef<BoardResponse["companies"]>([]);

  // One quiet retry for board calls: a refresh slice hitting the function's
  // resource ceiling can bounce a single request off the worker pool.
  const invokeBoard = async <T,>(body: Record<string, unknown>): Promise<{ data: T | null; error: { message?: string } | null }> => {
    const first = await supabase.functions.invoke("job-board", { body });
    if (!first.error && first.data != null) return first as { data: T; error: null };
    await new Promise((r) => setTimeout(r, 1200));
    return await supabase.functions.invoke("job-board", { body }) as { data: T | null; error: { message?: string } | null };
  };

  const fetchJobs = useCallback(
    async (offset: number) => {
      const seq = ++reqSeq.current;
      // A filter change over an already-loaded list refreshes in place (the
      // visible list locally filters meanwhile); only a true first load or
      // recovery-from-error blanks to the spinner.
      offset === 0 ? (jobsCount.current > 0 ? setRefreshing(true) : setLoading(true)) : setLoadingMore(true);
      setError(false);
      try {
        const body = {
          action: "list",
          q: q || undefined,
          location: location || undefined,
          remote: remoteOnly || workMode === "remote" || undefined,
      workMode: workMode || undefined,
          category: category || undefined,
          country: country || undefined,
          experience: experience || undefined,
          companies: company ? [company] : undefined,
          salaryFloor: salaryFloor || undefined,
          // Searches default to relevance ranking; the toggle bypasses it.
          sort: sortMode === "salary" ? "salary" : q && searchNewestFirst ? "newest" : undefined,
          // Company-stated dates only (maxAgeDays), never our discovery time —
          // "Today" must mean the company posted it today.
          maxAgeDays: freshness ? (freshness === "day" ? 1 : 7) : undefined,
          limit: PAGE,
          offset,
          includeFacets: companiesCache.current.length === 0,
        };
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
        if (br.companies?.length) companiesCache.current = br.companies;
        else br.companies = companiesCache.current;
        servedQuery.current = { q, location };
        setData(br);
        setJobs((prev) => (offset === 0 ? br.jobs : [...prev, ...br.jobs]));
      } catch (e) {
        if (seq !== reqSeq.current) return; // superseded request failed — not user-visible, don't log or flag
        console.error("[Jobs] list failed:", e);
        setError(true);
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [q, location, remoteOnly, workMode, company, category, experience, country, salaryFloor, sortMode, freshness, searchNewestFirst],
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
    if (experience) p.set("experience", experience);
    if (country) p.set("country", country);
    if (salaryFloor) p.set("salaryFloor", String(salaryFloor));
    // The detail panel's ?job= deep link isn't filter state — preserve it, or
    // this rewrite clobbers a shared link on mount before the panel can open.
    const jobParam = new URLSearchParams(window.location.search).get("job");
    if (jobParam) p.set("job", jobParam);
    const qs = p.toString();
    if (landerCompany && company === landerCompany && !q && !location && !remoteOnly && !category && !experience && !salaryFloor && !country) {
      window.history.replaceState({}, "", `/jobs/company/${landerCompany}${jobParam ? `?job=${encodeURIComponent(jobParam)}` : ""}`);
      return;
    }
    if (landerCategory && category === landerCategory && !q && !location && !remoteOnly && !company && !experience && !salaryFloor && !country) {
      window.history.replaceState({}, "", `/jobs/field/${landerCategory}${jobParam ? `?job=${encodeURIComponent(jobParam)}` : ""}`);
      return;
    }
    window.history.replaceState({}, "", qs ? `/jobs?${qs}` : "/jobs");
  }, [q, location, remoteOnly, workMode, company, category, experience, country, salaryFloor, landerCategory, landerCompany]);

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
  const [detailLoading, setDetailLoading] = useState(false);
  // URL mode per selection: an explicit card click PUSHES history (back button
  // closes the panel); keyboard/auto-selection REPLACES (arrowing through 30
  // postings must not create 30 history entries). Close undoes whichever the
  // current selection used.
  const detailPushed = useRef(false);
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
    setDetailJob(job);
    setDetailDesc(null);
    setDetailLoading(true);
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
    if (!job.lastSeen || Date.now() - Date.parse(job.lastSeen) > 24 * 3600_000) {
      invokeBoard({ action: "verify", ids: [job.id] }).catch(() => {});
    }
    // Hover-prefetch cache first: a warmed description opens the panel with
    // zero wait. Empty string = fetched-and-none; null = fetch in flight.
    const cached = descCache.current.get(job.id);
    if (typeof cached === "string") {
      setDetailDesc(cached || null);
      setDetailLoading(false);
      return;
    }
    try {
      const { data: res } = await invokeBoard<{ description?: string }>({ action: "detail", id: job.id });
      setDetailDesc(res?.description ?? null);
      descCache.current.set(job.id, res?.description ?? "");
    } catch { /* panel still shows metadata + actions */ }
    setDetailLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openRecent = useCallback(async (id: string) => {
    const inList = jobs.find((j) => j.id === id);
    if (inList) { void openDetail(inList); return; }
    try {
      const { data: res } = await invokeBoard<{ job?: BoardJob | null }>({ action: "detail", id });
      if (res?.job) void openDetail(res.job);
    } catch { /* posting may have closed — honest no-op */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);
  const closeDetail = useCallback((viaHistory = false) => {
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
            .slice(0, 5),
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
  useEffect(() => {
    if (deepLinkTried.current) return;
    const id = new URLSearchParams(window.location.search).get("job");
    if (!id) { deepLinkTried.current = true; return; }
    const inList = jobs.find((j) => j.id === id);
    if (inList) {
      deepLinkTried.current = true;
      void openDetail(inList, "none");
    } else if (jobs.length > 0) {
      // Loaded list doesn't contain it — the detail action resolves the row.
      deepLinkTried.current = true;
      (async () => {
        try {
          const { data: res } = await invokeBoard<{ job?: BoardJob | null; description?: string }>({ action: "detail", id });
          if (res?.job) {
            setDetailJob(res.job);
            setDetailDesc(res.description ?? null);
          }
        } catch { /* dead link — board renders normally */ }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

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
    const { error: err } = await searchesTable().insert({
      user_id: session.user.id,
      name: t("jobsPage.watchName", "New roles at {{company}}", { company: landerCompanyName }),
      params: { company: landerCompany },
    });
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
      description: `${t("jobsPage.watchSavedDesc", "Your account now shows how many new roles they've posted since your last look.")} ${t("jobsPage.queueBridge", "Want ready-to-review picks every morning instead? The Apply Agent runs your search nightly — Morning Queue, in your account.")}`,
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
          title: status === 429 ? t("jobsPage.tailorBusyTitle", "Busy right now") : t("jobsPage.tailorErrorTitle", "Couldn't tailor your résumé"),
          description: status === 429
            ? t("jobsPage.tailorBusy", "The résumé tailor is busy — try again in a moment.")
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

  const trackApply = (job: BoardJob) => {
    let visitorId = "unknown";
    try {
      visitorId = localStorage.getItem("rb_visitor_id") ?? "unknown";
    } catch { /* ignore */ }
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
        for (let i = 0; i < unscored.length; i += 60) {
          const { data } = await supabase.functions.invoke("job-board", {
            body: { action: "fit-batch", resumeText: resume, ids: unscored.slice(i, i + 60) },
          });
          const payload = data as { fits?: Record<string, number | null>; missing?: Record<string, string[]>; matched?: Record<string, string[]> } | null;
          if (payload?.fits) setFits((prev) => ({ ...prev, ...payload.fits }));
          if (payload?.missing) setMisses((prev) => ({ ...prev, ...payload.missing }));
          if (payload?.matched) setHits((prev) => ({ ...prev, ...payload.matched }));
        }
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
      } catch { /* RPC not deployed yet — no badges, no error surfaced */ }
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
    if (fitRanking) list = [...list].sort((a, b) => (fits[b.id] ?? -1) - (fits[a.id] ?? -1));
    return list;
  }, [jobs, fitRanking, fits, activelyHiringOnly, isActivelyHiring, dismissedIds, refreshing, q, location]);

  // De-dupe near-identical postings: the same role cross-posted across locations
  // (same company + same title) collapses into ONE card with a "+N more locations"
  // expander. Nothing is deleted — every posting is a real, distinct opening and
  // stays applyable inside the group; this only stops it flooding the list.
  const groupedJobs = useMemo(() => {
    const map = new Map<string, { primary: BoardJob; siblings: BoardJob[] }>();
    const order: Array<{ primary: BoardJob; siblings: BoardJob[] }> = [];
    for (const j of displayJobs) {
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
    return order;
  }, [displayJobs]);
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
      const list = groupedJobs.map((g) => g.primary);
      if (list.length === 0) return;
      const isDown = e.key === "ArrowDown" || e.key === "j";
      const isUp = e.key === "ArrowUp" || e.key === "k";
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

  const companies = useMemo(
    () => (data?.companies ?? []).filter((c) => c.count > 0 || c.token === company).sort((a, b) => a.name.localeCompare(b.name)),
    [data, company],
  );

  // Badge on the mobile Filters button: how many secondary filters are active
  // (q lives in the always-visible search bar, so it doesn't count).
  const activeFilterCount = useMemo(
    () => [location, category, experience, company, salaryFloor > 0, remoteOnly || workMode, freshness].filter(Boolean).length,
    [location, category, experience, company, salaryFloor, remoteOnly, workMode, freshness],
  );

  // Removable chips for every active filter — what's narrowing your results
  // should be visible and one click to undo, not buried in the controls.
  const activeFilters = useMemo(() => {
    const f: Array<{ key: string; label: string; clear: () => void }> = [];
    if (q) f.push({ key: "q", label: `“${q}”`, clear: () => setQ("") });
    if (location) f.push({ key: "location", label: location, clear: () => setLocation("") });
    if (category) f.push({ key: "category", label: t(`jobsPage.categories.${category}`, category), clear: () => setCategory("") });
    if (experience) f.push({ key: "experience", label: t(`jobsPage.experience.${experience}`, experience), clear: () => setExperience("") });
    if (company) f.push({ key: "company", label: companies.find((c) => c.token === company)?.name ?? company, clear: () => setCompany("") });
    if (country) f.push({ key: "country", label: country, clear: () => setCountry("") });
    if (salaryFloor > 0) f.push({ key: "salaryFloor", label: `$${salaryFloor / 1000}k+`, clear: () => setSalaryFloor(0) });
    if (remoteOnly && !workMode) f.push({ key: "remote", label: t("jobsPage.remoteBadge", "Remote"), clear: () => setRemoteOnly(false) });
    if (workMode) f.push({ key: "mode", label: t(`jobsPage.workMode.${workMode}`, workMode), clear: () => { setWorkMode(""); setRemoteOnly(false); } });
    if (freshness) f.push({ key: "freshness", label: freshness === "day" ? t("jobsPage.freshDay", "Today") : t("jobsPage.freshWeek", "This week"), clear: () => setFreshness("") });
    return f;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, location, category, experience, company, country, salaryFloor, remoteOnly, workMode, freshness, companies, t]);
  // S1: search suggestions — recent searches (local), matching companies
  // (served facet), matching category pages, and a curated common-role list.
  // Everything suggested is real and clickable; nothing invented.
  // D2: list density — compact triples postings per screen for power scanning.
  const [density, setDensity] = useState<"comfortable" | "compact">(() =>
    (localStorage.getItem("rb_density") === "compact" ? "compact" : "comfortable"));
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
    { id: "remote", label: workMode === "remote" ? t("jobsPage.paRemoteOff", "Show all locations") : t("jobsPage.paRemoteOn", "Remote only"), run: () => { setWorkMode(workMode === "remote" ? "" : "remote"); setRemoteOnly(false); } },
    { id: "week", label: t("jobsPage.paWeek", "Posted this week"), run: () => setFreshness("week") },
    { id: "today", label: t("jobsPage.paToday", "Posted today"), run: () => setFreshness("day") },
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
  const [zeroHelp, setZeroHelp] = useState<Array<{ key: string; label: string; count: number; clear: () => void }> | null>(null);
  const zeroSigRef = useRef("");
  useEffect(() => {
    if (loading || refreshing || error || !data || data.total !== 0) { setZeroHelp(null); return; }
    const sig = JSON.stringify([q, location, category, experience, company, salaryFloor, remoteOnly, freshness]);
    if (zeroSigRef.current === sig) return;
    zeroSigRef.current = sig;
    const base: Record<string, unknown> = {
      action: "list", countOnly: true, includeFacets: false,
      q: q || undefined, location: location || undefined, remote: remoteOnly || undefined,
      category: category || undefined, experience: experience || undefined,
      companies: company ? [company] : undefined, salaryFloor: salaryFloor || undefined,
      maxAgeDays: freshness ? (freshness === "day" ? 1 : 7) : undefined,
    };
    const OVERRIDES: Record<string, Record<string, unknown>> = {
      q: { q: undefined }, location: { location: undefined }, category: { category: undefined },
      experience: { experience: undefined }, company: { companies: undefined },
      salaryFloor: { salaryFloor: undefined }, remote: { remote: undefined }, freshness: { maxAgeDays: undefined },
    };
    const candidates = activeFilters.slice(0, 4);
    let cancelled = false;
    (async () => {
      const results = await Promise.all(candidates.map(async (c) => {
        try {
          const { data: r } = await invokeBoard<{ total?: number }>({ ...base, ...OVERRIDES[c.key] });
          return { ...c, count: r?.total ?? 0 };
        } catch { return { ...c, count: 0 }; }
      }));
      if (!cancelled) setZeroHelp(results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count));
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, refreshing, error, data, activeFilters]);

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
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-5 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold leading-snug">{detailJob.title}</h2>
                <p className="text-sm text-muted-foreground">
                  <Link to={`/jobs/company/${detailJob.token}`} className="text-primary hover:underline" onClick={() => closeDetail()}>
                    {detailJob.company}
                  </Link>
                  {detailJob.location ? <> · {detailJob.location}</> : null}
                </p>
              </div>
              <button
                type="button"
                aria-label={t("jobsPage.detailClose", "Close")}
                className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
                onClick={() => closeDetail()}
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 text-success">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {t("jobsPage.trustBadge", "Verified direct from {{company}}", { company: detailJob.company })}
                </span>
                {detailJob.lastSeen && (
                  <span
                    className="text-muted-foreground"
                    title={t("jobsPage.recheckedTip", "When this posting was last re-verified against the company's own feed")}
                  >
                    {t("jobsPage.rechecked", "re-checked {{ago}}", { ago: agoLabel(detailJob.lastSeen, t) })}
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
              <div className="flex flex-wrap gap-2 sticky top-0 z-10 bg-card/95 backdrop-blur-sm py-2 -mt-2">
                <Button size="sm" className="gap-1.5" asChild>
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
                <Button size="sm" variant="outline" className="gap-1.5" disabled={fitFetching === detailJob.id} onClick={() => checkFit(detailJob)}>
                  {fitFetching === detailJob.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
                  {t("jobsPage.checkFit", "Check my fit — free scan")}
                </Button>
                {detailJob.id.startsWith("greenhouse:") && (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={preparingId === detailJob.id} onClick={() => prepareApplication(detailJob)}>
                    {preparingId === detailJob.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                    {t("jobsPage.prepAnswers", "Prep answers")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="px-2" aria-label={t("jobsPage.saveJob", "Save")} onClick={() => saveJob(detailJob)}>
                  {savedIds.has(detailJob.id) ? <BookmarkCheck className="w-4 h-4 text-primary" /> : <Bookmark className="w-4 h-4" />}
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
                  previously lander-only. */}
              <EmployerContext companyToken={detailJob.token} companyName={detailJob.company} postingTitle={detailJob.title} />
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
                        <details key={i} open={i <= 2} className="group rounded-lg border border-border/60">
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
      <main className="pt-20 pb-20">
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
              this page targets. Only shown with a real count, so it's always true. */}
          {landerCompany && typeof data?.total === "number" && data.total > 0 && (
            <p className="text-sm font-semibold text-success mb-1">
              {t("jobsPage.companyYesHiring", "Yes — {{count}} verified open {{roleWord}} right now, straight from {{company}}'s own job board.", {
                count: data.total,
                roleWord: data.total === 1 ? "role" : "roles",
                company: landerCompanyName,
              })}
            </p>
          )}
          <p className="text-sm text-muted-foreground mb-2">
            {landerCompany
              ? t("jobsPage.companySubtitle", "Every {{company}} opening here comes straight from {{company}}'s own careers system — verified, still open, and re-checked the moment you apply.", { company: landerCompanyName })
              : data?.totalAllCompanies
              ? t("jobsPage.countLine", "{{total}} live openings from {{companies}} companies — every one straight from the company's own hiring system.", {
                  total: data.totalAllCompanies.toLocaleString(),
                  companies: (data.companiesCount ?? companies.length).toLocaleString(),
                })
              : t("jobsPage.subtitleShort", "Every job straight from the company's own careers system — verified, fresh, re-checked when you apply.")}
            {/* Live activity strip: the board IS alive — say so with measured
                numbers only (each clause renders only when its data exists). */}
            {!landerCompany && (takedownsToday !== null || recheckP50Min !== null) && (
              <span className="block text-[12px] text-muted-foreground mt-0.5">
                {takedownsToday !== null && t("jobsPage.takedownsToday", "{{n}} roles filled or closed today", { n: takedownsToday.toLocaleString() })}
                {takedownsToday !== null && recheckP50Min !== null && " · "}
                {recheckP50Min !== null && t("jobsPage.recheckLine", "median feed re-checked {{m}} min ago", { m: recheckP50Min })}
              </span>
            )}
            {!landerCompany && newToday !== null && (
              <span className="inline-flex items-center gap-1.5 ml-2 text-success whitespace-nowrap">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-success animate-pulse motion-reduce:animate-none" />
                {t("jobsPage.newTodayLine", "{{n}} posted today.", { n: newToday.toLocaleString() })}
              </span>
            )}
          </p>
          {/* Lander intel: sourced headcount/band, weekly net-new, salary
              median, top fields — each clause renders only when its data
              exists. Then claim-your-profile (identity, never data editing). */}
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
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
                  {t("jobsPage.nlHint", "We map it to real filters and show exactly how we read it — adjust anything below.")}
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
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={t("jobsPage.allFields", "All fields")}
            >
              <option value="">{t("jobsPage.allFields", "All fields")}</option>
              {CATEGORY_IDS.map((c) => (
                <option key={c} value={c}>
                  {t(`jobsPage.categories.${c}`, c)}
                  {data?.categories?.[c] ? ` (${data.categories[c]})` : ""}
                </option>
              ))}
            </select>
            <select
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={t("jobsPage.allExperience", "Any experience")}
            >
              <option value="">{t("jobsPage.allExperience", "Any experience")}</option>
              {EXPERIENCE_IDS.map((x) => (
                <option key={x} value={x}>
                  {t(`jobsPage.experience.${x}`, x)}
                </option>
              ))}
            </select>
            {countryFacet.length > 0 && (
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={t("jobsPage.allCountries", "All countries")}
                title={t("jobsPage.countryTip", "Country read from each posting's own location text — postings we can't place are excluded while this is on, never guessed.")}
              >
                <option value="">{t("jobsPage.allCountries", "All countries")}</option>
                {countryFacet.map((c) => (
                  <option key={c.country} value={c.country}>
                    {countryLabel(c.country)} ({c.n.toLocaleString()})
                  </option>
                ))}
              </select>
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
                value={companyQuery !== null ? companyQuery : (companies.find((c) => c.token === company)?.name ?? "")}
                onChange={(e) => { setCompanyQuery(e.target.value); setCompanyIdx(-1); }}
                onFocus={() => setCompanyQuery(companyQuery ?? "")}
                onBlur={() => setTimeout(() => { setCompanyQuery(null); setCompanyIdx(-1); }, 150)}
                onKeyDown={(e) => {
                  if (companyQuery === null) return;
                  const opts = companies.filter((c) => c.name.toLowerCase().includes(companyQuery.toLowerCase())).slice(0, 12);
                  if (e.key === "ArrowDown") { e.preventDefault(); setCompanyIdx((i) => Math.min(i + 1, opts.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setCompanyIdx((i) => Math.max(i - 1, -1)); }
                  else if (e.key === "Enter" && companyIdx >= 0 && opts[companyIdx]) {
                    e.preventDefault(); setCompany(opts[companyIdx].token); setCompanyQuery(null); setCompanyIdx(-1);
                  } else if (e.key === "Escape") { setCompanyQuery(null); setCompanyIdx(-1); }
                }}
                placeholder={t("jobsPage.companySearch", "Company…")}
                className="px-3 py-2 rounded-lg bg-background border border-border text-sm w-36 focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={t("jobsPage.allCompanies", "All companies")}
              />
              {companyQuery !== null && (
                <div id="company-typeahead-list" role="listbox" className="absolute z-30 mt-1 w-64 max-h-72 overflow-auto rounded-lg border border-border bg-background shadow-lg text-sm">
                  {company && (
                    <button type="button" className="block w-full text-left px-3 py-2 hover:bg-muted text-muted-foreground" onMouseDown={() => { setCompany(""); setCompanyQuery(null); }}>
                      {t("jobsPage.allCompanies", "All companies")}
                    </button>
                  )}
                  {companies
                    .filter((c) => c.name.toLowerCase().includes(companyQuery.toLowerCase()))
                    .slice(0, 12)
                    .map((c, ci) => (
                      <button
                        key={c.token}
                        id={`company-opt-${ci}`}
                        role="option"
                        aria-selected={ci === companyIdx}
                        type="button"
                        className={`block w-full text-left px-3 py-2 hover:bg-muted ${ci === companyIdx ? "bg-muted" : ""}`}
                        onMouseDown={() => { setCompany(c.token); setCompanyQuery(null); setCompanyIdx(-1); }}
                      >
                        {c.name} <span className="text-muted-foreground">({c.count})</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <select
              value={salaryFloor || ""}
              onChange={(e) => setSalaryFloor(Number(e.target.value) || 0)}
              className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={t("jobsPage.anySalary", "Any salary")}
              title={t("jobsPage.salaryFloorTip", "Filters on pay the posting itself states (hourly and monthly rates annualized). Postings that don't publish pay are hidden while this is on — that's most of them.")}
            >
              <option value="">{t("jobsPage.anySalary", "Any salary")}</option>
              {[40_000, 60_000, 80_000, 100_000, 120_000, 150_000, 200_000].map((f) => (
                <option key={f} value={f}>
                  {t("jobsPage.salaryFloorOption", "{{amount}}k+ stated", { amount: f / 1000 })}
                </option>
              ))}
            </select>
            {/* Definitive work-mode filter: only employer-stated tags match;
                postings that don't say are excluded by the filter, honestly. */}
            <select
              value={workMode}
              onChange={(e) => { const v = e.target.value as "" | "remote" | "hybrid" | "onsite"; setWorkMode(v); setRemoteOnly(false); }}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
              aria-label={t("jobsPage.workMode.label", "Work mode")}
            >
              <option value="">{t("jobsPage.workMode.any", "Any work mode")}</option>
              <option value="remote">{t("jobsPage.workMode.remote", "Remote")}</option>
              <option value="hybrid">{t("jobsPage.workMode.hybrid", "Hybrid")}</option>
              <option value="onsite">{t("jobsPage.workMode.onsite", "On-site")}</option>
            </select>
            {(q || location || remoteOnly || workMode || company || category || experience || salaryFloor > 0) && (
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={saveCurrentSearch}>
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
          <div className="flex flex-wrap items-center gap-2 mb-5 -mt-2">
            {([["", t("jobsPage.freshAll", "Any date")], ["day", t("jobsPage.freshDay", "Today")], ["week", t("jobsPage.freshWeek", "This week")]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setFreshness(v)}
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
            <div className="basis-full overflow-x-auto md:overflow-visible pb-1 -mb-1 relative [mask-image:linear-gradient(to_right,black_92%,transparent)] md:[mask-image:none]">
              <div className="flex items-center gap-2 w-max md:w-auto md:flex-wrap">
                {CATEGORY_IDS
                  .filter((c) => (data?.categories?.[c] ?? 0) > 0)
                  .sort((a, b) => {
                    // "Other" is the biggest bucket but the least useful pill —
                    // always last regardless of count.
                    if (a === "other") return 1;
                    if (b === "other") return -1;
                    return (data?.categories?.[b] ?? 0) - (data?.categories?.[a] ?? 0);
                  })
                  .slice(0, 10)
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
            </div>
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
            <button
              type="button"
              onClick={() => setActivelyHiringOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                activelyHiringOnly ? "border-success bg-success/10 text-success font-semibold" : "border-border text-muted-foreground hover:text-foreground"
              }`}
              title={t("jobsPage.activelyHiringTip", "Show only companies with a proven recent hiring pattern — roles they've actually filled or closed, from our lifecycle tracking (not just open listings).")}
            >
              <Activity className="w-3 h-3" />
              {t("jobsPage.activelyHiringFilter", "Actively hiring")}
            </button>
            <button
              type="button"
              onClick={toggleDensity}
              className="px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
              title={t("jobsPage.densityTip", "Switch list density")}
            >
              {density === "compact" ? t("jobsPage.densityComfortable", "Comfortable view") : t("jobsPage.densityCompact", "Compact view")}
            </button>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value === "salary" ? "salary" : "newest")}
              className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-background text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={t("jobsPage.sortLabel", "Sort")}
            >
              <option value="newest">{t("jobsPage.sortNewest", "Newest first")}</option>
              <option value="salary">{t("jobsPage.sortSalary", "Highest stated salary")}</option>
            </select>
            {/* Why this order: the board explains its data everywhere else —
                the ranking shouldn't be the one unexplained thing. */}
            <span className="text-[11px] text-muted-foreground">
              {fitRanking
                ? t("jobsPage.orderFit", "ordered by fit to your résumé")
                : sortMode === "salary"
                  ? t("jobsPage.orderSalary", "ordered by stated salary floor — postings without stated pay sort last")
                  : q
                    ? t("jobsPage.orderRelevance", "ordered by relevance to your search")
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
            {recentJobs.length === 0 && !q && !location && !category && !experience && !company && !remoteOnly && !freshness && !salaryFloor && !country && (
              <span className="inline-flex flex-wrap items-center gap-2 ml-1">
                <span className="text-[11px] text-muted-foreground">{t("jobsPage.tryLabel", "Try:")}</span>
                <button type="button" onClick={() => { setRemoteOnly(true); setExperience("entry"); setCountry("US"); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
                  {t("jobsPage.presetRemoteEntry", "Remote · Entry-level · US")}
                </button>
                <button type="button" onClick={() => { setCategory("engineering"); setFreshness("week"); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors">
                  {t("jobsPage.presetEngWeek", "Engineering · This week")}
                </button>
                <button type="button" onClick={() => { setSalaryFloor(100000); setFreshness("week"); }}
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
          </div>

          {/* Mobile quick filters: the board's best weapons as one-tap chips —
              on desktop the sidebar owns these, so lg:hidden. */}
          <div className="flex lg:hidden flex-wrap gap-2 mb-3">
            {([
              { key: "week", active: freshness === "week", label: t("jobsPage.chipWeek", "Posted this week"), toggle: () => setFreshness(freshness === "week" ? "" : "week") },
              { key: "remote", active: workMode === "remote", label: t("jobsPage.workMode.remote", "Remote"), toggle: () => { setWorkMode(workMode === "remote" ? "" : "remote"); setRemoteOnly(false); } },
              { key: "hybrid", active: workMode === "hybrid", label: t("jobsPage.workMode.hybrid", "Hybrid"), toggle: () => { setWorkMode(workMode === "hybrid" ? "" : "hybrid"); setRemoteOnly(false); } },
              { key: "pay", active: salaryFloor >= 100000, label: t("jobsPage.chip100k", "$100k+"), toggle: () => setSalaryFloor(salaryFloor >= 100000 ? 0 : 100000) },
              { key: "hiring", active: activelyHiringOnly, label: t("jobsPage.chipHiring", "Actively hiring"), toggle: () => setActivelyHiringOnly(!activelyHiringOnly) },
            ] as const).map((c) => (
              <button
                key={c.key}
                onClick={c.toggle}
                className={`px-3 py-1.5 rounded-full border text-[13px] font-medium transition-colors ${
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
            <div className="rounded-2xl border border-border bg-card p-5 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Compass className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-bold text-foreground">
                  {t("jobsPage.orientTitle", "{{total}} verified openings — where do you want to start?", {
                    total: data?.totalAllCompanies ? data.totalAllCompanies.toLocaleString() : "500,000+",
                  })}
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
          {resumeAvailable === false && !fitRanking && (
            <div
              onDragOver={(e) => { e.preventDefault(); setResumeDragOver(true); }}
              onDragLeave={() => setResumeDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setResumeDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleBoardResumeFile(f);
              }}
              className={`rounded-xl border px-4 py-3 mb-4 flex flex-wrap items-center gap-3 transition-colors ${
                resumeDragOver ? "border-primary bg-primary/10 border-dashed" : "border-primary/30 bg-primary/5"
              }`}
            >
              {parsingResume ? <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" /> : <Upload className="w-4 h-4 text-primary shrink-0" />}
              <p className="text-sm text-foreground flex-1 min-w-[220px]">
                {parsingResume
                  ? t("jobsPage.dropParsing", "Reading your résumé…")
                  : t("jobsPage.dropTitle", "Drop your résumé here — see your match score on every opening, instantly.")}
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
                <span className="cursor-pointer inline-flex items-center rounded-lg bg-primary text-primary-foreground text-sm font-semibold px-3 py-1.5 hover:bg-primary/90">
                  {t("jobsPage.dropBrowse", "Choose file")}
                </span>
              </label>
              <button onClick={() => navigate("/#upload")} className="text-[12px] text-muted-foreground hover:text-foreground hover:underline">
                {t("jobsPage.dropScannerLink", "or run the full free scan")}
              </button>
            </div>
          )}

          {/* Split-pane on lg+: list column left, detail column right. */}
          <div className="lg:grid lg:grid-cols-[minmax(0,46%)_minmax(0,54%)] lg:gap-6 lg:items-start">
          <div className="min-w-0">
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
              <p className="text-sm text-muted-foreground mb-3">{t("jobsPage.error", "The board couldn't load right now.")}</p>
              <Button variant="outline" size="sm" onClick={() => fetchJobs(0)}>
                {t("jobsPage.retry", "Try again")}
              </Button>
            </div>
          ) : jobs.length === 0 ? (
            /* Server-zero: an actionable exit, never a dead end. Each button is
               a measured single relaxation with its real result count. */
            <div className="rounded-2xl border border-border bg-card p-6 text-center my-4">
              <p className="font-semibold text-foreground mb-1">
                {t("jobsPage.zeroTitle", "No verified openings match all of that")}
              </p>
              <p className="text-sm text-muted-foreground mb-3">
                {t("jobsPage.zeroBody", "We only list postings verified from companies' own systems — nothing gets padded in. Loosening one filter helps:")}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {(zeroHelp ?? []).map((s) => (
                  <Button key={s.key} size="sm" variant="outline" onClick={s.clear}>
                    {t("jobsPage.zeroRemove", "Remove {{label}} — {{n}} openings", { label: s.label, n: s.count.toLocaleString() })}
                  </Button>
                ))}
                {zeroHelp === null && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
          ) : (
            <>
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
              <p className="text-xs text-muted-foreground mb-3" aria-live="polite">
                {landerCompany
                  ? t("jobsPage.companyResultsSummary", "Showing {{shown}} of {{total}} open roles at {{company}}", {
                      shown: jobs.length,
                      total: data?.total ?? jobs.length,
                      company: landerCompanyName,
                    })
                  : t("jobsPage.resultsSummary", "Showing {{shown}} of {{total}} matching openings across {{companies}} companies", {
                  shown: jobs.length,
                  total: data?.total ?? jobs.length,
                  companies: data?.companiesCount ?? companies.length,
                })}
                {data?.refreshedAt && (
                  <span> · {t("jobsPage.updatedAgo", "updated {{min}} min ago", { min: Math.max(0, Math.round((Date.now() - new Date(data.refreshedAt).getTime()) / 60000)) })}</span>
                )}
                {data && data.failedSources.length > 0 && (
                  <span> · {t("jobsPage.sourcesDown", "{{count}} company feeds are unreachable right now", { count: data.failedSources.length })}</span>
                )}
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
              {q.trim() && sortMode !== "salary" && (
                <p className="text-[11px] text-muted-foreground mb-2 -mt-1">
                  {searchNewestFirst
                    ? t("jobsPage.sortedNewest", "Sorted by newest first")
                    : t("jobsPage.sortedRelevance", "Sorted by relevance — title matches first")}
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
              <ul className="space-y-3">
                {groupedJobs.map(({ primary: job, siblings }, gi) => {
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
                      className={`animate-in fade-in slide-in-from-bottom-1 duration-200 rounded-2xl border bg-card ${density === "compact" ? "px-4 py-2" : "p-4"} cursor-pointer transition-all duration-150 hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                        detailJob?.id === job.id ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) {
                          e.preventDefault();
                          void openDetail(job);
                        }
                      }}
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
                          <p className={`font-semibold leading-snug ${viewedIds.has(job.id) && detailJob?.id !== job.id ? "text-muted-foreground" : "text-foreground"}`}>{job.title}</p>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {job.token
                              ? <Link to={`/jobs/company/${job.token}`} className="hover:text-primary hover:underline">{job.company}</Link>
                              : job.company}
                            {job.location ? ` · ${job.location}` : ""}
                            {job.department ? ` · ${job.department}` : ""}
                          </p>
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
                            {t("jobsPage.trustBadge", "Verified direct from {{company}}", { company: job.company })}
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
                                title={t("jobsPage.urgencyTipFills", "Based on {{n}} genuine fills in our tracking (roles that stayed posted a week or more, then closed), a typical role here closes in about {{d}} days — worth applying early.", { n: hh.closed_90d, d: Math.round(m) })}
                              >
                                <Clock className="w-3 h-3 shrink-0" />
                                {t("jobsPage.urgencyChip", "Typically fills in ~{{d}}d", { d: Math.round(m) })}
                              </span>
                            );
                          })()}
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
                        </div>
                      </div>
                      <div className={`flex flex-wrap items-center gap-2 mt-3 ${density === "compact" ? "hidden" : ""}`}>
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={fitFetching === job.id} onClick={() => checkFit(job)}>
                          {fitFetching === job.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
                          {t("jobsPage.checkFit", "Check my fit — free scan")}
                        </Button>
                        {job.id.startsWith("greenhouse:") && (
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
                                    {t("jobsPage.applyShort", "Apply →")}
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
              {data && jobs.length < data.total && (
                <div className="text-center mt-6">
                  <Button variant="outline" disabled={loadingMore} onClick={() => fetchJobs(jobs.length)} className="gap-2">
                    {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t("jobsPage.loadMore", "Load more")}
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
            {t("jobsPage.sourceNote", "Sources: the official public job-board APIs companies publish on Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR, Recruitee, Teamtailor, Personio, and Breezy. The largest boards are re-checked about every 10–15 minutes and the whole catalog rotates continuously — every feed is re-verified within a few hours, and postings a company takes down disappear on the next pass. A feed that stops responding drops off the board rather than breaking it.")}
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
            onClick={() => setCompareOpen(true)}
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
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(compareIds.length, 3)}, minmax(220px, 1fr))` }}>
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
