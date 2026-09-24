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
 * fill the schema; an unstated salary is an absent property and the page says
 * the employer stated none.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Building2, ExternalLink, Loader2, MapPin } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  BOARD_FRESH_WINDOW_DAYS,
  isPostingLive,
  jdParagraphs,
  POSTING_LD_TAG_ID,
  postingIdFromParams,
  postingJsonLd,
  postingPageDescription,
  postingPagePath,
  postingPageTitle,
  type PostingRow,
} from "@/components/jobs/posting-page";

const SITE = "https://resumebooster.work";

/**
 * Our JSON-LD element, and the one the bake wrote: the same slot, never two.
 * The id is declared in the shared module because the bake has to write the
 * same one — it used to be declared here alone, and the bake wrote its block
 * with no id, so this took over nothing.
 */
const LD_TAG_ID = POSTING_LD_TAG_ID;

type LoadState = "loading" | "ready" | "gone" | "failed";

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
  const seq = useRef(0);

  useEffect(() => {
    if (!id) return;
    const mine = ++seq.current;
    setState("loading");
    (async () => {
      // One quiet retry: a refresh slice hitting the function's resource
      // ceiling can bounce a single request off the worker pool.
      let res = await supabase.functions.invoke("job-board", { body: { action: "detail", id } });
      if (res.error || res.data == null) {
        await new Promise((r) => setTimeout(r, 1200));
        res = await supabase.functions.invoke("job-board", { body: { action: "detail", id } });
      }
      if (seq.current !== mine) return;
      const data = res.data as { job?: PostingRow | null; description?: string | null } | null;
      if (res.error || !data) {
        setState("failed");
        return;
      }
      const row = data.job ?? null;
      setJob(row);
      setDescription(typeof data.description === "string" ? data.description : null);
      // A row we cannot find, and a row that is no longer live, are the same
      // answer to the only question this URL asks.
      setState(row && isPostingLive(row) ? "ready" : "gone");
    })().catch(() => {
      if (seq.current === mine) setState("failed");
    });
  }, [id, attempt]);

  const live = state === "ready" && !!job;

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
  const ld = useMemo(
    () => (live && job ? postingJsonLd(job, description, { site: SITE }) : null),
    [live, job, description],
  );
  useEffect(() => {
    clearJobMarkup();
    if (!ld) return;
    const tag = document.createElement("script");
    tag.type = "application/ld+json";
    tag.id = LD_TAG_ID;
    tag.textContent = JSON.stringify(ld);
    document.head.appendChild(tag);
    return () => { clearJobMarkup(); };
  }, [ld]);

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
    if (state !== "gone") return;
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
  }, [state]);

  if (legacyId) {
    return legacyTarget
      ? <Navigate to={legacyTarget} replace />
      : <Navigate to="/jobs" replace />;
  }
  if (!id) return <Navigate to="/jobs" replace />;

  const paragraphs = description ? jdParagraphs(description) : [];
  const path = postingPagePath(id) ?? "/jobs";
  const company = (job?.company ?? "").trim();
  const heading = live && job?.title ? job.title : t("jobPostingPage.genericHeading", "Job posting");
  const seoTitle = live && job ? postingPageTitle(job) : t("jobPostingPage.goneTitle", "This posting is no longer live");
  const seoDescription = live && job
    ? postingPageDescription(job)
    : t(
        "jobPostingPage.goneMeta",
        "This opening is no longer served by the employer's own job board. Search the live board for openings like it.",
      );

  return (
    <>
      {/* The crawl directive for a gone posting is set on the tag the bake
          already wrote (see the effect above), never as a second one here. */}
      <SEO title={seoTitle} description={seoDescription} path={path} />
      <Header />
      <main className="min-h-screen pt-24 pb-20">
        <div className="container max-w-3xl">
          <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("jobPostingPage.backToBoard", "All openings")}
          </Link>

          {state === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("jobPostingPage.loading", "Loading this posting…")}
            </p>
          )}

          {state === "failed" && (
            <div className="rounded-xl border border-border bg-card p-6">
              <p className="text-sm text-muted-foreground mb-3">
                {t("jobPostingPage.loadFailed", "We couldn't load this posting just now.")}
              </p>
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                {t("jobPostingPage.retry", "Try again")}
              </Button>
            </div>
          )}

          {state === "gone" && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h1 className="text-2xl font-bold mb-3">
                {t("jobPostingPage.goneTitle", "This posting is no longer live")}
              </h1>
              <p className="text-sm text-muted-foreground mb-4">
                {t("jobPostingPage.goneBody", {
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

          {live && job && (
            <article>
              <h1 className="text-3xl font-bold tracking-tight mb-3">{heading}</h1>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mb-6">
                {company && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" />
                    {job.token
                      ? <Link to={`/jobs/company/${job.token}`} className="text-primary hover:underline">{company}</Link>
                      : company}
                  </span>
                )}
                {job.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {job.location}
                  </span>
                )}
                {job.workMode === "remote" && <span>{t("jobPostingPage.remote", "Remote")}</span>}
              </div>

              {/* EVERY LINE NAMES ITS BASIS, AND AN ABSENT FACT IS SAID TO BE
                  ABSENT rather than filled in. A date here is the employer's
                  own stated date; pay is the employer's own words, verbatim
                  and unconverted. */}
              <dl className="grid gap-2 text-sm mb-8 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{t("jobPostingPage.postedLabel", "Posted")}</dt>
                  <dd className="text-foreground">
                    {job.postedAt
                      ? t("jobPostingPage.postedValue", {
                          defaultValue: "{{date}}, as stated by the employer",
                          date: job.postedAt.slice(0, 10),
                        })
                      : t("jobPostingPage.noDate", "This employer states no posting date, so this page states none.")}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{t("jobPostingPage.payLabel", "Pay")}</dt>
                  <dd className="text-foreground">
                    {job.salary
                      ? t("jobPostingPage.payValue", {
                          defaultValue: "{{salary}} — the employer's own words, not converted or estimated",
                          salary: job.salary,
                        })
                      : t("jobPostingPage.noPay", "This employer states no pay on this posting.")}
                  </dd>
                </div>
              </dl>

              {job.applyUrl && (
                <div className="mb-8">
                  <Button asChild size="lg">
                    <a href={job.applyUrl} target="_blank" rel="noopener noreferrer nofollow">
                      {company
                        ? t("jobPostingPage.applyCta", { defaultValue: "Apply on {{company}}'s own site", company })
                        : t("jobPostingPage.applyCtaPlain", "Apply on the employer's own site")}
                      <ExternalLink className="w-4 h-4 ml-1.5" />
                    </a>
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t(
                      "jobPostingPage.applyNote",
                      "The application happens on the employer's own hiring system. This board never reposts a job or stands between you and them.",
                    )}
                  </p>
                </div>
              )}

              {paragraphs.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold mb-3">
                    {t("jobPostingPage.descHeading", "The employer's own description")}
                  </h2>
                  <div className="max-w-[72ch] space-y-3 text-sm text-muted-foreground leading-7 whitespace-pre-line">
                    {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
                  </div>
                </section>
              )}

              {/* NOT PRINTED OVER A STAFFING AGENCY. The sentence is
                  categorical — "never an aggregator, never a repost" — and the
                  board itself distinguishes agencies: `agency` is NOT NULL on
                  every row, rides the list payload, and has a documented
                  opt-out filter and a badge. On an agency row the claim is
                  false and the employer named above it is the agency, not the
                  employer hiring. A claim we cannot make is omitted rather than
                  softened, which needs no new copy to be honest. The bake goes
                  further and gives an agency row no static page at all. */}
              {job.agency !== true && (
                <p className="text-xs text-muted-foreground mt-10">
                  {t("jobPostingPage.sourceNote", {
                    defaultValue:
                      "Pulled straight from {{company}}'s own hiring system — never an aggregator, never a repost. A dated posting is served for at most {{days}} days and is dropped the moment the employer's feed stops serving it.",
                    company: company || t("jobPostingPage.theEmployer", "the employer"),
                    days: BOARD_FRESH_WINDOW_DAYS,
                  })}
                </p>
              )}
            </article>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
