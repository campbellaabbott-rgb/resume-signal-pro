// Live job board. Postings come from each company's OFFICIAL public
// job-board feed (Greenhouse / Lever / Ashby) via the job-board edge
// function — never scraped. Two honest actions per posting: scan your
// resume against it (JD handoff → the home scanner), or apply on the
// company's own site. We never fake an in-house "apply".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bookmark, BookmarkCheck, Briefcase, ExternalLink, Loader2, MapPin, Search, Target } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { postTrackEvent } from "@/lib/track-transport";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { searchName, searchToQuery } from "@/lib/job-search-params";

// user_applications gained board columns after the last typegen — untyped
// access until Lovable regenerates types.ts.
const appsTable = () => (supabase as unknown as { from: (t: string) => any }).from("user_applications");
const searchesTable = () => (supabase as unknown as { from: (t: string) => any }).from("user_job_searches");

interface BoardJob {
  id: string;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  department: string | null;
  postedAt: string | null;
  applyUrl: string;
}

interface BoardResponse {
  jobs: BoardJob[];
  total: number;
  totalAllCompanies: number;
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
  const [company, setCompany] = useState(initial.get("company") ?? "");
  const [category, setCategory] = useState(initial.get("category") ?? "");
  const [data, setData] = useState<BoardResponse | null>(null);
  const [jobs, setJobs] = useState<BoardJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fitFetching, setFitFetching] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const reqSeq = useRef(0);
  const { session } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

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
      const { data: res } = await supabase.functions.invoke("job-board", { body: { action: "detail", id: job.id } });
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
      location: location || undefined,
      remote: remoteOnly || undefined,
      company: company || undefined,
    };
    const name = searchName(params, category ? t(`jobsPage.categories.${category}`, category) : undefined);
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

  const fetchJobs = useCallback(
    async (offset: number) => {
      const seq = ++reqSeq.current;
      offset === 0 ? setLoading(true) : setLoadingMore(true);
      setError(false);
      try {
        const { data: res, error: err } = await supabase.functions.invoke("job-board", {
          body: {
            action: "list",
            q: q || undefined,
            location: location || undefined,
            remote: remoteOnly || undefined,
            category: category || undefined,
            companies: company ? [company] : undefined,
            limit: PAGE,
            offset,
          },
        });
        if (err || !res?.jobs) throw new Error(err?.message ?? "no jobs field");
        if (seq !== reqSeq.current) return; // a newer filter superseded this request
        setData(res as BoardResponse);
        setJobs((prev) => (offset === 0 ? (res as BoardResponse).jobs : [...prev, ...(res as BoardResponse).jobs]));
      } catch (e) {
        console.error("[Jobs] list failed:", e);
        if (seq === reqSeq.current) setError(true);
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [q, location, remoteOnly, company, category],
  );

  // Keep the URL shareable — filters in, defaults out.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (location) p.set("location", location);
    if (remoteOnly) p.set("remote", "1");
    if (company) p.set("company", company);
    if (category) p.set("category", category);
    const qs = p.toString();
    window.history.replaceState({}, "", qs ? `/jobs?${qs}` : "/jobs");
  }, [q, location, remoteOnly, company, category]);

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

  const checkFit = async (job: BoardJob) => {
    setFitFetching(job.id);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("job-board", {
        body: { action: "detail", id: job.id },
      });
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

  const companies = useMemo(
    () => (data?.companies ?? []).filter((c) => c.count > 0 || c.token === company).sort((a, b) => a.name.localeCompare(b.name)),
    [data, company],
  );

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={t("jobsPage.seoTitle", "Live Job Board — Openings You Can Check Your Resume Against")}
        description={t("jobsPage.seoDescription", "Live openings pulled from official company job boards (Greenhouse, Lever, Ashby). Check your resume's fit against any posting free, then apply on the company's own site.")}
        path="/jobs"
      />
      <Header />
      <main className="pt-20 pb-20">
        <div className="container max-w-4xl">
          <div className="flex items-center gap-2 mb-2">
            <Briefcase className="w-6 h-6 text-primary" />
            <h1 className="text-3xl md:text-4xl font-bold">{t("jobsPage.h1", "Live job board")}</h1>
          </div>
          <p className="text-muted-foreground mb-1">
            {t("jobsPage.subtitle", "Real openings, pulled live from each company's official job board. Scan your resume against a posting before you spend an application on it.")}
          </p>
          <p className="text-xs text-muted-foreground mb-6">
            {t("jobsPage.honestyNote", "Listings belong to the companies; applying happens on their site. We add the part they don't have: an honest fit check first.")}
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
            {(q || location || remoteOnly || company || category) && (
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={saveCurrentSearch}>
                <BookmarkCheck className="w-3.5 h-3.5" />
                {t("jobsPage.saveSearch", "Save this search")}
              </Button>
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
              <p className="text-xs text-muted-foreground mb-3">
                {t("jobsPage.resultsSummary", "Showing {{shown}} of {{total}} matching openings across {{companies}} companies", {
                  shown: jobs.length,
                  total: data?.total ?? jobs.length,
                  companies: companies.length,
                })}
                {data?.refreshedAt && (
                  <span> · {t("jobsPage.updatedAgo", "updated {{min}} min ago", { min: Math.max(0, Math.round((Date.now() - new Date(data.refreshedAt).getTime()) / 60000)) })}</span>
                )}
                {data && data.failedSources.length > 0 && (
                  <span> · {t("jobsPage.sourcesDown", "{{count}} company feeds are unreachable right now", { count: data.failedSources.length })}</span>
                )}
              </p>
              <ul className="space-y-3">
                {jobs.map((job) => {
                  const d = daysAgo(job.postedAt);
                  return (
                    <li key={job.id} className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="flex-1 min-w-[220px]">
                          <p className="font-semibold text-foreground leading-snug">{job.title}</p>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {job.company}
                            {job.location ? ` · ${job.location}` : ""}
                            {job.department ? ` · ${job.department}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {job.remote && <Badge variant="secondary" className="text-[10px]">{t("jobsPage.remoteBadge", "Remote")}</Badge>}
                          {d !== null && (
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
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
                        <Button size="sm" variant="ghost" className="gap-1.5" asChild>
                          <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" onClick={() => { trackApply(job); void promoteApplied(job); }}>
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
            {t("jobsPage.sourceNote", "Sources: the official public job-board APIs each company publishes on Greenhouse, Lever, or Ashby, refreshed on load (cached ~10 minutes). A feed that stops responding drops off the board rather than breaking it.")}
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
