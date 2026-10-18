/**
 * THE POSTING ON A PHONE: a full-screen sheet with Apply always in reach.
 *
 * What it replaces (Jobs.tsx's hand-rolled drawer): a fixed aside with
 * role="dialog" but no focus trap, no inert background and no focus return,
 * at z-50 beside a header at z-[60] that painted over its title; its pinned
 * bar gave the fit scan the solid style and outlined Apply under a bare "Apply".
 *
 * Here, on the Radix dialog the site already ships:
 *   - focus moves into the sheet, is trapped there, Escape closes it, and on
 *     close focus goes back to the card that opened it (returnFocusTo, else
 *     whatever held focus before);
 *   - the page behind is inert and its scroll is locked (body carries
 *     data-scroll-locked, which the floating help button hides under);
 *   - z-50, above the site header (z-40 in the design system);
 *   - a sticky header (back, one-line title, Close) and a sticky footer whose
 *     primary carries the SHORT label "Apply on employer site" — its
 *     accessible name contains that text — with Check fit and Save beside it;
 *   - min-w-0 and wrapping everywhere: nothing overflows a 320px screen.
 */
import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { listingTitle } from "@/lib/listing/text";
import { listingEmployer } from "@/lib/listing/employer";
import type { ListingJob } from "@/lib/listing/types";
import { PostingActions } from "./PostingActions";

export interface PostingSheetProps {
  job: ListingJob | null;
  open: boolean;
  onClose: () => void;
  /** The body: a PostingDetail with surface "sheet". */
  children: ReactNode;
  onApply?: () => void;
  onCheckFit?: () => void;
  checkFitBusy?: boolean;
  onToggleSave?: () => void;
  saved?: boolean;
  /** The card that opened the sheet; focus returns to it on close. */
  returnFocusTo?: HTMLElement | null;
}

export function PostingSheet({ job, open, onClose, children, onApply, onCheckFit, checkFitBusy, onToggleSave, saved, returnFocusTo }: PostingSheetProps) {
  const { t } = useTranslation();
  const title = job ? listingTitle(job.title) || t("jobPostingPage.genericHeading", "Job posting") : "";
  return (
    <DialogPrimitive.Root open={open && !!job} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex min-w-0 flex-col bg-background focus:outline-none"
          data-posting-sheet=""
          aria-describedby={undefined}
          // Focus lands on the sheet itself, so a screen reader announces the
          // posting by its title and Tab starts at Back — rather than a ring
          // appearing on Back the instant a tap opens the sheet.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={(e) => {
            if (returnFocusTo && document.contains(returnFocusTo)) {
              e.preventDefault();
              returnFocusTo.focus();
            }
          }}
        >
          {job && (
            <>
              <div className="sticky top-0 z-10 flex min-w-0 items-center gap-1 border-b border-border bg-background px-2 py-2">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("listing.sheet.back", "Back to the list")}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</DialogPrimitive.Title>
                <DialogPrimitive.Close
                  aria-label={t("jobsPage.detailClose", "Close")}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </DialogPrimitive.Close>
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
              <div className="sticky bottom-0 z-10 min-w-0 border-t border-border bg-background px-4 py-3">
                <PostingActions
                  variant="short"
                  employer={listingEmployer(job)}
                  applyUrl={job.applyUrl}
                  onApply={onApply}
                  onCheckFit={onCheckFit}
                  checkFitBusy={checkFitBusy}
                  onToggleSave={onToggleSave}
                  saved={saved}
                  title={title}
                />
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
