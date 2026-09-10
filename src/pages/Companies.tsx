// /companies — the human half of the directory. The crawler half is a
// prerendered A–Z page (prerender-seo.mjs) linking every company page, built
// because 387 of them sat in the sitemap linked from no page at all. This
// React page takes over after hydration: the board's live top employers plus
// the full count, each linking into the board filtered to that employer.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
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
  const [companies, setCompanies] = useState<CompanyChip[]>([]);
  const [openBoards, setOpenBoards] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.functions
      .invoke("job-board", { body: { action: "list", limit: 1, includeFacets: true } })
      .then(({ data }) => {
        if (cancelled) return;
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
        const d = data as { companies?: CompanyChip[]; companiesOpenCount?: number } | null;
        if (Array.isArray(d?.companies)) setCompanies(d.companies.filter((c) => c?.token && c?.name));
        if (typeof d?.companiesOpenCount === "number" && d.companiesOpenCount > 0) setOpenBoards(d.companiesOpenCount);
      })
      .catch(() => { /* the count-free copy below stands */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <SEO
        title="Companies Hiring Now — Verified Job Boards"
        description="Every employer on the board pulls straight from its own official career system and is re-verified all day. Browse the largest, or search the live board."
        path="/companies"
      />
      <Header />
      <main className="min-h-screen pt-24 pb-20">
        <div className="container max-w-4xl">
          <h1 className="text-3xl font-bold mb-3">
            {/* BOARDS, NOT EMPLOYERS. One employer can run several feed tokens
                (PwC ships five Workday sub-sites; 76 such employers in the top
                1,500 alone), and the display-name merge happens after this
                count — so "N companies" over it would overstate employers. */}
            {openBoards ? `${openBoards.toLocaleString()} company job boards hiring now` : "Companies hiring now"}
          </h1>
          <p className="text-muted-foreground mb-8">
            Every posting comes from the employer's own hiring system — no aggregators, no reposts.
            The largest boards are below;{" "}
            <Link to="/jobs" className="text-primary underline">search the live board</Link>{" "}
            to filter any employer by role, pay, or location.
          </p>
          {companies.length > 0 && (
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm">
              {companies.map((c) => (
                <li key={c.token}>
                  <Link to={`/jobs?company=${encodeURIComponent(companyLinkScope(c).join(","))}`} className="text-primary hover:underline">
                    {c.name}
                  </Link>{" "}
                  {/* ONLY WHEN THE LINK SERVES THE WHOLE GROUP `open` was
                      summed over; a cut group prints the name alone. */}
                  {typeof c.open === "number" && companyRowScope(c).complete
                    ? <span className="text-muted-foreground">— {c.open.toLocaleString()} open roles</span>
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
