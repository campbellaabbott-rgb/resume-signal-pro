/**
 * PERKS STATED IN THEIR JOB POSTINGS: the pure half of the lander's perks block.
 *
 * The company lander (/jobs/company/:token) shows a checkmark list of the perks
 * an employer's own open postings state (owner decision D1, 2026-10-11). A
 * checkmark is the shape most likely to say more than the data does, so this
 * module decides, once and without React, exactly which checks may appear:
 *
 *   - Only keys the reader names as live. get_employer_perks hands back the
 *     keys whose 60-row audit passed in the last 45 days with the publish
 *     pause off (published_keys), and the claim rows for those keys only. A
 *     row for any other key is dropped here too, and an answer with no live
 *     key renders NOTHING: no placeholder, no "being checked", no reason line.
 *   - Only rows above the claim threshold, re-checked against the numbers the
 *     reader and the rollup's CHECK hold (PERK_ROW_THRESHOLDS, and three
 *     postings for a stated visa limit). A guard reads them back out of the
 *     migration and the extractor module, so neither runtime moves alone.
 *   - Never on a board two vendors share, an agency's board, a franchise
 *     board, or a vendor whose benefits text our ingest drops. There the
 *     block prints the reason, and only when some key is live: before any key
 *     passes its audit, a reason line would be a placeholder for a section no
 *     page has.
 *
 * Each check carries what it rests on: k of n readable open postings in one
 * country, the date the rollup read them, one verbatim line, and the posting
 * it came from while that posting still serves. Countries are never merged;
 * the block groups by country when more than one qualifies.
 */
import { postingPagePath } from "@/components/jobs/posting-page";

/** The keys that render as a check, in the order the list prints them. */
export const PERK_CHECK_KEYS = ["health", "dental", "vision", "life_dis", "retire", "pto", "parental", "equity"] as const;
export type PerkCheckKey = (typeof PERK_CHECK_KEYS)[number];

/** Stated limits: shown apart from the checks, never with a checkmark. */
export const PERK_LIMIT_KEYS = ["visa_not_offered"] as const;
export type PerkLimitKey = (typeof PERK_LIMIT_KEYS)[number];

/** Every key that can ever publish. Mirrors CANDIDATE_KEYS in supabase/functions/_shared/perks-extract.ts. */
export const PERK_PUBLISHABLE_KEYS: readonly string[] = [...PERK_CHECK_KEYS, ...PERK_LIMIT_KEYS];

/**
 * The claim threshold: at least minReadable postings we could read in the
 * country, the perk stated in at least minStated of them and in at least
 * minShare of them. Mirrors PERK_THRESHOLDS in _shared/perks-extract.ts, the
 * rollup's CHECK and the reader's re-check in 20261012110000.
 */
export const PERK_ROW_THRESHOLDS = { minReadable: 5, minStated: 2, minShare: 0.1 } as const;

/** A stated visa limit needs this many postings saying it (plan section 4). Mirrors the reader. */
export const VISA_LIMIT_MIN_STATED = 3;

/**
 * THE CHECKMARK IS FOR MOST POSTINGS, NOT FOR SOME (design spec 5.5a,
 * 2026-10-12). The claim threshold above lets a perk through at 2 of 20
 * postings, and a bare check beside "Health insurance" reads as "offered".
 * So a check marks a perk stated in at least half of the postings we could
 * read in that country; a perk above the threshold but under half sits in an
 * "In some of their postings" group with a hollow dot. Both open the same
 * count and quote.
 */
export const PERK_CHECK_MIN_SHARE = 0.5;
export type PerkMark = "check" | "some";

/** "check" when at least half the postings we could read state it, "some" otherwise. Whole numbers, as the SQL states shares. */
export function perkMark(c: Pick<PerkClaim, "k" | "n">): PerkMark {
  return c.n > 0 && c.k * Math.round(1 / PERK_CHECK_MIN_SHARE) >= c.n ? "check" : "some";
}

/** The eligibility tag shows once at least this share of the k postings hedge the perk or limit who gets it. */
export const QUALIFIED_TAG_MIN_SHARE = 1 / 3;

