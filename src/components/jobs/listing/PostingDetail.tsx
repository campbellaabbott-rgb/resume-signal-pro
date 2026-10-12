/**
 * ONE POSTING, READ — the board's pane, the company page's pane, the phone
 * sheet's body and the posting page's article, from one component.
 *
 * Order, top to bottom: the header; where the posting stands at its source;
 * the decision (Apply on the employer's site, filled; the free fit check;
 * Save); the facts; what the employer's public records say, kept apart from
 * the facts of the job; how applying works; the employer's description; and
 * the employer context.
 *
 * Everything the board computes from its own state — the fit score, the
 * decision summary, the closure-record line, the layoff and filed-wage lines,
 * the Ontario panel, similar openings — arrives as a slot, so this file holds
 * no fetch and no board state and can be mounted from a fixture.
 */
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { listingEmployer } from "@/lib/listing/employer";
import type { ListingJob, OpenRolesValue } from "@/lib/listing/types";
import { LiveStatus, type ListingServed } from "./LiveStatus";
import { PostingActions } from "./PostingActions";
import { PostingDescription, type ListingDescription } from "./PostingDescription";
import { PostingFacts } from "./PostingFacts";
import { PostingHeader } from "./PostingHeader";
import type { PostingMenuActions } from "./PostingMenu";

export type PostingSurface = "board" | "company" | "sheet" | "page";

export interface PostingDetailSlots {
  employerContext?: ReactNode;
  layoffLine?: ReactNode;
  lcaLine?: ReactNode;
  ontario?: ReactNode;
  applicationAnswers?: ReactNode;
  agentHandoff?: ReactNode;
  /** Extension: the design system's HowApplyingWorks, built by the caller with its own facts. */
  howApplying?: ReactNode;
  /** Extension: the board's inline fit score / not-scored notice. */
  fit?: ReactNode;
  /** Extension: the board's decision summary ("What the data says") and posting-age comparison. */
  decision?: ReactNode;
  /** Extension: the field's pay benchmark, inside the Pay row. */
  payContext?: ReactNode;
  /** Extension: similar openings on the board. */
  similar?: ReactNode;
}

export interface OpenRolesLink {
  count: OpenRolesValue;
  href: string;
  name: string;
  /** The board narrows its own list instead of navigating (it sets the company filter). */
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

export interface PostingDetailProps {
  job: ListingJob;
  surface: PostingSurface;
  description: ListingDescription;
  /** Defaults to the row's own missingSince / recheckedAt. */
  served?: ListingServed;
  slots?: PostingDetailSlots;
  openRolesLink?: OpenRolesLink | null;
  back?: { label: string; onBack: () => void };
  onApply?: () => void;
  onCheckFit?: () => void;
  checkFitBusy?: boolean;
  onClose?: () => void;
  menu?: PostingMenuActions;
  saved?: boolean;
  onToggleSave?: () => void;
  highlight?: { have: string[]; missing: string[] };
  sectionsOpen?: number;
  onSectionOpen?: (title: string) => void;
  onCategory?: (category: string) => void;
  onEmployerClick?: (e: MouseEvent<HTMLAnchorElement>, href: string) => void;
  /** The posting page prints our-reading copy where we found no pay figure. */
  showPayAbsence?: boolean;
  descriptionHeading?: ReactNode;
  now?: Date;
}

export function OpenRolesLinkLine({ link }: { link: OpenRolesLink }) {
  const { t, i18n } = useTranslation();
  const n = link.count.value.toLocaleString(i18n.language || "en");
  const text = link.count.floor
    ? t("listing.detail.openRolesFloor", { defaultValue: "See all {{n}}+ open roles at {{name}}", n, name: link.name })
    : t("listing.detail.openRoles", {
        count: link.count.value, n, name: link.name,
        defaultValue_one: "See all {{n}} open role at {{name}}",
        defaultValue_other: "See all {{n}} open roles at {{name}}",
      });
  return (
    <p>
      <Link to={link.href} onClick={link.onClick} className="text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary" data-open-roles-link="">
        {text}
      </Link>
    </p>
  );
}

export function PostingDetail(props: PostingDetailProps) {
  const {
    job, surface, description, served, slots = {}, openRolesLink, back, onApply, onCheckFit, checkFitBusy, onClose,
    menu, saved, onToggleSave, highlight, sectionsOpen, onSectionOpen, onCategory, onEmployerClick, showPayAbsence,
    descriptionHeading, now,
  } = props;
  const employer = listingEmployer(job);
  const status: ListingServed = served ?? { missingSince: job.missingSince ?? null, recheckedAt: job.recheckedAt ?? null };
  const inSheet = surface === "sheet";
  const onPage = surface === "page";
  const records = [slots.layoffLine, slots.lcaLine, slots.ontario].filter(Boolean);
  return (
    <article className="min-w-0" data-posting-detail={surface}>
      <PostingHeader
        job={job}
        level={onPage ? 1 : 2}
        sticky={!inSheet && !onPage}
        hideEmployer={surface === "company"}
        menu={menu}
        onClose={inSheet ? undefined : onClose}
        back={back}
        onEmployerClick={onEmployerClick}
      />
      <div className="min-w-0 space-y-5 px-4 py-4 sm:px-5">
        <LiveStatus served={status} now={now} />
        {!inSheet && (
          <div className="space-y-3">
            <PostingActions
              employer={employer}
              applyUrl={job.applyUrl}
              onApply={onApply}
              onCheckFit={onCheckFit}
              checkFitBusy={checkFitBusy}
              onToggleSave={onToggleSave}
              saved={saved}
              title={job.title ?? undefined}
            />
            {slots.applicationAnswers}
            {slots.agentHandoff}
          </div>
        )}
        {inSheet && (slots.applicationAnswers || slots.agentHandoff) && (
          <div className="space-y-3">
            {slots.applicationAnswers}
            {slots.agentHandoff}
          </div>
        )}
        {slots.fit}
        {slots.decision}
        <PostingFacts job={job} showPayAbsence={showPayAbsence} payContext={slots.payContext} onCategory={onCategory} now={now} />
        {/* Each record line renders nothing until its own row clears its own
            bars, so the group shows only when one of them drew something. */}
        {records.length > 0 && (
          <div className="hidden space-y-3 border-t border-border pt-4 has-[>div:not(:empty)]:block" data-posting-records="">
            {records.map((node, i) => <div key={i} className="empty:hidden">{node}</div>)}
          </div>
        )}
        {slots.howApplying}
        {openRolesLink && <OpenRolesLinkLine link={openRolesLink} />}
        <PostingDescription
          description={description}
          employer={employer}
          applyUrl={job.applyUrl}
          highlight={highlight}
          sectionsOpen={sectionsOpen}
          onSectionOpen={onSectionOpen}
          heading={descriptionHeading}
        />
        {slots.employerContext}
        {slots.similar}
      </div>
    </article>
  );
}
