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
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { boardBudgetRefusal, markBoardBudgetRefused, readBoardBudgetRefusal } from "@/lib/board-budget";
import { invokeJobBoard } from "@/lib/invoke-job-board";
import { companyLanderPath } from "@/lib/public-href";
import { postingPagePath } from "@/components/jobs/posting-page";
import type { ListingJob } from "@/lib/listing/types";
import { JobCard } from "./JobCard";

/** Roles shown; one more is asked for so the current posting can be dropped without leaving a gap. */
export const MORE_ROLES_SHOWN = 4;

export function MoreRolesAtEmployer({ token, employer, excludeId }: { token: string; employer: string; excludeId: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement | null>(null);
  const [rows, setRows] = useState<ListingJob[] | null>(null);
  const [loading, setLoading] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || asked.current) return;
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
          if (!cancelled) setRows(jobs.filter((j) => j && typeof j.id === "string" && j.id !== excludeId).slice(0, MORE_ROLES_SHOWN));
        } catch {
          /* silent: the link below needs no read */
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, { rootMargin: "200px 0px" });
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); };
  }, [token, excludeId]);

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
      <Link to={companyLanderPath(token)} className="text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
        {t("listing.more.seeAll", { defaultValue: "See every open role at {{employer}}", employer })}
      </Link>
    </section>
  );
}