/** Why a board shows no perks, in the order the block names them when more than one applies. */
export const PERK_WITHHELD_REASONS = ["collision", "agency", "franchise", "vendor_text_not_stored"] as const;
export type PerkWithheldReason = (typeof PERK_WITHHELD_REASONS)[number];

export interface PerkStatute {
  statute: string;
  sourceUrl: string;
  /** Where the statute applies, when that is narrower than the country group (the GB rows: Great Britain). */
  appliesIn: string | null;
}

export interface PerkBaseline extends PerkStatute {
  readOn: string;
  /** The law that sets the same minimum in the rest of the country group (Northern Ireland for the GB rows). */
  also: PerkStatute | null;
}

/** Statute only, from the two official registers the table's CHECK allows. */
const STATUTE_URL = /^https:\/\/www\.(legislation\.gov\.uk|gesetze-im-internet\.de)\//;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface PerkClaim {
  perk: PerkCheckKey | PerkLimitKey;
  /** ISO 3166 alpha-2, upper case. */
  country: string;
  k: number;
  n: number;
  quote: string;
  /** The posting the quote came from, only while it still serves. */
  postingId: string | null;
  asOf: string;
  qualifiedShare: number;
  standardText: boolean;
  baseline: PerkBaseline | null;
}

export interface EmployerPerksAnswer {
  token: string;
  collision: boolean;
  publishedKeys: string[];
  perks: PerkClaim[];
  withheld: Array<{ source: string; reason: string; share: number | null }>;
}

export interface PerkCountryGroup {
  country: string;
  checks: PerkClaim[];
  limits: PerkClaim[];
}

