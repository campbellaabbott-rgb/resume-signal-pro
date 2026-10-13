/**
 * WHAT A POSTING ASKS FOR, QUOTED FROM THE POSTING.
 *
 * resume-match reads the top 40 candidates' stored descriptions (the select
 * fit-batch already makes: id, description, min_years) and lifts out the
 * lines a recruiter screens on: required and preferred lines, the stated
 * minimum years, the licence and where it must be held, a refusal to sponsor,
 * citizenship, an ACTIVE clearance (an "ability to obtain" one is
 * information), degree, language, shift and driving. Each comes with the
 * sentence it was read from, cut to about 160 characters (owner decision 2:
 * the anonymous path must not become a bulk export of description text).
 *
 * A ROW WHOSE TEXT WAS NOT READ SAYS SO. No stored description, a description
 * of 150 characters or fewer (fit-batch's own "nothing to read" line), a row
 * beyond the 40 read or a failed read: requirements "not read", tier capped at
 * Good, never counted in a description-based set-aside group. "Meets every
 * stated requirement we could read" is false when nothing was read.
 *
 * THE STORED MINIMUM IS STALE AT 16 AND ABOVE. Old reads took ages ("18 years
 * or older") for experience; job-board/experience.ts has guarded against that
 * since, but stored rows keep the old value (4 of the 5 bench rows with a
 * readable description re-parse to null). So a stored value of 16 or more is
 * unknown, and whenever the description is read, the value re-read from it
 * with the board's own parser replaces the stored one.
 *
 * POSTING TERMS are the dictionary walk behind keyword overlap: the same
 * dictionary, order and containment rule as _shared/fit-score.ts (a parity
 * test holds them equal), run here WITHOUT computeFit. They cost about 16 ms
 * per posting locally (n=443) and 1-2.5 s at the edge for twenty, so a call
 * walks at most 6 uncached descriptions or 40,000 characters, whichever comes
 * first; the rest say "keywords pending" and fill on later calls.
 *
 * Server only: imported by resume-match.
 */
import { parseMinYears } from "../job-board/experience.ts";
import { INDUSTRY_KEYWORDS } from "./industry-detection.ts";
import { cut, type PostingLicence, readPostingLicence, sentenceAt } from "./licence-rules.ts";

export const EXTRACTOR_VERSION = "2026-10-16.1";
/** Requirements are read for this many candidates per call. */
export const READ_TOP = 40;
export const MAX_UNCACHED_WALKS = 6;
export const MAX_WALK_CHARS = 40_000;
/** job-fit scores with computeFit(description, scan, 40): the same cap. */
export const POSTING_TERMS_MAX = 40;
/** fit-batch's bound on how much of a description it reads. */
export const DESCRIPTION_READ_CHARS = 20_000;
/** fit-batch scores a description of 150 characters or fewer as unreadable. */
export const MIN_READABLE_CHARS = 150;
/** A stored min_years at or above this is the stale age read: unknown. */
export const STALE_MIN_YEARS = 16;
const LINES_MAX = 12;

export type DegreeLevel = "high_school" | "associate" | "bachelor" | "master" | "doctorate";
export const DEGREE_RANK: Record<DegreeLevel, number> = { high_school: 1, associate: 2, bachelor: 3, master: 4, doctorate: 5 };

export interface PostingRequirements {
  version: string;
  /** The stated minimum re-read from the text (board parser, age-guarded), or null. */
  minYears: number | null;
  minYearsQuote: string | null;
  licence: PostingLicence | null;
  noSponsorship: string | null;
  citizenshipRequired: string | null;
  activeClearance: string | null;
  clearanceObtainable: string | null;
  degree: { level: DegreeLevel; must: boolean; quote: string } | null;
  languages: Array<{ language: string; must: boolean; quote: string }>;
  shift: string | null;
  driving: { cdlClass: string | null; quote: string } | null;
  /** BLS, CPR, forklift, ServSafe ...: information, never a gate. */
  credentials: string[];
  must: string[];
  nice: string[];
}

