/**
 * THE COMPANY PAGE, DECIDED ONCE AND WITHOUT REACT.
 *
 * /jobs/company/:token printed three different open-role counts on one page
 * (Domino's: "10,000+" in the answer line, "19936+" on the Hiring Health
 * card, "19953 more" in the detail pane), presented USAJOBS as an employer
 * with its "own job board", called a board two hiring systems share by one
 * employer's name, and put a token-derived name ("Andurilindustries") in the
 * H1 whenever the list was slow or refused. Each of those was a decision made
 * in a different place in a 13,000-line page. This module makes them here,
 * from inputs the page already has, and returns one model every surface of
 * the company page renders from:
 *
 *   - variant: which page this is (standard, collision, usajobs, agency,
 *     zero, uncarried), picked in one order;
 *   - openRoles: ONE OpenRolesValue {value, floor, asOf}, chosen once, which
 *     the answer line, the rail, the pane's "see all" link and the results
 *     line all print, so they cannot disagree;
 *   - name: the board's name from data (the override or the stored name, the
 *     baked H1, the name cached from the last visit), never derived from the
 *     token; null means "show a skeleton bar", and a generic board label
 *     ("Corporate", "Careers") is marked so no H1 sentence or possessive is
 *     built around it;
 *   - sections: which employer-level blocks may render on this variant.
 *
 * GATED INPUTS ONLY. The hiring-record verdict arrives already through the
 * shared gate (Jobs.tsx's gatedHiringRecord and activelyHiringVerdict); this
 * module never reads a raw fill-curve count and never re-derives a bar.
 */
import type { CollidedBoard } from "@/lib/board-collisions";
import type { HiringRecordRefusal } from "@/lib/hiring-record-gate";

/** The served list counts up to this many rows and then says countCapped (job-board serveList). */
export const LIST_COUNT_CAP = 10_000;
/** USAJOBS answers at most this many results per query (job-board USAJOBS_RESULT_CAP). */
export const USAJOBS_RESULT_CAP = 10_000;
/** The source key of the federal feed. */
export const USAJOBS_SOURCE = "usajobs";

export type LanderVariant = "standard" | "collision" | "usajobs" | "agency" | "zero" | "uncarried";

/** One open-roles figure per page. `floor` means the true figure is higher ("10,000+"). */
export interface OpenRolesValue {
  value: number;
  floor: boolean;
  /** When the figure was true: the board's own read, or the fill curve's computation. */
  asOf: string | null;
  /** Whether the floor is the list's own count cap (copy says "we count up to N"). */
  capped?: boolean;
  /**
   * What `asOf` dates, so the page words it truly: "read" is this board's own
   * feed read (the list's figure), "counted" is when a count was computed (the
   * board-level fill-curve count, or the moment the list answered when the
   * board's read time is missing). One screen used to print the fill curve's
   * computation time as "read 1 hr ago" beside "this board read 46 min ago".
   */
  basis?: "read" | "counted";
}

/** The gated closure verdict, as Jobs.tsx's gatedHiringRecord returns it. */
export interface GatedRecordInput {
  verdict: "closes" | "no-pattern" | "unknown";
  withheld: HiringRecordRefusal | null;
}

export type ActivelyHiringInput = "positive" | "negative" | "unknown";
export type GrowthVerdictInput = "grew" | "no-growth" | "unknown";

/**
 * Everything the page hands the model. Field names follow the design spec's
 * LanderInput contract (section 8); the three marked EXTENSION are this
 * module's additions and are listed in the wiring table.
 */
export interface LanderInput {
  token: string;
  /** boardName(token, a stored row name) -- NEVER the prettified token. Null until a row or facet names it. */
  storedName: string | null;
  /** The baked lander H1's name, read before React mounted (display-name.ts bakedLanderName). */
  bakedName: string | null;
  /** The name cached for this token on the last visit (display-name.ts cachedLanderName). */
  cachedName: string | null;
  /** The served list's exact total, null when it timed out or has not answered. */
  listTotal: number | null;
  /** The list said countCapped: listTotal is its cap, and the true figure is higher. */
  listFloor: boolean;
  /** The board-level open count (get_company_fill_curve.open_roles), null when not read. */
  feedTotal: number | null;
  /** The employer's own advertised total exceeds our stored rows: feedTotal is a floor. */
  feedFloor: boolean;
  /** When the board-level count was computed. */
  feedAsOf: string | null;
  /** This board's own last read (the newest recheckedAt on its rows). */
  boardReadAt: string | null;
  /** The hiring system of this board's rows, when they all share one. */
  source: string | null;
  /** The board is a tagged staffing agency. */
  agency: boolean;
  /** collidedBoards(token): two hiring systems carry a board with this name. */
  collision: CollidedBoard[] | null;
  isUsajobs: boolean;
  loading: boolean;
  error: boolean;
  /** The board pass refused this visitor (the 429 allowance), not an outage. */
  budgetRefusal: boolean;
  gated: GatedRecordInput;
  verdict: ActivelyHiringInput;
  growth: GrowthVerdictInput;
  layoffRows: number;
  /** activeBoardFilterKeys minus the company scope: the filters the VISITOR set. */
  visitorFilters: string[];
  /** EXTENSION: whether the catalogue carries this token. null = unknown, which is never "uncarried". */
  carried?: boolean | null;
  /** EXTENSION: the last unfiltered OpenRolesValue on this token, so a visitor filter does not blank the header. */
  lastUnfiltered?: OpenRolesValue | null;
  /** EXTENSION: the description-only segment of an unfiltered reply (a lander with only those is not empty). */
  relatedTotal?: number | null;
  /**
   * EXTENSION: when the served list answered. The job-board leaves recheckedAt
   * ABSENT when its stamp lookup fails, so boardReadAt can be null on a live
   * reply; the list's figure is then dated by its answer ("counted just now"),
   * and with neither time it carries no date and the header prints no count.
   */
  listAnsweredAt?: string | null;
}

