/**
 * ONE CARD FOR EVERY LIST OF POSTINGS — the board, the company page (no
 * employer line: the page is the employer) and the posting page's "more roles"
 * list (compact).
 *
 * Four rows, each answering one question:
 *   1. WHAT IS IT?      the title (the open-details link) and Save
 *   2. WHO AND WHERE?   the employer, linking to its page; the place, split
 *                       only outside parentheses; the department, decoded
 *   3. WHY CARE?        pay in plain strong type with its period, our "≈"
 *                       annual figure only when the period is known, the work
 *                       mode (trinary or nothing), the employment type when
 *                       stated
 *   4. WHY BELIEVE IT?  "{System} · feed read 46 min ago", then "posted 3 days
 *                       ago" ONLY for a date the employer's system states and
 *                       does not move. Undated: no age and no first-seen date.
 *
 * At most two chips: the agency-board disclosure first, then the slots the
 * board fills on /jobs alone (a layoff filing, the employer's hiring record,
 * the field-horizon note). A company page passes none — the employer's record
 * is printed once, in its header, never on every card.
 *
 * "Check fit" is a quiet link; Report, Hide, Compare, Open in Claude or
 * ChatGPT and Copy link live in the ⋯ menu. Apply lives in the pane, beside
 * the facts it should be read with.
 */
import { Fragment, type LiHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { decodeListingText, listingTitle } from "@/lib/listing/text";
import { companyLanderPath } from "@/lib/public-href";
import { listingSource } from "@/lib/listing/age";
import { systemLabel } from "@/lib/listing/apply-url";
import { listingEmployer } from "@/lib/listing/employer";
import { countryToName, displayLocation } from "@/lib/listing/location";
import { listingPay, PAY_BASIS_FALLBACK } from "@/lib/listing/pay";
import { EMPLOYMENT_TYPE_FALLBACK, statedEmploymentType, statedWorkMode, type ListingJob } from "@/lib/listing/types";
import { AgencyBoardChip } from "./AgencyBoardChip";
import { agoText, cardAgeText, periodSuffix } from "./listing-text";
import { PostingMenu, type PostingMenuActions } from "./PostingMenu";

/** contracts.ts CardContext. */
export interface CardContext {
  surface: "board" | "company" | "posting";
  density: "compact" | "comfortable";
  hideEmployer: boolean;
  selected: boolean;
}

/** The reader's fit: a keyword-coverage percentage, or the scorer's honest "no description to score". */
export type JobCardFit = { kind: "score"; pct: number } | { kind: "unscored" };

export interface JobCardSlots {
  /** /jobs only: the employer's gated hiring-record chip. */
  employerChip?: ReactNode;
  /** /jobs only: the employer's newest qualifying layoff filing. */
  layoffChip?: ReactNode;
  /** Extension: "Up longer than most {field} roles last". */
  fieldChip?: ReactNode;
  /** Extension: the board's same-role-elsewhere expander. */
  siblings?: ReactNode;
}

export interface JobCardProps {
  job: ListingJob;
  ctx: CardContext;
  /** The crawlable address of this posting (the board's /jobs?job=…, or the posting page). */
  href: string;
  fit?: JobCardFit | null;
  fitKeywords?: { have: string[]; missing: string[] };
  saved?: boolean;
  applied?: boolean;
  viewed?: boolean;
  slots?: JobCardSlots;
  /** "keyboard" when the open came from Enter on the title link. */
  onOpen?: (job: ListingJob, how: "click" | "keyboard") => void;
  onToggleSave?: (job: ListingJob) => void;
  onCheckFit?: (job: ListingJob) => void;
  checkFitBusy?: boolean;
  menu?: PostingMenuActions;
  /** Board plumbing (hover prefetch, swipe handlers) spread onto the list item. */
  liProps?: LiHTMLAttributes<HTMLLIElement>;
  now?: Date;
}

/** A modified click asks the BROWSER for the link (new tab, new window); only the plain click opens the pane. */
export function opensInNewContext(e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number }): boolean {
  return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) || (e.button ?? 0) !== 0;
}

