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
import { Activity, AlertTriangle, Bookmark, BookmarkCheck, Briefcase, ChevronDown, Clock, Copy, ExternalLink, FileText, Flag, Loader2, MapPin, MessageSquare, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Target } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ApplicationAnswers } from "@/components/apply/ApplicationAnswers";
import { TailoredResumeModal, type TailoredResumeContent } from "@/components/TailoredResumeModal";
import { supabase } from "@/integrations/supabase/client";
import { postTrackEvent } from "@/lib/track-transport";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { searchName, searchToQuery } from "@/lib/job-search-params";
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
  experienceBand?: string | null;
  minYears?: number | null;
  /** Board category slug (serveList returns it; drives detail-panel "similar openings"). */
  category?: string | null;
}

// A company with several fresh, still-open roles is demonstrably hiring — the
// anti-ghost-job signal. Show the count at/above this bar; below it, the number
// isn't a meaningful "actively hiring" tell, so we stay quiet.
const HIRING_INTENT_MIN = 8;

// Per-company hiring-health, from get_company_hiring_health (lifecycle data).
interface HiringHealth {
  open_roles: number;
  closed_90d: number;
  /** Same-title relistings in 90d — repost churn (absent until the RPC ships it). */
  superseded_90d?: number;
  median_days_open: number | null;
  median_days_to_close: number | null;
  tracking_days: number;
}
// Closures needed before we'll call a company "actively hiring" — enough that
// it's a real pattern, not one data point. Below it we show only neutral facts.
const ACTIVELY_HIRING_MIN_CLOSED = 3;
// Urgency chip: only when the fill pattern is both proven (>= the closure floor)
// and actually fast — a 25-day median is not "apply early".
const URGENT_FILL_MAX_DAYS = 14;
// Repost caution: relisting the same titles this often in 90d is a pattern.
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

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return Number.isFinite(d) && d >= 0 ? d : null;
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
  const { category: pathCategory, companyToken } = useParams<{ category?: string; companyToken?: string }>();
  const landerCategory = isBoardCategory(pathCategory) ? pathCategory : undefined;
  // /jobs/company/:token — the board scoped to one employer's verified openings.
  const landerCompany = companyToken || undefined;
  const [company, setCompany] = useState(initial.get("company") ?? landerCompany ?? "");
  const [category, setCategory] = useState(initial.get("category") ?? landerCategory ?? "");
  const [experience, setExperience] = useState(initial.get("experience") ?? "");
  // Salary floor filters on the posting's OWN stated pay, annualized (hourly
  // ×2080 etc.) but never currency-converted — postings that don't state pay
  // are excluded while the floor is active.
  const [salaryFloor, setSalaryFloor] = useState<number>(() => {
    const n = Number(initial.get("salaryFloor"));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const [freshness, setFreshness] = useState<"" | "day" | "week">("");
  // Sort: newest (default) or highest STATED salary (annualized floor, server-
  // side; unsalaried postings sort last). Fit ordering is owned by "For you".
  const [sortMode, setSortMode] = useState<"newest" | "salary">("newest");
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
  const [data, setData] = useState<BoardResponse | null>(null);
  const [jobs, setJobs] = useState<BoardJob[]>([]);
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
      remote: remoteOnly || undefined,
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
      description: t("jobsPage.searchSavedDesc", "Your account shows how many new postings match since your last look."),
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
          remote: remoteOnly || undefined,
          category: category || undefined,
          experience: experience || undefined,
          companies: company ? [company] : undefined,
          salaryFloor: salaryFloor || undefined,
          sort: sortMode === "salary" ? "salary" : undefined,
          postedAfter: freshness ? new Date(Date.now() - (freshness === "day" ? 1 : 7) * 86_400_000).toISOString() : undefined,
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
    [q, location, remoteOnly, company, category, experience, salaryFloor, sortMode, freshness],
  );

  // Keep the URL shareable — filters in, defaults out. A category lander
  // (/jobs/field/engineering) keeps its crawlable URL while its category is
  // the only active filter; touching any other filter moves to query form.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (location) p.set("location", location);
    if (remoteOnly) p.set("remote", "1");
    if (company) p.set("company", company);
    if (category) p.set("category", category);
    if (experience) p.set("experience", experience);
    if (salaryFloor) p.set("salaryFloor", String(salaryFloor));
    // The detail panel's ?job= deep link isn't filter state — preserve it, or
    // this rewrite clobbers a shared link on mount before the panel can open.
    const jobParam = new URLSearchParams(window.location.search).get("job");
    if (jobParam) p.set("job", jobParam);
    const qs = p.toString();
    if (landerCompany && company === landerCompany && !q && !location && !remoteOnly && !category && !experience && !salaryFloor) {
      window.history.replaceState({}, "", `/jobs/company/${landerCompany}${jobParam ? `?job=${encodeURIComponent(jobParam)}` : ""}`);
      return;
    }
    if (landerCategory && category === landerCategory && !q && !location && !remoteOnly && !company && !experience && !salaryFloor) {
      window.history.replaceState({}, "", `/jobs/field/${landerCategory}${jobParam ? `?job=${encodeURIComponent(jobParam)}` : ""}`);
      return;
    }
    window.history.replaceState({}, "", qs ? `/jobs?${qs}` : "/jobs");
  }, [q, location, remoteOnly, company, category, experience, salaryFloor, landerCategory, landerCompany]);

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
    try {
      const { data: res } = await invokeBoard<{ description?: string }>({ action: "detail", id: job.id });
      setDetailDesc(res?.description ?? null);
    } catch { /* panel still shows metadata + actions */ }
    setDetailLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      description: t("jobsPage.watchSavedDesc", "Your account now shows how many new roles they've posted since your last look."),
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

  const resolveFitResume = async (): Promise<string | null> => {
    if (fitResume.current) return fitResume.current;
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
    (tok?: string) => !!tok && (healthByToken[tok]?.closed_90d ?? 0) >= ACTIVELY_HIRING_MIN_CLOSED,
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
    () => [location, category, experience, company, salaryFloor > 0, remoteOnly, freshness].filter(Boolean).length,
    [location, category, experience, company, salaryFloor, remoteOnly, freshness],
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
    if (salaryFloor > 0) f.push({ key: "salaryFloor", label: `$${salaryFloor / 1000}k+`, clear: () => setSalaryFloor(0) });
    if (remoteOnly) f.push({ key: "remote", label: t("jobsPage.remoteBadge", "Remote"), clear: () => setRemoteOnly(false) });
    if (freshness) f.push({ key: "freshness", label: freshness === "day" ? t("jobsPage.freshDay", "Today") : t("jobsPage.freshWeek", "This week"), clear: () => setFreshness("") });
    return f;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, location, category, experience, company, salaryFloor, remoteOnly, freshness, companies, t]);

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
      postedAfter: freshness ? new Date(Date.now() - (freshness === "day" ? 1 : 7) * 86_400_000).toISOString() : undefined,
    };
    const OVERRIDES: Record<string, Record<string, unknown>> = {
      q: { q: undefined }, location: { location: undefined }, category: { category: undefined },
      experience: { experience: undefined }, company: { companies: undefined },
      salaryFloor: { salaryFloor: undefined }, remote: { remote: undefined }, freshness: { postedAfter: undefined },
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
  const highlightedDesc = useMemo(() => {
    if (!detailDesc || !detailJob) return null;
    const clean = decodeEntities(detailDesc);
    const hitList = (hits[detailJob.id] ?? []).filter((k) => k.length > 1);
    const missList = (misses[detailJob.id] ?? []).filter((k) => k.length > 1);
    if (hitList.length + missList.length === 0) return <>{clean}</>;
    const esc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${[...hitList, ...missList].map(esc).join("|")})`, "gi");
    const hitSet = new Set(hitList.map((k) => k.toLowerCase()));
    const missSet = new Set(missList.map((k) => k.toLowerCase()));
    return (
      <>
        {clean.split(re).map((part, i) => {
          const lower = part.toLowerCase();
          if (hitSet.has(lower)) return <mark key={i} className="bg-success/20 text-success rounded px-0.5">{part}</mark>;
          if (missSet.has(lower)) return <mark key={i} className="bg-warning/20 text-warning rounded px-0.5">{part}</mark>;
          return part;
        })}
      </>
    );
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
                {detailJob.remote && <Badge variant="secondary" className="text-[10px]">{t("jobsPage.remoteBadge", "Remote")}</Badge>}
                {detailJob.experienceBand && detailJob.experienceBand !== "unspecified" && (
                  <span className="px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                    {t(`jobsPage.experience.${detailJob.experienceBand}`, detailJob.experienceBand)}
                  </span>
                )}
                {daysAgo(detailJob.postedAt) !== null && (
                  <span className="text-muted-foreground">
                    {daysAgo(detailJob.postedAt) === 0
                      ? t("jobsPage.postedToday", "today")
                      : t("jobsPage.postedDaysAgo", "{{count}}d ago", { count: daysAgo(detailJob.postedAt) })}
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
                    {detailJob.salary}
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
              <div className="flex flex-wrap gap-2">
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
                  <div className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{highlightedDesc}</div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {t("jobsPage.detailNoDesc", "This company's feed doesn't publish the full description — the complete posting is on their own site via Apply.")}
                </p>
              )}
              {jobs.filter((j) => j.category === detailJob.category && j.id !== detailJob.id).length > 0 && (
                <div className="pt-2 border-t border-border">
                  <p className="text-[12px] font-semibold text-muted-foreground mb-2">{t("jobsPage.detailSimilar", "Similar openings on the board")}</p>
                  <ul className="space-y-1.5">
                    {jobs
                      .filter((j) => j.category === detailJob.category && j.id !== detailJob.id)
                      .slice(0, 4)
                      .map((j) => (
                        <li key={j.id}>
                          <button type="button" className="text-left text-sm text-primary hover:underline" onClick={() => void openDetail(j)}>
                            {j.title}
                          </button>
                          <span className="text-[11px] text-muted-foreground"> · {j.company}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
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
          </p>
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
              Honest + staged: the "actively hiring" label needs real closure volume,
              and with no closures yet we say we're still gathering, never "doesn't hire". */}
          {landerCompany && hiringHealth && (hiringHealth.open_roles > 0 || hiringHealth.closed_90d > 0) && (
            <div className="rounded-xl border border-border bg-card p-4 mb-6 max-w-xl">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-primary shrink-0" />
                <h2 className="text-sm font-semibold text-foreground">{t("jobsPage.hhTitle", "Hiring Health")}</h2>
                {hiringHealth.closed_90d >= ACTIVELY_HIRING_MIN_CLOSED && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/10 text-success">
                    {t("jobsPage.hhActive", "Actively hiring")}
                  </span>
                )}
              </div>
              <ul className="space-y-1 text-[13px] text-muted-foreground">
                {hiringHealth.open_roles > 0 && (
                  <li>
                    <span className="text-foreground font-semibold">{hiringHealth.open_roles}</span>{" "}
                    {t("jobsPage.hhOpen", "open roles verified on the board right now")}
                  </li>
                )}
                {hiringHealth.closed_90d > 0 ? (
                  <li>
                    {t("jobsPage.hhClosedPre", "Filled or closed")}{" "}
                    <span className="text-foreground font-semibold">{hiringHealth.closed_90d}</span>{" "}
                    {t("jobsPage.hhClosedPost", "in the last 90 days")}
                    {hiringHealth.median_days_to_close != null && (
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
                    {t("jobsPage.hhReposts", "Relisted the same role title {{n}} times in the last 90 days — routine reposting or roles that keep reopening.", { n: hiringHealth.superseded_90d })}
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
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("jobsPage.searchPlaceholder", "Title or keyword — e.g. product designer")}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
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
            <select
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={t("jobsPage.allCompanies", "All companies")}
            >
              <option value="">{t("jobsPage.allCompanies", "All companies")}</option>
              {companies.map((c) => (
                <option key={c.token} value={c.token}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
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
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm cursor-pointer select-none">
              <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} className="accent-primary" />
              {t("jobsPage.remoteOnly", "Remote only")}
            </label>
            {(q || location || remoteOnly || company || category || experience || salaryFloor > 0) && (
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
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  freshness === v ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
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
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value === "salary" ? "salary" : "newest")}
              className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-background text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={t("jobsPage.sortLabel", "Sort")}
            >
              <option value="newest">{t("jobsPage.sortNewest", "Newest first")}</option>
              <option value="salary">{t("jobsPage.sortSalary", "Highest stated salary")}</option>
            </select>
            {salaryFloor > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {t("jobsPage.salaryFloorNote", "Only postings that state pay of ${{amount}}k+ (annualized) — most companies don't publish pay, so this hides them.", { amount: salaryFloor / 1000 })}
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

          {/* The one thing no other board offers on arrival: match scores on
              every opening. Shown only to visitors we KNOW have no resume yet
              (never nags someone who deliberately switched to All jobs). */}
          {resumeAvailable === false && !fitRanking && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
              <Sparkles className="w-4 h-4 text-primary shrink-0" />
              <p className="text-sm text-foreground flex-1 min-w-[220px]">
                {t("jobsPage.forYouUpsell", "See your match score on every opening — scan your resume once, free, and the board ranks itself around you.")}
              </p>
              <Button size="sm" onClick={() => navigate("/#upload")}>
                {t("jobsPage.forYouUpsellCta", "Scan my resume")}
              </Button>
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
                      className={`rounded-2xl border bg-card p-4 cursor-pointer transition-all duration-150 hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
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
                            <p className="text-xs text-success font-medium mt-0.5">{job.salary}</p>
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
                          {job.token && (healthByToken[job.token]?.closed_90d ?? 0) >= ACTIVELY_HIRING_MIN_CLOSED && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-success mt-1 ml-2"
                              title={t("jobsPage.hhBadgeTip", "This company has filled or closed {{n}} roles in the last 90 days — a proven, active hiring pattern, not just open listings.", { n: healthByToken[job.token].closed_90d })}
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
                                title={t("jobsPage.urgencyTip", "Based on {{n}} roles this company filled or closed in the last 90 days, a typical role here closes in about {{d}} days — worth applying early.", { n: hh.closed_90d, d: Math.round(m) })}
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
                              title={t("jobsPage.repostTip", "This company relisted the same role title {{n}} times in the last 90 days. That can mean routine reposting or roles that keep reopening — worth knowing before you invest in an application.", { n: healthByToken[job.token].superseded_90d })}
                            >
                              <RefreshCw className="w-3 h-3 shrink-0" />
                              {t("jobsPage.repostChip", "Relists roles often ({{n}}× / 90d)", { n: healthByToken[job.token].superseded_90d })}
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
                          {job.remote && <Badge variant="secondary" className="text-[10px]">{t("jobsPage.remoteBadge", "Remote")}</Badge>}
                          {d !== null && (
                            <span className={`text-[11px] whitespace-nowrap ${d <= 2 ? "text-success font-medium" : "text-muted-foreground"}`}>
                              {d === 0 ? t("jobsPage.postedToday", "today") : t("jobsPage.postedDaysAgo", "{{count}}d ago", { count: d })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-3">
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

      <Footer />
    </div>
  );
}
