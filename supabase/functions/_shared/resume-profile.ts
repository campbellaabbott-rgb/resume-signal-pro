/**
 * WHAT A RECRUITER READS OFF THE TOP OF A RÉSUMÉ, AS FACTS WITH THEIR LINES.
 *
 * Résumé matching starts from a profile, not from the résumé's words: where
 * the person lives and would move, which countries they say they can work in,
 * the occupation they are seeking, their level, the years their employment
 * dates evidence, and their licences. Today's "For you" searched the first
 * role term with no place at all, and 85% of its top-20 rows were jobs the
 * reader could not take (match bench, 2026-10-12).
 *
 * EVERY FIELD CARRIES ITS BASIS: the line it was read from. The strip shows
 * "We read you as ..." with those lines and an edit control, so a wrong read is
 * a visible chip, not a silent filter.
 *
 * AUTHORISATION IS NEVER INFERRED. Only an explicit statement counts (citizen,
 * permanent resident, F-1/OPT, H-1B, "would require sponsorship", a held
 * clearance); anything else is "unknown". `canWorkIn` defaults to the country
 * the résumé says the person lives in, labelled as exactly that, because it
 * is a search area the reader confirms on the strip, not a claim about status.
 *
 * Pure, deterministic, no model call. The browser loads it through a dynamic
 * import (the matcher receives the confirmed profile, never the text, on the
 * site's paste path), and resume-match loads it for the MCP and /v1 surfaces.
 * Imports: fit-score (resumeRoleTerms and its dictionary), target-roles,
 * work-countries, location-terms and licence-rules, all import-free apart from
 * fit-score's dictionary.
 */
import { resumeRoleTerms } from "./fit-score.ts";
import { MAX_TARGET_ROLES } from "./target-roles.ts";
import { toCode } from "./work-countries.ts";
import { STATE_ALIASES } from "./location-terms.ts";
import { cut, type Licence, readResumeLicences } from "./licence-rules.ts";

export const PROFILE_VERSION = "2026-10-16.1";

export type Level = "entry" | "mid" | "senior" | "exec";
export type WorkAuthStatus = "citizen" | "permanent_resident" | "student_visa" | "work_visa" | "unknown";
export type Relocate = "none" | "country" | string[];
export type RadiusKm = 15 | 40 | 80;
export const RADIUS_CHOICES: readonly RadiusKm[] = [15, 40, 80];
export const DEFAULT_RADIUS_KM: RadiusKm = 40;

export interface Place { city: string; region: string | null; country: string | null }

