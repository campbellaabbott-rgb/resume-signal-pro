/**
 * GATES, TIERS AND EVERY WORD THE MATCH LIST SAYS.
 *
 * A row is first placed (the reader's commute ring, remote in a country they
 * said they can work in, a region or the whole country they said they would
 * move to), then gated, then tiered. Gates SET ROWS ASIDE: every set-aside
 * group is counted, names the rows its count was taken over, and has "show
 * anyway". There is no gate on years, degree or skills.
 *
 * Tiers are ordinal and carry no number:
 *   Strong  requirements read, core title, level fits, stated minimum within
 *           the reader's years + 2 (2 for an entry reader), licence met or
 *           met-pending, no required line answered "No", no smaller gap;
 *   Good    exactly one smaller gap, or requirements not read;
 *   Stretch 3+ years short, an entry reader against a senior band, a licence
 *           held elsewhere, or two or more smaller gaps.
 *
 * Pure and import-light (licence-rules only): the server tiers with it, and
 * the device re-tiers with it when the reader edits a chip or answers a
 * question, from the facets the server returned. No wording here may state or
 * imply whether anyone will be hired; BANNED_MATCH_WORDS and its test hold
 * every string in this file, the function's responses and the match UI to that.
 */
import { licenceIsGate, type Licence, type LicenceKind, licenceVerdict, type LicenceVerdict, type PostingLicence } from "./licence-rules.ts";

export const MATCH_TIERS_VERSION = "2026-10-16.1";

export type Tier = "strong" | "good" | "stretch";
export type Lane = "ring" | "remote" | "region" | "country";
export const LANE_ORDER: Record<Lane, number> = { ring: 0, remote: 1, region: 2, country: 3 };
export type Level = "entry" | "mid" | "senior" | "exec";

export type SetAsideReason =
  | "outside_countries" | "beyond_commute" | "place_not_stated" | "different_occupation" | "previous_field"
  | "internship" | "level_above" | "level_below" | "no_sponsorship" | "citizenship_required"
  | "clearance_required" | "licence_missing" | "licence_elsewhere";

/** Reasons counted over the rows whose description was read. */
export const DESCRIPTION_REASONS: ReadonlySet<SetAsideReason> = new Set(["no_sponsorship", "citizenship_required", "clearance_required", "licence_missing"]);

// ---------------------------------------------------------------------------
// Wording. Every sentence the list shows lives here.
// ---------------------------------------------------------------------------

export const FOOTER =
  "This compares each posting's stated requirements with your résumé and where you said you can work. It is not a prediction of whether you will be hired.";