export const readable = (description: string | null | undefined): description is string =>
  typeof description === "string" && description.trim().length > MIN_READABLE_CHARS;

/**
 * The minimum to judge against. When the description was read, the re-read
 * value replaces the stored one (null included: the text states none). When it
 * was not, a stored value of STALE_MIN_YEARS or more is unknown.
 */
export function effectiveMinYears(stored: number | null | undefined, reRead: PostingRequirements | "not read" | null | undefined): number | null {
  if (reRead && reRead !== "not read") return reRead.minYears;
  if (typeof stored !== "number" || !Number.isFinite(stored)) return null;
  return stored >= STALE_MIN_YEARS ? null : stored;
}

const NO_SPONSOR = /\b(?:not|unable to|cannot|can ?not|will not|won'?t|does not|do not|is not able to|are not able to)\s+(?:be able to\s+)?(?:sponsor|offer (?:visa |immigration )?sponsorship|provide (?:visa |immigration )?sponsorship|support (?:visa|h-?1b)|consider (?:candidates|applicants) (?:who|that) (?:require|need))|without (?:the need for |requiring )?(?:current or future |now or in the future |present or future )?(?:employer[- ]|visa |immigration )?sponsorship|\bno (?:visa |immigration )?sponsorship\b|sponsorship (?:is |will )?not (?:be )?(?:available|offered|provided)|not eligible for (?:visa )?sponsorship|\bauthori[sz]ed to work in the (?:us|u\.s\.|united states)\b[^.]{0,60}\b(?:now and|now or) in the future\b/i;
const CITIZEN = /\bu\.?s\.? citizen(?:ship)?\b[^.\n]{0,40}\b(?:required|requirement|only|must)\b|\bmust be (?:a )?u\.?s\.? citizen\b|\bus citizens only\b|\b(?:requires?|required) (?:u\.?s\.? )?citizenship\b|\bcitizenship (?:is )?required\b/i;
const ACTIVE_CLEARANCE = /\b(?:active|current|existing)\b[^.\n]{0,25}\b(?:secret|top secret|ts\/sci|ts|public trust|security)\s+clearance\b|\b(?:secret|top secret|ts\/sci)\s+clearance\b[^.\n]{0,30}\b(?:required|is required|must)\b|\bclearance (?:is )?required\b|\bmust (?:currently )?(?:hold|possess|have) (?:an? )?(?:active )?(?:secret|top secret|ts\/sci|security) clearance\b/i;
const OBTAIN_CLEARANCE = /\b(?:ability|able|eligib(?:le|ility)) (?:to )?(?:obtain|receive|be granted|for)\b[^.\n]{0,30}\bclearance\b|\bmust be (?:able to )?(?:obtain|granted)\b[^.\n]{0,30}\bclearance\b/i;
const DEGREES: Array<[DegreeLevel, RegExp]> = [
  ["doctorate", /\b(?:ph\.?d|doctorate|doctoral degree|pharm\.?d|d\.?p\.?t|md degree)\b/i],
  ["master", /\b(?:master'?s|m\.s\.|msc|mba|msn|m\.ed|graduate degree)\b/i],
  ["bachelor", /\b(?:bachelor'?s|b\.s\.|b\.a\.|bsn|bs\/ba|ba\/bs|four[- ]year degree|undergraduate degree|college degree)\b/i],
  ["associate", /\b(?:associate'?s degree|associate degree|two[- ]year degree|adn)\b/i],
  ["high_school", /\b(?:high school diploma|ged|high school education)\b/i],
];
const LANGUAGES = ["Spanish", "French", "German", "Mandarin", "Cantonese", "Chinese", "Japanese", "Korean", "Portuguese", "Italian", "Arabic", "Vietnamese", "Tagalog", "Russian", "Hindi", "Polish", "Dutch", "American Sign Language", "ASL"];
const LANGUAGE_RE = new RegExp(`\\b(?:fluen(?:t|cy) in|bilingual\\b[^.\\n]{0,20}|proficien(?:t|cy) in|speak(?:s|ing)?)\\s*(?:english and |english\\/)?(${LANGUAGES.join("|")})\\b|\\b(${LANGUAGES.join("|")})\\b[^.\\n]{0,20}\\b(?:required|preferred|a plus|speaking|fluency|bilingual)\\b`, "gi");
const SHIFT = /\b(?:night|overnight|evening|weekend|rotating|graveyard|swing|12[- ]hour|on[- ]call|day\/night)\s+(?:shifts?|hours|work|availability|rotation)\b|\bmust (?:be able to )?work (?:nights|weekends|holidays|overnight)\b/i;
const DRIVING = /\b(?:valid|current|clean)\s+(?:state\s+)?driver'?s'?\s+licen[cs]e\b|\bcdl\b[^.\n]{0,20}\bclass\s*[abc]\b|\bclass\s*[abc]\s+cdl\b/i;
const CREDENTIALS = /\b(bls|acls|pals|nrp|cpr|first aid|forklift certification|servsafe|food handler|osha (?:10|30)|tncc|cna certification|cprs?)\b/gi;
const MUST_HEAD = /^(?:minimum|basic|required|essential|key)?\s*(?:qualifications|requirements|skills and experience|experience required|what you(?:'| wi)ll need|what we(?:'re| are) looking for|you have|must haves?|who you are|job requirements)\s*:?$/i;
const NICE_HEAD = /^(?:preferred|desired|additional|bonus|nice[- ]to[- ]have|plus)\s*(?:qualifications|skills|experience|requirements|points)?\s*:?$|^nice to haves?:?$|^bonus points:?$/i;
const OTHER_HEAD = /^(?:responsibilities|what you(?:'| wi)ll do|duties|benefits|about (?:us|the role|the company)|compensation|perks|why join|our company|the role|overview|summary)\s*:?$/i;

function quoteOf(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? sentenceAt(text, m.index, m[0].length) : null;
}

/** Required and preferred lines, read off the posting's own headings and inline wording. */
function requirementLines(text: string): { must: string[]; nice: string[] } {
  const must: string[] = [];
  const nice: string[] = [];
  let mode: "must" | "nice" | "other" = "other";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s•·*\-–—●▪◦]+/, "").trim();
    if (!line) continue;
    if (line.length <= 60 && MUST_HEAD.test(line)) { mode = "must"; continue; }
    if (line.length <= 60 && NICE_HEAD.test(line)) { mode = "nice"; continue; }
    if (line.length <= 60 && OTHER_HEAD.test(line)) { mode = "other"; continue; }
    if (line.length < 8) continue;
    const inlineNice = /\b(?:preferred|a plus|nice to have|desired|bonus)\b/i.test(line);
    const inlineMust = /\b(?:required|must|minimum|at least|mandatory)\b/i.test(line);
    const bucket = mode === "nice" || (mode === "other" && inlineNice) ? nice : mode === "must" || inlineMust ? (inlineNice && mode !== "must" ? nice : must) : null;
    if (bucket && bucket.length < LINES_MAX) bucket.push(cut(line));
  }
  return { must, nice };
}

export function extractRequirements(description: string): PostingRequirements {
  const text = description.slice(0, DESCRIPTION_READ_CHARS);
  const lines = requirementLines(text);
  const minYears = parseMinYears(text);
  let minYearsQuote: string | null = null;
  if (minYears !== null) {
    const m = new RegExp(`(?<!\\d)${minYears}\\s*\\+?\\s*(?:-\\s*\\d{1,2}\\s*)?years?`, "i").exec(text);
    if (m) minYearsQuote = sentenceAt(text, m.index, m[0].length);
  }
  let degree: PostingRequirements["degree"] = null;
  for (const [level, re] of DEGREES) {
    const m = re.exec(text);
    if (!m) continue;
    const q = sentenceAt(text, m.index, m[0].length);
    const isNice = /\b(?:preferred|a plus|desired|nice to have)\b/i.test(q) || lines.nice.some((l) => l.includes(q.slice(0, 40)));
    if (!degree || DEGREE_RANK[level] < DEGREE_RANK[degree.level] && !isNice) degree = { level, must: !isNice, quote: q };
  }
  const languages: PostingRequirements["languages"] = [];
  for (const m of text.matchAll(LANGUAGE_RE)) {
    const language = (m[1] ?? m[2] ?? "").replace(/^asl$/i, "American Sign Language");
    if (!language || languages.some((l) => l.language.toLowerCase() === language.toLowerCase())) continue;
    const q = sentenceAt(text, m.index ?? 0, m[0].length);
    languages.push({ language: language[0].toUpperCase() + language.slice(1), must: /\brequired|must\b/i.test(q) && !/\bpreferred|a plus\b/i.test(q), quote: q });
    if (languages.length >= 3) break;
  }
  const drivingM = DRIVING.exec(text);
  const credentials = [...new Set([...text.matchAll(CREDENTIALS)].map((m) => m[1].toUpperCase().replace(/^CPRS$/, "CPR")))].slice(0, 8);
  const active = quoteOf(text, ACTIVE_CLEARANCE);
  return {
    version: EXTRACTOR_VERSION,
    minYears,
    minYearsQuote,
    licence: readPostingLicence(text),
    noSponsorship: quoteOf(text, NO_SPONSOR),
    citizenshipRequired: quoteOf(text, CITIZEN),
    activeClearance: active,
    clearanceObtainable: active ? null : quoteOf(text, OBTAIN_CLEARANCE),
    degree,
    languages,
    shift: quoteOf(text, SHIFT),
    driving: drivingM ? { cdlClass: /\bclass\s*([abc])\b/i.exec(drivingM[0])?.[1]?.toUpperCase() ?? null, quote: sentenceAt(text, drivingM.index, drivingM[0].length) } : null,
    credentials,
    must: lines.must,
    nice: lines.nice,
  };
}

// ---------------------------------------------------------------------------
// Posting terms: fit-score's dictionary walk, without computeFit.
// ---------------------------------------------------------------------------

const DICTIONARY: string[] = (() => {
  const set = new Set<string>();
  for (const data of Object.values(INDUSTRY_KEYWORDS)) {
    for (const list of [data.primary, data.secondary, data.certifications, data.titles]) {
      for (const term of list) {
        const t = term.toLowerCase().trim();
        if (t.length >= 3) set.add(t);
      }
    }
  }
  return [...set].sort((a, b) => b.length - a.length);
})();
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERM_RE = new Map<string, RegExp>();
function containsTerm(haystack: string, term: string): boolean {
  let re = TERM_RE.get(term);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i");
    TERM_RE.set(term, re);
  }
  return re.test(haystack);
}

/** The recognised terms of a posting, longest first, at most maxTerms: computeFit's postingTerms. */
export function postingTerms(description: string, maxTerms = POSTING_TERMS_MAX): string[] {
  const lower = description.slice(0, DESCRIPTION_READ_CHARS).toLowerCase();
  const out: string[] = [];
  for (const term of DICTIONARY) {
    if (out.length >= maxTerms) break;
    if (out.some((p) => p.includes(term))) continue;
    if (containsTerm(lower, term)) out.push(term);
  }
  return out;
}

/**
 * Which uncached descriptions this call may walk, in display order: at most
 * MAX_UNCACHED_WALKS and at most MAX_WALK_CHARS (each description counted up
 * to the DESCRIPTION_READ_CHARS it is read to). The rest wait for a later call.
 */
export function planTermWalks(rows: ReadonlyArray<{ id: string; chars: number }>): { walk: string[]; pending: string[] } {
  const walk: string[] = [];
  const pending: string[] = [];
  let chars = 0;
  for (const r of rows) {
    const c = Math.min(r.chars, DESCRIPTION_READ_CHARS);
    if (walk.length < MAX_UNCACHED_WALKS && chars + c <= MAX_WALK_CHARS) {
      walk.push(r.id);
      chars += c;
    } else pending.push(r.id);
  }
  return { walk, pending };
}