/** Fit tiers, calibrated on live data (Jobs.tsx): ~20%+ coverage is a strong same-field résumé. */
export function fitTier(pct: number): "strong" | "possible" | "stretch" {
  return pct >= 20 ? "strong" : pct >= 10 ? "possible" : "stretch";
}

function Dotted({ items, className }: { items: ReactNode[]; className: string }) {
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <p className={className}>
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true" className="px-1.5 text-muted-foreground">·</span>}
          {item}
        </Fragment>
      ))}
    </p>
  );
}

export function JobCard({
  job, ctx, href, fit, fitKeywords, saved, applied, viewed, slots = {}, onOpen, onToggleSave, onCheckFit, checkFitBusy,
  menu, liProps, now,
}: JobCardProps) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "en";
  const title = listingTitle(job.title);
  const employer = listingEmployer(job);
  const loc = displayLocation(job.location);
  const country = countryToName(loc.text, job.country, lng);
  const department = decodeListingText(job.department);
  const pay = listingPay(job, lng);
  const mode = statedWorkMode(job);
  const type = statedEmploymentType(job.employmentType);
  const system = systemLabel(listingSource(job));
  const read = job.missingSince ? null : agoText(t, job.recheckedAt, lng, now);
  const age = cardAgeText(t, job, now);
  const compact = ctx.density === "compact";
  const chips = [
    job.agency === true ? <AgencyBoardChip key="agency" /> : null,
    ...(ctx.surface === "board" ? [slots.layoffChip, slots.employerChip, slots.fieldChip] : [slots.fieldChip]),
  ].filter(Boolean).slice(0, 2);
  const tier = fit?.kind === "score" ? fitTier(fit.pct) : null;

  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    if (!onOpen || opensInNewContext(e)) return;
    e.preventDefault();
    onOpen(job, e.detail === 0 ? "keyboard" : "click");
  };

  const fold = (job.locationCount ?? 1) > 1
    ? t("jobsPage.alsoInLocations", {
        count: (job.locationCount ?? 1) - 1,
        defaultValue_one: "Also hiring in {{count}} more location",
        defaultValue_other: "Also hiring in {{count}} more locations",
      }) + ((job.otherLocations ?? []).length > 0 ? `: ${(job.otherLocations ?? []).slice(0, 3).map((l) => displayLocation(l).text ?? l).join(", ")}` : "")
    : (job.postingCount ?? 1) > 1
      ? t("jobsPage.sameLocationOpenings", { defaultValue: "{{count}} openings at this location", count: job.postingCount })
      : null;

  return (
    <li
      data-job-id={job.id}
      aria-current={ctx.selected ? "true" : undefined}
      {...liProps}
      className={`group relative min-w-0 rounded-lg border bg-card ${compact ? "px-4 py-2.5" : "p-4"} ${
        ctx.selected ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border hover:border-primary/60"
      } ${onOpen ? "cursor-pointer" : ""} ${liProps?.className ?? ""}`}
      onClick={(e) => {
        liProps?.onClick?.(e);
        if (!onOpen || e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("button, a, select, input, label, [role='menu']")) return;
        onOpen(job, "click");
      }}
    >
      <div className="flex min-w-0 items-start gap-3">
        {ctx.surface === "board" && (
          <div aria-hidden="true" className="hidden h-9 w-9 shrink-0 select-none items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground sm:flex">
            {(employer || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1">
            <h3 className="min-w-0 flex-1 text-base font-semibold leading-snug sm:text-sm">
              <Link
                to={href}
                onClick={open}
                title={title}
                className={`line-clamp-2 break-words hover:underline focus-visible:underline ${viewed && !ctx.selected ? "text-muted-foreground" : "text-foreground"}`}
              >
                {title}
              </Link>
            </h3>
            {/* 36px targets that do not push the employer line down: the
                negative margin keeps the row as tall as the title. */}
            <div className="-my-1.5 -mr-2 flex shrink-0 items-center">
            {onToggleSave && (
              <button
                type="button"
                aria-pressed={!!saved}
                aria-label={t("listing.card.save", { defaultValue: "Save {{title}}", title })}
                title={saved ? t("jobsPage.savedTip", "In your application tracker — click to open it") : t("jobsPage.saveTip", "Save this posting to your application tracker")}
                onClick={(e) => { e.stopPropagation(); onToggleSave(job); }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {saved ? <BookmarkCheck className="h-5 w-5 text-primary" aria-hidden="true" /> : <Bookmark className="h-5 w-5" aria-hidden="true" />}
              </button>
            )}
            {menu && <PostingMenu job={job} title={title} menu={menu} />}
            </div>
          </div>

          <Dotted
            className="mt-0.5 flex flex-wrap items-baseline text-sm text-muted-foreground"
            items={[
              !ctx.hideEmployer && employer
                ? job.token
                  ? <Link key="e" to={companyLanderPath(job.token)} onClick={(e) => e.stopPropagation()} className="text-foreground hover:underline">{employer}</Link>
                  : <span key="e" className="text-foreground">{employer}</span>
                : null,
              loc.text ? <span key="l" title={loc.raw !== loc.text ? loc.raw ?? undefined : undefined}>{loc.text}</span> : null,
              country ? <span key="c">{country}</span> : null,
              department ? <span key="d">{department}</span> : null,
            ]}
          />
          {fold && <p className="mt-0.5 text-xs text-muted-foreground" title={(job.otherLocations ?? []).join(" · ") || undefined}>{fold}</p>}

          <Dotted
            className="mt-1.5 flex flex-wrap items-baseline text-sm text-foreground"
            items={[
              pay ? (
                <span key="p" className="font-semibold text-foreground" title={pay.raw}>
                  {pay.text}
                  {pay.currencyCode && <span className="font-normal text-muted-foreground"> ({pay.currencyCode})</span>}
                  {pay.basis && <span className="font-normal text-muted-foreground"> · {t(`jobsPage.payBasis.${pay.basis}`, PAY_BASIS_FALLBACK[pay.basis])}</span>}
                </span>
              ) : null,
              pay?.annual ? (
                <span
                  key="a"
                  className="text-muted-foreground"
                  title={t("jobsPage.annualizedBasisTip", "Our arithmetic, not the employer's: an hourly rate × 2,080 hours (40 hours a week, 52 weeks), a daily rate × 260 days, a monthly rate × 12. The figure to its left is what the posting actually says.")}
                >
                  {t("listing.card.annualEstimate", { defaultValue: "≈ {{amount}}{{period}}", amount: pay.annual, period: periodSuffix(t, "year") })}
                </span>
              ) : null,
              mode ? (
                <span key="m" title={t("jobsPage.workModeProvenance", "Work mode as the employer states it — the option they chose in their own hiring system, or their own words on the posting: its title, its location or its department. Where those disagree, or where none of them states a mode, the posting shows none: silence is never read as on-site.")}>
                  {t(`jobsPage.workMode.${mode}`, mode)}
                </span>
              ) : null,
              type ? (
                <span key="t" title={t("jobsPage.employmentTypeProvenance", "Employment type as the employer states it on its own careers feed. Postings whose feed states no type show no tag — never a guess.")}>
                  {t(`jobsPage.employmentType.${type}`, EMPLOYMENT_TYPE_FALLBACK[type])}
                </span>
              ) : null,
            ]}
          />

          {job.snippet && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {t("jobsPage.matchedInDesc", "In the description:")}{" "}
              …{job.snippet.split(/\[\[|\]\]/).map((part, i) =>
                i % 2 === 1 ? <mark key={i} className="rounded bg-primary/20 px-0.5 text-foreground">{part}</mark> : <Fragment key={i}>{part}</Fragment>)}…
            </p>
          )}
          {(job.closeMatch || job.semanticMatch || job.matchScope === "description") && (
            <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {job.closeMatch && <span className="rounded-md border border-warning/50 px-2 py-0.5 text-warning">{t("jobsPage.closeMatchChip", "close match")}</span>}
              {job.semanticMatch && !job.closeMatch && <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">{t("jobsPage.semanticMatchChip", "related by meaning")}</span>}
              {job.matchScope === "description" && !job.closeMatch && <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">{t("jobsPage.descriptionMatchChip", "in description")}</span>}
            </p>
          )}

          <Dotted
            className="mt-1.5 flex flex-wrap items-baseline text-xs text-muted-foreground"
            items={[
              system || read ? (
                <span key="r" title={read ? t("listing.card.feedReadTip", "When we last read this employer's own job feed. A posting the employer takes down leaves the board at the next read of its feed.") : undefined} data-card-read="">
                  {system && read
                    ? t("listing.card.feedRead", { defaultValue: "{{system}} · feed read {{ago}}", system, ago: read })
                    : read
                      ? t("listing.card.feedReadNoSystem", { defaultValue: "Feed read {{ago}}", ago: read })
                      : system}
                </span>
              ) : null,
              age ? <span key="g" data-card-age="">{age}</span> : null,
            ]}
          />

          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              {chips.map((chip, i) => <Fragment key={i}>{chip}</Fragment>)}
            </div>
          )}

          {(tier || fit?.kind === "unscored" || applied || onCheckFit) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {tier && fit?.kind === "score" && (
                <span className="font-semibold text-foreground" title={t("jobsPage.matchCoverage", { defaultValue: "{{pct}}% of this posting's recognized keywords are already in your resume", pct: fit.pct })}>
                  {tier === "strong" ? t("jobsPage.matchStrong", "Strong match") : tier === "possible" ? t("jobsPage.matchPossible", "Possible match") : t("jobsPage.matchStretch", "Stretch")}
                </span>
              )}
              {!tier && fit?.kind === "unscored" && (
                <span className="rounded-md border border-dashed border-border px-2 py-0.5 text-muted-foreground" title={t("jobsPage.notScoredTip", "We hold no stored description for this posting, so there was nothing to compare your resume against. This is not a low score — it is no score.")}>
                  {t("jobsPage.notScoredChip", "Not scored")}
                </span>
              )}
              {applied && <span className="font-medium text-success">✓ {t("jobsPage.appliedBadge", "Applied")}</span>}
              {onCheckFit && !tier && (
                <button
                  type="button"
                  disabled={checkFitBusy}
                  aria-label={t("listing.card.checkFitLabel", { defaultValue: "Check your fit for {{title}}", title })}
                  onClick={(e) => { e.stopPropagation(); onCheckFit(job); }}
                  className="min-h-6 text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary disabled:cursor-wait"
                >
                  {t("listing.card.checkFit", "Check fit")}
                </button>
              )}
            </div>
          )}
          {!compact && fitKeywords && (fitKeywords.have.length > 0 || fitKeywords.missing.length > 0) && (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {fitKeywords.have.length > 0 && <><span className="font-medium text-foreground">{t("jobsPage.youHave", "You already have:")}</span> {fitKeywords.have.join(", ")}</>}
              {fitKeywords.have.length > 0 && fitKeywords.missing.length > 0 && " · "}
              {fitKeywords.missing.length > 0 && <><span className="font-medium text-foreground">{t("jobsPage.addToCompete", "Add to compete:")}</span> {fitKeywords.missing.join(", ")}</>}
            </p>
          )}
        </div>
      </div>
      {slots.siblings}
    </li>
  );
}
