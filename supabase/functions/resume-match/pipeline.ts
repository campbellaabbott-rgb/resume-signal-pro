/**
 * THE MATCH PIPELINE: profile -> family -> ring -> one statement -> place,
 * gate -> requirements for the top 40 -> tiers -> order -> collapse and cap.
 *
 * Kept apart from index.ts so the Deno test and the pglite test run the same
 * code the function serves, against a client they hand it (supabase-js in
 * production; a real Postgres in src/test/match-endpoint.test.ts).
 *
 * BUDGETS (spec 17). One match_candidates statement under a 1.2 s deadline,
 * at most ONE automatic widening statement, and every step's deadline is the
 * smaller of its own and what is left of the overall 2.5 s (counted from the
 * request's start, the limiters included). After a missed candidates, widening
 * or requirements deadline no further statement runs in the request:
 * withDeadline is a race and cannot cancel SQL, so a statement left running
 * must not be joined by another. A missed RING deadline (a small indexed read
 * of geo_places) is the one exception: the city alone stands in for the ring,
 * the note says so, deadlineMissed says "ring", and the request goes on, so
 * one slow geo lookup does not cap every row at Good. The description read
 * starts only while 800 ms are left; the cache write runs after the answer
 * when the runtime can (EdgeRuntime.waitUntil), and otherwise only while
 * 400 ms are left. At most 6 uncached posting-term walks or 40,000
 * description characters. computeFit is never called here: MCP and /v1 keep
 * calling job-fit fit-batch on the ids this returns.
 *
 * NOTHING ABOUT THE READER IS LOGGED, STORED OR FORWARDED. The only write is the
 * posting-requirements cache (posting text facts); the only log line carries
 * counts and timings.
 */
import {
  adjacentFamily, familyByKey, familyForTitles, fallbackFamily, familyQuery, levelFacets, notListed, titleRank, TITLE_FAMILIES_VERSION,
  type TitleFamily,
} from "../_shared/title-families.ts";
import {
  DESCRIPTION_READ_CHARS, effectiveMinYears, EXTRACTOR_VERSION, extractRequirements, planTermWalks, postingTerms, type PostingRequirements,
  READ_TOP, readable,
} from "../_shared/posting-requirements.ts";
import {
  collapseAndCap, compareRows, type CountriesBasis, countryDisplay, fill, FOOTER, FOOTER_HOME, freshnessBucket, gateFor, type Gate,
  KEYWORDS_PENDING, type Lane, LANE_ORDER, MATCH_TIERS_VERSION, NO_HOME, PLACE_LINE, type PlaceVerdict, REDATING_SOURCES,
  REQUIREMENTS_NOT_READ, RING_FALLBACK, type RowFacets, setAsideCounts, setAsideLabel, setAsideSummary, siblingKey, THIN_RESULTS, type Tier,
  tierFor, type TierReader, TOP_N, USAJOBS_NOTE, WIDEN_STEP_LABEL,
} from "../_shared/match-tiers.ts";
import { NLC_STATES, PRACTICE_BOUND, statesIn, type Licence } from "../_shared/licence-rules.ts";
import { STATE_ALIASES, sanitizeTerm } from "../_shared/location-terms.ts";
import { employerDisplayName } from "../_shared/employer-names.ts";

export const PIPELINE_VERSION = "2026-10-16.2";
/** Phase 1: job-board/index.ts and public-api/index.ts serve 30 days; a test holds the three equal. */
export const FRESH_WINDOW_DAYS = 30;
/** Every step's deadline is at most what is left of this, counted from the request's start. */
export const OVERALL_DEADLINE_MS = 2_500;
export const CANDIDATES_DEADLINE_MS = 1_200;
export const RING_DEADLINE_MS = 400;
export const READ_DEADLINE_MS = 700;
/** The requirements phase (cache read, then descriptions) starts only while this much of the overall budget is left. */
export const READ_MIN_LEFT_MS = 800;
/** After the cache read, the description fetch starts only while this much is left (the fetch plus extraction CPU). */
export const DESCRIPTIONS_MIN_LEFT_MS = 400;
/** The cache write, awaited, runs only while this much is left; in the background it gets BACKGROUND_WRITE_MS. */
export const WRITE_DEADLINE_MS = 400;
export const BACKGROUND_WRITE_MS = 2_000;
/** Widening runs automatically only while this much of the overall budget is unspent. */
export const AUTO_WIDEN_BEFORE_MS = 1_000;
/** No requirements read starts after this point in the request. */
export const REQUIREMENTS_BEFORE_MS = 1_900;
export const RING_MAX_PLACES = 20;
/** match_candidates accepts at most this many ring arms. */
export const RING_ARMS_MAX = 40;
export const LANE_LIMIT = 120;
export const MAX_WIDEN_STEP = 6;
export const SET_ASIDE_ROWS_MAX = 60;
/** The anonymous site answer carries at most this many required and preferred lines per posting; mcp and v1 carry 12. */
export const SITE_LINES_MAX = 4;

export interface Place { city: string; region: string | null; country: string | null }
export interface MatchInput {
  roles: string[];
  home: Place | null;
  extraPlaces: Place[];
  relocate: "none" | "country" | string[];
  remote: boolean;
  radiusKm: number;
  canWorkIn: string[];
  /** Whether the reader named the countries, or they are the résumé's home country by default. Absent = declared. */
  countriesBasis?: CountriesBasis;
  level: TierReader["level"];
  years: { low: number; high: number } | null;
  targetYears: number | null;
  careerChanger: boolean;
  former: string | null;
  student: boolean;
  degree: string | null;
  licences: Licence[];
  workAuth: TierReader["workAuth"];
}

export interface Client {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> & { abortSignal?: (s: AbortSignal) => unknown };
  from(table: string): any;
}

export interface RunOptions {
  widen: number;
  excludeSources: string[] | null;
  order: "rank" | "recent";
  nowMs: number;
  startedMs: number;
  clock: () => number;
  /** Required and preferred lines kept per posting in the answer (the cache keeps them all). Default 12. */
  linesMax?: number;
  /** Runs a promise after the answer (EdgeRuntime.waitUntil). Absent: the cache write is awaited while time is left. */
  background?: (p: Promise<unknown>) => void;
}