export const TIER_LABEL: Record<Tier, string> = { strong: "Strong match", good: "Good match", stretch: "Stretch" };
export const TIER_DEFINITION: Record<Tier, string> = {
  strong: "Strong match: meets every stated requirement we could read",
  good: "Good match: one gap, or requirements we could not read",
  stretch: "Stretch: a bigger gap, or two or more smaller ones",
};
export const SET_ASIDE_LABEL: Record<SetAsideReason, string> = {
  outside_countries: "Outside the countries you said you can work in",
  beyond_commute: "Beyond your commute area and where you'd move",
  place_not_stated: "Place not stated",
  different_occupation: "Different occupation",
  previous_field: "Your previous field",
  internship: "Internship or student role",
  level_above: "Senior titles above your level",
  level_below: "More junior than your experience",
  no_sponsorship: "Says it won't sponsor",
  citizenship_required: "Says citizenship required",
  clearance_required: "Needs an active clearance you haven't listed",
  licence_missing: "Needs a licence you haven't listed",
  licence_elsewhere: "Needs a licence in {{state}}",
};
/** Short forms for the one-line summary ("34 outside where you said you can work"). */
export const SET_ASIDE_SHORT: Record<SetAsideReason, string> = {
  outside_countries: "outside where you said you can work",
  beyond_commute: "beyond your commute area",
  place_not_stated: "place not stated",
  different_occupation: "a different occupation",
  previous_field: "in your previous field",
  internship: "internships or student roles",
  level_above: "senior titles",
  level_below: "more junior than your experience",
  no_sponsorship: "say they won't sponsor",
  citizenship_required: "say citizenship required",
  clearance_required: "need an active clearance",
  licence_missing: "need a licence you haven't listed",
  licence_elsewhere: "need a licence in another state",
};
export const SHOW_ANYWAY = "Show anyway";
export const REQUIREMENTS_NOT_READ = "requirements not read";
export const KEYWORDS_PENDING = "keywords pending";
export const USAJOBS_NOTE = "Most federal jobs require U.S. citizenship; this posting's text wasn't read.";
export const LICENCE_STATE_NOT_STATED = "licence state not stated";
export const NO_CLOSURE_RECORD = "no closure record yet";
export const RING_FALLBACK = "Only {{city}} itself was searched: the commute area around it is not available yet.";
export const THIN_RESULTS = "{{n}} in your {{city}} commute area. We also tried: {{steps}}.";
export const NO_OCCUPATION = "Type your target role";
export const PARTIAL_FAILURE = "{{n}} could not be checked: retry";
export const KEYWORD_OVERLAP = "Keyword overlap: {{n}} of {{m}} recognised terms in this posting appear in your résumé.";
export const PLACE_LINE = {
  ring: "in your {{city}} commute area ({{km}} km)",
  remote: "Remote within the {{country}}",
  region: "you said you'd move within {{region}}",
  country: "Elsewhere in {{country}}",
} as const;
export const WIDEN_STEP_LABEL: Record<number, string> = {
  1: "any word order",
  2: "'{{headNoun}}'",
  3: "the next rung",
  4: "80 km",
  5: "elsewhere in {{region}}",
  6: "your previous field",
};
export const GAP_LABEL = {
  nearTitle: "a related title",
  widened: "found by a wider search",
  yearsShort: "asks {{min}}+ years; we read about {{years}}",
  licenceTransfer: "licence held in another state",
  licenceTransferPending: "licence transfer pending",
  licenceNotListed: "licence not on your résumé",
  licenceStateNotStated: LICENCE_STATE_NOT_STATED,
  degreeBelow: "asks for a {{degree}}",
  answeredNo: "you answered No to a required line",
  seniorBand: "an experienced-level posting",
} as const;

/**
 * Words and phrases no match copy may use: each states or implies a chance of
 * being hired, a competition proxy, or a check nobody made. A percentage next
 * to "match" or "fit" reads as a probability.
 */
export const BANNED_MATCH_WORDS: readonly RegExp[] = [
  /\bchances?\b/i, /\blikely\b/i, /\bwill hire\b/i, /\bhire you\b/i, /\bget hired\b/i, /\bodds\b/i,
  /\bprobabilit(?:y|ies)\b/i, /\bbest chance\b/i, /\bshortlist(?:ed|ing)?\b/i, /\bverified\b/i, /\bfilled\b/i,
  /\bearly applicants?\b/i, /\bjobs you can take\b/i, /\bwhere you can work\b/i,
  /\d\s*%\s*(?:match|fit)\b/i, /\b(?:match|fit)\s*(?:score\s*)?(?:of\s*)?\d+\s*%/i, /\{\{\s*pct\s*\}\}\s*%/i,
];
export function bannedIn(text: string): string[] {
  return BANNED_MATCH_WORDS.filter((re) => re.test(text)).map((re) => re.source);
}

