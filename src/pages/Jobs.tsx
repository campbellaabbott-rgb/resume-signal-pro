// Live job board. Postings come from each company's OFFICIAL public
// job-board feed (Greenhouse / Lever / Ashby) via the job-board edge
// function — never scraped. Two honest actions per posting: scan your
// resume against it (JD handoff → the home scanner), or apply on the
// company's own site. We never fake an in-house "apply".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bookmark, BookmarkCheck, Briefcase, ExternalLink, Loader2, MapPin, MessageSquare, Search, ShieldCheck, Sparkles, Target } from "lucide-react";
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
}

// A company with several fresh, still-open roles is demonstrably hiring — the
// anti-ghost-job signal. Show the count at/above this bar; below it, the number
// isn't a meaningful "actively hiring" tell, so we stay quiet.
const HIRING_INTENT_MIN = 8;

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
  const [freshness, setFreshness] = useState<"" | "day" | "week">("");
  const [fitRanking, setFitRanking] = useState(false);
  const [fits, setFits] = useState<Record<string, number | null>>({});
  // Top missing keywords per posting id — the "add these to compete" signal
  // rendered inline on each card once fit-ranking is on.
  const [misses, setMisses] = useState<Record<string, string[]>>({});
  const [fitLoading, setFitLoading] = useState(false);
  // True once we've checked for a resume on mount, so the auto-enable only
  // fires once and never fights a user who deliberately toggled fit off.
  const fitAutoChecked = useRef(false);
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
  // Apply-agent: the posting whose questions we're drafting (with its fetched JD
  // and whether the user already applied — the dedup guard), and which card is
  // currently loading its description.
  const [prepareJob, setPrepareJob] = useState<{ job: BoardJob; description: string | null; alreadyApplied: boolean } | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  // Per-application resume rewrite (uses the already-deployed generate-tailored-resume).
  const [tailoredOpen, setTailoredOpen] = useState(false);
  const [tailoredLoading, setTailoredLoading] = useState(false);
  const [tailoredContent, setTailoredContent] = useState<TailoredResumeContent | null>(null);

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
      offset === 0 ? setLoading(true) : setLoadingMore(true);
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
        }
      }
    },
    [q, location, remoteOnly, company, category, experience, freshness],
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
    const qs = p.toString();
    if (landerCompany && company === landerCompany && !q && !location && !remoteOnly && !category && !experience) {
      window.history.replaceState({}, "", `/jobs/company/${landerCompany}`);
      return;
    }
    if (landerCategory && category === landerCategory && !q && !location && !remoteOnly && !company && !experience) {
      window.history.replaceState({}, "", `/jobs/field/${landerCategory}`);
      return;
    }
    window.history.replaceState({}, "", qs ? `/jobs?${qs}` : "/jobs");
  }, [q, location, remoteOnly, company, category, experience, landerCategory, landerCompany]);

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
    try {
      const stashed = sessionStorage.getItem("rb_resume_for_fit");
      if (stashed && stashed.length >= 100) {
        fitResume.current = stashed;
        return stashed;
      }
    } catch { /* ignore */ }
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
          const payload = data as { fits?: Record<string, number | null>; missing?: Record<string, string[]> } | null;
          if (payload?.fits) setFits((prev) => ({ ...prev, ...payload.fits }));
          if (payload?.missing) setMisses((prev) => ({ ...prev, ...payload.missing }));
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
      if (cancelled || !resume) return; // no resume yet — stay unlocked, retry when session lands
      fitAutoChecked.current = true;
      setFitRanking(true);
    })();
    return () => { cancelled = true; };
    // session gates the DB lookup inside resolveFitResume; re-run when it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const displayJobs = useMemo(() => {
    if (!fitRanking) return jobs;
    return [...jobs].sort((a, b) => (fits[b.id] ?? -1) - (fits[a.id] ?? -1));
  }, [jobs, fitRanking, fits]);

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

  const companies = useMemo(
    () => (data?.companies ?? []).filter((c) => c.count > 0 || c.token === company).sort((a, b) => a.name.localeCompare(b.name)),
    [data, company],
  );

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={landerCategory
          ? t("jobsPage.landerSeoTitle", "Live {{category}} Jobs — From Official Company Job Boards", { category: t(`jobsPage.categories.${landerCategory}`, landerCategory) })
          : landerCompany
          ? t("jobsPage.companySeoTitle", "{{company}} Jobs — Real, Verified Openings", { company: landerCompanyName })
          : t("jobsPage.seoTitle", "Live Jobs From Companies' Own Boards — Check Your Fit Before You Apply")}
        description={landerCategory
          ? t("jobsPage.landerSeoDescription", "Live {{category}} openings pulled straight from companies' own official job boards — no aggregators, no reposts, re-verified all day. Check your resume's fit free, then apply on the company's own site.", { category: t(`jobsPage.categories.${landerCategory}`, landerCategory) })
          : landerCompany
          ? t("jobsPage.companySeoDescription", "Browse {{company}}'s open roles, pulled straight from {{company}}'s own job board and re-verified all day — no aggregators, no reposts. Check your resume's fit against any role free, then apply on {{company}}'s own site.", { company: landerCompanyName })
          : t("jobsPage.seoDescription", "Real openings pulled straight from thousands of companies' own official job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR) — no aggregators, no reposts, re-verified all day and checked live when you apply. See how your resume fits any posting free, then apply on the company's own site.")}
        path={landerCompany ? `/jobs/company/${landerCompany}` : landerCategory ? `/jobs/field/${landerCategory}` : "/jobs"}
      />
      <Header />
      <main className="pt-20 pb-20">
        <div className="container max-w-4xl">
          <div className="flex items-center gap-2 mb-2">
            <Briefcase className="w-6 h-6 text-primary" />
            <h1 className="text-3xl md:text-4xl font-bold">{landerCompany
              ? t("jobsPage.companyH1", "Open roles at {{company}}", { company: landerCompanyName })
              : landerCategory
              ? t("jobsPage.landerH1", "Live {{category}} jobs", { category: t(`jobsPage.categories.${landerCategory}`, landerCategory) })
              : t("jobsPage.h1", "Live job board")}</h1>
          </div>
          <p className="text-muted-foreground mb-1">
            {landerCompany
              ? t("jobsPage.companySubtitle", "Every {{company}} opening here comes straight from {{company}}'s own careers system — verified, still open, and re-checked the moment you apply.", { company: landerCompanyName })
              : t("jobsPage.subtitle", "Every job here comes straight from the company's own careers system — no aggregators, no reposts, no dead links — and each is re-checked live the moment you apply.")}
          </p>
          <p className="text-xs text-muted-foreground mb-6">
            {t("jobsPage.honestyNote", "Then we do the part other boards skip: check your resume against any posting free and see exactly what to add — so you apply prepared, not hoping.")}
          </p>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-5">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("jobsPage.searchPlaceholder", "Title or keyword — e.g. product designer")}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="relative min-w-[170px]">
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
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm cursor-pointer select-none">
              <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} className="accent-primary" />
              {t("jobsPage.remoteOnly", "Remote only")}
            </label>
            {(q || location || remoteOnly || company || category || experience) && (
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={saveCurrentSearch}>
                <BookmarkCheck className="w-3.5 h-3.5" />
                {t("jobsPage.saveSearch", "Save this search")}
              </Button>
            )}
          </div>

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
            <button
              type="button"
              onClick={toggleFitRanking}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                fitRanking ? "border-success bg-success/10 text-success font-semibold" : "border-primary/40 text-primary hover:bg-primary/10"
              }`}
            >
              {fitLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
              {fitRanking ? t("jobsPage.fitRankingOn", "Ranked by your fit") : t("jobsPage.fitRankingCta", "Rank by my fit")}
            </button>
            {fitRanking && (
              <span className="text-[11px] text-muted-foreground">
                {t("jobsPage.fitRankingNote", "Deterministic keyword coverage vs your scanned resume — postings without stored descriptions show no score.")}
              </span>
            )}
          </div>

          {/* Results */}
          {loading ? (
            <div className="py-16 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
              <p className="text-sm">{t("jobsPage.loadingFirst", "Pulling live boards — the first load can take a few seconds.")}</p>
            </div>
          ) : error ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground mb-3">{t("jobsPage.error", "The board couldn't load right now.")}</p>
              <Button variant="outline" size="sm" onClick={() => fetchJobs(0)}>
                {t("jobsPage.retry", "Try again")}
              </Button>
            </div>
          ) : jobs.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {t("jobsPage.empty", "No openings match those filters. Loosen one and try again.")}
            </p>
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
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground mb-3">
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
              </p>
              <ul className="space-y-3">
                {displayJobs.map((job) => {
                  const d = daysAgo(job.postedAt);
                  const openRoles = job.token ? companyCounts.get(job.token) : undefined;
                  const fit = fitRanking ? fits[job.id] : undefined;
                  const gaps = fitRanking ? (misses[job.id] ?? []) : [];
                  // Calibrated on live data: full JDs are keyword-dense, so a
                  // strong same-field resume covers ~20-24% of recognized terms
                  // and a cross-field one ~3%. Show a qualitative tier (precise
                  // coverage in the tooltip) so a genuinely strong 22% doesn't
                  // read as a bad match to a layperson.
                  const tier = typeof fit === "number" ? (fit >= 20 ? "strong" : fit >= 10 ? "possible" : "stretch") : null;
                  return (
                    <li key={job.id} className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="flex-1 min-w-[220px]">
                          <p className="font-semibold text-foreground leading-snug">{job.title}</p>
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
                        <Button size="sm" variant="ghost" className="gap-1.5" asChild>
                          <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" onClick={() => { trackApply(job); void promoteApplied(job); void verifyJob(job); }}>
                            {t("jobsPage.apply", "Apply on {{company}}'s site", { company: job.company })}
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </Button>
                      </div>
                    </li>
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

          <p className="text-[11px] text-muted-foreground mt-10">
            {t("jobsPage.sourceNote", "Sources: the official public job-board APIs companies publish on Greenhouse, Lever, Ashby, SmartRecruiters, Workable, and BambooHR. The largest boards are re-checked about every 10–15 minutes and the whole catalog rotates continuously — every feed is re-verified within about an hour, and postings a company takes down disappear on the next pass. A feed that stops responding drops off the board rather than breaking it.")}
          </p>
        </div>
      </main>

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

      <Footer />
    </div>
  );
}
