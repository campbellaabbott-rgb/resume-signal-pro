/**
 * THE PROP CONTRACTS BETWEEN THE BOARD PAGE AND ITS COMPONENTS.
 *
 * Types only. The job card, the detail pane, the phone sheet and the company
 * page's parts were built against these, and src/pages/Jobs.tsx wires them
 * (pass B, 2026-10-12). Since the wiring, the listing and company-page
 * contracts are the components' own prop types, re-exported below; the
 * board types re-declared here stay declared here. This file is edited by
 * the design-system group only.
 *
 * Nothing here imports from src/pages/Jobs.tsx (that would be circular). The
 * few board types re-declared below are held equal to Jobs.tsx's own by
 * src/test/the-shared-contracts-match-the-board.test.ts.
 */
import type { BoardJob, FillCurve } from "@/lib/board-job";
import type { HiringRecordRefusal } from "@/lib/hiring-record-gate";

export type { BoardJob, FillCurve };

/** The three closure-record answers (Jobs.tsx HiringRecordVerdict). "unknown" is never a no. */
export type HiringRecordVerdict = "closes" | "no-pattern" | "unknown";

/** The growth answer (Jobs.tsx GrowthVerdict). */
export type GrowthVerdict = "grew" | "no-growth" | "unknown";

/** A verdict after the shared gate (Jobs.tsx GatedHiringRecord). */
export interface GatedHiringRecord {
  verdict: HiringRecordVerdict;
  withheld: HiringRecordRefusal | null;
}

/**
 * The growth reading a company page may print: OUR observation days and the
 * rows served on them, which are counted differently from open roles and must
 * be labelled so. A subset of Jobs.tsx GrowthRow.
 */
export interface GrowthReading {
  verdict: GrowthVerdict;
  window_days: number;
  baseline_day: string | null;
  baseline_served: number | null;
  latest_day: string | null;
  latest_served: number | null;
  unknown_reason: string | null;
}

/**
 * THE ONE OPEN-ROLES FIGURE A PAGE PRINTS, chosen once and rendered
 * identically in the answer line, the rail, the pane link and the results
 * line. `floor` means "at least": print it through format.count(value,
 * { floor }). `asOf` is the read time of the figure, never first_seen.
 */
export interface OpenRolesValue {
  value: number;
  floor: boolean;
  asOf: string | null;
}

// ── THE LISTING COMPONENTS, AS WIRED (pass B, 2026-10-12) ───────────────────
//
// G2 built the card, the pane, the phone sheet and the menu against the
// contracts this file first declared, and extended them where the board
// needed more. Pass B wired them into the board, so the contract IS the
// components' own prop types now, re-exported here rather than declared a
// second time: one declaration cannot drift from the other. What changed
// from the first draft:
//   - the menu's handlers take the job back ((job, ...)), are each optional
//     (an item renders only when its handler is supplied) and carry the
//     reader's state (reported, compared);
//   - the card takes the crawlable href, the fit as {kind} (a score, or the
//     scorer's honest "unscored"), and two more slots (fieldChip, siblings);
//   - the pane's fit is a slot (slots.fit), with new slots for how applying
//     works, the decision summary, the pay benchmark and similar openings;
//     the served stamp defaults to the row's own and carries partialRead;
//   - the description says whether a failed read can be retried (onRetry).
export type { CardContext, JobCardFit as FitValue, JobCardProps, JobCardSlots } from "./listing/JobCard";
export type { PostingMenuActions, ReportReason } from "./listing/PostingMenu";
export type { OpenRolesLink, PostingDetailProps, PostingDetailSlots, PostingSurface } from "./listing/PostingDetail";
export type { ListingDescription as PostingDescription } from "./listing/PostingDescription";
export type { ListingServed as PostingServed } from "./listing/LiveStatus";
export type { PostingSheetProps } from "./listing/PostingSheet";

// ── THE COMPANY PAGE, AS WIRED ─────────────────────────────────────────────
//
// The lander's input and model are G3's (src/lib/company/lander-model.ts),
// which pass B mounts: the collision arrives as the catalogue's boards (not a
// flag), growth and the closure verdict as their gated readings, layoff
// filings as a count, and the extensions it names (carried, lastUnfiltered,
// relatedTotal, listAnsweredAt, boardTotal, undatedOpen). Re-exported so the
// page and its parts read one declaration. Its OpenRolesValue is this file's,
// plus the basis of its date and the cap flag.
export type { LanderInput, LanderModel, LanderVariant, LanderSections } from "@/lib/company/lander-model";