type Candidate = {
  id: string; source: string | null; company_token: string | null; company: string | null; title: string | null;
  location: string | null; country: string | null; remote: boolean | null; work_mode: string | null;
  employment_type: string | null; posted_at: string | null; salary: string | null; salary_min_annual: number | null;
  salary_max_annual: number | null; salary_period: string | null; salary_currency: string | null;
  experience_band: string | null; min_years: number | null; agency: boolean | null; lane: Lane; title_rank: number | null;
  siblings: number | null;
};

class DeadlineMissed extends Error {}

async function withDeadline<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new DeadlineMissed(`deadline ${ms} ms`)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function signalled<T extends { abortSignal?: (s: AbortSignal) => unknown }>(q: T, ms: number): T {
  if (typeof q.abortSignal === "function") {
    try { q.abortSignal(AbortSignal.timeout(ms)); } catch { /* the builder cannot take a signal: the race still bounds it */ }
  }
  return q;
}

// ---------------------------------------------------------------------------
// Place names: accents, typed apostrophes and street names
// ---------------------------------------------------------------------------

/** The board stores the ASCII apostrophe; these are the five a phone types (job-board/typed-text.ts). */
const TYPED_APOSTROPHES = /[‘’‛ʼ＇]/g;
/** A place name compared without accents or typed apostrophes: Montréal is Montreal, St. John’s is St. John's. */
export const foldPlace = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(TYPED_APOSTROPHES, "'");

/**
 * The ring's location arms: each place's own name (apostrophes folded, as the
 * board stores them), its accent-free spelling and GeoNames' ASCII name, each
 * once. An ILIKE '%Montréal%' never matches the board's "Montreal"; 12 of 17
 * Montreal rows the measurer saw were unaccented.
 */
export function ringTerms(places: ReadonlyArray<{ name: string; asciiName?: string | null }>): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    const t = sanitizeTerm(String(s ?? "").replace(TYPED_APOSTROPHES, "'"));
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const p of places) { add(p.name); add(foldPlace(p.name)); add(p.asciiName); }
  return out.slice(0, RING_ARMS_MAX);
}

const STREET_AFTER = /^\s+(?:ave(?:nue)?|st(?:reet)?|rd|road|blvd|boulevard|pkwy|parkway|hwy|highway|pike|dr(?:ive)?|ln|lane|ct|court|pl|place|ter(?:race)?|cir(?:cle)?)\b/i;
const STREET_BEFORE = /(?:\b\d{1,6}[a-z]?\s+(?:[NSEW]\.?\s+)?|(?:^|[^A-Za-z])[NSEW]\.?\s+)$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a location names a place: as a word, after folding both sides, and
 * not as a street ("801 S Milwaukee Ave" is in Libertyville, IL).
 */
export function namesPlace(loc: string, name: string): boolean {
  const L = foldPlace(loc);
  const N = foldPlace(name).trim();
  if (!N) return false;
  const re = new RegExp(`(^|[^A-Za-z])${esc(N)}(?=[^A-Za-z]|$)`, "gi");
  for (const m of L.matchAll(re)) {
    const start = (m.index ?? 0) + m[1].length;
    const end = start + N.length;
    if (STREET_AFTER.test(L.slice(end))) continue;
    if (STREET_BEFORE.test(L.slice(0, start))) continue;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rings, cached in isolate memory
// ---------------------------------------------------------------------------

type RingPlace = { name: string; asciiName?: string | null; region: string | null; regionName: string | null; country: string };
const RING_CACHE = new Map<string, { places: RingPlace[]; at: number }>();
const RING_TTL_MS = 6 * 3_600_000;
export function clearRingCache(): void { RING_CACHE.clear(); }

async function ringFor(client: Client, home: Place, km: number, ms: number): Promise<RingPlace[] | null> {
  const key = `${home.city.toLowerCase()}|${(home.region ?? "").toLowerCase()}|${home.country}|${km}`;
  const hit = RING_CACHE.get(key);
  if (hit && Date.now() - hit.at < RING_TTL_MS) return hit.places;
  const q = signalled(client.rpc("metro_ring", { p_city: home.city, p_region: home.region, p_country: home.country, p_km: km, p_max: RING_MAX_PLACES }), ms);
  const { data, error } = await withDeadline(q, ms);
  if (error) return null;
  const places = ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
    name: String(r.name), asciiName: r.ascii_name ? String(r.ascii_name) : null,
    region: r.region ? String(r.region) : null, regionName: r.region_name ? String(r.region_name) : null, country: String(r.country),
  }));
  RING_CACHE.set(key, { places, at: Date.now() });
  return places;
}

// ---------------------------------------------------------------------------
// Regions, by country
// ---------------------------------------------------------------------------

const CA_CODES = /(?:^|[^A-Za-z])(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)(?=[^A-Za-z]|$)/g;
const CA_NAMES: Array<[RegExp, string]> = ([
  ["ontario", "ON"], ["quebec", "QC"], ["british columbia", "BC"], ["alberta", "AB"], ["manitoba", "MB"], ["saskatchewan", "SK"],
  ["nova scotia", "NS"], ["new brunswick", "NB"], ["newfoundland", "NL"], ["prince edward island", "PE"],
] as Array<[string, string]>).map(([n, c]) => [new RegExp(`\\b${n}\\b`, "i"), c]);
/** Australia's three-letter codes collide with nothing; WA, SA and NT collide with US codes and count only on an Australian row. */
const AU_CODES_SAFE = /(?:^|[^A-Za-z])(QLD|NSW|VIC|TAS|ACT)(?=[^A-Za-z]|$)/g;
const AU_CODES_ALL = /(?:^|[^A-Za-z])(QLD|NSW|VIC|TAS|ACT|WA|SA|NT)(?=[^A-Za-z]|$)/g;
export const AU_REGION_NAMES: Record<string, string> = {
  QLD: "Queensland", NSW: "New South Wales", VIC: "Victoria", TAS: "Tasmania", ACT: "Australian Capital Territory",
  WA: "Western Australia", SA: "South Australia", NT: "Northern Territory",
};
const AU_NAMES: Array<[RegExp, string]> = Object.entries(AU_REGION_NAMES)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([c, n]) => [new RegExp(`\\b${n}\\b`, "i"), c]);