export type PerksView =
  | { kind: "withheld"; reason: PerkWithheldReason; share: number | null }
  | { kind: "claims"; groups: PerkCountryGroup[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const ISO2 = /^[A-Z]{2}$/;

function readStatute(v: unknown): PerkStatute | null {
  if (!isObj(v)) return null;
  const statute = text(v.statute);
  const sourceUrl = v.source_url;
  if (!statute || typeof sourceUrl !== "string" || !STATUTE_URL.test(sourceUrl)) return null;
  return { statute, sourceUrl, appliesIn: text(v.applies_in) };
}

function readBaseline(v: unknown): PerkBaseline | null {
  const law = readStatute(v);
  if (!law || !isObj(v)) return null;
  const also = readStatute(v.also);
  // A statute narrower than the country is shown only with where it applies
  // and the law for the rest; one without the other is not shown at all.
  if (law.appliesIn && !(also && also.appliesIn)) return null;
  return { ...law, readOn: typeof v.read_on === "string" ? v.read_on : "", also };
}

function readClaim(v: unknown): PerkClaim | null {
  if (!isObj(v)) return null;
  const perk = v.perk;
  if (typeof perk !== "string" || !PERK_PUBLISHABLE_KEYS.includes(perk)) return null;
  const country = typeof v.country === "string" ? v.country.trim().toUpperCase() : "";
  if (!ISO2.test(country)) return null;
  if (!isCount(v.k) || !isCount(v.n)) return null;
  const quote = typeof v.quote === "string" ? v.quote.trim() : "";
  if (!quote) return null;
  const asOf = typeof v.as_of === "string" && !Number.isNaN(Date.parse(v.as_of)) ? v.as_of : null;
  if (!asOf) return null;
  const share = typeof v.qualified_share === "number" ? v.qualified_share : Number(v.qualified_share);
  return {
    perk: perk as PerkClaim["perk"],
    country,
    k: v.k,
    n: v.n,
    quote,
    postingId: typeof v.quote_posting_id === "string" && v.quote_posting_id ? v.quote_posting_id : null,
    asOf,
    qualifiedShare: Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0,
    standardText: v.standard_text === true,
    baseline: readBaseline(v.baseline),
  };
}

/**
 * The reader's answer, or null when it is not one. A malformed row is dropped
 * rather than failing the answer; an answer with no published_keys list names
 * no live key, so it renders nothing (fail closed).
 */
export function readEmployerPerks(data: unknown): EmployerPerksAnswer | null {
  if (!isObj(data) || !Array.isArray(data.perks)) return null;
  const publishedKeys = Array.isArray(data.published_keys)
    ? data.published_keys.filter((k): k is string => typeof k === "string")
    : [];
  const withheld = Array.isArray(data.withheld)
    ? data.withheld.filter(isObj).map((w) => ({
        source: typeof w.source === "string" ? w.source : "",
        reason: typeof w.reason === "string" ? w.reason : "",
        share: typeof w.share === "number" ? w.share : w.share == null ? null : Number(w.share),
      }))
    : [];
  return {
    token: typeof data.token === "string" ? data.token : "",
    collision: data.collision === true,
    publishedKeys,
    perks: data.perks.map(readClaim).filter((c): c is PerkClaim => c !== null),
    withheld,
  };
}

/** The claim threshold, as the reader and the rollup's CHECK state it. */
export function passesPerkThreshold(c: Pick<PerkClaim, "perk" | "k" | "n">): boolean {
  const { minReadable, minStated, minShare } = PERK_ROW_THRESHOLDS;
  if (c.n < minReadable || c.k < minStated || c.k > c.n) return false;
  // In whole numbers, as the SQL states it (k * 10 >= n): 0.1 * 30 is 3.0000000000000004.
  if (c.k * Math.round(1 / minShare) < c.n) return false;
  if (c.perk === "visa_not_offered" && c.k < VISA_LIMIT_MIN_STATED) return false;
  return true;
}

/** Whether the eligibility tag shows: a third or more of the k postings hedge it or limit who gets it. */
export function showsConditions(c: Pick<PerkClaim, "qualifiedShare">): boolean {
  return c.qualifiedShare >= QUALIFIED_TAG_MIN_SHARE - 1e-9;
}

/** How many of the k postings hedge it, from the reader's share (stored to three places). */
export function qualifiedCount(c: Pick<PerkClaim, "qualifiedShare" | "k">): number {
  return Math.min(c.k, Math.max(0, Math.round(c.qualifiedShare * c.k)));
}

/**
 * What the block may print, or null for nothing at all.
 *
 * Nothing when the answer is missing or names no live key. The reason line
 * when the board is withheld and some key is live. Otherwise the claim rows
 * for live keys that pass the threshold, grouped by country (the country with
 * the most readable postings first); nothing when none survive.
 */
export function perksView(answer: EmployerPerksAnswer | null): PerksView | null {
  if (!answer) return null;
  const live = new Set(answer.publishedKeys.filter((k) => PERK_PUBLISHABLE_KEYS.includes(k)));
  if (live.size === 0) return null;

  if (answer.collision) return { kind: "withheld", reason: "collision", share: null };
  if (answer.withheld.length > 0) {
    for (const reason of PERK_WITHHELD_REASONS) {
      const w = answer.withheld.find((x) => x.reason === reason);
      if (w) return { kind: "withheld", reason, share: reason === "franchise" && typeof w.share === "number" ? w.share : null };
    }
    // A reason this page does not know still withholds: no check, no line.
    return null;
  }

  const byCountry = new Map<string, PerkCountryGroup>();
  const seen = new Set<string>();
  for (const c of answer.perks) {
    if (!live.has(c.perk) || !passesPerkThreshold(c)) continue;
    const id = `${c.country}:${c.perk}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const g = byCountry.get(c.country) ?? { country: c.country, checks: [], limits: [] };
    if ((PERK_LIMIT_KEYS as readonly string[]).includes(c.perk)) g.limits.push(c);
    else g.checks.push(c);
    byCountry.set(c.country, g);
  }
  const order = (k: string) => PERK_PUBLISHABLE_KEYS.indexOf(k);
  const groups = [...byCountry.values()]
    .map((g) => ({ ...g, checks: g.checks.sort((a, b) => order(a.perk) - order(b.perk)) }))
    .sort((a, b) => {
      const na = Math.max(...[...a.checks, ...a.limits].map((c) => c.n));
      const nb = Math.max(...[...b.checks, ...b.limits].map((c) => c.n));
      return nb - na || a.country.localeCompare(b.country);
    });
  return groups.length ? { kind: "claims", groups } : null;
}

/** The page a quoted posting lives on: its own posting page, or the board's detail link for an id that cannot be a path. */
export function perkPostingHref(id: string): string {
  return postingPagePath(id) ?? `/jobs?job=${encodeURIComponent(id)}`;
}