/** "{{city}}" style placeholders. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

// ---------------------------------------------------------------------------
// Facets and the reader
// ---------------------------------------------------------------------------

export interface LevelWords {
  intern: boolean;
  aboveEntry: boolean;
  numeral: boolean;
  overreach: boolean;
  junior: boolean;
  assistant: boolean;
}

export type PlaceVerdict =
  | { kind: "ring"; label: string }
  | { kind: "remote"; label: string; country: string }
  | { kind: "region"; label: string; region: string }
  | { kind: "country"; label: string; country: string }
  | { kind: "outside_countries"; country: string }
  | { kind: "beyond_commute" }
  | { kind: "place_not_stated" }
  | { kind: "licence_elsewhere"; state: string };

export interface PostingReqFacet {
  minYears: number | null;
  licence: PostingLicence | null;
  noSponsorship: string | null;
  citizenshipRequired: string | null;
  activeClearance: string | null;
  degree: { level: string; must: boolean; quote: string } | null;
  must: string[];
}

export interface RowFacets {
  place: PlaceVerdict;
  /** 0 core, 1 near, 9 not this occupation. */
  titleRank: 0 | 1 | 9;
  previousField: boolean;
  level: LevelWords;
  levelInQuery: boolean;
  assistantIsJunior: boolean;
  /** 0 = the exact search; 1-3 = the widening step that found it. */
  widenStep: number;
  /** The minimum to judge against (effectiveMinYears). */
  minYears: number | null;
  /** The posting's own experience band (entry / mid / senior / expert), when stored. */
  band: string | null;
  requirements: PostingReqFacet | "not read";
  /** States the row's own location names (licence jurisdiction when the text names none). */
  rowStates: string[];
  /** Licensed family on the remote lane, no state named. */
  licenceStateNotStated: boolean;
  /** The country the row is in (for a citizenship line). */
  country: string | null;
}

export interface TierReader {
  level: Level;
  years: { low: number; high: number } | null;
  targetYears: number | null;
  careerChanger: boolean;
  student?: boolean;
  workAuth: { status: string; needsSponsorship: boolean; citizenOf: string[]; clearance: string | null };
  licences: readonly Licence[];
  degree?: string | null;
  /** Answers to "? Yes / No / Skip" lines, keyed by the line's quote. Device only, never sent. */
  answers?: Record<string, "yes" | "no" | "skip">;
}

const DEGREE_RANK: Record<string, number> = { high_school: 1, associate: 2, bachelor: 3, master: 4, doctorate: 5 };
const DEGREE_NAME: Record<string, string> = { high_school: "high school diploma", associate: "associate degree", bachelor: "bachelor's degree", master: "master's degree", doctorate: "doctorate" };

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export interface Gate { reason: SetAsideReason; detail?: string }

/** The first gate that sets this row aside for this reader, or null. */
export function gateFor(f: RowFacets, r: TierReader): Gate | null {
  switch (f.place.kind) {
    case "outside_countries": return { reason: "outside_countries", detail: f.place.country };
    case "beyond_commute": return { reason: "beyond_commute" };
    case "place_not_stated": return { reason: "place_not_stated" };
    case "licence_elsewhere": return { reason: "licence_elsewhere", detail: f.place.state };
    default: break;
  }
  if (f.titleRank === 9) return { reason: f.previousField ? "previous_field" : "different_occupation" };
  if (f.previousField && f.titleRank !== 0) return { reason: "previous_field" };
  if (f.level.intern && !r.student) return { reason: "internship" };
  if (!f.levelInQuery) {
    if (r.level === "entry" && (f.level.aboveEntry || f.level.numeral)) return { reason: "level_above" };
    if (r.level === "mid" && f.level.overreach) return { reason: "level_above" };
  }
  if ((r.level === "senior" || r.level === "exec") && (f.level.junior || (f.assistantIsJunior && f.level.assistant))) {
    return { reason: "level_below" };
  }
  const q = f.requirements;
  if (q !== "not read") {
    if (r.workAuth.needsSponsorship && q.noSponsorship) return { reason: "no_sponsorship" };
    if (q.citizenshipRequired && declaredNotCitizen(r, f.country)) return { reason: "citizenship_required" };
    if (q.activeClearance && !r.workAuth.clearance) return { reason: "clearance_required" };
    if (q.licence && licenceIsGate(q.licence.kind) && licenceVerdict(r.licences, q.licence, f.rowStates) === "missing") {
      return { reason: "licence_missing" };
    }
  }
  return null;
}

