/**
 * THE MATCH PIPELINE: profile -> family -> ring -> one statement -> place,
 * gate -> requirements for the top 40 -> tiers -> order -> collapse and cap.
 *
 * Kept apart from index.ts so the Deno test and the pglite test run the same
 * code the function serves, against a client they hand it (supabase-js in
 * production; a real Postgres in src/test/match-endpoint.test.ts).
 *
 * BUDGETS (spec 17): one match_candidates statement under a 1.2 s deadline, at
 * most ONE automatic widening statement, and after any missed deadline no
 * further statement in the request (withDeadline is a race and cannot cancel
 * SQL, so a statement left running must not be joined by another). Overall
 * deadline 2.5 s. At most 6 uncached posting-term walks or 40,000 description
 * characters. computeFit is never called here: MCP and /v1 keep calling job-fit
 * fit-batch on the ids this returns.
 *
 * NOTHING ABOUT THE READER IS LOGGED, STORED OR FORWARDED. The only write is the
 * posting-requirements cache (posting text facts); the only log line carries
 * counts and timings.
 */
import { familyByKey, familyForTitles, fallbackFamily, familyQuery, levelFacets, notListed, titleRank, TITLE_FAMILIES_VERSION, type TitleFamily } from "../_shared/title-families.ts";
import {
  effectiveMinYears, EXTRACTOR_VERSION, extractRequirements, planTermWalks, postingTerms, READ_TOP, readable,
  DESCRIPTION_READ_CHARS, type PostingRequirements,
} from "../_shared/posting-requirements.ts";
import {
  collapseAndCap, compareRows, fill, FOOTER, freshnessBucket, gateFor, type Gate, KEYWORDS_PENDING, type Lane,
  LANE_ORDER, MATCH_TIERS_VERSION, PLACE_LINE, type PlaceVerdict, REDATING_SOURCES, REQUIREMENTS_NOT_READ, RING_FALLBACK,
  type RowFacets, SET_ASIDE_LABEL, setAsideCounts, setAsideSummary, siblingKey, THIN_RESULTS, type Tier, tierFor,
  type TierReader, TOP_N, USAJOBS_NOTE, WIDEN_STEP_LABEL,
} from "../_shared/match-tiers.ts";
import { NLC_STATES, statesIn, stateCodeOf, type Licence } from "../_shared/licence-rules.ts";
import { STATE_ALIASES, sanitizeTerm } from "../_shared/location-terms.ts";
import { employerDisplayName } from "../_shared/employer-names.ts";

export const PIPELINE_VERSION = "2026-10-16.1";
/** Phase 1: job-board/index.ts and public-api/index.ts serve 30 days; a test holds the three equal. */
export const FRESH_WINDOW_DAYS = 30;
export const OVERALL_DEADLINE_MS = 2_500;
export const CANDIDATES_DEADLINE_MS = 1_200;
export const RING_DEADLINE_MS = 400;
export const READ_DEADLINE_MS = 700;
/** Widening runs automatically only while this much of the overall budget is unspent. */
export const AUTO_WIDEN_BEFORE_MS = 1_000;
/** No requirements read starts after this point in the request. */
export const REQUIREMENTS_BEFORE_MS = 1_900;
export const RING_MAX_PLACES = 20;
export const LANE_LIMIT = 120;
export const MAX_WIDEN_STEP = 6;
export const SET_ASIDE_ROWS_MAX = 60;