/**
 * The regions a location names, READ FOR THE ROW'S COUNTRY: US states (codes
 * and names) only on a US row, Canadian provinces on a Canadian one, Australian
 * states on an Australian one. "Pune, IN" is India, "Munich, DE" Germany,
 * "Toronto, CA" Canada and "Derby DE1" a UK postcode, never Indiana, Delaware
 * or California. A row whose country is unknown is read for the US and Canada
 * (and Australia's unambiguous codes).
 */
export function regionsIn(loc: string, country: string | null = null): string[] {
  const L = foldPlace(loc);
  const out = new Set<string>();
  if (!country || country === "US") for (const s of statesIn(L)) out.add(s);
  if (!country || country === "CA") {
    for (const m of L.matchAll(CA_CODES)) out.add(m[1]);
    for (const [re, c] of CA_NAMES) if (re.test(L)) out.add(c);
  }
  if (!country) for (const m of L.matchAll(AU_CODES_SAFE)) out.add(m[1]);
  if (country === "AU") {
    for (const m of L.matchAll(AU_CODES_ALL)) out.add(m[1]);
    let rest = L;
    for (const [re, c] of AU_NAMES) if (re.test(rest)) { out.add(c); rest = rest.replace(re, " "); }
  }
  return [...out];
}

function regionName(code: string, country: string | null = null): string {
  if (country === "AU" && AU_REGION_NAMES[code.toUpperCase()]) return AU_REGION_NAMES[code.toUpperCase()];
  const hit = STATE_ALIASES[code.toLowerCase()];
  return hit?.names.find((n) => !n.startsWith(", ")) ?? AU_REGION_NAMES[code.toUpperCase()] ?? code;
}

/** "TX" -> ["Texas", ", TX"]: search_jobs' alias format, for the region lane. An Australian reader's WA is Western Australia. */
export function regionAliases(codes: readonly string[], country: string | null = null): string[] {
  const out: string[] = [];
  const push = (s: string) => { if (!out.includes(s)) out.push(s); };
  for (const c of codes) {
    const up = c.toUpperCase();
    if (country === "AU" && AU_REGION_NAMES[up]) {
      push(AU_REGION_NAMES[up]);
      push(`, ${up}`);
      continue;
    }
    const hit = STATE_ALIASES[c.toLowerCase()];
    if (hit) for (const n of hit.names) push(n);
    else if (AU_REGION_NAMES[up] && up.length === 3) push(AU_REGION_NAMES[up]);
  }
  return out.slice(0, 40);
}

/** Words that name a country, or no place at all, and nothing more specific. */
const NO_PLACE_WORDS = /\b(?:united states(?: of america)?|usa|us|america|united kingdom|uk|great britain|britain|england|scotland|wales|northern ireland|canada|australia|germany|deutschland|india|ireland|netherlands|france|spain|italy|portugal|poland|new zealand|anywhere|nationwide|countrywide|multiple locations|various locations|multiple|various|locations?|in[- ]office|on[- ]?site|hybrid|office)\b/gi;
/** A location that names only a country (or nothing): there is no place to compare. */
export function namesNoPlace(loc: string | null, country: string | null): boolean {
  let rest = foldPlace(loc ?? "").replace(NO_PLACE_WORDS, " ");
  if (country) rest = rest.replace(new RegExp(`(^|[^A-Za-z])${esc(country)}(?=[^A-Za-z]|$)`, "gi"), " ");
  return rest.replace(/[^A-Za-z]+/g, "").length < 2;
}

/** The part of a location that does not exclude: "Remote, US (excluding CA, NY)" requires neither state. */
function withoutExclusions(loc: string): string {
  return loc.replace(/\b(?:excluding|excludes|except(?: for)?|not (?:available )?in|outside(?: of)?|no)\b[^)|;\]]*/gi, " ");
}

// ---------------------------------------------------------------------------
// Placing a returned row (spec 6.4, 6.7): null-tolerant, never trusting a flag alone.
// ---------------------------------------------------------------------------

const US_HINT = /\b(united states|usa)\b|(^|[^A-Za-z])US([^A-Za-z]|$)/;
const LITERAL_REMOTE = /\b(remote|virtual|online|work from home|wfh|telecommut\w*|home[- ]based)\b/i;

function namesRegionOf(loc: string, p: RingPlace, named: string[]): boolean {
  if (p.region && named.includes(p.region.toUpperCase())) return true;
  return !!p.regionName && new RegExp(`\\b${esc(foldPlace(p.regionName))}\\b`, "i").test(foldPlace(loc));
}

export interface PlaceContext {
  ring: RingPlace[];
  ringCity: string | null;
  radiusKm: number;
  canWorkIn: string[];
  relocate: MatchInput["relocate"];
  family: TitleFamily;
  licences: Licence[];
  /** The reader's home region (a remote row listing another is labelled so). */
  homeRegion?: string | null;
  /** The regions the reader said they would move to; a region outside it (widening step 5) is "elsewhere in". Absent = all said. */
  saidRegions?: readonly string[] | null;
}

export interface Placed {
  place: PlaceVerdict;
  licenceStateNotStated: boolean;
  rowStates: string[];
  /** A remote row naming a region other than the reader's home one: that region's name. */
  remoteListsRegion: string | null;
}

