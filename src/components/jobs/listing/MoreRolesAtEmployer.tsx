/**
 * "MORE ROLES AT {EMPLOYER}" ON THE POSTING PAGE — ONE LAZY READ, OR NONE.
 *
 * The posting page is the board's prerendered crawler surface and every
 * visitor's read of it is counted against the daily allowance, so this list
 * costs at most ONE list call (four roles, this posting left out), and only
 * once the section scrolls into view. A browser without IntersectionObserver
 * makes no call at all: the section still offers the link to every open role
 * at the employer, which needs none. A standing board-allowance refusal makes
 * no call either — the page already knows the answer would be a refusal, and
 * a refusal is never retried.
 *
 * A failed read is silent here: the link stays, nothing claims the employer
 * has no other roles.
 *
 * ONE EMPLOYER OR NO SECTION. The list is asked by board token, and a token is
 * not an employer: two hiring systems can carry the same token for two
 * different companies (src/lib/board-collisions.ts: "clear" is BambooHR's
 * Clear and Greenhouse's CLEAR - Corporate), and every USAJOBS row shares the
 * token "usajobs" across hundreds of agencies. The cards hide their employer
 * line under a heading that names one employer, so a row from anyone else
 * would be printed as this employer's role. So:
 *   - on a collided token or on USAJOBS the section does not render at all
 *     (moreRolesAllowed), and the page does not mount it;
 *   - as a backstop, only rows from the posting's own hiring system whose
 *     employer name is the posting's are kept; if the reply held anyone
 *     else's row, the "see every open role" link is left out too (the token's
 *     page is not one employer's), and with no row left the section goes.
 *
 * A CARD OPENS THE ROLE IT NAMES, AND ONLY A PAGE THE BAKE WROTE IS FOLLOWED
 * (CRAWL-M1). The four rows are almost never among the postings the bake
 * writes (429 in the sitemap production served on 2026-11-21), and an
 * unwritten posting address serves the fallback file and then renders a page
 * the bake never checked. The first fix sent every such card to the
 * employer's page, so a person who picked a role was handed a list of roles,
 * and after a mixed reply the card was no link at all (review of 2026-11-21).
 * A card now always links its own role: its posting page, or the board's
 * address for it when its id cannot be a page path. The link is followed only
 * when /posting-pages.json names the page live
 * (src/lib/seo/posting-manifest.ts); otherwise, and until that file has
 * loaded, it carries rel="nofollow". People reach the role, and crawlers are
 * asked to follow only the pages the bake wrote: the rule the employer's name
 * keeps (companyProfileLink, SEO-010). An unwritten address is noindex from
 * the fallback's first script (SEO-F10). No card links the employer's page,
 * so a mixed reply, where that page is the token's and also lists the other
 * employer's roles, changes nothing a card links.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { boardBudgetRefusal, markBoardBudgetRefused, readBoardBudgetRefusal } from "@/lib/board-budget";
import { invokeJobBoard } from "@/lib/invoke-job-board";
import { useCompanyBoardHref } from "@/lib/seo/lander-manifest";
import { useBakedPostingPath } from "@/lib/seo/posting-manifest";
import { postingPagePath } from "@/components/jobs/posting-page";
import { moreRolesAllowed, sameEmployerRows } from "@/lib/listing/more-roles";
import type { ListingJob } from "@/lib/listing/types";
import { JobCard } from "./JobCard";

/** Roles shown; one more is asked for so the current posting can be dropped without leaving a gap. */
export const MORE_ROLES_SHOWN = 4;

/**
 * Where a card sends its reader, and whether a crawler may follow: the
 * role's own address always, followed only when `baked` (the manifest's
 * answer for a path) names its posting page.
 */
function cardLink(
  id: string,
  baked: (path: string | null | undefined) => string | null,
): { href: string; rel?: "nofollow" } {
  const own = postingPagePath(id);
  const written = baked(own);
  if (written) return { href: written };
  return { href: own ?? `/jobs?job=${encodeURIComponent(id)}`, rel: "nofollow" };
}

export function MoreRolesAtEmployer({ token, employer, excludeId, source = null }: {
  token: string;
  employer: string;
  excludeId: string;
  /** The posting's hiring system (job_board_postings.source). */
  source?: string | null;
}) {
  const { t } = useTranslation();
  // SEO-010: an employer link goes to its written company page, or to the
  // live board filtered to the board when the bake wrote none.
  const companyHref = useCompanyBoardHref();
  // CRAWL-M1: a card's link is followed only when the bake wrote its page and it is live.
  const bakedPath = useBakedPostingPath();
  const ref = useRef<HTMLElement | null>(null);
  const [rows, setRows] = useState<ListingJob[] | null>(null);
  const [mixed, setMixed] = useState(false);
  const [loading, setLoading] = useState(false);
  const asked = useRef(false);
  const allowed = moreRolesAllowed(token, source);

  useEffect(() => {
    const node = ref.current;
    if (!allowed || !node || asked.current) return;
    if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") return;
    let cancelled = false;
    const observer = new window.IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || asked.current) return;
      asked.current = true;
      observer.disconnect();
      if (boardBudgetRefusal()) return;
      setLoading(true);
      void (async () => {
        try {
          const res = await invokeJobBoard<{ jobs?: ListingJob[] }>({
            body: { action: "list", companies: [token], limit: MORE_ROLES_SHOWN + 1, sort: "newest", includeFacets: false },
          });
          if (res.error) {
            const refused = await readBoardBudgetRefusal(res.error);
            if (refused) markBoardBudgetRefused(refused);
            return;
          }
          const jobs = Array.isArray(res.data?.jobs) ? res.data!.jobs : [];
          const kept = sameEmployerRows(jobs, { source, employer, excludeId });
          if (!cancelled) {
            setMixed(kept.mixed);
            setRows(kept.rows.slice(0, MORE_ROLES_SHOWN));
          }
        } catch {
          /* silent: the link below needs no read */
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, { rootMargin: "200px 0px" });
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); };
  }, [allowed, token, excludeId, source, employer]);

  if (!allowed) return null;
  // Anyone else's row came back under this token and none of this employer's:
  // there is nothing this heading may truthfully list, and no single page to send the reader to.
  if (mixed && rows && rows.length === 0) return null;

  return (
    <section ref={ref} className="mt-10 border-t border-border pt-6" data-more-roles="" aria-labelledby="more-roles-heading">
      <h2 id="more-roles-heading" className="mb-3 text-lg font-semibold text-foreground">
        {t("listing.more.heading", { defaultValue: "More roles at {{employer}}", employer })}
      </h2>
      {loading && <p className="text-sm text-muted-foreground" role="status">{t("listing.more.loading", "Loading more roles…")}</p>}
      {rows && rows.length > 0 && (
        <ul className="mb-4 space-y-2">
          {rows.map((job) => {
            const link = cardLink(job.id, bakedPath);
            return (
              <JobCard
                key={job.id}
                job={job}
                href={link.href}
                hrefRel={link.rel}
                ctx={{ surface: "posting", density: "compact", hideEmployer: true, selected: false }}
              />
            );
          })}
        </ul>
      )}
      {!mixed && (
        <Link to={companyHref(token)} className="text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary" data-more-roles-all="">
          {t("listing.more.seeAll", { defaultValue: "See every open role at {{employer}}", employer })}
        </Link>
      )}
    </section>
  );
}