export interface Place { city: string; region: string | null; country: string | null }
export interface MatchInput {
  roles: string[];
  home: Place | null;
  extraPlaces: Place[];
  relocate: "none" | "country" | string[];
  remote: boolean;
  radiusKm: number;
  canWorkIn: string[];
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
// Rings, cached in isolate memory
// ---------------------------------------------------------------------------

type RingPlace = { name: string; region: string | null; regionName: string | null; country: string };
const RING_CACHE = new Map<string, { places: RingPlace[]; at: number }>();
const RING_TTL_MS = 6 * 3_600_000;
export function clearRingCache(): void { RING_CACHE.clear(); }

async function ringFor(client: Client, home: Place, km: number): Promise<RingPlace[] | null> {
  const key = `${home.city.toLowerCase()}|${(home.region ?? "").toLowerCase()}|${home.country}|${km}`;
  const hit = RING_CACHE.get(key);
  if (hit && Date.now() - hit.at < RING_TTL_MS) return hit.places;
  const q = signalled(client.rpc("metro_ring", { p_city: home.city, p_region: home.region, p_country: home.country, p_km: km, p_max: RING_MAX_PLACES }), RING_DEADLINE_MS);
  const { data, error } = await withDeadline(q, RING_DEADLINE_MS);
  if (error) return null;
  const places = ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
    name: String(r.name), region: r.region ? String(r.region) : null, regionName: r.region_name ? String(r.region_name) : null, country: String(r.country),
  }));
  RING_CACHE.set(key, { places, at: Date.now() });
  return places;
}

// ---------------------------------------------------------------------------
// Placing a returned row (spec 6.4, 6.7): null-tolerant, never trusting a flag alone.
// ---------------------------------------------------------------------------

const US_HINT = /\b(united states|usa)\b|(^|[^A-Za-z])US([^A-Za-z]|$)/;
const LITERAL_REMOTE = /\b(remote|virtual|online|work from home|wfh|telecommut\w*|home[- ]based)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COUNTRY_NAME: Record<string, string> = { US: "US", GB: "UK", CA: "Canada", AU: "Australia", DE: "Germany", IN: "India", IE: "Ireland" };

/** The regions a location names: US states and Canadian provinces (codes and names), Australian states. */
export function regionsIn(loc: string): string[] {
  const out = new Set(statesIn(loc));
  for (const m of loc.matchAll(/(?:^|[^A-Za-z])(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|QLD|NSW|VIC|TAS|ACT)(?=[^A-Za-z]|$)/g)) out.add(m[1]);
  for (const w of ["ontario", "quebec", "british columbia", "alberta", "manitoba", "saskatchewan", "nova scotia", "new brunswick", "queensland", "new south wales", "victoria", "tasmania"]) {
    if (new RegExp(`\\b${w}\\b`, "i").test(loc)) { const c = stateCodeOf(w); if (c) out.add(c); }
  }
  return [...out];
}

function namesPlace(loc: string, p: RingPlace): boolean {
  return new RegExp(`(^|[^A-Za-z])${esc(p.name)}([^A-Za-z]|$)`, "i").test(loc);
}
function namesRegionOf(loc: string, p: RingPlace, named: string[]): boolean {
  if (p.region && named.includes(p.region.toUpperCase())) return true;
  return !!p.regionName && new RegExp(`\\b${esc(p.regionName)}\\b`, "i").test(loc);
}

export interface PlaceContext {
  ring: RingPlace[];
  ringCity: string | null;
  radiusKm: number;
  canWorkIn: string[];
  relocate: MatchInput["relocate"];
  family: TitleFamily;
  licences: Licence[];
}

