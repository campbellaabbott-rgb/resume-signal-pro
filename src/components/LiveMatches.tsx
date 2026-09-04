// Live openings inside the scan report: the board's top matches for THIS
// resume — SEARCHED for by the occupation the resume names, then fit-ranked by
// the same deterministic scorer the report's numbers come from. Zero AI cost —
// one fit-terms call, one list query, a few twenty-id fit-batch calls. The
// free scan's output stops at "here's your score" for everyone else; ours ends
// with jobs you can act on today.
//
// The card says which of those two things happened. When the resume names no
// occupation we can resolve, the rows are the industry bucket's and the
// heading stops claiming they match this resume.

import { useEffect, useState } from "react";
import { displaySalary } from "@/lib/salary-display";
import { accentFor } from "@/lib/category-accent";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Briefcase, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { rolesForIndustry } from "@/data/roles";
import { roundedFloor } from "@/hooks/use-board-totals";
import { INDUSTRY_TO_CATEGORY } from "@/lib/job-board-categories";

interface MatchJob {
  id: string;
  company: string;
  title: string;
  location: string;
  salary?: string | null;
  applyUrl: string;
  fit: number | null;
}

// TWENTY, THE SERVER'S CAP. job-fit slices `ids` to FIT_BATCH_MAX = 20 and
// scores nothing past it. This component used to send its thirty candidates in
// one call: ids 21-30 came back unscored, the sort put them under every scored
// row, and a third of the candidate set could never reach the top five.
// Mirrors FIT_BATCH in src/pages/Jobs.tsx.
const FIT_BATCH = 20;

// job-fit refuses a résumé shorter than this, so a shorter one is a round trip
// that can only 400. Mirrors the `resumeText.trim().length < 100` bound in
// supabase/functions/job-fit/index.ts.
const FIT_MIN_CHARS = 100;

/**
 * WHERE THE ROWS ON SCREEN CAME FROM — and therefore what the card may claim.
 *
 * `resume`: the board was searched for the occupation THIS résumé names, and
 * the heading may say the openings match it. `industry`: no occupation could
 * be read out of the résumé, so the rows are the industry bucket's — scored
 * against the résumé, but not found by it, and the copy says exactly that.
 */
type Retrieval = { by: "resume"; role: string } | { by: "industry" };

/**
 * RANKING IS NOT RETRIEVAL. Ask the résumé what it does for a living and
 * search the board for THAT, so the fit scores rank a candidate set worth
 * ranking. Returns the term to search, or "" when the résumé names no
 * occupation we know — the caller has to be able to tell the difference,
 * because "" is the case where the rows are not this résumé's.
 *
 * THE DEFECT THIS REPLACES: the query was `rolesForIndustry(industry)[0]`, the
 * first canonical title of a broad industry bucket. A pharmacist's report was
 * headed "Live openings matching this resume" over five Registered Nurse
 * openings — retrieved for a different occupation, then honestly scored as
 * poor matches. On the free scan report, the highest-traffic conversion
 * surface, that list is the reader's first impression of the product.
 *
 * Same call, same semantics as `retrieveForResume` in src/pages/Jobs.tsx: the
 * occupation is read server-side by resumeRoleTerms, so the recorded refusals
 * ride along for free — a strategy phrase like "go-to-market" is not an
 * occupation, a bare rank ("veteran", "manager") is not an occupation, and a
 * grade ("journeyman electrician") only shrinks the search. What comes back is
 * a job title or nothing.
 */
async function resumeRoleQuery(resumeText: string): Promise<string> {
  if (resumeText.trim().length < FIT_MIN_CHARS) return "";
  try {
    // job-fit, not job-board: the scorer has had its own isolate since
    // 2026-09-03, because sharing the ingest function's worker pool answered
    // 546 to readers who had done everything right.
    const { data } = await supabase.functions.invoke("job-fit", {
      body: { action: "fit-terms", resumeText },
    });
    const terms = ((data as { terms?: string[] } | null)?.terms ?? [])
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    return terms[0] ?? "";
  } catch {
    // Retrieval is the upgrade, not the feature. A failure here drops to the
    // industry fallback below — and the card's copy then stops claiming these
    // openings match this résumé, because they were not found by it.
    return "";
  }
}

