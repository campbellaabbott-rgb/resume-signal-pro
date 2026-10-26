/**
 * THE NAME A PAGE PRINTS FOR AN EMPLOYER OR A BOARD.
 *
 * Wraps employerName / boardName (src/lib/company-display.ts, which the bake
 * also reads and this module never edits) with the three repairs the company
 * page audit of 2026-10-11 measured on live landers:
 *
 *   1. "Mint Velvet | Mint Velvet" — a vendor that joins the company name to
 *      the site name. Two equal halves collapse to one.
 *   2. "Prosperity Bank's career website" — a site title stored as the name.
 *      The trailing "('s) career website" comes off.
 *   3. "Corporate", "Careers", "Open Roles", "External", "Experience site" —
 *      a board LABEL, not a name. It is marked `generic`, and a generic label
 *      never enters an H1 sentence or a possessive: the page says
 *      'Roles on the "Corporate" board (UKG)' instead of "Corporate's jobs".
 *
 * And it never guesses. A lander whose name has not arrived yet takes, in
 * order: the override or stored board name; the name the prerendered page
 * carried in its <h1>, read by main.tsx before React replaced it; the name
 * cached on this browser's last visit; and otherwise nothing, which the page
 * renders as a skeleton bar. It never builds a name from the board token.
 */
import { boardName, decodeNameEntities, employerName } from "@/lib/company-display";
import { rawBakedLanderName } from "@/lib/baked-lander-name";

export type DisplayNameSource = "stored" | "baked" | "cached" | "none";

export interface DisplayName {
  /** What to print. Empty only when source is "none". */
  text: string;
  /** A board label such as "Corporate": never put it in a sentence about an employer. */
  generic: boolean;
  source: DisplayNameSource;
}

const SEPARATED_TWICE = /^(.+?)\s*[|–—-]\s*(.+)$/;
const CAREER_WEBSITE = /(?:['’]s)?\s+careers?\s+web\s?site\s*$/i;

/** The cleaned label, before any generic test. Idempotent. */
export function cleanBoardLabel(raw: string | null | undefined): string {
  let s = decodeNameEntities(String(raw ?? "")).replace(/\s+/g, " ").trim();
  if (!s) return "";
  const twice = s.match(SEPARATED_TWICE);
  if (twice && twice[1].trim().toLowerCase() === twice[2].trim().toLowerCase()) s = twice[1].trim();
  const stripped = s.replace(CAREER_WEBSITE, "").trim();
  // A name that WAS only "career website" keeps its words rather than vanishing.
  if (stripped) s = stripped;
  return s;
}

/**
 * Labels a hiring system gives a board, which name no employer. Matched as
 * the whole name, case-insensitively, after cleaning. The list grows only from
 * names seen on live boards.
 */
const GENERIC_LABELS = new Set([
  "corporate",
  "corporate careers",
  "open roles",
  "careers",
  "career",
  "career site",
  "careers site",
  "careers page",
  "jobs",
  "job board",
  "job openings",
  "current openings",
  "search jobs",
  "external",
  "external careers",
  "external career site",
  "experience site",
  "internal",
]);

export function isGenericBoardLabel(name: string | null | undefined): boolean {
  const n = cleanBoardLabel(name).toLowerCase();
  return n !== "" && GENERIC_LABELS.has(n);
}

function named(text: string, source: DisplayNameSource): DisplayName {
  const t = cleanBoardLabel(text);
  if (!t) return { text: "", generic: false, source: "none" };
  return { text: t, generic: isGenericBoardLabel(t), source };
}

/** An employer as a card or a pane names it (one posting's employer). */
export function displayEmployer(token: string | null | undefined, stored: string | null | undefined): DisplayName {
  return named(employerName(token, stored), "stored");
}

/** A whole board, as a lander or a directory row names it. */
export function displayBoard(token: string | null | undefined, stored: string | null | undefined): DisplayName {
  return named(boardName(token, stored), "stored");
}

// ── The lander's name while its data loads ────────────────────────────────

export { captureBakedLanderName, resetBakedLanderName } from "@/lib/baked-lander-name";

/** The baked name for this token, cleaned, if the page that loaded carried one. */
export function bakedLanderName(token: string | null | undefined): string | null {
  const raw = rawBakedLanderName(token);
  const n = cleanBoardLabel(raw);
  return n || null;
}

const CACHE_KEY = "rb_lander_names";
const CACHE_MAX = 60;

type Store = Pick<Storage, "getItem" | "setItem">;
function safeStore(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readCache(store: Store | null): Record<string, string> {
  try {
    const raw = store?.getItem(CACHE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function cachedLanderName(token: string | null | undefined, store: Store | null = safeStore()): string | null {
  if (!token) return null;
  const v = readCache(store)[token];
  return typeof v === "string" && v.trim() ? v : null;
}

/** Remember the name a lander resolved to, for the next visit's first paint. */
export function rememberLanderName(token: string | null | undefined, name: string | null | undefined, store: Store | null = safeStore()): void {
  const t = String(token ?? "").trim();
  const n = cleanBoardLabel(name);
  if (!t || !n) return;
  try {
    const cache = readCache(store);
    delete cache[t];
    cache[t] = n;
    const keys = Object.keys(cache);
    for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete cache[k];
    store?.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* blocked storage: the next visit shows the skeleton instead */
  }
}

export interface LanderNameInput {
  token: string;
  /** The board's stored name from the list response, once it has arrived. */
  storedName?: string | null;
  /** Defaults to what main.tsx captured. */
  bakedName?: string | null;
  /** Defaults to this browser's cache. */
  cachedName?: string | null;
}

/**
 * The name a lander prints right now. source "none" means render the
 * skeleton bar (HeaderSkeleton), never a name built from the token.
 */
export function landerDisplayName(input: LanderNameInput): DisplayName {
  const fromStore = displayBoard(input.token, input.storedName ?? null);
  if (fromStore.source !== "none") return fromStore;
  const bakedName = input.bakedName !== undefined ? input.bakedName : bakedLanderName(input.token);
  if (bakedName) {
    const d = named(bakedName, "baked");
    if (d.source !== "none") return d;
  }
  const cached = input.cachedName !== undefined ? input.cachedName : cachedLanderName(input.token);
  if (cached) {
    const d = named(cached, "cached");
    if (d.source !== "none") return d;
  }
  return { text: "", generic: false, source: "none" };
}