export interface MatchProfile {
  version: string;
  /** The headline title as written, cut at | ( , and a spaced dash. */
  headline: string | null;
  /** Up to MAX_TARGET_ROLES titles to search, best first. */
  roles: string[];
  /** Grade words the headline carries (apprentice, staff, new grad ...). */
  grade: string[];
  /** A career changer's previous occupation, shown apart and never searched as a match. */
  former: string | null;
  careerChanger: boolean;
  home: Place | null;
  /** Other places the résumé names as search areas. */
  extraPlaces: Place[];
  relocate: Relocate;
  remote: boolean;
  radiusKm: RadiusKm;
  /** Countries searched. Declared, or the home country (basis says which). */
  canWorkIn: string[];
  canWorkInBasis: "declared" | "home" | "none";
  workAuth: {
    status: WorkAuthStatus;
    /** Declared: needs sponsorship now or in the future. */
    needsSponsorship: boolean;
    /** Countries the résumé says they are a citizen of. */
    citizenOf: string[];
    /** A clearance the résumé says is held (secret, top secret, ts/sci). */
    clearance: string | null;
  };
  level: Level;
  newGrad: boolean;
  /** Still studying: an expected graduation after this year. Internships are not set aside for a student. */
  student: boolean;
  /** Highest degree the education section names. */
  degree: "high_school" | "associate" | "bachelor" | "master" | "doctorate" | null;
  /** Employment-only years, merged intervals: [evidenced by dates, highest claimed]. */
  years: { low: number; high: number } | null;
  /** Career changers: years in the target field ("since 2025"). */
  targetYears: number | null;
  licences: Licence[];
  /** field -> the line it was read from (at most 160 characters). */
  basis: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/** "arizona" / "az" -> "AZ", from the board's own alias table (US states, Canadian provinces). */
function usCaCode(word: string): string | null {
  const hit = STATE_ALIASES[word.trim().toLowerCase()];
  if (!hit) return null;
  const code = hit.names.find((n) => /^, [A-Z]{2}$/.test(n));
  return code ? code.slice(2) : null;
}
const CA_CODES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK", "NT", "NU", "YT"]);
const AU_REGIONS: Record<string, string> = {
  queensland: "QLD", qld: "QLD", "new south wales": "NSW", nsw: "NSW", victoria: "VIC", vic: "VIC",
  "western australia": "WA", "south australia": "SA", sa: "SA", tasmania: "TAS", tas: "TAS", act: "ACT",
  "australian capital territory": "ACT", "northern territory": "NT",
};
const GB_REGIONS = /^(england|scotland|wales|northern ireland|greater manchester|greater london)$/i;

function regionAndCountry(r: string): { region: string | null; country: string | null } | null {
  const raw = r.replace(/\s+\d{3,6}(?:-\d{4})?$/, "").replace(/\.$/, "").trim();
  if (!raw) return null;
  if (/^[A-Z]{2}$/.test(raw)) {
    const c = usCaCode(raw);
    if (c) return { region: c, country: CA_CODES.has(c) ? "CA" : "US" };
  }
  const lower = raw.toLowerCase();
  if (raw.length > 2) {
    const c = usCaCode(lower);
    if (c) return { region: c, country: CA_CODES.has(c) ? "CA" : "US" };
  }
  if (AU_REGIONS[lower]) return { region: AU_REGIONS[lower], country: "AU" };
  if (GB_REGIONS.test(raw)) return { region: null, country: "GB" };
  const cc = toCode(raw);
  if (cc) return { region: null, country: cc };
  return null;
}

const CITY = /^([A-Z][A-Za-zÀ-ÿ.'’ -]{1,40}?)$/;

/** "Phoenix, Arizona", "Chicago, IL 60615", "Toronto, Ontario, Canada", "Manchester, United Kingdom". */
export function readPlace(seg: string): Place | null {
  const parts = seg.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  const city = parts[0];
  if (!CITY.test(city) || /@|\d/.test(city) || city.split(/\s+/).length > 4) return null;
  let region: string | null = null;
  let country: string | null = null;
  for (const p of parts.slice(1)) {
    const rc = regionAndCountry(p);
    if (!rc) {
      if (!region && /^[A-Z][A-Za-z .'-]{2,30}$/.test(p) && !country) region = p;
      continue;
    }
    if (rc.region && !region) region = rc.region;
    if (rc.country) country = rc.country;
  }
  if (!country) return null;
  return { city, region, country };
}

// ---------------------------------------------------------------------------
// Lines and sections
// ---------------------------------------------------------------------------

const CONTACT = /@|\b(?:linkedin|github|portfolio|clips)\b|https?:|www\.|\+?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}|\b0\d{3,4} ?\d{3} ?\d{3,4}\b/i;
const LICENCE_LINE = /\blicen[cs]e|\blicensure\b|\bcredential\b|\bcertificat|\bregistered nurse \(|\bnmc\b|\bahpra\b|\bcpa\b \(|\bclearance\b/i;
const AUTH_OR_PREF = /\bcitizen|\bpermanent resident|\bopt\b|\bf-1\b|\bh-1b\b|\bsponsor|\bauthori[sz]|\beligible to work|\bwork permit|\bvisa\b|\brelocat|\bremote\b|\bhybrid\b|\bonsite\b|\bopen to\b|\bseeking\b|\bcommute\b/i;
const HEAD_NOUN = /\b(engineer|developer|programmer|nurse|teacher|educator|instructor|manager|analyst|designer|technician|tech|electrician|plumber|welder|carpenter|mechanic|cashier|clerk|associate|supervisor|controller|accountant|bookkeeper|scientist|coordinator|specialist|assistant|director|consultant|driver|operator|representative|advisor|adviser|administrator|officer|writer|editor|strategist|marketer|recruiter|therapist|pharmacist|technologist|paralegal|attorney|lawyer|chef|cook|server|bartender|barista|leader|lead|holder|apprentice|helper|installer|planner|buyer|auditor|architect|researcher|counselor|worker|aide|attendant|agent|producer|sister|matron)s?\b/i;
const GRADE_WORDS = /\b(apprentice|trainee|junior|jr\.?|entry[- ]level|new grad(?:uate)?|graduate|staff|senior|sr\.?|principal|lead|head|chief|a-grade)\b/gi;

function lineSplit(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

interface Section { head: string; body: string[] }
const HEADING = /^(?:[A-Z][A-Z &/'-]{3,44}|(?:Professional |Work |Teaching |Clinical |Relevant )?(?:Experience|Employment|Work History|Career History|Education|Skills|Summary|Profile|Objective|Certifications?|Licen[cs]es?|Projects?|Volunteer(?:ing)?|Publications|Awards)):?$/;

export function splitSections(text: string): Section[] {
  const out: Section[] = [];
  let cur: Section = { head: "HEADER", body: [] };
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (t.length <= 45 && HEADING.test(t) && !/@|\d/.test(t)) {
      out.push(cur);
      cur = { head: t.replace(/:$/, "").toUpperCase(), body: [] };
      continue;
    }
    cur.body.push(t);
  }
  out.push(cur);
  return out;
}
const isJobSection = (h: string) => /EXPERIENCE|EMPLOYMENT|WORK HISTORY|CAREER HISTORY|PROFESSIONAL BACKGROUND/.test(h) && !/EDUCATION|VOLUNTEER/.test(h);
const isEduSection = (h: string) => /EDUCATION|CREDENTIAL|QUALIFICATION/.test(h);
const isSummarySection = (h: string) => /SUMMARY|PROFILE|OBJECTIVE|STATEMENT|ABOUT/.test(h);

// ---------------------------------------------------------------------------
// Dates: English, Spanish, German, French, Portuguese, Italian, Dutch; numeric.
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {};
const MONTH_WORDS: Array<[string[], number]> = [
  [["jan", "january", "ene", "enero", "januar", "janv", "janvier", "janeiro", "gen", "gennaio", "januari", "jän", "jänner"], 0],
  [["feb", "february", "febrero", "februar", "févr", "fevr", "février", "fevereiro", "febbraio", "februari", "fev"], 1],
  [["mar", "march", "marzo", "märz", "maerz", "mars", "março", "marco", "maart", "mrt"], 2],
  [["apr", "april", "abr", "abril", "avr", "avril", "aprile"], 3],
  [["may", "mayo", "mai", "maio", "maggio", "mei", "mag"], 4],
  [["jun", "june", "junio", "juni", "juin", "junho", "giugno", "giu"], 5],
  [["jul", "july", "julio", "juli", "juil", "juillet", "julho", "luglio", "lug"], 6],
  [["aug", "august", "ago", "agosto", "août", "aout", "augustus"], 7],
  [["sep", "sept", "september", "septiembre", "set", "septembre", "setembro", "settembre"], 8],
  [["oct", "october", "octubre", "okt", "oktober", "octobre", "out", "outubro", "ott", "ottobre"], 9],
  [["nov", "november", "noviembre", "novembre", "novembro"], 10],
  [["dec", "december", "dic", "diciembre", "dez", "dezember", "déc", "décembre", "dezembro", "dicembre"], 11],
];
for (const [ws, n] of MONTH_WORDS) for (const w of ws) MONTHS[w] = n;
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.]/g, "\\.")).join("|");
const PRESENT = "present|current|currently|now|today|heute|actualidad|actual|presente|aujourd'hui|aujourd’hui|présent|atual|oggi|heden|nu|jetzt";
const POINT = `(?:(?:(${MONTH_ALT})\\.?\\s+)?((?:19|20)\\d\\d)|(\\d{1,2})[/.](\\d{4}))`;
const RANGE = new RegExp(`${POINT}\\s*(?:[-–—]+|to|bis|a|à|al|até|tot)\\s*(?:${POINT}|(${PRESENT}))`, "gi");

function monthOf(word: string | undefined, numeric: string | undefined, end: boolean): number {
  if (numeric) { const n = Number(numeric); if (n >= 1 && n <= 12) return (n - 1) / 12; }
  if (word) { const m = MONTHS[word.toLowerCase().replace(/\.$/, "")]; if (m !== undefined) return m / 12; }
  return end ? 0.5 : 0;
}

/** Every dated range on a line as [startYear, endYear] fractions. */
export function dateRanges(line: string, nowYear: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  RANGE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RANGE.exec(line))) {
    const sy = Number(m[2] ?? m[4]);
    const s = sy + monthOf(m[1], m[3], false);
    let e: number;
    if (m[9]) e = nowYear + 0.8;
    else {
      const ey = Number(m[6] ?? m[8]);
      e = ey + monthOf(m[5], m[7], true);
    }
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s && e <= nowYear + 1.5 && s >= 1950) out.push([s, e]);
  }
  return out;
}

function mergedYears(iv: Array<[number, number]>): number {
  if (!iv.length) return 0;
  const s = [...iv].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = s[0];
  for (const [a, b] of s.slice(1)) {
    if (a <= ce) ce = Math.max(ce, b);
    else { total += ce - cs; cs = a; ce = b; }
  }
  return total + (ce - cs);
}
const round1 = (n: number) => Math.round(n * 10) / 10;
const NOT_EMPLOYMENT = /\b(intern|internship|co-?op|student|substitute|pre-?apprentice|clinical rotation|practicum|preceptorship|student teach|volunteer|fellowship program|bootcamp|break|career break|gap|sabbatical|parental leave)\b/i;
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

const FUNCTION_PHRASE = /^(content marketing|digital marketing|learning and development|marketing and communications|business intelligence|analytics engineering|computational biology|social media|paid search|customer service|operations|communications|finance|marketing|sales|engineering)\b/i;
const FORMER_CUE = /\b(?:former|formerly|ex-|previously(?: a| an)?)\s+((?:[A-Za-z&'-]+\s+){0,4}?[A-Za-z&'-]+)(?=\s*(?:$|[|(),.;]|\bturned\b|\band\b))/i;
const CHANGER_CUE = /\b(career chang(?:er|e)|moving into|transitioning (?:to|into)|turned|making a (?:deliberate )?move|pivot(?:ing)? (?:to|into)|retrain(?:ed|ing))\b/i;

function cleanTitle(seg: string): { title: string; dropped: string } {
  const m = /^(.*?)(?:\s*[|(,]|\s+[-–—]\s+|$)/.exec(seg);
  const title = (m?.[1] ?? seg).replace(/\s+/g, " ").trim();
  return { title, dropped: seg.slice(title.length) };
}

function containsWord(hay: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(hay);
}

export function readProfile(rawText: string, opts: { nowYear?: number } = {}): MatchProfile {
  const nowYear = opts.nowYear ?? new Date().getUTCFullYear();
  const text = rawText.replace(/\bU\.S\.(?:A\.)?/g, "US").replace(/\bU\.K\./g, "UK").replace(/[‐-‒]/g, "-");
  const lines = lineSplit(text);
  const head = lines.slice(0, 8);
  const basis: Record<string, string> = {};
  const sections = splitSections(text);
  const headerBody = sections[0]?.body ?? [];

  // ---- headline: the first top line (after the name) that is a title, not contact/licence/preference
  let headline: string | null = null;
  const grade: string[] = [];
  for (let i = 1; i < Math.min(head.length, 6); i++) {
    for (const seg of head[i].split(/\s*\|\s*/)) {
      if (CONTACT.test(seg) || readPlace(seg)) continue;
      const { title, dropped } = cleanTitle(seg);
      // The licence test reads the title alone: "Elementary School Teacher
      // (Multiple Subject Credential)" is a headline whose aside names a credential.
      if (LICENCE_LINE.test(title) || AUTH_OR_PREF.test(seg) && !HEAD_NOUN.test(title)) continue;
      if (!title || title.length > 70 || !HEAD_NOUN.test(title) && !FUNCTION_PHRASE.test(title)) continue;
      headline = title;
      basis.headline = cut(head[i]);
      for (const g of `${title} ${dropped}`.matchAll(GRADE_WORDS)) {
        const w = g[1].toLowerCase().replace(/\.$/, "");
        if (!grade.includes(w)) grade.push(w);
      }
      break;
    }
    if (headline) break;
  }

  // ---- place: the contact line (the one with an email), else the first "City, ST" in the header
  let home: Place | null = null;
  const contactFirst = [...head.filter((l) => /@/.test(l)), ...head];
  outer: for (const l of contactFirst) {
    for (const seg of l.split(/\s*\|\s*/)) {
      const p = readPlace(seg);
      if (p) { home = p; basis.home = cut(seg); break outer; }
    }
  }

  // ---- authorisation (declared only)
  const authLines = head.filter((l) => /citizen|permanent resident|\bopt\b|\bf-1\b|h-1b|sponsor|authori[sz]ed|authori[sz]ation|eligible to work|work permit|\bvisa\b|clearance/i.test(l));
  const authText = authLines.join(" \n ");
  if (authLines.length) basis.workAuth = cut(authLines[0]);
  let status: WorkAuthStatus = "unknown";
  let needsSponsorship = false;
  const citizenOf: string[] = [];
  const declared = new Set<string>();
  const notIn = new Set<string>();
  const homeCC = home?.country ?? null;
  for (const m of authText.matchAll(/\b([A-Z][a-z]+|US|UK|USA)\s+citizen(?:ship)?\b|\bcitizen of (?:the )?([A-Z][A-Za-z ]+?)(?=[.,;\n]|$)/g)) {
    const word = (m[1] ?? m[2] ?? "").trim();
    const cc = toCode(word) ?? CITIZEN_ADJ[word.toLowerCase()] ?? null;
    if (cc) { citizenOf.push(cc); declared.add(cc); }
  }
  if (/\bcitizen\b/i.test(authText) && !/\bnon-?citizen\b/i.test(authText)) {
    status = "citizen";
    if (!citizenOf.length && homeCC) { citizenOf.push(homeCC); declared.add(homeCC); }
  }
  const pr = /\b([A-Z][a-z]+|US)?\s*permanent resident\b/.exec(authText);
  if (pr) {
    if (status !== "citizen") status = "permanent_resident";
    const cc = pr[1] ? (toCode(pr[1]) ?? CITIZEN_ADJ[pr[1].toLowerCase()] ?? null) : homeCC;
    if (cc) declared.add(cc);
  }
  for (const m of authText.matchAll(/\b(?:eligible|authori[sz]ed|permitted) to work in (?:the )?([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)/g)) {
    const cc = toCode(m[1]);
    if (cc) declared.add(cc);
  }
  if (/\bopt\b|\bf-1\b/i.test(authText)) {
    status = status === "unknown" ? "student_visa" : status;
    if (homeCC) declared.add(homeCC);
  }
  if (/\bh-1b\b/i.test(authText) && !/\bopt\b|\bf-1\b/i.test(authText)) status = status === "unknown" ? "work_visa" : status;
  if (/\b(?:will|would|do|does)?\s*(?:require|need)s?\b[^.\n]{0,30}\bsponsorship\b|\bsponsorship (?:required|needed)\b|\bwill require h-1b\b/i.test(authText)) {
    const forCountry = /sponsorship for (?:the )?(US|USA|American|UK|British|Canadian|Australian)\b(?:-based)?/i.exec(authText);
    if (forCountry) {
      const cc = toCode(forCountry[1]) ?? CITIZEN_ADJ[forCountry[1].toLowerCase()] ?? null;
      if (cc) notIn.add(cc);
    } else needsSponsorship = true;
  }
  const clearanceHeld = /\b(?:active|current|hold(?:s|ing)?|held)\b[^.\n]{0,30}\b(top secret\/sci|ts\/sci|top secret|secret)\b[^.\n]{0,12}\bclearance\b/i.exec(text.slice(0, 2500));
  const clearance = clearanceHeld ? clearanceHeld[1].toLowerCase() : null;
  if (clearanceHeld) basis.clearance = cut(clearanceHeld[0]);

  let canWorkIn: string[];
  let canWorkInBasis: MatchProfile["canWorkInBasis"];
  if (declared.size) {
    canWorkIn = [...declared].filter((c) => !notIn.has(c));
    canWorkInBasis = "declared";
  } else if (homeCC && !notIn.has(homeCC)) {
    canWorkIn = [homeCC];
    canWorkInBasis = "home";
  } else {
    canWorkIn = [];
    canWorkInBasis = "none";
  }

  // ---- preferences: remote, relocation, extra places (header only)
  const prefLines = head.slice(1).filter((l) => !/@/.test(l) || /remote|relocat|hybrid|open to|seeking/i.test(l));
  const prefText = prefLines.join(" \n ");
  const remote = /\bremote\b|\bwork from home\b|\btelecommut/i.test(prefText);
  if (remote) basis.remote = cut(prefLines.find((l) => /\bremote\b|\bwork from home\b|\btelecommut/i.test(l)) ?? "");
  let relocate: Relocate = "none";
  const rel = /relocat\w*\s+(?:anywhere\s+)?(?:with)?in\s+(?:the\s+)?([^.;\n]+)|relocat\w*\s+(?:anywhere|nationwide)\b([^.;\n]*)/i.exec(prefText);
  if (rel) {
    basis.relocate = cut(rel[0]);
    const scope = (rel[1] ?? rel[2] ?? "").trim();
    const regions = new Set<string>();
    for (const m of scope.matchAll(/(?:^|[^A-Za-z])([A-Z]{2,3})(?=[^A-Za-z]|$)/g)) {
      const c = usCaCode(m[1]) ?? AU_REGIONS[m[1].toLowerCase()] ?? null;
      if (c) regions.add(c);
    }
    for (const [name, v] of Object.entries(STATE_ALIASES)) {
      if (name.length > 2 && new RegExp(`\\b${name}\\b`, "i").test(scope)) {
        const c = v.names.find((n) => /^, [A-Z]{2}$/.test(n));
        if (c) regions.add(c.slice(2));
      }
    }
    for (const [name, c] of Object.entries(AU_REGIONS)) if (name.length > 3 && new RegExp(`\\b${name}\\b`, "i").test(scope)) regions.add(c);
    const countryWord = /\b(us|usa|united states|uk|united kingdom|canada|australia|germany|india|country|nationwide)\b/i.test(scope) || !scope;
    if (regions.size) relocate = [...regions];
    else if (countryWord) relocate = "country";
  }
  if (/\bonly\b/i.test(prefText) && /\bcommute|\bbus\b|\btransit\b/i.test(prefText)) relocate = "none";
  const extraPlaces: Place[] = [];
  const mm = /\b(?:roles|positions|jobs|work|opportunities) in ([A-Z][A-Za-z.]+(?: [A-Z][A-Za-z.]+){0,2}) or ([A-Z][A-Za-z.]+(?: [A-Z][A-Za-z.]+){0,2})/.exec(prefText);
  if (mm) {
    for (const c of [mm[1], mm[2]]) {
      const name = c.replace(/[.,;]+$/, "").replace(/ City$/, "").trim();
      if (/^(Greater|the|North|South|East|West)\b/.test(name)) continue;
      if (home && name.toLowerCase() === home.city.toLowerCase()) continue;
      extraPlaces.push({ city: name, region: null, country: homeCC });
    }
    if (extraPlaces.length) basis.extraPlaces = cut(mm[0]);
  }

  // ---- roles: the headline, then resumeRoleTerms re-ordered and filtered
  const lower = text.toLowerCase();
  const summaryBody = sections.find((s) => isSummarySection(s.head))?.body.join("\n") ?? "";
  const headlineLine = basis.headline ?? "";
  const formerM = FORMER_CUE.exec(headlineLine) ?? FORMER_CUE.exec(summaryBody);
  let former: string | null = formerM ? formerM[1].trim() : null;
  const changerCue = CHANGER_CUE.exec(`${headlineLine}\n${summaryBody}`);
  const careerChanger = !!former || !!changerCue;
  const licenceLines = lines.filter((l) => LICENCE_LINE.test(l));
  const terms = resumeRoleTerms(text, 6);
  const beforeMove = /([a-z][a-z ]{2,40}?)\s+(?:moving into|transitioning (?:to|into)|turned)\b/i.exec(`${headlineLine}\n${summaryBody}`);
  const candidates: string[] = [];
  const push = (t: string) => {
    const k = t.toLowerCase();
    if (candidates.some((c) => c.toLowerCase() === k || containsWord(c, t))) return;
    candidates.push(t);
  };
  if (headline) push(headline);
  const inHeadOrSummary = (t: string) => containsWord(`${headerBody.join("\n")}\n${summaryBody}`, t);
  const ordered = [...terms].sort((a, b) => {
    const rank = (t: string) => (containsWord(headlineLine, t) ? 0 : containsWord(summaryBody, t) ? 1 : 2);
    return rank(a) - rank(b);
  });
  for (const t of ordered) {
    const onlyOnLicence = lines.filter((l) => containsWord(l, t)).every((l) => licenceLines.includes(l));
    if (onlyOnLicence) continue;
    if (former && (containsWord(former, t) || containsWord(t, former))) continue;
    if (beforeMove && containsWord(beforeMove[1], t)) { former ??= t; continue; }
    if (careerChanger && !inHeadOrSummary(t)) { former ??= t; continue; }
    push(t);
  }
  // Department or function words are never role 1 when a real title exists.
  if (candidates.length > 1 && FUNCTION_PHRASE.test(candidates[0]) && !HEAD_NOUN.test(candidates[0])) {
    const j = candidates.findIndex((c) => HEAD_NOUN.test(c));
    if (j > 0) candidates.unshift(...candidates.splice(j, 1));
  }
  // "Biochemist turned data scientist": the word before the cue is the old career.
  if (!former && beforeMove) {
    const w = beforeMove[1].trim().split(/\s+/).pop() ?? "";
    if (w && !(headline && containsWord(headline, w))) former = w;
  }
  const roles = candidates.slice(0, MAX_TARGET_ROLES);
  if (former) basis.former = cut(formerM?.[0] ?? beforeMove?.[0] ?? former);
  if (roles.length) basis.roles = cut(headlineLine || roles.join(", "));

  // ---- years: employment sections only, merged intervals
  const jobLines = sections.filter((s) => isJobSection(s.head)).flatMap((s) => s.body);
  const realIv: Array<[number, number]> = [];
  let anyIv = false;
  for (const l of jobLines) {
    const rs = dateRanges(l, nowYear);
    if (!rs.length) continue;
    anyIv = true;
    if (NOT_EMPLOYMENT.test(l)) continue;
    realIv.push(...rs);
  }
  const evidenced = realIv.length ? round1(mergedYears(realIv)) : (anyIv ? 0 : null);
  const claimed = [...text.slice(0, 1500).matchAll(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\+?\s+years?\b(?!\s+(?:old|of age|ago))/gi)]
    .map((m) => (/^\d/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1].toLowerCase()]))
    .filter((n): n is number => typeof n === "number" && n <= 45);
  const claimMax = claimed.length ? Math.max(...claimed) : null;
  const years = evidenced === null && claimMax === null
    ? null
    : { low: evidenced ?? claimMax!, high: Math.max(evidenced ?? 0, claimMax ?? 0) };
  if (years) basis.years = `about ${years.low === years.high ? years.low : `${years.low}-${years.high}`} (from your employment dates${claimMax !== null ? " and what the résumé states" : ""})`;

  // ---- level
  const eduBody = sections.find((s) => isEduSection(s.head))?.body.join("\n") ?? "";
  const gradYear = Math.max(0, ...[...eduBody.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1])).filter((y) => y <= nowYear + 1));
  const eduIdx = sections.findIndex((s) => isEduSection(s.head));
  const expIdx = sections.findIndex((s) => isJobSection(s.head));
  const educationFirst = eduIdx >= 0 && (expIdx < 0 || eduIdx < expIdx);
  const headTitleText = `${headline ?? ""} ${grade.join(" ")}`;
  const newGrad = /\b(new grad(uate)?|entry[- ]level|graduate)\b/i.test(headTitleText) || /\bnew grad\b/i.test(head.slice(0, 3).join(" "))
    || ((realIv.length === 0 || (years?.low ?? 0) <= 1.5 || educationFirst) && gradYear >= nowYear - 1 && !(years && years.low >= 5));
  let level: Level = "mid";
  const yLow = years?.low ?? null;
  if (newGrad || (yLow !== null && yLow < 2 && !careerChanger)) level = "entry";
  else if (/\b(controller|director|head of|vp|vice president|chief)\b/i.test(headline ?? "")) level = "exec";
  else if (/\b(staff|principal|senior|sr\.?|lead|manager|ward manager)\b/i.test(headline ?? "") || (yLow ?? 0) >= 10) level = "senior";
  if (/\b(apprentice|trainee|helper|pre-?apprentice)\b/i.test(headline ?? "")) level = "entry";

  let targetYears: number | null = null;
  if (careerChanger) {
    const since = /\bsince (20\d\d)\b/i.exec(text) ?? /\b(?:completed|finished)\b[^.]{0,80}\b(?:in )?(20\d\d)\b/i.exec(text);
    if (since) targetYears = Math.max(0, nowYear - Number(since[1]));
    if (level !== "entry") level = targetYears !== null && targetYears < 3 ? "entry" : "mid";
    if (/\bscientist\b/i.test(headline ?? "") && level === "entry" && (yLow ?? 0) >= 3) level = "mid";
  }
  basis.level = `${level}${newGrad ? " (new graduate)" : ""}`;

  const licences = readResumeLicences(text);
  if (licences.length) basis.licences = licences.map((l) => l.basis).join(" / ").slice(0, 160);

  const expected = /\b(?:expected|anticipated|candidate for)\b[^.\n]{0,40}?\b(20\d\d)\b|\b(20\d\d)\s*\(expected\)/i.exec(eduBody);
  const student = !!expected && Number(expected[1] ?? expected[2]) > nowYear;
  let degree: MatchProfile["degree"] = null;
  if (/\b(?:ph\.?d|doctorate|doctor of|pharm\.?d|d\.?p\.?t|ed\.?d)\b/i.test(eduBody)) degree = "doctorate";
  else if (/\b(?:master'?s?|m\.s\.|m\.a\.|msc|mba|msn|m\.ed|mph)\b/i.test(eduBody)) degree = "master";
  else if (/\b(?:bachelor'?s?|b\.s\.|b\.a\.|b\.b\.a\.|bsn|b\.eng|bsc|b\.sc)\b/i.test(eduBody) || /\b(?:BS|BA|BSN|BBA)\b/.test(eduBody)) degree = "bachelor";
  else if (/\b(?:associate'?s? (?:degree|of)|a\.a\.s?\.|adn)\b/i.test(eduBody)) degree = "associate";
  else if (/\b(?:high school|diploma|ged)\b/i.test(eduBody)) degree = "high_school";
  if (degree) basis.degree = degree.replace("_", " ");

  return {
    version: PROFILE_VERSION,
    headline,
    roles,
    grade,
    former,
    careerChanger,
    home,
    extraPlaces,
    relocate,
    remote,
    radiusKm: DEFAULT_RADIUS_KM,
    canWorkIn,
    canWorkInBasis,
    workAuth: { status, needsSponsorship, citizenOf, clearance },
    level,
    newGrad,
    student,
    degree,
    years,
    targetYears,
    licences,
    basis,
  };
}

/** Nationality adjectives a citizenship line uses. */
const CITIZEN_ADJ: Record<string, string> = {
  american: "US", us: "US", usa: "US", british: "GB", uk: "GB", english: "GB", scottish: "GB", welsh: "GB",
  canadian: "CA", australian: "AU", german: "DE", irish: "IE", indian: "IN", french: "FR", spanish: "ES",
  dutch: "NL", italian: "IT", mexican: "MX", "new zealand": "NZ",
};