export function placeRow(row: Candidate, ctx: PlaceContext): Placed {
  const loc = row.location ?? "";
  const title = row.title ?? "";
  let country = row.country ?? null;
  if (!country && US_HINT.test(loc)) country = "US";
  const named = regionsIn(loc, country);
  const flaggedRemote = row.lane === "remote" || row.work_mode === "remote" || row.remote === true || /\bremote\b/i.test(loc);
  const literal = LITERAL_REMOTE.test(`${title} ${loc}`);
  const out = (place: PlaceVerdict, extra: Partial<Placed> = {}): Placed => ({ place, licenceStateNotStated: false, rowStates: named, remoteListsRegion: null, ...extra });

  // REMOTE: valid only when the occupation is not on-site, or the row says remote in words.
  if (flaggedRemote && (!ctx.family.onsite || literal)) {
    if (!country) return out({ kind: "place_not_stated" });
    if (!ctx.canWorkIn.includes(country)) return out({ kind: "outside_countries", country });
    const listed = regionsIn(withoutExclusions(loc), country);
    const remote: PlaceVerdict = { kind: "remote", country, label: fill(PLACE_LINE.remote, { country: countryDisplay(country) }) };
    const lic = ctx.family.licensed;
    // A licence bound to the state of practice (nurse, therapist, pharmacist,
    // teacher): a remote US row naming states needs one of them, as
    // licenceVerdict reads it (a licence naming no state covers). A CPA or a
    // PE does not bind a remote desk to a state, and is not checked here.
    if (lic && PRACTICE_BOUND.has(lic) && country === "US") {
      const mine = ctx.licences.filter((l) => l.kind === lic);
      if (!mine.length) return out(remote, { rowStates: listed });
      const covered = (s: string) => mine.some((l) => !l.jurisdiction || l.jurisdiction === s || (l.compact && NLC_STATES.has(l.jurisdiction) && NLC_STATES.has(s)));
      const us = listed.filter((s) => s.length === 2);
      if (us.length === 0) return out(remote, { rowStates: listed, licenceStateNotStated: mine.every((l) => !!l.jurisdiction) });
      if (!us.some(covered)) return out({ kind: "licence_elsewhere", state: us[0] }, { rowStates: listed });
      return out(remote, { rowStates: listed });
    }
    // A remote row that lists a region, none of them the reader's own, may
    // need the reader to live there: said so, never "remote within the US".
    if (listed.length && !(ctx.homeRegion && listed.includes(ctx.homeRegion.toUpperCase()))) {
      const region = regionName(listed[0], country);
      return out({ kind: "remote", country, label: fill(PLACE_LINE.remoteLists, { region }) }, { rowStates: listed, remoteListsRegion: region });
    }
    return out(remote, { rowStates: listed });
  }

  // THE RING: a place name, in that place's state (or naming no state at all on a placed row).
  for (const p of ctx.ring) {
    if (!namesPlace(loc, p.name) && !(p.asciiName && namesPlace(loc, p.asciiName))) continue;
    // Read the row's regions for its own country, or the ring place's when the row names none.
    const here = regionsIn(loc, country ?? p.country);
    const inItsRegion = namesRegionOf(loc, p, here);
    // A place the reader named without a region ("Boston or NYC") cannot conflict with one.
    const conflicting = here.length > 0 && !inItsRegion && !!(p.region || p.regionName);
    if (conflicting) continue;
    const ringLabel = fill(PLACE_LINE.ring, { city: ctx.ringCity ?? p.name, km: ctx.radiusKm });
    if (!country) {
      // A null-country row is kept only when it names the ring place AND that place's state.
      if (inItsRegion) return out({ kind: "ring", label: ringLabel }, { rowStates: here });
      continue;
    }
    if (country !== p.country) continue;
    if (!ctx.canWorkIn.includes(country)) return out({ kind: "outside_countries", country });
    const same = foldPlace(p.name).toLowerCase() === foldPlace(ctx.ringCity ?? "").toLowerCase();
    return out({ kind: "ring", label: same ? ringLabel : `${p.name} · ${ringLabel}` });
  }

  if (country && !ctx.canWorkIn.includes(country)) return out({ kind: "outside_countries", country });
  if (Array.isArray(ctx.relocate) && country) {
    const hit = ctx.relocate.find((r) => named.includes(r.toUpperCase()));
    if (hit) {
      const said = !ctx.saidRegions || ctx.saidRegions.some((s) => s.toUpperCase() === hit.toUpperCase());
      return out({ kind: "region", region: hit, label: fill(said ? PLACE_LINE.region : PLACE_LINE.elsewhere, { region: regionName(hit, country) }) });
    }
  }
  // Anywhere in a country the reader said they would move within: any named
  // place there, a city named alone included; a location naming no place is
  // "place not stated", never "beyond where you'd move".
  if (ctx.relocate === "country" && country) {
    if (namesNoPlace(loc, country)) return out({ kind: "place_not_stated" });
    return out({ kind: "country", country, label: fill(PLACE_LINE.country, { country: countryDisplay(country) }) });
  }
  // No country and no region, or a location naming no place: nothing to say it is beyond the commute.
  if (named.length === 0 && (!country || namesNoPlace(loc, country))) return out({ kind: "place_not_stated" });
  return out({ kind: "beyond_commute" });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface MatchRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  country: string | null;
  remote: boolean;
  workMode: string | null;
  employmentType: string | null;
  postedAt: string | null;
  salary: string | null;
  agency: boolean;
  lane: Lane;
  tier: Tier;
  gaps: string[];
  openings: number;
  placeLine: string;
  widenStep: number;
  /** Whether the posting's text was read. What it asks (quoted) is in facets.requirements, sent once. */
  requirements: "read" | "not read";
  postingTerms: string[] | "pending";
  sourceNote: string | null;
  facets: RowFacets;
}
export interface SetAsideRow { id: string; title: string; company: string; location: string | null; reason: Gate["reason"]; detail: string | null }

