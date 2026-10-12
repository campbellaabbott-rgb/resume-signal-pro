/**
 * THE PROP CONTRACTS BETWEEN THE BOARD PAGE AND ITS COMPONENTS.
 *
 * Types only. The job card, the detail pane, the phone sheet and the company
 * page's parts are built against these, and src/pages/Jobs.tsx wires them in
 * one region at a time. A component that needs a field this file lacks adds an
 * extension type in its own module and names it in its wiring table; this
 * file is edited by the design-system group only.
 *
 * Nothing here imports from src/pages/Jobs.tsx (that would be circular). The
 * few board types re-declared below are held equal to Jobs.tsx's own by
 * src/test/the-shared-contracts-match-the-board.test.ts.
 */
import type { ReactNode } from "react";
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

export type CardSurface = "board" | "company" | "posting";

export interface CardContext {
  surface: CardSurface;
  density: "compact" | "comfortable";
  /** On a company page every card is the same employer: no name, no monogram. */
  hideEmployer: boolean;
  selected: boolean;
}

/** A fit score: a number, null when the posting could not be scored, undefined when not asked. */
export type FitValue = number | null | undefined;

export interface PostingMenuActions {
  onReport: () => void;
  onHide: () => void;
  onCompare?: () => void;
  onCopyLink: () => void;
  /** "Open in Claude or ChatGPT": absent where no hand-off applies. */
  aiHandoff?: () => void;
}

export interface JobCardProps {
  job: BoardJob;
  ctx: CardContext;
  fit?: FitValue;
  saved: boolean;
  /** Employer-level chips, filled by the board on /jobs only, never on a company page (CP26). */
  slots?: { employerChip?: ReactNode; layoffChip?: ReactNode };
  onOpen: (job: BoardJob, how: "click" | "keyboard") => void;
  onToggleSave: (job: BoardJob) => void;
  onCheckFit: (job: BoardJob) => void;
  menu: PostingMenuActions;
}

export type PostingSurface = "board" | "company" | "sheet" | "page";

export interface PostingDescription {
  text: string;
  state: "loaded" | "loading" | "unavailable";
  /** True when the stored text reached STORED_DESC_CAP and continues on the employer's site. */
  capped: boolean;
}

export interface PostingServed {
  /** Set once the employer's system stopped listing the posting. */
  missingSince: string | null;
  /** When the board's feed was last read (job_board_verifications), never first_seen. */
  recheckedAt: string | null;
  /** We could read only part of this board on the last pass. */
  partialRead: boolean;
}

export interface PostingDetailProps {
  job: BoardJob;
  surface: PostingSurface;
  description: PostingDescription;
  served: PostingServed;
  fit?: FitValue;
  slots: {
    employerContext?: ReactNode;
    layoffLine?: ReactNode;
    lcaLine?: ReactNode;
    ontario?: ReactNode;
    applicationAnswers?: ReactNode;
    agentHandoff?: ReactNode;
  };
  openRolesLink?: { count: OpenRolesValue; href: string; name: string };
  back?: { label: string; onBack: () => void };
  onApply: (job: BoardJob) => void;
  onCheckFit: (job: BoardJob) => void;
  onClose?: () => void;
  menu: PostingMenuActions;
}

/** A layoff filing row as the company page receives it (LayoffFilingLine's LayoffFiling). */
export type LayoffRowLike = Record<string, unknown>;

export interface LanderInput {
  token: string;
  storedName: string | null;
  bakedName: string | null;
  cachedName: string | null;
  /** The list response's total and whether it is a capped floor. */
  listTotal: number | null;
  listFloor: boolean;
  /** The board-level open count (fill-curve open_roles) and its basis. */
  feedTotal: number | null;
  feedFloor: boolean;
  feedAsOf: string | null;
  /** This board's own last read, never a board-wide median. */
  boardReadAt: string | null;
  source: string | null;
  agency: boolean;
  collision: boolean;
  isUsajobs: boolean;
  loading: boolean;
  error: boolean;
  /** The daily-allowance refusal sentence, when the board budget refused the read. */
  budgetRefusal: string | null;
  gated: GatedHiringRecord;
  verdict: HiringRecordVerdict;
  growth: GrowthReading | null;
  layoffRows: LayoffRowLike[];
  /** Filters the VISITOR set (activeBoardFilterKeys minus the company scope). */
  visitorFilters: string[];
}

export interface LanderSlots {
  perks?: ReactNode;
  publicRecords?: ReactNode;
  similar?: ReactNode;
  /** Collision pages: show only one hiring system's roles. */
  onShowOnly: (source: string) => void;
  onWatch: () => void;
  onClaim?: () => void;
}
