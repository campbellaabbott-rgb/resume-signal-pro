// /companies — the human half of the directory. The crawler half is a
// prerendered A–Z page (prerender-seo.mjs) linking every company page, built
// because 387 of them sat in the sitemap linked from no page at all. This
// React page takes over after hydration: the board's live top employers plus
// the full count, each linking into the board filtered to that employer.
//
// THE DIRECTORY'S OWN WORDS (design spec 5.7, 2026-10-12): every figure is
// formatted in the reader's language and every string reads from the company
// shard in all nine languages. "Verified" is gone from the title: a board is
// read from the employer's own hiring system, which is the claim this page can
// stand behind.
//
// NOT "NO AGGREGATORS". The list includes USAJOBS, which the company page
// itself calls a federal listing site, not an employer
// (usajobs-is-a-listing-site-not-an-employer.test.tsx), and staffing-agency
// boards, so the intro says whose systems these are instead of a blanket
// "no aggregators, no reposts".
//
// EVERY COUNT IS DATED. The heading's board count and each row's open roles
// come from the board's last count pass (the reply's refreshedAt), and the
// page says when that was. A reply that carries no such time prints no
// counts at all: names only.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { ago as fmtAgo, count as fmtCount } from "@/lib/company/format";
import { tPlural } from "@/lib/company/plural";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { invokeJobBoard } from "@/lib/invoke-job-board";
import { boardBudgetRefusal, markBoardBudgetRefused, readBoardBudgetRefusal, useBoardBudgetRefusal } from "@/lib/board-budget";
import { BoardBudgetNotice } from "@/components/jobs/BoardBudgetNotice";
import { COMPANY_SCOPE_MAX } from "@/lib/company-scope";

// `open` — the SERVABLE per-employer count, under BOTH serving predicates
// (not withdrawn, dated inside the last 30 days: migration 20260909214000).
//
// THIS SHAPE IS NOT A STYLE CHOICE AND IT IS NOT BoardResponse's. It is
// hand-written here, and that is exactly why this page kept rendering
// `count.toLocaleString()` after the board stopped sending `count` at all —
// tsc had nothing to compare it against. `count` is deliberately absent below
// so that re-adding a read of it is a compile error on this page too.
//
// OPTIONAL: a facet pass written before that migration carries no servable
// number, and then this row prints the employer's name alone rather than a
// figure the page it links to would contradict.
// `tokens` — present only where the row IS a group: mergeCompanyFacet folds an
// employer's sub-boards into one row and SUMS `open` across them, and the
// board's `company` filter takes the comma-joined group (same contract as
// scopeTokensOf on /jobs). Linking the primary token alone printed a sum the
// destination could not serve.
interface CompanyChip { token: string; name: string; open?: number; tokens?: string[] }

/** The scope a row's `open` was summed over — the whole group when the server
 *  sent one, the single token otherwise — and whether the link can CARRY it.
 *
 *  The /jobs lander keeps at most COMPANY_SCOPE_MAX tokens of a `?company=`
 *  list, so a group past that is cut at the destination, silently: the row
 *  would print a sum over N boards above a link that serves the first 12.
 *  The link is cut HERE instead, where it can be said, and `complete` tells
 *  the row whether its figure still describes what the link serves. It does
 *  not when the group was cut — and a number that describes a different
 *  scope than the one under it is withheld, not printed. Exported so the
 *  guard can walk it. */
export function companyRowScope(c: { token: string; tokens?: string[] }): { tokens: string[]; complete: boolean } {
  const group = Array.isArray(c.tokens) && c.tokens.length > 1
    ? c.tokens.filter((t): t is string => typeof t === "string" && t !== "")
    : [c.token];
  const tokens = group.slice(0, COMPANY_SCOPE_MAX);
  return { tokens, complete: tokens.length === group.length };
}
/** The tokens the row links — the group, cut to what the lander keeps. */
export function companyLinkScope(c: { token: string; tokens?: string[] }): string[] {
  return companyRowScope(c).tokens;
}