export function LiveMatches({ resumeText, industry }: { resumeText: string; industry: string }) {
  const { t } = useTranslation();
  // NO EXTRA REQUEST FOR THE NUMBER. This component already calls the board;
  // its list response carries `total`, so the CTAs below read the count from a
  // round trip that was happening anyway. Adding useBoardTotals here would have
  // put a second board call on the free-report page — a hot path — to state a
  // figure the first call already returned.
  const [boardTotal, setBoardTotal] = useState<number | null>(null);
  const [matches, setMatches] = useState<MatchJob[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Candidates no scorer call answered for. Distinct from `failed` (the board
  // itself did not answer): the list arrived, the scorer did not. Shown as the
  // same "could not be scored just now" note the board page uses — never as a
  // list of unscored rows under a "fit-ranked" heading.
  const [fitFailedCount, setFitFailedCount] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // null until the retrieval above has answered — the window in which the card
  // shows a spinner and claims nothing about any posting.
  const [retrieval, setRetrieval] = useState<Retrieval | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // THE RÉSUMÉ IS ASKED FIRST, AND THE INDUSTRY IS THE FALLBACK — never
        // the other way round. Every other door into fit ranking on this site
        // retrieves before it ranks; this one scored whatever the industry's
        // first canonical title happened to return.
        const role = await resumeRoleQuery(resumeText);
        if (cancelled) return;
        const topRole = rolesForIndustry(industry)[0]?.title;
        const category = INDUSTRY_TO_CATEGORY[industry];
        // Résumé query first (this résumé's own occupation); the industry's
        // first canonical title for a résumé whose occupation cannot be
        // resolved; the category for an industry we carry no role pages for.
        const q = role || topRole;
        // THE CLAIM IS DERIVED FROM THE QUERY THAT WAS ACTUALLY SENT, not from
        // whether an occupation happened to resolve. Written the obvious way
        // — `role ? "resume" : "industry"` — the heading goes on saying "matching
        // this resume" for anyone who later reorders the two candidates above,
        // which is precisely the sentence that was false. Reading `q` back
        // means the claim cannot outlive the retrieval it describes.
        let by: Retrieval["by"] = q && q === role ? "resume" : "industry";
        const body = q
          ? { action: "list", q, limit: 30 }
          : { action: "list", category, limit: 30 };
        let { data: res } = await supabase.functions.invoke("job-board", { body });
        // Zero is a failed read, not a total: leaving it null keeps the CTAs on
        // their count-free copy rather than publishing "0 verified openings".
        const t0 = (res as { total?: number } | null)?.total;
        if (!cancelled && typeof t0 === "number" && t0 > 0) setBoardTotal(t0);
        let jobs: Array<Record<string, unknown>> = (res as { jobs?: [] })?.jobs ?? [];
        // WIDENING TO THE CATEGORY IS A DEMOTION, NOT A TOP-UP: it REPLACES the
        // candidate set with another occupation's jobs. Off a résumé query that
        // found something, three of the reader's own rows beat five of somebody
        // else's — showing somebody else's is the whole defect this card had.
        // Off the industry title (nothing to lose) the original "fewer than the
        // five we show" threshold stands.
        const thin = by === "resume" ? jobs.length === 0 : jobs.length < 5;
        if (thin && q && category) {
          ({ data: res } = await supabase.functions.invoke("job-board", { body: { action: "list", category, limit: 30 } }));
          jobs = (res as { jobs?: [] })?.jobs ?? [];
          by = "industry";
        }
        // Set before the rows exist, so no row is ever on screen under a
        // heading describing a retrieval that did not produce it.
        if (!cancelled) setRetrieval(by === "resume" && role ? { by, role } : { by: "industry" });
        if (jobs.length === 0) {
          if (!cancelled) setMatches([]);
          return;
        }
        // A FAILED SCORING RUN USED TO LOOK EXACTLY LIKE A SUCCESSFUL ONE.
        //
        // This destructured only `{ data }` from job-board's fit-batch — the
        // co-tenant copy whose shared worker pool answered 546
        // WORKER_RESOURCE_LIMIT. On that (or a 429, or a 500) `fits` became
        // {}, every fit null, and the first five rows in list order were
        // presented as "top matches for THIS resume, fit-ranked". Now: job-fit
        // (the scorer's own isolate since 2026-09-03), twenty ids a call, and a
        // batch that errors in transport OR answers 2xx without `fits` counts
        // its ids as unscored instead of unranked.
        const fits: Record<string, number | null> = {};
        let fitFailed = 0;
        for (let i = 0; i < jobs.length; i += FIT_BATCH) {
          const ids = jobs.slice(i, i + FIT_BATCH).map((j) => String(j.id));
          const { data, error } = await supabase.functions.invoke("job-fit", {
            body: { action: "fit-batch", resumeText, ids },
          });
          // Same payload Jobs.tsx reads; only `fits` is consumed here — the
          // report has no per-posting keyword panel to show missing/matched in.
          const payload = data as { fits?: Record<string, number | null>; missing?: Record<string, string[]>; matched?: Record<string, string[]>; code?: string } | null;
          if (error || !payload?.fits) {
            fitFailed += ids.length;
            continue;
          }
          Object.assign(fits, payload.fits);
        }
        const ranked = jobs
          // A row no scorer call answered for has no place in a fit-ranked
          // list. `null` is different: the scorer looked and the posting has
          // no stored description — an honest null, kept and sorted last.
          .filter((j) => String(j.id) in fits)
          .map((j) => ({
            id: String(j.id),
            company: String(j.company),
            title: String(j.title),
            location: String(j.location ?? ""),
            salary: (j.salary as string | null) ?? null,
            applyUrl: String(j.applyUrl),
            fit: fits[String(j.id)] ?? null,
          }))
          .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1))
          .slice(0, 5);
        // Feature 4 (re-verify surfaced matches): the top few are what the
        // reader will actually click — confirm they're still live right now
        // and drop any the company just closed, so a surfaced match is never
        // a dead link. Unverifiable ones are kept (never a false close).
        let shown = ranked;
        if (ranked.length > 0) {
          try {
            const { data: vr } = await supabase.functions.invoke("job-board", {
              body: { action: "verify", ids: ranked.map((r) => r.id) },
            });
            const live = (vr as { live?: Record<string, boolean> })?.live;
            if (live) shown = ranked.filter((r) => live[r.id] !== false);
          } catch { /* verify unavailable — show the fit-ranked set as-is */ }
        }
        if (!cancelled) {
          setFitFailedCount(fitFailed);
          setMatches(shown);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [industry, attempt]);

  // Same retry the board page offers: a scoring failure is a transient
  // (measured live, a batch that failed scored 60/60 on retry), and saying so
  // is the difference between a blip and "this feature does nothing".
  const retry = () => {
    setMatches(null);
    setFitFailedCount(0);
    // The retry re-runs the retrieval too, so the claim is re-earned rather
    // than carried over from the attempt that failed.
    setRetrieval(null);
    setAttempt((a) => a + 1);
  };

  // On a BOARD failure (the list itself, or the daily fit-ranking rate limit
  // a heavy user can genuinely hit) the MATCHES go quietly absent — but the
  // board handoff must survive: it makes no per-posting claims, and losing
  // the report's strongest next step over a hiccup is a worse failure. An
  // empty list with unscored candidates is NOT this case: the reader is told
  // below what could not be scored, with a way to try again.
  if (failed || (matches !== null && matches.length === 0 && fitFailedCount === 0)) {
    return (
      <div className="mb-4">
        <Link
          to="/jobs"
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-r from-primary via-primary to-blue-500 text-primary-foreground font-bold px-5 py-3.5 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 active:scale-[0.99] transition-all"
        >
          {/* DERIVED, AND INTERPOLATED. A literal here is a claim frozen when it
              was typed: this said "600,000+ verified openings", which is the
              TRACKED total under the SERVABLE noun. The number is a parameter so
              a translated copy cannot bake a stale one in either. */}
          {boardTotal
            ? t("freeResults.matches.openBoardFallbackLive", "Open the live job board — {{n}}+ verified openings, ranked against your resume", { n: roundedFloor(boardTotal).toLocaleString() })
            : t("freeResults.matches.openBoardFallbackPlain", "Open the live job board — verified openings, ranked against your resume")}
          <ArrowRight className="w-4 h-4 shrink-0" />
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-4">
      {/* THE HEADING IS A CLAIM ABOUT THE RETRIEVAL, NOT A CONSTANT. It read
          "matching this resume" over rows retrieved for the industry bucket's
          first canonical title — a pharmacist's report, headed that way, over
          Registered Nurse openings. Three states, and only one of them says
          the openings match this résumé:
            · still retrieving — the card claims nothing and shows a spinner;
            · retrieved BY the résumé — the occupation it names is quoted, so
              the reader can see the query and disagree with it;
            · retrieved by the industry — said plainly: scored against this
              résumé, not found by it. */}
      <div className="flex items-center gap-2 mb-1">
        <Briefcase className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-foreground">
          {retrieval === null
            ? t("freeResults.matches.titleSearching", "Finding live openings for this resume")
            : retrieval.by === "resume"
              ? t("freeResults.matches.title", "Live openings matching this resume")
              : t("freeResults.matches.titleIndustry", "Live openings in your field")}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {retrieval === null
          ? t("freeResults.matches.subtitle", "Ranked by the same deterministic fit scoring as your report — from live company job boards, continuously re-verified against each company's official feed.")
          : retrieval.by === "resume"
            ? t("freeResults.matches.subtitleSearched", "Searched live company job boards for {{role}} — the occupation this resume names — then ranked by the same deterministic fit scoring as your report.", { role: retrieval.role })
            : t("freeResults.matches.subtitleIndustry", "We couldn't read a job title from this resume, so these are current openings in your field — scored against your resume, not found by it. Search the board yourself to narrow them.")}
      </p>

      {matches === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("freeResults.matches.loading", "Ranking live openings against your resume…")}
        </div>
      ) : (
        <>
          {matches.length > 0 && (
            <ul className="space-y-2 mb-3">
              {matches.map((m) => (
                <li key={m.id} style={{ borderLeft: `3px solid ${accentFor((m as { category?: string | null }).category)}` }} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2">
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-medium text-foreground leading-snug">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.company}
                      {m.location ? ` · ${m.location}` : ""}
                      {m.salary ? <span className="text-success font-medium" title={m.salary}> · {displaySalary(m.salary)}</span> : null}
                    </p>
                  </div>
                  {typeof m.fit === "number" && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold shrink-0 ${m.fit >= 20 ? "bg-success/10 text-success" : m.fit >= 10 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>
                      {t("jobsPage.fitBadge", "fit {{pct}}%", { pct: m.fit })}
                    </span>
                  )}
                  <a
                    href={m.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                  >
                    {t("freeResults.matches.apply", "Apply")}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {/* A SCORING FAILURE IS RETRYABLE, AND SAYING SO IS THE DIFFERENCE
              BETWEEN A BLIP AND "THIS FEATURE DOES NOTHING". Same copy, same
              button as the board page: the reader learns what was not scored
              and can press again, instead of reading five unranked rows as
              their matches — or concluding the product is broken. */}
          {fitFailedCount > 0 && (
            <p className="text-[11px] text-warning mb-3">
              {t("jobsPage.fitFailedNote", "{{n}} postings could not be scored just now — this is usually temporary.", { n: fitFailedCount })}{" "}
              <button
                type="button"
                onClick={retry}
                className="underline hover:text-foreground"
              >
                {t("jobsPage.fitRetry", "Try again")}
              </button>
            </p>
          )}
          {/* The flywheel moment: the scan just finished and the board already
              knows this resume — For-you mode auto-enables on arrival. Make the
              handoff a destination, not a footnote link. */}
          <Link
            to="/jobs"
            className="flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-r from-primary via-primary to-blue-500 text-primary-foreground font-bold px-5 py-3.5 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 active:scale-[0.99] transition-all"
          >
            {t("freeResults.matches.openBoard", "Open your ranked board — every opening scored against this resume")}
            <ArrowRight className="w-4 h-4 shrink-0" />
          </Link>
          <p className="text-[11px] text-muted-foreground text-center mt-2">
            {boardTotal
              ? t("freeResults.matches.openBoardNoteLive", "{{n}}+ verified openings · save searches, watch companies, track applications", { n: roundedFloor(boardTotal).toLocaleString() })
              : t("freeResults.matches.openBoardNotePlain", "Verified openings · save searches, watch companies, track applications")}
          </p>
        </>
      )}
    </div>
  );
}