export interface MatchResult {
  family: { key: string; label: string } | null;
  versions: { pipeline: string; families: string; extractor: string; tiers: string };
  searched: {
    titles: string[]; places: string[]; ringSource: "geonames" | "city-only" | "none"; radiusKm: number;
    countries: string[]; lanes: Lane[]; order: "rank" | "recent"; excludedSources: string[];
  };
  rows: MatchRow[];
  more: number;
  setAside: Partial<Record<Gate["reason"], { count: number; basis: string; label: string }>>;
  setAsideRows: SetAsideRow[];
  summary: string | null;
  steps: Array<{ step: number; label: string; added: number }>;
  nextWiden: number | null;
  thin: boolean;
  notes: string[];
  basis: { found: number; passed: number; read: number; walked: number; pending: number };
  deadlineMissed: "ring" | "candidates" | "widen" | "requirements" | null;
  phaseMs: { ring: number; candidates: number; requirements: number; terms: number };
  cpuMs: number;
  footer: string;
}

interface Staged {
  row: Candidate;
  facets: RowFacets;
  gate: Gate | null;
  serverOrder: number;
}

function reader(input: MatchInput): TierReader {
  return {
    level: input.level, years: input.years, targetYears: input.targetYears, careerChanger: input.careerChanger,
    student: input.student, workAuth: input.workAuth, licences: input.licences, degree: input.degree,
  };
}

/** The answer's copy of what a posting asks: every field the tiers read, its required and preferred lines cut to `max`. */
function answerRequirements(q: PostingRequirements, max: number): PostingRequirements {
  return q.must.length <= max && q.nice.length <= max ? q : { ...q, must: q.must.slice(0, max), nice: q.nice.slice(0, max) };
}

