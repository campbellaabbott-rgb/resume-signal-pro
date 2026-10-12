/**
 * The pane's sticky header: the title, the employer (linking to its company
 * page), the place, the ⋯ menu and ONE close control with a name. On a
 * company page a "Back to {name}" control sits above it (the pane replaced
 * the employer rail, and this is the way back to it).
 *
 * The title is cleaned and decoded here (listingTitle decodes named and
 * numeric entities, then folds a doubled leading phrase), so a row that
 * reaches the pane without the board's normalizeRow still prints "R&D
 * Engineer – Batteries", not "R&amp;D Engineer &#8211; Batteries".
 */
import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { listingTitle } from "@/lib/listing/text";
import { companyLanderPath } from "@/lib/public-href";
import { countryToName, displayLocation } from "@/lib/listing/location";
import { listingEmployer } from "@/lib/listing/employer";
import type { ListingJob } from "@/lib/listing/types";
import { PostingMenu, type PostingMenuActions } from "./PostingMenu";

export interface PostingHeaderProps {
  job: ListingJob;
  level?: 1 | 2;
  sticky?: boolean;
  /** Hidden on a company page, where the page itself is the employer. */
  hideEmployer?: boolean;
  menu?: PostingMenuActions;
  onClose?: () => void;
  back?: { label: string; onBack: () => void };
  /** The board leaves the pane before following the employer link (Jobs.tsx leavePanelFor). */
  onEmployerClick?: (e: MouseEvent<HTMLAnchorElement>, href: string) => void;
}

export function PostingHeader({ job, level = 2, sticky = true, hideEmployer, menu, onClose, back, onEmployerClick }: PostingHeaderProps) {
  const { t, i18n } = useTranslation();
  const title = listingTitle(job.title) || t("jobPostingPage.genericHeading", "Job posting");
  const employer = listingEmployer(job);
  const loc = displayLocation(job.location);
  const country = countryToName(loc.text, job.country, i18n.language || "en");
  const place = [loc.text, country].filter(Boolean).join(" · ");
  const href = job.token ? companyLanderPath(job.token) : null;
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className={`${sticky ? "sticky top-0 z-20" : ""} border-b border-border bg-background px-4 py-3 sm:px-5`} data-posting-header="">
      {back && (
        <button
          type="button"
          onClick={back.onBack}
          className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {back.label}
        </button>
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Heading className={`${level === 1 ? "text-3xl" : "text-xl"} break-words font-semibold leading-snug tracking-tight text-foreground`}>{title}</Heading>
          {(!hideEmployer || place) && (
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {!hideEmployer && employer && (href ? (
                <Link
                  to={href}
                  className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
                  onClick={onEmployerClick ? (e) => onEmployerClick(e, href) : undefined}
                >
                  {employer}
                </Link>
              ) : <span className="text-foreground">{employer}</span>)}
              {!hideEmployer && employer && place ? " · " : null}
              {place}
            </p>
          )}
        </div>
        {menu && <PostingMenu job={job} title={title} menu={menu} />}
        {onClose && (
          <button
            type="button"
            aria-label={t("jobsPage.detailClose", "Close")}
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}