export default function Companies() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const [companies, setCompanies] = useState<CompanyChip[]>([]);
  const [openBoards, setOpenBoards] = useState<number | null>(null);
  const [countedAt, setCountedAt] = useState<string | null>(null);
  // A board-budget refusal rendered as an empty list read as "no companies";
  // it is the board pausing this connection, and the notice says so.
  const budgetRefusal = useBoardBudgetRefusal();

  useEffect(() => {
    let cancelled = false;
    if (boardBudgetRefusal()) return;
    invokeJobBoard({ body: { action: "list", limit: 1, includeFacets: true } })
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          const refused = await readBoardBudgetRefusal(error);
          if (refused) markBoardBudgetRefused(refused);
          return;
        }
        // NEVER companiesCount. That is the length of the UNFILTERED
        // company_token grouping — the array the orphan prune DELETES by, which
        // is why it is left unfiltered — so it counts boards whose every
        // posting has been withdrawn or has aged out of the 30-day window. This
        // page's H1 says "hiring now" over it. companiesOpenCount is boards
        // with at least one OPEN posting, taken in the same pass under the same
        // two rules as the openings count every other surface publishes.
        //
        // Absent (an older cached pass) means NOT MEASURED, so the heading
        // drops its number rather than falling back to the larger one.
        const d = data as { companies?: CompanyChip[]; companiesOpenCount?: number; refreshedAt?: string | null } | null;
        if (Array.isArray(d?.companies)) setCompanies(d.companies.filter((c) => c?.token && c?.name));
        if (typeof d?.companiesOpenCount === "number" && d.companiesOpenCount > 0) setOpenBoards(d.companiesOpenCount);
        if (typeof d?.refreshedAt === "string" && Number.isFinite(Date.parse(d.refreshedAt))) setCountedAt(d.refreshedAt);
      })
      .catch(() => { /* the count-free copy below stands */ });
    return () => { cancelled = true; };
  }, []);

  // The date the counts are true as of; without one no count is printed.
  const counted = countedAt ? fmtAgo(countedAt, { lng: lang }) : "";

  return (
    <>
      <SEO
        title={t("companyProfile.directory.seoTitle", "Companies Hiring Now — Live Jobs From Their Own Hiring Systems")}
        description={t("companyProfile.directory.seoDescription", "Every employer on the board is read straight from its own hiring system. Browse the largest boards, or search the live board.")}
        path="/companies"
      />
      <Header />
      <main className="min-h-screen pt-24 pb-20">
        <div className="container max-w-4xl">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground mb-3">
            {/* BOARDS, NOT EMPLOYERS. One employer can run several feed tokens
                (PwC ships five Workday sub-sites; 76 such employers in the top
                1,500 alone), and the display-name merge happens after this
                count — so "N companies" over it would overstate employers. */}
            {openBoards && counted
              ? tPlural(t, "companyProfile.directory.h1Count", openBoards, { n: fmtCount(openBoards, { lng: lang }) }, "{{n}} company job board hiring now", "{{n}} company job boards hiring now")
              : t("companyProfile.directory.h1", "Companies hiring now")}
          </h1>
          {budgetRefusal && <BoardBudgetNotice refusal={budgetRefusal} variant="banner" />}
          <p className="text-muted-foreground mb-8">
            {t("companyProfile.directory.intro2", "Each board is read from its own hiring system: most are employers' own, staffing-agency boards are labelled on their pages, and USAJOBS is the federal government's listing site, where agencies post their roles. The largest boards are below.")}{" "}
            <Link to="/jobs" className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
              {t("companyProfile.directory.searchLink", "Search the live board")}
            </Link>{" "}
            {t("companyProfile.directory.searchTail", "to filter any employer by role, pay, or location.")}
          </p>
          {/* Under the intro, not above it: the line arrives with the reply,
              and above the intro it pushed the paragraph down under the
              reader (CLS 0.008 -> 0.025 at 375px). Here it arrives with the
              list it dates. */}
          {counted && (openBoards || companies.some((c) => typeof c.open === "number")) ? (
            <p className="-mt-5 mb-4 text-sm text-muted-foreground" data-directory-counted="">
              {t("companyProfile.directory.countedAgo", "Counts from the board's last count, {{ago}}.", { ago: counted })}
            </p>
          ) : null}
          {companies.length > 0 && (
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm">
              {companies.map((c) => (
                <li key={c.token}>
                  <Link to={`/jobs?company=${encodeURIComponent(companyLinkScope(c).join(","))}`} className="inline-block py-0.5 text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
                    {c.name}
                  </Link>{" "}
                  {/* ONLY WHEN THE LINK SERVES THE WHOLE GROUP `open` was
                      summed over; a cut group prints the name alone. */}
                  {counted && typeof c.open === "number" && companyRowScope(c).complete
                    ? <span className="text-muted-foreground">— {tPlural(t, "companyProfile.directory.rowOpen", c.open, { n: fmtCount(c.open, { lng: lang }) }, "{{n}} open role", "{{n}} open roles")}</span>
                    : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