export async function runMatch(client: Client, input: MatchInput, opts: RunOptions): Promise<MatchResult> {
  const elapsed = () => opts.clock() - opts.startedMs;
  const left = () => OVERALL_DEADLINE_MS - elapsed();
  /** A step's deadline: its own, or what is left of the overall budget, whichever is smaller. */
  const budget = (own: number) => Math.max(1, Math.min(own, Math.floor(left())));
  let cpu = 0;
  const sync = <T>(f: () => T): T => { const s = opts.clock(); try { return f(); } finally { cpu += opts.clock() - s; } };
  const phaseMs = { ring: 0, candidates: 0, requirements: 0, terms: 0 };
  const notes: string[] = [];
  let deadlineMissed: MatchResult["deadlineMissed"] = null;
  /** Set by a candidates, widening or requirements miss: no further statement. A ring miss does not set it. */
  let blocked = false;
  const missed = (which: Exclude<MatchResult["deadlineMissed"], null>) => {
    if (which === "ring") { deadlineMissed ??= "ring"; return; }
    deadlineMissed = which;
    blocked = true;
  };
  const linesMax = Math.max(1, opts.linesMax ?? 12);
  const countriesBasis: CountriesBasis = input.countriesBasis ?? "declared";
  const footer = countriesBasis === "home" ? FOOTER_HOME : FOOTER;

  // ---- the occupation
  const mapped = sync(() => familyForTitles(input.roles));
  const family: TitleFamily | null = mapped?.family ?? sync(() => fallbackFamily(input.roles));
  /** A fallback family is the reader's own words: always quoted, never any word order. */
  const literal = !mapped;
  const formerFamily = input.former ? (familyForTitles([input.former])?.family ?? null) : null;
  const tierReader = reader(input);
  if (!input.home?.city) notes.push(NO_HOME);

  const empty = (extra: Partial<MatchResult> = {}): MatchResult => ({
    family: mapped ? { key: mapped.family.key, label: mapped.family.label } : null,
    versions: { pipeline: PIPELINE_VERSION, families: TITLE_FAMILIES_VERSION, extractor: EXTRACTOR_VERSION, tiers: MATCH_TIERS_VERSION },
    searched: { titles: input.roles, places: [], ringSource: "none", radiusKm: input.radiusKm, countries: input.canWorkIn, lanes: [], order: opts.order, excludedSources: opts.excludeSources ?? [] },
    rows: [], more: 0, setAside: {}, setAsideRows: [], summary: null, steps: [], nextWiden: null, thin: true, notes,
    basis: { found: 0, passed: 0, read: 0, walked: 0, pending: 0 }, deadlineMissed, phaseMs, cpuMs: Math.round(cpu), footer, ...extra,
  });
  if (!family) return empty();

  // ---- the ring
  const radius = opts.widen === 4 ? 80 : input.radiusKm;
  let ring: RingPlace[] = [];
  let ringSource: MatchResult["searched"]["ringSource"] = "none";
  if (input.home?.city && input.home.country) {
    const t0 = opts.clock();
    try {
      const got = await ringFor(client, input.home, radius, budget(RING_DEADLINE_MS));
      if (got && got.length) { ring = got; ringSource = "geonames"; }
    } catch (e) {
      if (e instanceof DeadlineMissed) missed("ring");
    }
    phaseMs.ring = Math.round(opts.clock() - t0);
    if (!ring.length) {
      ring = [{ name: input.home.city, region: input.home.region, regionName: input.home.region ? regionName(input.home.region, input.home.country) : null, country: input.home.country }];
      ringSource = "city-only";
      notes.push(fill(RING_FALLBACK, { city: input.home.city }));
    }
  }
  const extras = input.extraPlaces.filter((p) => p.city && !ring.some((r) => foldPlace(r.name).toLowerCase() === foldPlace(p.city).toLowerCase()));
  ring = [...ring.slice(0, Math.max(1, RING_MAX_PLACES - extras.length)), ...extras.map((p) => ({ name: p.city, region: p.region, regionName: p.region ? regionName(p.region, p.country) : null, country: p.country ?? input.home?.country ?? "US" }))];
  const ringNames = ringTerms(ring);
  const ringCountries = [...new Set(ring.map((r) => r.country))];

  // ---- the statement (one per request, plus at most one automatic widening)
  // The home country first: the country lane reads the first three only (match_candidates).
  const homeCountry = input.home?.country ?? null;
  const countries = homeCountry && input.canWorkIn.includes(homeCountry) ? [homeCountry, ...input.canWorkIn.filter((c) => c !== homeCountry)] : input.canWorkIn;
  const regions = Array.isArray(input.relocate) ? input.relocate : [];
  const regionCountry = homeCountry ?? countries[0] ?? null;
  const lanes: Lane[] = [];
  if (ringNames.length) lanes.push("ring");
  if (input.remote && countries.length) lanes.push("remote");
  if (regions.length && countries.length) lanes.push("region");
  if (input.relocate === "country" && countries.length) lanes.push("country");
  /** Widening step 5 places region rows as if the reader had said their own region, labelled "elsewhere in". */
  const step5Regions = input.home?.region ? [...new Set([input.home.region.toUpperCase(), ...regions.map((r) => r.toUpperCase())])] : regions;

  const freshCutoff = new Date(opts.nowMs - FRESH_WINDOW_DAYS * 86_400_000).toISOString();
  const statement = async (step: number): Promise<Candidate[]> => {
    let phrases: readonly string[] = family.q;
    let simple: readonly string[] = family.qSimple ?? [];
    let anyOrder = false;
    let useRegions = regions;
    let useRemote = input.remote;
    let useCountry = input.relocate === "country";
    let useRing = ringNames;
    if (step === 1) anyOrder = !literal;
    if (step === 2) { phrases = [family.headNoun]; simple = []; }
    if (step === 3) { phrases = family.adjacent ?? []; simple = []; }
    if (step === 5) { useRegions = input.home?.region ? [input.home.region] : []; useRemote = false; useCountry = false; useRing = []; }
    if (step === 6) {
      if (!formerFamily) return [];
      phrases = formerFamily.q; simple = formerFamily.qSimple ?? [];
    }
    if (!phrases.length && !simple.length) return [];
    const isLiteral = literal && step !== 6;
    const args = {
      p_q_en: familyQuery(phrases, anyOrder, isLiteral) || null,
      p_q_simple: simple.length ? familyQuery(simple, anyOrder, isLiteral) : null,
      p_fresh_cutoff: freshCutoff,
      p_countries: countries,
      p_ring: useRing,
      p_remote: useRemote && countries.length > 0,
      p_regions: regionAliases(useRegions, regionCountry),
      p_country_lane: useCountry && countries.length > 0,
      p_exclude_sources: opts.excludeSources,
      p_lane_limit: LANE_LIMIT,
      p_order: opts.order,
      p_ring_countries: ringCountries.length ? ringCountries : null,
    };
    const ms = budget(CANDIDATES_DEADLINE_MS);
    const q = signalled(client.rpc("match_candidates", args), ms);
    const { data, error } = await withDeadline(q, ms);
    if (error) throw new Error(`match_candidates: ${error.code ?? ""} ${String(error.message ?? "").slice(0, 120)}`);
    return ((data as Candidate[]) ?? []).map((r) => ({ ...r, lane: r.lane as Lane }));
  };

  const staged: Staged[] = [];
  const seen = new Set<string>();
  const steps: MatchResult["steps"] = [];
  const stage = (rows: Candidate[], step: number) => sync(() => {
    let added = 0;
    const sorted = [...rows].sort((a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane]);
    const famForStep: TitleFamily = step === 2
      ? { ...family, core: /$^/, near: new RegExp(`\\b${esc(family.headNoun)}s?\\b`, "i") }
      : step === 3 ? (adjacentFamily(family) ?? family)
        : step === 6 && formerFamily ? formerFamily : family;
    const ctx: PlaceContext = {
      ring, ringCity: input.home?.city ?? null, radiusKm: radius, canWorkIn: countries, family, licences: input.licences,
      relocate: step === 5 && step5Regions.length ? step5Regions : input.relocate,
      saidRegions: step === 5 ? regions : null,
      homeRegion: input.home?.region ?? null,
    };
    for (const r of sorted) {
      if (!r.id || seen.has(r.id)) continue;
      seen.add(r.id);
      const title = r.title ?? "";
      const placed = placeRow(r, ctx);
      let rank = titleRank(famForStep, title);
      if (step === 2 && rank === 1 && notListed(family, title)) rank = 9;
      const prev = step !== 6 && !!formerFamily && formerFamily.key !== family.key && titleRank(formerFamily, title) !== 9 && titleRank(family, title) !== 0;
      const facets: RowFacets = {
        place: placed.place,
        titleRank: rank,
        previousField: step === 6 ? true : prev,
        level: levelFacets(title, famForStep),
        levelInQuery: !!famForStep.levelInQuery,
        assistantIsJunior: !!family.assistantIsJunior,
        widenStep: step,
        minYears: effectiveMinYears(r.min_years, null),
        band: r.experience_band,
        requirements: "not read",
        rowStates: placed.rowStates,
        licenceStateNotStated: placed.licenceStateNotStated,
        country: r.country,
        remoteListsRegion: placed.remoteListsRegion,
      };
      staged.push({ row: r, facets, gate: step === 6 ? { reason: "previous_field" } : gateFor(facets, tierReader), serverOrder: staged.length });
      added++;
    }
    return added;
  });

  const requestedStep = Math.max(0, Math.min(MAX_WIDEN_STEP, Math.floor(opts.widen || 0)));
  const t1 = opts.clock();
  try {
    const first = await statement(requestedStep);
    const added = stage(first, requestedStep);
    steps.push({ step: requestedStep, label: requestedStep === 0 ? "exact titles" : stepLabel(requestedStep, family, input), added });
  } catch (e) {
    if (e instanceof DeadlineMissed) missed("candidates");
    else throw e;
  }
  phaseMs.candidates = Math.round(opts.clock() - t1);

  const passingCount = () => staged.filter((s) => !s.gate).length;
  // Any word order means nothing for a reader's own quoted words, so a fallback family never widens to it.
  if (!blocked && !literal && requestedStep === 0 && passingCount() < TOP_N && elapsed() < AUTO_WIDEN_BEFORE_MS) {
    const t2 = opts.clock();
    try {
      const more = await statement(1);
      steps.push({ step: 1, label: stepLabel(1, family, input), added: stage(more, 1) });
    } catch (e) {
      if (e instanceof DeadlineMissed) missed("widen");
      else throw e;
    }
    phaseMs.candidates += Math.round(opts.clock() - t2);
  }

  // ---- preliminary order, then requirements for the top READ_TOP that pass
  const nowMs = opts.nowMs;
  const orderable = (s: Staged, tier: Tier) => ({
    tier, lane: laneOf(s), freshness: freshnessBucket(s.row.posted_at, nowMs, REDATING_SOURCES.has(String(s.row.source ?? ""))),
    openings: Math.max(1, s.row.siblings ?? 1), serverOrder: s.serverOrder - (s.facets.titleRank === 0 ? 1e6 : 0),
  });
  let passing = sync(() => staged.filter((s) => !s.gate).sort((a, b) => compareRows(orderable(a, tierFor(a.facets, tierReader).tier), orderable(b, tierFor(b.facets, tierReader).tier))));
  const toRead = passing.slice(0, READ_TOP).map((s) => s.row.id);
  const reqs = new Map<string, PostingRequirements>();
  const terms = new Map<string, string[]>();
  let walked = 0;
  const descriptionChars = new Map<string, number>();
  const uncachedDescriptions = new Map<string, string>();
  const fresh = new Set<string>();
  if (toRead.length && !blocked && elapsed() < REQUIREMENTS_BEFORE_MS && left() >= READ_MIN_LEFT_MS) {
    const t3 = opts.clock();
    try {
      const ms = budget(READ_DEADLINE_MS);
      const cached = await withDeadline(
        signalled(client.from("job_posting_requirements").select("posting_id, requirements, posting_terms, description_chars").eq("extractor_version", EXTRACTOR_VERSION).in("posting_id", toRead), ms),
        ms,
      ) as { data: Array<{ posting_id: string; requirements: PostingRequirements; posting_terms: string[] | null; description_chars: number }> | null; error: unknown };
      for (const c of cached.data ?? []) {
        reqs.set(c.posting_id, c.requirements);
        if (Array.isArray(c.posting_terms)) terms.set(c.posting_id, c.posting_terms);
        descriptionChars.set(c.posting_id, c.description_chars);
      }
      // Uncached rows are fetched to be read. A cached row whose terms an
      // earlier call left pending is fetched only when this call will walk it
      // (planned on its cached length), never just to be left pending again.
      const uncached = toRead.filter((id) => !reqs.has(id));
      const pendingCached = planTermWalks(toRead.filter((id) => reqs.has(id) && !terms.has(id)).map((id) => ({ id, chars: descriptionChars.get(id) ?? 0 }))).walk;
      const need = [...uncached, ...pendingCached];
      if (need.length && !blocked && left() >= DESCRIPTIONS_MIN_LEFT_MS) {
        const ms2 = budget(READ_DEADLINE_MS);
        const got = await withDeadline(
          signalled(client.from("job_board_postings").select("id, description, min_years").in("id", need), ms2),
          ms2,
        ) as { data: Array<{ id: string; description: string | null; min_years: number | null }> | null; error: unknown };
        sync(() => {
          for (const r of got.data ?? []) {
            if (!readable(r.description)) continue;
            const text = r.description.slice(0, DESCRIPTION_READ_CHARS);
            if (!reqs.has(r.id)) { reqs.set(r.id, extractRequirements(text)); fresh.add(r.id); }
            descriptionChars.set(r.id, text.length);
            uncachedDescriptions.set(r.id, text);
          }
        });
      }
    } catch (e) {
      if (e instanceof DeadlineMissed) missed("requirements");
      else notes.push("Requirements could not be read for this page.");
    }
    phaseMs.requirements = Math.round(opts.clock() - t3);

    // Posting terms: cached first; at most 6 uncached walks / 40,000 characters, in display order.
    const t4 = opts.clock();
    const needTerms = toRead.filter((id) => !terms.has(id) && uncachedDescriptions.has(id)).map((id) => ({ id, chars: descriptionChars.get(id) ?? 0 }));
    const plan = planTermWalks(needTerms);
    const walkedIds = new Set<string>();
    sync(() => {
      for (const id of plan.walk) { terms.set(id, postingTerms(uncachedDescriptions.get(id)!)); walkedIds.add(id); walked++; }
    });
    phaseMs.terms = Math.round(opts.clock() - t4);

    // Cache what was read or walked (posting facts only); a failed write costs the next reader a re-read, nothing more.
    const at = new Date(nowMs).toISOString();
    const writes = [...new Set([...fresh, ...walkedIds])].filter((id) => reqs.has(id)).map((id) => ({
      posting_id: id, extractor_version: EXTRACTOR_VERSION, requirements: reqs.get(id), posting_terms: terms.get(id) ?? null,
      description_chars: descriptionChars.get(id) ?? 0, read_at: at, terms_at: terms.has(id) ? at : null,
    }));
    if (writes.length && !blocked) {
      const write = (ms: number) => withDeadline(signalled(client.from("job_posting_requirements").upsert(writes, { onConflict: "posting_id,extractor_version" }), ms), ms)
        .then(() => undefined, () => undefined);
      if (opts.background) opts.background(write(BACKGROUND_WRITE_MS));
      else if (left() >= WRITE_DEADLINE_MS) await write(budget(WRITE_DEADLINE_MS));
    }
  } else if (toRead.length) {
    notes.push(`${REQUIREMENTS_NOT_READ}: the page answered before the postings could be read.`);
  }
  // Keywords pending: rows whose requirements were read and whose terms are
  // not walked yet. A row with no readable description never fills, so it is
  // not counted.
  const pendingTerms = toRead.filter((id) => reqs.has(id) && !terms.has(id)).length;

  // ---- final facets, gates and tiers
  const readIds = new Set(reqs.keys());
  sync(() => {
    for (const s of staged) {
      const q = reqs.get(s.row.id);
      if (q) {
        s.facets.requirements = answerRequirements(q, linesMax);
        s.facets.minYears = effectiveMinYears(s.row.min_years, q);
        if (!s.gate) s.gate = gateFor(s.facets, tierReader);
      }
    }
  });
  passing = staged.filter((s) => !s.gate);
  const tiered = sync(() => {
    const t = passing.map((s) => ({ s, t: tierFor(s.facets, tierReader) }));
    t.sort((a, b) => compareRows(orderable(a.s, a.t.tier), orderable(b.s, b.t.tier)));
    return t;
  });
  const collapsed = sync(() => collapseAndCap(tiered.map(({ s, t }) => ({
    id: s.row.id, employer: String(s.row.company_token ?? s.row.company ?? "").toLowerCase(), sibling: siblingKey(s.row),
    openings: Math.max(1, s.row.siblings ?? 1), s, t,
  }))));

  const rows: MatchRow[] = sync(() => collapsed.slice(0, TOP_N).map(({ s, t, openings }) => {
    const r = s.row;
    const notRead = !reqs.has(r.id);
    const source = String(r.source ?? "");
    return {
      id: r.id,
      title: r.title ?? "",
      company: employerDisplayName(r.company_token, r.company),
      location: r.location,
      country: r.country,
      remote: r.remote === true || r.work_mode === "remote",
      workMode: r.work_mode,
      employmentType: r.employment_type,
      postedAt: r.posted_at,
      salary: r.salary,
      agency: r.agency === true,
      lane: laneOf(s),
      tier: t.tier,
      gaps: t.gaps,
      openings,
      placeLine: "label" in s.facets.place ? s.facets.place.label : "",
      widenStep: s.facets.widenStep,
      requirements: notRead ? "not read" : "read",
      postingTerms: terms.get(r.id) ?? "pending",
      sourceNote: notRead && source === "usajobs" ? USAJOBS_NOTE : null,
      facets: s.facets,
    } satisfies MatchRow;
  }));

  const built = sync(() => {
    const gates = staged.filter((s) => s.gate).map((s) => s.gate!);
    const counts = setAsideCounts(gates, { found: staged.length, read: readIds.size });
    const setAside: MatchResult["setAside"] = {};
    for (const [k, v] of Object.entries(counts)) {
      if (v) setAside[k as Gate["reason"]] = { ...v, label: setAsideLabel(k as Gate["reason"], countriesBasis) };
    }
    const setAsideRows: SetAsideRow[] = staged.filter((s) => s.gate).slice(0, SET_ASIDE_ROWS_MAX).map((s) => ({
      id: s.row.id, title: s.row.title ?? "", company: employerDisplayName(s.row.company_token, s.row.company), location: s.row.location,
      reason: s.gate!.reason, detail: s.gate!.detail ?? null,
    }));
    return { counts, setAside, setAsideRows };
  });
  const tried = steps.filter((x) => x.step > 0).map((x) => x.label);
  const thin = rows.length < TOP_N && requestedStep === 0;
  if (thin && input.home?.city) {
    // Counted by lane: "N in your commute area" counts only commute-area rows.
    const inRing = rows.filter((r) => r.lane === "ring").length;
    const remoteN = rows.filter((r) => r.lane === "remote").length;
    const moveN = rows.filter((r) => r.lane === "region" || r.lane === "country").length;
    const other = [remoteN ? `${remoteN} remote` : "", moveN ? `${moveN} where you said you'd move` : ""].filter(Boolean);
    notes.push(fill(THIN_RESULTS, {
      n: inRing,
      place: ringSource === "geonames" ? `your ${input.home.city} commute area` : input.home.city,
      elsewhere: other.length ? `; ${other.join(", ")}` : "",
      steps: tried.length ? tried.join(" · ") : "exact titles only",
    }));
  }
  const nextWiden = nextStep(requestedStep, steps, family, input, formerFamily);
  if (pendingTerms > 0) notes.push(`${KEYWORDS_PENDING}: ${pendingTerms} of the postings read fill on a later call.`);

  return {
    family: mapped ? { key: mapped.family.key, label: mapped.family.label } : null,
    versions: { pipeline: PIPELINE_VERSION, families: TITLE_FAMILIES_VERSION, extractor: EXTRACTOR_VERSION, tiers: MATCH_TIERS_VERSION },
    searched: { titles: input.roles, places: ring.map((r) => r.name), ringSource, radiusKm: radius, countries, lanes, order: opts.order, excludedSources: opts.excludeSources ?? [] },
    rows,
    more: Math.max(0, collapsed.length - rows.length),
    setAside: built.setAside,
    setAsideRows: built.setAsideRows,
    summary: setAsideSummary(built.counts, readIds.size, countriesBasis),
    steps,
    nextWiden,
    thin,
    notes,
    basis: { found: staged.length, passed: passing.length, read: readIds.size, walked, pending: pendingTerms },
    deadlineMissed,
    phaseMs,
    cpuMs: Math.round(cpu),
    footer,
  };
}