export interface LanderName {
  /** The name to print, or null: render a skeleton bar, never the token. */
  name: string | null;
  /** A board label that is not an employer's name ("Corporate"): no sentence is built around it. */
  generic: boolean;
  from: "stored" | "baked" | "cached" | null;
}

export interface LanderSections {
  hiringRecord: boolean;
  /** USAJOBS prints only the tracking-floor reason of the record. */
  hiringRecordFloorOnly: boolean;
  perks: boolean;
  pay: boolean;
  mix: boolean;
  /** Hiring-mix copy says "roles listed mostly in", never "hires mostly in". */
  mixAsListings: boolean;
  publicRecords: boolean;
  sec: boolean;
  claim: boolean;
  similar: boolean;
  howApplying: boolean;
  /** The "Actively hiring" employer chip, once, in the header. */
  employerChip: boolean;
}

export interface LanderModel {
  variant: LanderVariant;
  name: LanderName;
  /** Null until a figure exists that every surface may print. */
  openRoles: OpenRolesValue | null;
  /** Whether the "is X hiring?" answer line may speak for this reply (no visitor filter, an answer that arrived). */
  answerable: boolean;
  /** A collision page's boards, in catalogue order. */
  boards: CollidedBoard[];
  sections: LanderSections;
  /** The visitor set a filter: the end-of-list "narrow filters" copy may speak, the company scope never counts. */
  visitorFiltered: boolean;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

// ── NAMES ──────────────────────────────────────────────────────────────────

/**
 * Board labels that name a page of a careers site, not an employer. The same
 * list as the design system's display-name module (src/lib/display-name.ts,
 * built in parallel); the wiring pass may point landerName at that module.
 */
const GENERIC_LABELS = new Set([
  "corporate", "corporate careers", "open roles", "careers", "career", "career site", "careers site",
  "careers page", "jobs", "job board", "job openings", "current openings", "search jobs", "external",
  "external careers", "external career site", "experience site", "internal",
]);

/**
 * A stored board name as it should read in a heading: "Mint Velvet | Mint
 * Velvet" is "Mint Velvet", "Prosperity Bank's career website" is
 * "Prosperity Bank". Never invents a word; never expands a name. A name that
 * was only "career website" keeps its words rather than vanishing.
 */
export function cleanBoardName(raw: string | null | undefined): string | null {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const twice = /^(.+?)\s*[|–—-]\s*(.+)$/.exec(s);
  if (twice && twice[1].trim().toLowerCase() === twice[2].trim().toLowerCase()) s = twice[1].trim();
  const stripped = s.replace(/(?:['’]s)?\s+careers?\s+web\s?site\s*$/i, "").trim();
  return stripped || s;
}

/** A label that names a careers page rather than an employer. */
export function isGenericBoardLabel(name: string | null | undefined): boolean {
  const n = (cleanBoardName(name) ?? "").toLowerCase();
  return n !== "" && GENERIC_LABELS.has(n);
}

/**
 * The page's name, in the one order the spec allows: the stored or
 * override name, the baked H1, the name cached from the last visit, and
 * otherwise nothing (the header shows a skeleton bar). The token is never
 * consulted: a prettified token read "Andurilindustries" for every second
 * the list was slow, and forever when it was refused.
 */
export function landerName(input: Pick<LanderInput, "storedName" | "bakedName" | "cachedName">): LanderName {
  const order: Array<[LanderName["from"], string | null]> = [
    ["stored", input.storedName], ["baked", input.bakedName], ["cached", input.cachedName],
  ];
  for (const [from, raw] of order) {
    const name = cleanBoardName(raw);
    if (name) return { name, generic: isGenericBoardLabel(name), from };
  }
  return { name: null, generic: false, from: null };
}

// ── THE ONE OPEN-ROLES FIGURE ────────────────────────────────────────────────

/**
 * Chosen once, from the unfiltered reply:
 *   - the list's exact total while it is under its cap, as of the board's read;
 *   - past the cap, the board-level count when it is at least the cap (with
 *     its own floor flag and computation time);
 *   - otherwise the cap itself, as a floor ("10,000+ · we count up to 10,000").
 * With a visitor filter on, the list no longer describes the board, so the
 * board-level count (unaffected by filters) or the last unfiltered figure
 * stands in, and with neither there is no figure.
 *
 * Each figure carries the basis of its date: the list's figure is "read" at
 * the board's read time (or "counted" when the list answered, if the read time
 * is missing); the board-level figure is "counted" when it was computed.
 */
export function chooseOpenRoles(input: Pick<LanderInput,
  "listTotal" | "listFloor" | "feedTotal" | "feedFloor" | "feedAsOf" | "boardReadAt" | "visitorFilters" | "lastUnfiltered" | "loading" | "error" | "listAnsweredAt">,
): OpenRolesValue | null {
  const feed: OpenRolesValue | null = finite(input.feedTotal) && input.feedTotal >= 0
    ? { value: input.feedTotal, floor: !!input.feedFloor, asOf: input.feedAsOf ?? null, basis: "counted" }
    : null;
  if (input.visitorFilters.length > 0 || input.loading || input.error || !finite(input.listTotal)) {
    return input.lastUnfiltered ?? (feed && feed.value > 0 ? feed : null);
  }
  const list = input.listTotal;
  const dated: Pick<OpenRolesValue, "asOf" | "basis"> = input.boardReadAt
    ? { asOf: input.boardReadAt, basis: "read" }
    : { asOf: input.listAnsweredAt ?? null, basis: "counted" };
  if (!input.listFloor && list < LIST_COUNT_CAP) {
    return { value: list, floor: false, ...dated };
  }
  if (feed && feed.value >= list) return feed;
  return { value: list, floor: true, ...dated, capped: true };
}

// ── THE VARIANT AND ITS SECTIONS ─────────────────────────────────────────────

/**
 * THE "ACTIVELY HIRING" CHIP NEEDS OPEN ROLES. The verdict it rests on
 * (activelyHiringVerdict) reads only fills and relists over 90 days, so a
 * board with none open today can still pass it; the legacy lander guarded the
 * chip with open_roles > 0 ("a dead board is not hiring"), and a page reading
 * "No open roles right now" beside "Actively hiring" contradicts itself. So
 * the chip needs the standard variant AND a figure above zero.
 */
function sectionsFor(variant: LanderVariant, input: LanderInput, openRoles: OpenRolesValue | null): LanderSections {
  const shared = !!input.collision;
  const agency = input.agency && !shared;
  const usajobs = input.isUsajobs && !shared;
  const employer = !shared && !agency && !usajobs;
  return {
    hiringRecord: !shared && !agency,
    hiringRecordFloorOnly: usajobs,
    perks: employer,
    pay: !shared,
    mix: !shared,
    mixAsListings: agency || usajobs,
    publicRecords: !shared,
    sec: employer,
    claim: employer && variant !== "uncarried",
    similar: !shared && variant !== "uncarried",
    howApplying: !shared && variant !== "uncarried" && variant !== "zero",
    employerChip: employer && variant === "standard" && input.verdict === "positive" && !!openRoles && openRoles.value > 0,
  };
}

/**
 * The variant, in one order: a token we do not carry, a board name two
 * hiring systems share, the federal feed, a carried board with no open roles
 * (and no visitor filter, which would make it a filter result, not a fact
 * about the board), a staffing agency's board, and otherwise an employer.
 */
export function pickVariant(input: LanderInput): LanderVariant {
  const answered = !input.loading && !input.error && finite(input.listTotal);
  const empty = answered && (input.listTotal ?? 0) + (input.relatedTotal ?? 0) === 0 && input.visitorFilters.length === 0;
  if (input.carried === false && (empty || !answered) && !input.collision) return "uncarried";
  if (input.collision && input.collision.length > 1) return "collision";
  if (input.isUsajobs) return "usajobs";
  if (empty) return "zero";
  if (input.agency) return "agency";
  return "standard";
}

export function buildLanderModel(input: LanderInput): LanderModel {
  const variant = pickVariant(input);
  const answerable = !input.loading && !input.error && !input.budgetRefusal && finite(input.listTotal) && input.visitorFilters.length === 0;
  const openRoles = variant === "uncarried" || variant === "zero" ? null : chooseOpenRoles(input);
  return {
    variant,
    name: landerName(input),
    openRoles,
    answerable,
    boards: variant === "collision" ? [...(input.collision ?? [])] : [],
    sections: sectionsFor(variant, input, openRoles),
    visitorFiltered: input.visitorFilters.length > 0,
  };
}