export function placeRow(row: Candidate, ctx: PlaceContext): { place: PlaceVerdict; licenceStateNotStated: boolean; rowStates: string[] } {
  const loc = row.location ?? "";
  const title = row.title ?? "";
  let country = row.country ?? null;
  if (!country && US_HINT.test(loc)) country = "US";
  const named = regionsIn(loc);
  const flaggedRemote = row.lane === "remote" || row.work_mode === "remote" || row.remote === true || /\bremote\b/i.test(loc);
  const literal = LITERAL_REMOTE.test(`${title} ${loc}`);
  let licenceStateNotStated = false;

  // REMOTE: valid only when the occupation is not on-site, or the row says remote in words.
  if (flaggedRemote && (!ctx.family.onsite || literal)) {
    if (!country) return { place: { kind: "place_not_stated" }, licenceStateNotStated, rowStates: named };
    if (!ctx.canWorkIn.includes(country)) return { place: { kind: "outside_countries", country }, licenceStateNotStated, rowStates: named };
    if (ctx.family.licensed && country === "US") {
      const mine = ctx.licences.filter((l) => l.kind === ctx.family.licensed);
      const covered = (s: string) => mine.some((l) => l.jurisdiction === s || (l.compact && !!l.jurisdiction && NLC_STATES.has(l.jurisdiction) && NLC_STATES.has(s)));
      const us = named.filter((s) => s.length === 2);
      if (us.length === 0) licenceStateNotStated = true;
      else if (mine.length && !us.some(covered)) return { place: { kind: "licence_elsewhere", state: us[0] }, licenceStateNotStated, rowStates: named };
    }
    return { place: { kind: "remote", country, label: fill(PLACE_LINE.remote, { country: COUNTRY_NAME[country] ?? country }) }, licenceStateNotStated, rowStates: named };
  }

  // THE RING: a place name, in that place's state (or naming no state at all on a placed row).
  for (const p of ctx.ring) {
    if (!namesPlace(loc, p)) continue;
    const inItsRegion = namesRegionOf(loc, p, named);
    // A place the reader named without a region ("Boston or NYC") cannot conflict with one.
    const conflicting = named.length > 0 && !inItsRegion && !!(p.region || p.regionName);
    if (conflicting) continue;
    if (!country) {
      // A null-country row is kept only when it names the ring place AND that place's state.
      if (inItsRegion) return { place: { kind: "ring", label: fill(PLACE_LINE.ring, { city: ctx.ringCity ?? p.name, km: ctx.radiusKm }) }, licenceStateNotStated, rowStates: named };
      continue;
    }
    if (country !== p.country) continue;
    if (!ctx.canWorkIn.includes(country)) return { place: { kind: "outside_countries", country }, licenceStateNotStated, rowStates: named };
    const label = p.name.toLowerCase() === (ctx.ringCity ?? "").toLowerCase()
      ? fill(PLACE_LINE.ring, { city: ctx.ringCity ?? p.name, km: ctx.radiusKm })
      : `${p.name} · ${fill(PLACE_LINE.ring, { city: ctx.ringCity ?? p.name, km: ctx.radiusKm })}`;
    return { place: { kind: "ring", label }, licenceStateNotStated, rowStates: named };
  }

  if (country && !ctx.canWorkIn.includes(country)) return { place: { kind: "outside_countries", country }, licenceStateNotStated, rowStates: named };
  if (Array.isArray(ctx.relocate) && country) {
    const hit = ctx.relocate.find((r) => named.includes(r.toUpperCase()));
    if (hit) return { place: { kind: "region", region: hit, label: fill(PLACE_LINE.region, { region: regionName(hit) }) }, licenceStateNotStated, rowStates: named };
  }
  if (ctx.relocate === "country" && country && (named.length > 0 || /,/.test(loc))) {
    return { place: { kind: "country", country, label: fill(PLACE_LINE.country, { country: COUNTRY_NAME[country] ?? country }) }, licenceStateNotStated, rowStates: named };
  }
  if (!country && named.length === 0) return { place: { kind: "place_not_stated" }, licenceStateNotStated, rowStates: named };
  return { place: { kind: "beyond_commute" }, licenceStateNotStated, rowStates: named };
}

