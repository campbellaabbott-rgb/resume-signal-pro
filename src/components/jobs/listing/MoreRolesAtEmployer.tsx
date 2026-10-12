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
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { boardBudgetRefusal, markBoardBudgetRefused, readBoardBudgetRefusal } from "@/lib/board-budget";
import { invokeJobBoard } from "@/lib/invoke-job-board";
import { companyLanderPath } from "@/lib/public-href";
import { postingPagePath } from "@/components/jobs/posting-page";
import { moreRolesAllowed, sameEmployerRows } from "@/lib/listing/more-roles";
import type { ListingJob } from "@/lib/listing/types";
import { JobCard } from "./JobCard";

/** Roles shown; one more is asked for so the current posting can be dropped without leaving a gap. */
export const MORE_ROLES_SHOWN = 4;

export function MoreRolesAtEmployer({ token, employer, excludeId, source = null }: {
  token: string;
  employer: string;
  excludeId: string;
  /** The posting's hiring system (job_board_postings.source). */
  source?: string | null;
}) {
  const { t } = useTranslation();
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
          {rows.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              href={postingPagePath(job.id) ?? companyLanderPath(token)}
              ctx={{ surface: "posting", density: "compact", hideEmployer: true, selected: false }}
            />
          ))}
        </ul>
      )}
      {!mixed && (
        <Link to={companyLanderPath(token)} className="text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary" data-more-roles-all="">
          {t("listing.more.seeAll", { defaultValue: "See every open role at {{employer}}", employer })}
        </Link>
      )}
    </section>
  );
}
