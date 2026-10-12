/**
 * /jobs/posting/<source>/<token>/<requisition> — ONE POSTING AS A PAGE.
 *
 * WHAT WAS WRONG. A posting on this board had no address. It opens in a dialog
 * over the list, so the only handle on it was a query parameter, and a query
 * parameter is not a page. Measured 2026-09-23 with a Googlebot user-agent:
 * /jobs?job=<id> returned the same 12,377 bytes as /jobs — MD5 identical, and
 * identical again for an id that does not exist — carrying the board's title,
 * the board's description, a canonical naming /jobs, and no JobPosting markup
 * anywhere in the served bytes. 767,391 posting URLs of that shape were being
 * advertised to crawlers at the time. A posting could not be linked, indexed,
 * cited or handed to an answer engine as itself.
 *
 * WHAT THIS IS. The posting's own URL, its own title and heading, its own
 * description, its own canonical, and its own structured data — written into
 * static HTML by scripts/prerender-seo.mjs for the bounded set it bakes, and
 * rendered live here for every other id. Both sides compute every fact from
 * src/components/jobs/posting-page.ts, so the file a crawler reads and the page
 * a person sees cannot say different things.
 *
 * WHAT IT REFUSES TO DO. A posting that the employer's feed stopped serving, or
 * that has passed the board's serving window, is not shown as live: the page
 * says it is gone, marks the URL unindexable, and carries no job markup at all
 * — one of the sanctioned ways to retract a posting. No field is invented to
 * fill the schema; a salary we could not read is an absent property, and the
 * page says WE found none — never that the employer stated none.
 *
 * AN UNDATED POSTING IS NOT A GONE ONE (job-listings audit JL1, 2026-10-11).
 * The page used to ask isPostingLive, the bake's question, which answers false
 * for any posting the employer did not date — so 15 audited live postings were
 * told they were "no longer live" and noindexed while the board served them.
 * Liveness is now three states (src/lib/listing/liveness.ts): gone, window
 * closed, live. An undated live posting renders as live, keeps whatever crawl
 * directive its file shipped and carries no JobPosting markup (datePosted is
 * required, and inventing one is the thing this page refuses); whether to
 * index those pages is the SEO group's call.
 *
 * ONE VOCABULARY WITH THE BOARD. The title, the facts, the decision row and the
 * description are the listing components the board's pane uses
 * (src/components/jobs/listing), so the page a crawler indexes and the pane a
 * seeker reads print one posting the same way.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { companyLanderPath } from "@/lib/public-href";
import { useTranslation } from "react-i18next";
import { ChevronRight, Loader2 } from "lucide-react";
import { canHandOff, writeJdHandoff } from "@/lib/jd-handoff";
import { postTrackEvent } from "@/lib/track-transport";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { invokeJobBoard } from "@/lib/invoke-job-board";
import { boardBudgetRefusal, httpStatusOf, markBoardBudgetRefused, readBoardBudgetRefusal, type BoardBudgetRefusal } from "@/lib/board-budget";
import { BoardBudgetNotice } from "@/components/jobs/BoardBudgetNotice";
import {
  BOARD_FRESH_WINDOW_DAYS,
  POSTING_LD_TAG_ID,
  postingIdFromParams,
  postingJsonLd,
  postingPageDescription,
  postingPagePath,
  postingPageTitle,
  type PostingRow,
} from "@/components/jobs/posting-page";
import { possessive } from "@/lib/company-display";
import { postingLiveness, shownPosting } from "@/lib/listing/liveness";
import { listingEmployer } from "@/lib/listing/employer";
import { PostingDetail } from "@/components/jobs/listing/PostingDetail";
import { MoreRolesAtEmployer } from "@/components/jobs/listing/MoreRolesAtEmployer";

const SITE = "https://resumebooster.work";

/**
 * Our JSON-LD element, and the one the bake wrote: the same slot, never two.
 * The id is declared in the shared module because the bake has to write the
 * same one — it used to be declared here alone, and the bake wrote its block
 * with no id, so this took over nothing.
 */
const LD_TAG_ID = POSTING_LD_TAG_ID;

/** "budget": the board's daily allowance for this connection is spent -- never "gone", never retried.
 *  "gone": the row we hold says it is not live, or the closure log saw it go.
 *  "unlisted": no row and no recorded closure (a 404, past our cap, a hidden row) --
 *  retracted all the same, but with no claim about the employer's own board. */
type LoadState = "loading" | "ready" | "gone" | "unlisted" | "failed" | "budget";

/**
 * Take every JobPosting entity out of the head — the one this page wrote under
 * its own id, and any the bake left there under none. Parsing rather than
 * matching on text is deliberate: the head also carries WebSite and
 * BreadcrumbList blocks on the same page and those are not ours to touch.
 */