function regionName(code: string): string {
  const hit = STATE_ALIASES[code.toLowerCase()];
  return hit?.names.find((n) => !n.startsWith(", ")) ?? code;
}
/** "TX" -> ["Texas", ", TX"]: search_jobs' alias format, for the region lane. */
export function regionAliases(codes: readonly string[]): string[] {
  const out: string[] = [];
  const AU: Record<string, string> = { QLD: "Queensland", NSW: "New South Wales", VIC: "Victoria", TAS: "Tasmania", ACT: "Australian Capital Territory" };
  for (const c of codes) {
    const hit = STATE_ALIASES[c.toLowerCase()];
    if (hit) {
      for (const n of hit.names) if (!out.includes(n)) out.push(n);
    } else if (AU[c.toUpperCase()] && !out.includes(AU[c.toUpperCase()])) {
      out.push(AU[c.toUpperCase()]);
    }
  }
  return out.slice(0, 40);
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
  requirements: PostingRequirements | "not read";
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

export async function runMatch(client: Client, input: MatchInput, opts: RunOptions): Promise<MatchResult> {
  const elapsed = () => opts.clock() - opts.startedMs;
  let cpu = 0;
  const sync = <T>(f: () => T): T => { const s = opts.clock(); try { return f(); } finally { cpu += opts.clock() - s; } };
  const phaseMs = { ring: 0, candidates: 0, requirements: 0, terms: 0 };
  const notes: string[] = [];
  let deadlineMissed: MatchResult["deadlineMissed"] = null;

  // ---- the occupation
  const mapped = sync(() => familyForTitles(input.roles));
  const family: TitleFamily | null = mapped?.family ?? sync(() => fallbackFamily(input.roles));
  const formerFamily = input.former ? (familyForTitles([input.former])?.family ?? null) : null;
  const tierReader = reader(input);

  const empty = (extra: Partial<MatchResult> = {}): MatchResult => ({
    family: mapped ? { key: mapped.family.key, label: mapped.family.label } : null,
    versions: { pipeline: PIPELINE_VERSION, families: TITLE_FAMILIES_VERSION, extractor: EXTRACTOR_VERSION, tiers: MATCH_TIERS_VERSION },
    searched: { titles: input.roles, places: [], ringSource: "none", radiusKm: input.radiusKm, countries: input.canWorkIn, lanes: [], order: opts.order, excludedSources: opts.excludeSources ?? [] },
    rows: [], more: 0, setAside: {}, setAsideRows: [], summary: null, steps: [], nextWiden: null, thin: true, notes,
    basis: { found: 0, passed: 0, read: 0, walked: 0, pending: 0 }, deadlineMissed, phaseMs, cpuMs: Math.round(cpu), footer: FOOTER, ...extra,
  });
  if (!family) return empty();

  // ---- the ring
  const radius = opts.widen === 4 ? 80 : input.radiusKm;
  let ring: RingPlace[] = [];
  let ringSource: MatchResult["searched"]["ringSource"] = "none";
  if (input.home?.city && input.home.country) {
    const t0 = opts.clock();
    try {
      const got = await ringFor(client, input.home, radius);
      if (got && got.length) { ring = got; ringSource = "geonames"; }
    } catch (e) {
      if (e instanceof DeadlineMissed) deadlineMissed = "ring";
    }
    phaseMs.ring = Math.round(opts.clock() - t0);
    if (!ring.length) {
      ring = [{ name: input.home.city, region: input.home.region, regionName: input.home.region ? regionName(input.home.region) : null, country: input.home.country }];
      ringSource = "city-only";
      notes.push(fill(RING_FALLBACK, { city: input.home.city }));
    }
  }
  const extras = input.extraPlaces.filter((p) => p.city && !ring.some((r) => r.name.toLowerCase() === p.city.toLowerCase()));
  ring = [...ring.slice(0, Math.max(1, RING_MAX_PLACES - extras.length)), ...extras.map((p) => ({ name: p.city, region: p.region, regionName: p.region ? regionName(p.region) : null, country: p.country ?? input.home?.country ?? "US" }))];
  const ringNames = [...new Set(ring.map((r) => sanitizeTerm(r.name)).filter(Boolean))];
  const ringCountries = [...new Set(ring.map((r) => r.country))];

  // ---- the statement (one per request, plus at most one automatic widening)
  const countries = input.canWorkIn;
  const regions = Array.isArray(input.relocate) ? input.relocate : [];
  const lanes: Lane[] = [];
  if (ringNames.length) lanes.push("ring");
  if (input.remote && countries.length) lanes.push("remote");
  if (regions.length && countries.length) lanes.push("region");
  if (input.relocate === "country" && countries.length) lanes.push("country");

  const freshCutoff = new Date(opts.nowMs - FRESH_WINDOW_DAYS * 86_400_000).toISOString();
  const statement = async (step: number): Promise<Candidate[]> => {
    let phrases: readonly string[] = family.q;
    let simple: readonly string[] = family.qSimple ?? [];
    let anyOrder = false;
    let useRegions = regions;
    let useRemote = input.remote;
    let useCountry = input.relocate === "country";
    let useRing = ringNames;
    if (step === 1) anyOrder = true;
    if (step === 2) { phrases = [family.headNoun]; simple = []; }
    if (step === 3) { phrases = family.adjacent ?? []; simple = []; }
    if (step === 5) { useRegions = input.home?.region ? [input.home.region] : []; useRemote = false; useCountry = false; useRing = []; }
    if (step === 6) {
      if (!formerFamily) return [];
      phrases = formerFamily.q; simple = formerFamily.qSimple ?? [];
    }
    if (!phrases.length && !simple.length) return [];
    const args = {
      p_q_en: familyQuery(phrases, anyOrder) || null,
      p_q_simple: simple.length ? familyQuery(simple, anyOrder) : null,
      p_fresh_cutoff: freshCutoff,
      p_countries: countries,
      p_ring: useRing,
      p_remote: useRemote && countries.length > 0,
      p_regions: regionAliases(useRegions),
      p_country_lane: useCountry && countries.length > 0,
      p_exclude_sources: opts.excludeSources,
      p_lane_limit: LANE_LIMIT,
      p_order: opts.order,
      p_ring_countries: ringCountries.length ? ringCountries : null,
    };
    const q = signalled(client.rpc("match_candidates", args), CANDIDATES_DEADLINE_MS);
    const { data, error } = await withDeadline(q, CANDIDATES_DEADLINE_MS);
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
      : step === 3 && family.adjacent?.length
        ? { ...family, core: new RegExp(family.adjacent.map((a) => a.split(" ").map((w) => `\\b${esc(w)}\\b`).join("[^,|]*")).join("|"), "i"), near: family.core }
        : step === 6 && formerFamily ? formerFamily : family;
    const ctx: PlaceContext = { ring, ringCity: input.home?.city ?? null, radiusKm: radius, canWorkIn: countries, relocate: input.relocate, family, licences: input.licences };
    for (const r of sorted) {
      if (!r.id || seen.has(r.id)) continue;
      seen.add(r.id);
      const title = r.title ?? "";
      const placed = placeRow(r, ctx);
      let rank = titleRank(famForStep, title);
      if (step === 2 && rank === 1 && notListed(family, title)) rank = 9;
      const prev = step !== 6 && !!formerFamily && formerFamily.key !== family.key && titleRank(formerFamily, title) !== 9 && titleRank(family, title) !== 0;
      const lf = levelFacets(title);
      const facets: RowFacets = {
        place: placed.place,
        titleRank: rank,
        previousField: step === 6 ? true : prev,
        level: lf,
        levelInQuery: !!family.levelInQuery,
        assistantIsJunior: !!family.assistantIsJunior,
        widenStep: step,
        minYears: effectiveMinYears(r.min_years, null),
        band: r.experience_band,
        requirements: "not read",
        rowStates: placed.rowStates,
        licenceStateNotStated: placed.licenceStateNotStated,
        country: r.country,
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
    if (e instanceof DeadlineMissed) deadlineMissed = "candidates";
    else throw e;
  }
  phaseMs.candidates = Math.round(opts.clock() - t1);

  const passingCount = () => staged.filter((s) => !s.gate).length;
  if (!deadlineMissed && requestedStep === 0 && passingCount() < TOP_N && elapsed() < AUTO_WIDEN_BEFORE_MS) {
    const t2 = opts.clock();
    try {
      const more = await statement(1);
      steps.push({ step: 1, label: stepLabel(1, family, input), added: stage(more, 1) });
    } catch (e) {
      if (e instanceof DeadlineMissed) deadlineMissed = "widen";
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
  let pendingTerms = 0;
  const descriptionChars = new Map<string, number>();
  const uncachedDescriptions = new Map<string, string>();
  const fresh = new Set<string>();
  if (toRead.length && !deadlineMissed && elapsed() < REQUIREMENTS_BEFORE_MS) {
    const t3 = opts.clock();
    try {
      const cached = await withDeadline(
        signalled(client.from("job_posting_requirements").select("posting_id, requirements, posting_terms, description_chars").eq("extractor_version", EXTRACTOR_VERSION).in("posting_id", toRead), READ_DEADLINE_MS),
        READ_DEADLINE_MS,
      ) as { data: Array<{ posting_id: string; requirements: PostingRequirements; posting_terms: string[] | null; description_chars: number }> | null; error: unknown };
      for (const c of cached.data ?? []) {
        reqs.set(c.posting_id, c.requirements);
        if (Array.isArray(c.posting_terms)) terms.set(c.posting_id, c.posting_terms);
        descriptionChars.set(c.posting_id, c.description_chars);
      }
      // Uncached rows, and cached rows whose terms an earlier call left pending.
      const need = toRead.filter((id) => !reqs.has(id) || !terms.has(id));
      if (need.length && elapsed() < REQUIREMENTS_BEFORE_MS) {
        const got = await withDeadline(
          signalled(client.from("job_board_postings").select("id, description, min_years").in("id", need), READ_DEADLINE_MS),
          READ_DEADLINE_MS,
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
      if (e instanceof DeadlineMissed) deadlineMissed = "requirements";
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
    pendingTerms = toRead.filter((id) => !terms.has(id)).length;
    phaseMs.terms = Math.round(opts.clock() - t4);

    // Cache what was read or walked (posting facts only); a failed write costs the next reader a re-read, nothing more.
    const at = new Date(nowMs).toISOString();
    const writes = [...new Set([...fresh, ...walkedIds])].filter((id) => reqs.has(id)).map((id) => ({
      posting_id: id, extractor_version: EXTRACTOR_VERSION, requirements: reqs.get(id), posting_terms: terms.get(id) ?? null,
      description_chars: descriptionChars.get(id) ?? 0, read_at: at, terms_at: terms.has(id) ? at : null,
    }));
    if (writes.length && !deadlineMissed) {
      try {
        await withDeadline(signalled(client.from("job_posting_requirements").upsert(writes, { onConflict: "posting_id,extractor_version" }), 400), 400);
      } catch { /* a cache write that misses its deadline is left to the next reader */ }
    }
  } else if (toRead.length) {
    notes.push(`${REQUIREMENTS_NOT_READ}: the page answered before the postings could be read.`);
  }

  // ---- final facets, gates and tiers
  const readIds = new Set(reqs.keys());
  sync(() => {
    for (const s of staged) {
      const q = reqs.get(s.row.id);
      if (q) {
        s.facets.requirements = q;
        s.facets.minYears = effectiveMinYears(s.row.min_years, q);
        if (!s.gate) s.gate = gateFor(s.facets, tierReader);
      }
    }
  });
  passing = staged.filter((s) => !s.gate);
  const tiered = sync(() => passing.map((s) => ({ s, t: tierFor(s.facets, tierReader) })));
  tiered.sort((a, b) => compareRows(orderable(a.s, a.t.tier), orderable(b.s, b.t.tier)));
  const collapsed = sync(() => collapseAndCap(tiered.map(({ s, t }) => ({
    id: s.row.id, employer: String(s.row.company_token ?? s.row.company ?? "").toLowerCase(), sibling: siblingKey(s.row),
    openings: Math.max(1, s.row.siblings ?? 1), s, t,
  }))));

  const rows: MatchRow[] = collapsed.slice(0, TOP_N).map(({ s, t, openings }) => {
    const r = s.row;
    const q = reqs.get(r.id);
    const notRead = !q;
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
      gaps: notRead ? [...t.gaps, REQUIREMENTS_NOT_READ] : t.gaps,
      openings,
      placeLine: "label" in s.facets.place ? s.facets.place.label : "",
      widenStep: s.facets.widenStep,
      requirements: q ?? "not read",
      postingTerms: terms.get(r.id) ?? "pending",
      sourceNote: notRead && source === "usajobs" ? USAJOBS_NOTE : null,
      facets: s.facets,
    };
  });

  const gates = staged.filter((s) => s.gate).map((s) => s.gate!);
  const counts = setAsideCounts(gates, { found: staged.length, read: readIds.size });
  const setAside: MatchResult["setAside"] = {};
  for (const [k, v] of Object.entries(counts)) {
    if (v) setAside[k as Gate["reason"]] = { ...v, label: SET_ASIDE_LABEL[k as Gate["reason"]] };
  }
  const setAsideRows: SetAsideRow[] = staged.filter((s) => s.gate).slice(0, SET_ASIDE_ROWS_MAX).map((s) => ({
    id: s.row.id, title: s.row.title ?? "", company: employerDisplayName(s.row.company_token, s.row.company), location: s.row.location,
    reason: s.gate!.reason, detail: s.gate!.detail ?? null,
  }));
  const tried = steps.filter((x) => x.step > 0).map((x) => x.label);
  const thin = rows.length < TOP_N && requestedStep === 0;
  if (thin && input.home?.city) notes.push(fill(THIN_RESULTS, { n: rows.length, city: input.home.city, steps: tried.length ? tried.join(" · ") : "exact titles only" }));
  const nextWiden = nextStep(requestedStep, steps, family, input, formerFamily);
  if (pendingTerms > 0) notes.push(`${KEYWORDS_PENDING}: ${pendingTerms} of the postings read fill on a later call.`);

  return {
    family: mapped ? { key: mapped.family.key, label: mapped.family.label } : null,
    versions: { pipeline: PIPELINE_VERSION, families: TITLE_FAMILIES_VERSION, extractor: EXTRACTOR_VERSION, tiers: MATCH_TIERS_VERSION },
    searched: { titles: input.roles, places: ring.map((r) => r.name), ringSource, radiusKm: radius, countries, lanes, order: opts.order, excludedSources: opts.excludeSources ?? [] },
    rows,
    more: Math.max(0, collapsed.length - rows.length),
    setAside,
    setAsideRows,
    summary: setAsideSummary(counts, readIds.size),
    steps,
    nextWiden,
    thin,
    notes,
    basis: { found: staged.length, passed: passing.length, read: readIds.size, walked, pending: pendingTerms },
    deadlineMissed,
    phaseMs,
    cpuMs: Math.round(cpu),
    footer: FOOTER,
  };
}

function laneOf(s: Staged): Lane {
  const k = s.facets.place.kind;
  return k === "ring" || k === "remote" || k === "region" || k === "country" ? k : s.row.lane;
}

export function stepLabel(step: number, family: TitleFamily, input: MatchInput): string {
  return fill(WIDEN_STEP_LABEL[step] ?? `step ${step}`, { headNoun: family.headNoun, region: input.home?.region ? regionName(input.home.region) : "your region" });
}

/** The next follow-up step worth offering, or null: skips steps that cannot apply to this reader. */
function nextStep(current: number, steps: MatchResult["steps"], family: TitleFamily, input: MatchInput, formerFamily: TitleFamily | null): number | null {
  const done = new Set(steps.map((s) => s.step));
  for (let n = Math.max(current, 1) + 1; n <= MAX_WIDEN_STEP; n++) {
    if (done.has(n)) continue;
    if (n === 2 && !family.key) continue;
    if (n === 3 && !family.adjacent?.length) continue;
    if (n === 4 && (!input.home || input.radiusKm >= 80)) continue;
    if (n === 5 && (!input.home?.region || input.relocate === "country")) continue;
    if (n === 6 && (!input.careerChanger || !formerFamily)) continue;
    return n;
  }
  return null;
}

export { familyByKey };