/** Only a reader who declared they are not a citizen of the row's country is gated; unknown is information. */
export function declaredNotCitizen(r: TierReader, country: string | null): boolean {
  const c = country ?? "US";
  if (r.workAuth.citizenOf.includes(c)) return false;
  if (r.workAuth.citizenOf.length > 0) return true;
  return r.workAuth.status === "permanent_resident" || r.workAuth.status === "student_visa" || r.workAuth.status === "work_visa";
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export interface TierResult { tier: Tier; gaps: string[]; notRead: boolean; licence: LicenceVerdict }

/** The years an entry reader is judged on (0) or the reader's high years (target-field years for a career changer). */
export function readerYears(r: TierReader): number | null {
  if (r.level === "entry") return 0;
  if (r.careerChanger && r.targetYears !== null) return r.targetYears;
  return r.years ? r.years.high : null;
}
export const YEARS_ALLOWANCE = 2;

export function tierFor(f: RowFacets, r: TierReader): TierResult {
  const minor: string[] = [];
  const major: string[] = [];
  const notRead = f.requirements === "not read";
  const q = f.requirements === "not read" ? null : f.requirements;

  if (f.titleRank === 1) minor.push(GAP_LABEL.nearTitle);
  if (f.widenStep >= 1 && f.widenStep <= 3) minor.push(GAP_LABEL.widened);

  const yrs = readerYears(r);
  if (typeof f.minYears === "number" && yrs !== null) {
    const short = f.minYears - (yrs + YEARS_ALLOWANCE);
    const label = fill(GAP_LABEL.yearsShort, { min: f.minYears, years: Math.round(r.level === "entry" ? (r.years?.low ?? 0) : yrs) });
    if (short >= 3) major.push(label);
    else if (short >= 1) minor.push(label);
  }
  if (r.level === "entry" && (f.band === "senior" || f.band === "expert")) major.push(GAP_LABEL.seniorBand);

  let licence: LicenceVerdict = "not_asked";
  if (q?.licence) {
    licence = licenceVerdict(r.licences, q.licence, f.rowStates);
    if (licence === "transfer") major.push(GAP_LABEL.licenceTransfer);
    else if (licence === "transfer_pending") minor.push(GAP_LABEL.licenceTransferPending);
    else if (licence === "missing") minor.push(GAP_LABEL.licenceNotListed);
  }
  if (f.licenceStateNotStated) minor.push(GAP_LABEL.licenceStateNotStated);
  if (q?.degree && q.degree.must && r.degree && DEGREE_RANK[r.degree] !== undefined && DEGREE_RANK[q.degree.level] !== undefined) {
    const below = DEGREE_RANK[q.degree.level] - DEGREE_RANK[r.degree];
    if (below === 1) minor.push(fill(GAP_LABEL.degreeBelow, { degree: DEGREE_NAME[q.degree.level] }));
    else if (below >= 2) major.push(fill(GAP_LABEL.degreeBelow, { degree: DEGREE_NAME[q.degree.level] }));
  }
  const answeredNo = !!q && !!r.answers && q.must.some((line) => r.answers![line] === "no");
  if (answeredNo) minor.push(GAP_LABEL.answeredNo);

  let tier: Tier;
  if (major.length || minor.length >= 2) tier = "stretch";
  else if (minor.length === 1 || notRead) tier = "good";
  else tier = "strong";
  // Never Strong without reading the requirements, and never Strong on a near title.
  if (tier === "strong" && (notRead || f.titleRank !== 0 || answeredNo)) tier = "good";
  return { tier, gaps: [...major, ...minor], notRead, licence };
}

// ---------------------------------------------------------------------------
// Order, collapse and caps
// ---------------------------------------------------------------------------

/** Freshness bucket by the employer's own date: 0-3, 4-7, 8-14, 15-30 days; 4 = unknown. */
export function freshnessBucket(postedAt: string | null | undefined, nowMs: number, redates = false): number {
  if (!postedAt || redates) return 4;
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return 4;
  const d = Math.max(0, (nowMs - t) / 86_400_000);
  return d <= 3 ? 0 : d <= 7 ? 1 : d <= 14 ? 2 : d <= 30 ? 3 : 4;
}
/** Sources that re-date a posting under the same id (memory: Ashby), whose posted date orders nothing. */
export const REDATING_SOURCES: ReadonlySet<string> = new Set(["ashby"]);

export interface Orderable {
  tier: Tier;
  lane: Lane;
  freshness: number;
  openings: number;
  overlap?: number | null;
  titleRankScore?: number;
  serverOrder: number;
}
const TIER_ORDER: Record<Tier, number> = { strong: 0, good: 1, stretch: 2 };

/** Within a tier: lane, freshness, several openings, keyword overlap (last), then the server's order. */
export function compareRows(a: Orderable, b: Orderable): number {
  return TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
    || LANE_ORDER[a.lane] - LANE_ORDER[b.lane]
    || a.freshness - b.freshness
    || b.openings - a.openings
    || (b.overlap ?? -1) - (a.overlap ?? -1)
    || a.serverOrder - b.serverOrder;
}

export const EMPLOYER_CAP_TOP = 2;
export const TOP_N = 20;

/** Same employer, normalised title and place: one row, "N openings". */
export function siblingKey(row: { company_token?: string | null; company?: string | null; title?: string | null; location?: string | null }): string {
  const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${norm(row.company_token || row.company)}|${norm(row.title)}|${norm(row.location)}`;
}
/** An Oracle requisition listed on several career sites: "oracle:tenant~pod~SITE:123" -> "oracle:tenant~pod:123". */
export function requisitionKey(id: string): string | null {
  const m = /^oracle:([^~:]+~[^~:]+)~[^:]+:(.+)$/.exec(id);
  return m ? `oracle:${m[1]}:${m[2]}` : null;
}

/**
 * Collapse siblings and Oracle sub-site copies, then hold each employer to
 * EMPLOYER_CAP_TOP rows inside the top TOP_N: the excess moves below the top
 * TOP_N, it is never dropped. Input must already be ordered.
 */
export function collapseAndCap<T extends { id: string; employer: string; sibling: string; openings: number }>(rows: readonly T[]): T[] {
  const bySibling = new Map<string, T>();
  const byReq = new Map<string, T>();
  const kept: T[] = [];
  for (const r of rows) {
    const s = bySibling.get(r.sibling);
    if (s) { s.openings += r.openings; continue; }
    const req = requisitionKey(r.id);
    if (req) {
      const o = byReq.get(req);
      if (o) continue;
      byReq.set(req, r);
    }
    bySibling.set(r.sibling, r);
    kept.push(r);
  }
  const head: T[] = [];
  const tail: T[] = [];
  const perEmployer = new Map<string, number>();
  for (const r of kept) {
    const n = perEmployer.get(r.employer) ?? 0;
    if (head.length < TOP_N && n >= EMPLOYER_CAP_TOP) { tail.push(r); continue; }
    perEmployer.set(r.employer, n + 1);
    if (head.length < TOP_N) head.push(r);
    else tail.push(r);
  }
  return [...head, ...tail];
}

// ---------------------------------------------------------------------------
// The set-aside summary
// ---------------------------------------------------------------------------

export interface SetAsideCount { count: number; basis: string }

/** Each reason's count with the rows it was counted over. */
export function setAsideCounts(gated: ReadonlyArray<Gate>, totals: { found: number; read: number }): Partial<Record<SetAsideReason, SetAsideCount>> {
  const out: Partial<Record<SetAsideReason, SetAsideCount>> = {};
  for (const g of gated) {
    const basis = DESCRIPTION_REASONS.has(g.reason) ? `of the ${totals.read} postings we read` : `of the ${totals.found} postings we found`;
    const cur = out[g.reason] ?? { count: 0, basis };
    cur.count += 1;
    out[g.reason] = cur;
  }
  return out;
}

/** "Set aside: 34 outside where you said you can work · 12 senior titles · of the 40 we read: 3 say they won't sponsor". */
export function setAsideSummary(counts: Partial<Record<SetAsideReason, SetAsideCount>>, read: number): string | null {
  const place: string[] = [];
  const desc: string[] = [];
  for (const [k, v] of Object.entries(counts) as Array<[SetAsideReason, SetAsideCount]>) {
    if (!v || v.count === 0) continue;
    (DESCRIPTION_REASONS.has(k) ? desc : place).push(`${v.count} ${SET_ASIDE_SHORT[k]}`);
  }
  if (!place.length && !desc.length) return null;
  const parts = [...place];
  if (desc.length) parts.push(`of the ${read} we read: ${desc.join(", ")}`);
  return `Set aside: ${parts.join(" · ")}`;
}

export type { Licence, LicenceKind, LicenceVerdict, PostingLicence };