function clearJobMarkup(): void {
  for (const node of [...document.head.querySelectorAll('script[type="application/ld+json"]')]) {
    if (node.id === LD_TAG_ID) { node.remove(); continue; }
    try {
      const parsed = JSON.parse(node.textContent || "");
      if (parsed && parsed["@type"] === "JobPosting") node.remove();
    } catch { /* not JSON we wrote; leave it exactly where it is */ }
  }
}

export default function JobPosting() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ source?: string; token?: string; key?: string; id?: string }>();

  // THE ONE-SEGMENT FORM IS A COMPATIBILITY ROUTE, NOT A SECOND PAGE.
  // A board id spelled straight into one path segment carries colons. This app
  // resolves it, but it is never baked, never linked and never in a sitemap:
  // it redirects to the three-segment URL, which is the only canonical one.
  const legacyId = params.id ?? null;
  const id = postingIdFromParams(params.source, params.token, params.key);
  const legacyTarget = legacyId ? postingPagePath(legacyId) : null;

  const [job, setJob] = useState<PostingRow | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  const [budget, setBudget] = useState<BoardBudgetRefusal | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!id) return;
    const mine = ++seq.current;
    setState("loading");
    // A REFUSAL IS NOT A FAILURE AND NOT A CLOSURE. The board's per-connection
    // allowance resets at 00:00 UTC: no retry can succeed before then, and the
    // posting is not gone -- so neither "Try again" nor noindex applies.
    const refusedWith = (r: BoardBudgetRefusal) => {
      markBoardBudgetRefused(r);
      if (seq.current !== mine) return;
      setBudget(r);
      setState("budget");
    };
    (async () => {
      const standing = boardBudgetRefusal();
      if (standing) { refusedWith(standing); return; }
      // One quiet retry: a refresh slice hitting the function's resource
      // ceiling can bounce a single request off the worker pool.
      let res = await invokeJobBoard({ body: { action: "detail", id } });
      if (res.error || res.data == null) {
        const refused = await readBoardBudgetRefusal(res.error);
        if (refused) { refusedWith(refused); return; }
        // A 404 IS THE BOARD'S ANSWER, NOT A FAILURE: "Posting not found (it
        // may have closed)". Retrying it was a second counted read, and
        // rendering it as a retryable "couldn't load" kept a soft 404 indexed.
        if (httpStatusOf(res.error) === 404) {
          if (seq.current === mine) setState("unlisted");
          return;
        }
        await new Promise((r) => setTimeout(r, 1200));
        res = await invokeJobBoard({ body: { action: "detail", id } });
      }
      if (seq.current !== mine) return;
      const data = res.data as { job?: PostingRow | null; description?: string | null; closed?: unknown } | null;
      if (res.error || !data) {
        const refused = await readBoardBudgetRefusal(res.error);
        if (refused) { refusedWith(refused); return; }
        setState(httpStatusOf(res.error) === 404 ? "unlisted" : "failed");
        return;
      }
      const row = data.job ?? null;
      setJob(row);
      setDescription(typeof data.description === "string" ? data.description : null);
      // A row we cannot find, and a row that is no longer live, are the same
      // answer to the only question this URL asks -- but only a watched
      // closure says anything about the employer's own board. "Live" is the
      // three-state answer: an undated row the board still serves is live.
      setState(row ? (postingLiveness(row) === "live" ? "ready" : "gone") : data.closed ? "gone" : "unlisted");
    })().catch(() => {
      if (seq.current === mine) setState("failed");
    });
  }, [id, attempt]);

  const live = state === "ready" && !!job;
  const retracted = state === "gone" || state === "unlisted";

  // THE MARKUP LIVES IN ONE ELEMENT, WHOEVER WROTE IT.
  // The baked file already carries a block in the head under this id. Writing a
  // second one from React would leave two competing entities for one URL, so
  // this takes over the same slot and clears it when the posting is not live —
  // which is itself how a retracted posting is meant to be retracted.
  //
  // IT CLEARS BY TYPE, NOT ONLY BY ID. The id is the contract with the bake and
  // the bake keeps it, but a file written by an older bake — or reached through
  // a cached shell — carries an untagged JobPosting block, and leaving that one
  // standing is the whole defect: a live posting described twice, and a
  // retracted one still marked up under a heading saying it is gone. Anything
  // in the head that claims to be a JobPosting is ours to clear before we
  // write, and the block we write is the only one that may survive.
  //
  // AN UNDATED LIVE POSTING CARRIES NONE. datePosted is a required property
  // and the employer stated no date, so there is nothing true to put there;
  // the block is cleared (an older file may have carried one) and nothing is
  // written in its place.
  const shown = useMemo(() => (job ? shownPosting(job) : null), [job]);
  const dated = !!shown?.postedAt;
  const ld = useMemo(
    () => (live && shown && dated ? postingJsonLd(shown, description, { site: SITE }) : null),
    [live, shown, dated, description],
  );
  //
  // ONLY "GONE" RETRACTS. While loading, after a failed read and under a
  // budget refusal the posting may well be live, and clearing the baked block
  // then told every early renderer it was not — so the head is left exactly
  // as the bake wrote it until there is an answer either way.
  useEffect(() => {
    if (retracted) { clearJobMarkup(); return; }
    if (live && !dated) { clearJobMarkup(); return; }
    if (!ld) return;
    clearJobMarkup();
    const tag = document.createElement("script");
    tag.type = "application/ld+json";
    tag.id = LD_TAG_ID;
    tag.textContent = JSON.stringify(ld);
    document.head.appendChild(tag);
    return () => { clearJobMarkup(); };
  }, [ld, retracted, live, dated]);
  // Leaving the page takes any posting markup with it, baked or ours.
  useEffect(() => () => { clearJobMarkup(); }, []);

  // A URL whose posting is gone must not stay indexable. Refusing to index is
  // the only per-URL expiry signal a statically hosted SPA can emit — there is
  // no status-code lever on this host — and it is applied symmetrically so it
  // can never linger over a live posting in the same tab.
  //
  // IT REWRITES THE TAG THE BAKE ALREADY WROTE RATHER THAN ADDING ONE. Every
  // prerendered file ships the template's own crawl directive, so appending a
  // second leaves the page carrying two contradictory ones and lets the crawler
  // choose — which is not a choice to hand away on a page we deliberately want
  // dropped. The previous value is restored on the way out.
  useEffect(() => {
    if (!retracted) return;
    const tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!tag) {
      const added = document.createElement("meta");
      added.name = "robots";
      added.content = "noindex";
      document.head.appendChild(added);
      return () => { added.remove(); };
    }
    const previous = tag.getAttribute("content");
    tag.setAttribute("content", "noindex");
    return () => { if (previous !== null) tag.setAttribute("content", previous); };
  }, [retracted]);

  // A VISIT TO A LIVE POSTING, so "scans per 100 job-page visits" has its
  // denominator. Once per tab session (the transport's repeat rule).
  const viewedPath = live && id ? postingPagePath(id) : null;
  useEffect(() => {
    if (!viewedPath) return;
    postTrackEvent({ testName: "job_page", variant: "posting_view", eventType: "view", metadata: { page: viewedPath } });
  }, [viewedPath]);

  if (legacyId) {
    return legacyTarget
      ? <Navigate to={legacyTarget} replace />
      : <Navigate to="/jobs" replace />;
  }
  if (!id) return <Navigate to="/jobs" replace />;

  const path = postingPagePath(id) ?? "/jobs";
  // The employer by the name it uses, not its vendor tenant code (F1) — the
  // same function the board's card and pane ask (one name on every surface).
  const company = job?.company ? listingEmployer(job) : "";
  const companyPossessive = company ? possessive(company) : "";
  // THE SCANNER ALREADY READS A HAND-OFF (Index.tsx, the board's "Check my
  // fit"): this page holds the description, so it hands it over directly.
  const canScore = live && canHandOff(description);
  const scoreAgainstThisJob = () => {
    if (!job || !description) return;
    if (!writeJdHandoff({ jd: description, title: shown?.title ?? undefined, company: company || undefined, applyUrl: job.applyUrl ?? undefined })) return;
    postTrackEvent({ testName: "job_page", variant: "score_against_job", eventType: "view", metadata: { page: path } });
    navigate("/#upload");
  };
  // THE GONE COPY IS FOR "GONE" ONLY. It used to cover every state that was
  // not ready, so a renderer that snapshotted while loading, after a transient
  // failure or under a budget refusal read "This posting is no longer live" as
  // the title of a live posting. Until there is an answer the page renders no
  // head of its own and the baked one stands.
  const seoTitle = live && shown ? postingPageTitle(shown) : t("jobPostingPage.goneTitle", "This posting is no longer live");
  const seoDescription = live && shown
    ? postingPageDescription(shown)
    : state === "unlisted"
      ? t(
          "jobPostingPage.unlistedMeta",
          "No longer listed on this board — that says nothing about the employer, and it may still be open on their own site. Search the live board for similar openings.",
        )
      : t(
          "jobPostingPage.goneMeta",
          "This opening is no longer served by the employer's own job board. Search the live board for openings like it.",
        );

  return (
    <>
      {/* The crawl directive for a gone posting is set on the tag the bake
          already wrote (see the effect above), never as a second one here. */}
      {(live || retracted) && <SEO title={seoTitle} description={seoDescription} path={path} />}
      <Header />
      <main id="main-content" tabIndex={-1} className="min-h-screen pb-20 pt-24 focus:outline-none">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          {/* Jobs › {Employer} › {Title}: where this posting sits, each step a link but the last. */}
          <nav aria-label={t("listing.page.breadcrumb", "Breadcrumb")} className="mb-6 text-sm">
            <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
              <li>
                <Link to="/jobs" className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
                  {t("listing.page.jobs", "Jobs")}
                </Link>
              </li>
              {live && shown && company && shown.token && (
                <>
                  <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
                  <li className="min-w-0">
                    <Link to={companyLanderPath(shown.token)} className="break-words text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
                      {company}
                    </Link>
                  </li>
                </>
              )}
              {live && shown?.title && (
                <>
                  <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
                  <li className="min-w-0 truncate text-foreground" aria-current="page">{shown.title}</li>
                </>
              )}
            </ol>
          </nav>

          {state === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("jobPostingPage.loading", "Loading this posting…")}
            </p>
          )}

          {state === "budget" && budget && <BoardBudgetNotice refusal={budget} />}

          {state === "failed" && (
            <div className="rounded-lg border border-border bg-card p-6">
              <p className="mb-3 text-sm text-muted-foreground">
                {t("jobPostingPage.loadFailed", "We couldn't load this posting just now.")}
              </p>
              <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                {t("jobPostingPage.retry", "Try again")}
              </Button>
            </div>
          )}

          {retracted && (
            <div className="rounded-lg border border-border bg-card p-6">
              <h1 className="mb-3 text-2xl font-semibold">
                {t("jobPostingPage.goneTitle", "This posting is no longer live")}
              </h1>
              <p className="mb-4 text-sm text-muted-foreground">
                {state === "unlisted"
                  ? t("jobPostingPage.unlistedBody", "This board no longer lists this posting. That says nothing about the employer — it may still be open on their own site.")
                  : t("jobPostingPage.goneBody", {
                    defaultValue:
                      "Either the employer's own job board stopped serving it, or it passed the {{days}} days this board serves a dated posting for. Nothing here is kept live after that.",
                    days: BOARD_FRESH_WINDOW_DAYS,
                  })}
              </p>
              <Button asChild size="sm">
                <Link to="/jobs">{t("jobPostingPage.goneCta", "Search the live board")}</Link>
              </Button>
            </div>
          )}

          {live && shown && (
            <>
              {/* THE BOARD'S OWN VOCABULARY. Title, place, the decision row,
                  the facts (each with its basis: the employer's stated date or
                  the sentence that it states none; pay from the employer's feed
                  or OUR reading that found none; the work mode with the line
                  that says whose statement it is) and the description, from
                  the components the board's pane renders. */}
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <PostingDetail
                  job={shown}
                  surface="page"
                  description={{ text: description, state: description ? "loaded" : "unavailable" }}
                  showPayAbsence
                  onCheckFit={canScore ? scoreAgainstThisJob : undefined}
                  sectionsOpen={99}
                  descriptionHeading={
                    <h2 className="mb-3 text-lg font-semibold text-foreground">
                      {t("jobPostingPage.descHeading", "The employer's own description")}
                    </h2>
                  }
                />
              </div>

              {/* NOT PRINTED OVER A STAFFING AGENCY. The sentence is
                  categorical — "never an aggregator, never a repost" — and the
                  board itself distinguishes agencies: `agency` is NOT NULL on
                  every row, rides the list payload, and has a documented
                  opt-out filter and a badge. On an agency row the claim is
                  false and the employer named above it is the agency, not the
                  employer hiring. A claim we cannot make is omitted rather than
                  softened, which needs no new copy to be honest. The bake goes
                  further and gives an agency row no static page at all. */}
              {shown.agency !== true && (
                <p className="mt-6 text-xs text-muted-foreground">
                  {t("jobPostingPage.sourceNote", {
                    defaultValue:
                      "Pulled straight from {{companyPossessive}} own hiring system — never an aggregator, never a repost. A dated posting is served for at most {{days}} days from the date the employer states, and the board re-checks a posting when you open it.",
                    company: company || t("jobPostingPage.theEmployer", "the employer"),
                    companyPossessive: companyPossessive || t("jobPostingPage.theEmployerPossessive", "the employer's"),
                    days: BOARD_FRESH_WINDOW_DAYS,
                  })}
                </p>
              )}

              {/* ONE LAZY READ, on scroll, of four more roles at this employer. */}
              {shown.token && company && <MoreRolesAtEmployer token={shown.token} employer={company} excludeId={shown.id} />}
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
