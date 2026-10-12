/**
 * THE ⋯ MENU: everything about a posting that is housekeeping, not a decision.
 *
 * The card carried four icon buttons (save, report, hide, compare) plus an
 * "Open in your agent" control in a row of their own, and the pane a second ✕
 * that hid the posting beside the ✕ that closed the pane. They live here now,
 * each with an icon and a name: Report (three reasons), Hide this posting
 * (EyeOff — never a second ✕), Compare (a checked item), Open in Claude or
 * ChatGPT, Copy link. An item renders only when its handler is supplied, so a
 * surface offers exactly what it can do.
 *
 * Built on the Radix menu the site already ships (roving focus, Escape, focus
 * back to the trigger). The design-system pass adds an OverflowMenu
 * primitive; the wiring table swaps the shell, not the items.
 */
import { Bot, Columns2, EyeOff, Flag, Link as LinkIcon, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ListingJob } from "@/lib/listing/types";

export type ReportReason = "gone" | "misleading" | "other";

/** contracts.ts PostingMenuActions, with the job handed back so the board can pass stable handlers. */
export interface PostingMenuActions {
  onReport?: (job: ListingJob, reason: ReportReason) => void;
  /** True once this reader reported it: the reasons give way to the thank-you. */
  reported?: boolean;
  onHide?: (job: ListingJob) => void;
  onCompare?: (job: ListingJob) => void;
  compared?: boolean;
  onCopyLink?: (job: ListingJob) => void;
  /** Hands the posting to the reader's own AI chat (Jobs.tsx JobAgentHandoff's copy). */
  aiHandoff?: (job: ListingJob) => void;
}

export function hasMenuItems(menu: PostingMenuActions | undefined): boolean {
  return !!menu && !!(menu.onReport || menu.onHide || menu.onCompare || menu.onCopyLink || menu.aiHandoff);
}

const ITEM = "gap-2 min-h-9";

export function PostingMenu({ job, title, menu }: { job: ListingJob; title: string; menu: PostingMenuActions }) {
  const { t } = useTranslation();
  if (!hasMenuItems(menu)) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("listing.card.moreActions", { defaultValue: "More actions for {{title}}", title })}
        onClick={(e) => e.stopPropagation()}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={(e) => e.stopPropagation()}>
        {menu.onReport && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Flag className="h-3.5 w-3.5" aria-hidden="true" />
              {menu.reported ? t("jobsPage.reportedBadge", "Reported — thanks") : t("listing.menu.report", "Report")}
            </DropdownMenuLabel>
            {!menu.reported && (["gone", "misleading", "other"] as const).map((reason) => (
              <DropdownMenuItem key={reason} className={`${ITEM} pl-8`} onSelect={() => menu.onReport?.(job, reason)}>
                {reason === "gone"
                  ? t("jobsPage.reportGone", "Posting is gone")
                  : reason === "misleading"
                    ? t("jobsPage.reportMisleading", "Looks misleading")
                    : t("jobsPage.reportOther", "Something else")}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}
        {menu.onHide && (
          <DropdownMenuItem className={ITEM} onSelect={() => menu.onHide?.(job)} title={t("jobsPage.dismissTip", "Hide this posting on this device. Restore all hidden postings any time.")}>
            <EyeOff className="h-4 w-4" aria-hidden="true" />
            {t("jobsPage.dismissCta", "Hide this posting")}
          </DropdownMenuItem>
        )}
        {menu.onCompare && (
          <DropdownMenuCheckboxItem className={ITEM} checked={!!menu.compared} onSelect={() => menu.onCompare?.(job)} title={t("jobsPage.compareTip", "Add to compare (up to 3)")}>
            <Columns2 className="h-4 w-4" aria-hidden="true" />
            {t("listing.menu.compare", "Compare")}
          </DropdownMenuCheckboxItem>
        )}
        {menu.aiHandoff && (
          <DropdownMenuItem className={ITEM} onSelect={() => menu.aiHandoff?.(job)}>
            <Bot className="h-4 w-4" aria-hidden="true" />
            {t("listing.menu.aiHandoff", "Open in Claude or ChatGPT")}
          </DropdownMenuItem>
        )}
        {menu.onCopyLink && (
          <DropdownMenuItem className={ITEM} onSelect={() => menu.onCopyLink?.(job)}>
            <LinkIcon className="h-4 w-4" aria-hidden="true" />
            {t("listing.menu.copyLink", "Copy link")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