function laneOf(s: Staged): Lane {
  const k = s.facets.place.kind;
  return k === "ring" || k === "remote" || k === "region" || k === "country" ? k : s.row.lane;
}

export function stepLabel(step: number, family: TitleFamily, input: MatchInput): string {
  return fill(WIDEN_STEP_LABEL[step] ?? `step ${step}`, { headNoun: family.headNoun, region: input.home?.region ? regionName(input.home.region, input.home.country) : "your region" });
}

/** The next follow-up step worth offering, or null: skips steps that cannot apply to this reader. */
function nextStep(current: number, steps: MatchResult["steps"], family: TitleFamily, input: MatchInput, formerFamily: TitleFamily | null): number | null {
  const done = new Set(steps.map((s) => s.step));
  const said = Array.isArray(input.relocate) ? input.relocate.map((r) => r.toUpperCase()) : [];
  for (let n = Math.max(current, 1) + 1; n <= MAX_WIDEN_STEP; n++) {
    if (done.has(n)) continue;
    if (n === 2 && !family.key) continue;
    if (n === 3 && !family.adjacent?.length) continue;
    if (n === 4 && (!input.home || input.radiusKm >= 80)) continue;
    if (n === 5 && (!input.home?.region || input.relocate === "country" || said.includes(input.home.region.toUpperCase()))) continue;
    if (n === 6 && (!input.careerChanger || !formerFamily)) continue;
    return n;
  }
  return null;
}

export { familyByKey };
