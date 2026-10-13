/**
 * THE RECRUITER RUBRIC. "Would a recruiter shortlist this candidate for this
 * job?" decided on five questions:
 *
 *   role       target | adjacent | related | old (career changer's previous job) | off
 *   seniority  ok | too_junior (overqualified) | too_senior
 *   location   ok | remote_ok | mismatch | unknown
 *   auth       can they legally take it: ok | fail
 *   licence    a licence or credential the posting requires that they lack: ok | fail
 *
 * shortlist = role in {target, adjacent} AND seniority ok AND location not
 * mismatch AND auth ok AND licence ok. Unknown location is NOT a mismatch.
 *
 * TWO RUBRICS, ONE FILE.
 *   legacy  the 2026-10-12 BEFORE rubric exactly as it ran: licence always
 *           passed, and sponsorship / citizenship wording was read only from
 *           the descriptions the BEFORE run held. Kept so the positive control
 *           can replay BEFORE and reproduce 14.5 / 10.0 to the decimal.
 *   v2      the rubric BEFORE and AFTER are both judged with from now on
 *           (spec 19.2). Three changes, nothing else moves:
 *           1. LICENCES ARE CHECKED (licenceVerdict below): a posting that
 *              requires a licence family the candidate does not hold, or names
 *              a jurisdiction their licence does not cover, fails, unless it
 *              says the licence may follow hire ("or eligible", "within 90
 *              days", "upon hire"). A multistate RN licence covers every
 *              compact state; a national register (NMC, GPhC, AHPRA) covers its
 *              country. A licensed title with no readable description is
 *              checked for the family only.
 *           2. A CLEARANCE IS A CREDENTIAL: "active / current clearance" or
 *              "clearance required" fails anyone who holds none, citizen or
 *              not; "able to obtain a clearance" fails only a non-citizen.
 *           3. AUTHORISATION WORDING IS READ WHEREVER A DESCRIPTION EXISTS:
 *              callers pass the corpus description for every row, whatever
 *              pipeline produced it, and every verdict says whether one was
 *              read (descRead), so a report can name its coverage.
 *
 * THE RUBRIC NEVER IMPORTS THE ENGINE. Its licence and clearance reading is
 * written here, apart from _shared/licence-rules.ts and posting-requirements.ts,
 * so the matcher is never graded by its own rules.
 *
 * Hand reviews: judgments/overrides.json ("<resumeId>::<postingId>") and
 * judgments/posting-facts.json (a posting's own metadata) apply to both rubrics.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LicenceHeld, LicenceKind, ResumeTruth } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(HERE, rel), "utf8")) as T;

export type Rubric = "legacy" | "v2";
export type Role = "target" | "adjacent" | "related" | "old" | "off";
export interface Verdict {
  role: Role;
  seniority: "ok" | "too_junior" | "too_senior";
  location: "ok" | "remote_ok" | "mismatch" | "unknown";
  auth: "ok" | "fail";
  licence: "ok" | "fail";
  shortlist: boolean;
  reasons: string[];
  reviewed: boolean;
  /** A description was available to read sponsorship, citizenship and licence wording from. */
  descRead: boolean;
  note?: string;
}
export interface PostingRow {
  id: string; title: string; company?: string | null; location?: string | null; country?: string | null;
  workMode?: string | null; remote?: boolean | null; minYears?: number | null; experienceBand?: string | null;
  category?: string | null; agency?: boolean | null;
}

const STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut",
  DE: "delaware", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa",
  KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan",
  MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire",
  NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma",
  OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee",
  TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
  DC: "district of columbia",
  ON: "ontario", QC: "quebec", BC: "british columbia", AB: "alberta", QLD: "queensland", NSW: "new south wales", VIC: "victoria",
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Does the location string name this state/region (by code, case-sensitive, or by name)? */
export function namesRegion(loc: string, code: string): boolean {
  const name = STATES[code] ?? code.toLowerCase();
  if (new RegExp(`(^|[^A-Za-z])${escape(code)}([^A-Za-z]|$)`).test(loc)) return true;
  return new RegExp(`\\b${escape(name)}\\b`, "i").test(loc);
}
function anyOtherState(loc: string, except: string): boolean {
  return Object.keys(STATES).some((c) => c !== except && c.length === 2 && namesRegion(loc, c));
}
function inMetro(loc: string, metro: string[]): boolean {
  const lower = loc.toLowerCase();
  for (const m of metro) {
    const [city, st] = m.split("|");
    if (!new RegExp(`\\b${escape(city)}\\b`, "i").test(lower)) continue;
    if (!st) return true;
    if (namesRegion(loc, st)) return true;
    if (!anyOtherState(loc, st)) return true; // city named, no conflicting state
  }
  return false;
}
const US_HINT = /\b(united states|usa|u\.s\.a?\.?)\b|(^|[^A-Za-z])US([^A-Za-z]|$)/;
const COUNTRY_WORDS = /\b(united states|usa|canada|united kingdom|england|scotland|wales|australia|india|germany|france|spain|ireland|mexico|philippines|netherlands|remote)\b/i;
/** Does the location string name ANY place we can place (a state/province, a country, "remote")? */
export function namesPlace(loc: string): boolean {
  if (!loc.trim()) return false;
  if (COUNTRY_WORDS.test(loc) || US_HINT.test(loc)) return true;
  return Object.keys(STATES).some((c) => namesRegion(loc, c));
}

// ─── Authorisation wording ─────────────────────────────────────────────────
// LEGACY patterns, byte for byte as the BEFORE run used them.
export const NO_SPONSOR = /\b(unable|not able|cannot|can ?not|will not|won'?t|do(es)? not|not)\s+(be able\s+)?(to\s+)?sponsor\b|\b(unable|not able|cannot|can ?not|will not|won'?t|do(es)? not|not)\s+(be able\s+)?(to\s+)?(provide|offer|support|consider)\b.{0,60}?\b(sponsor\w*|visas?|h-?1b)\b|without (the need for |requiring )?(current or future |now or in the future |present or future )?(employer[- ]|visa |immigration )?sponsorship|\bno (visa |immigration )?sponsorship\b|sponsorship (is |will )?not (be )?(available|offered|provided)|not eligible for (visa )?sponsorship|\bauthori[sz]ed to work\b.{0,60}?\b(now and|now or) in the future\b/i;
export const CITIZEN_ONLY = /\bu\.?s\.? citizen(ship)?\b[^.]{0,40}\b(required|requirement|only|must)\b|\bmust be (a )?u\.?s\.? citizen\b|\b(active |current )?(secret|top secret|ts\/sci|ts\/sci|security) clearance\b[^.]{0,40}\b(required|must|eligib)|\bclearance (is )?required\b|\bus citizens only\b/i;

// V2 additions. Sponsorship refusals the legacy pattern missed (UK and German
// postings), citizenship split from clearance, and clearance read as a credential.
export const NO_SPONSOR_V2 = new RegExp(
  NO_SPONSOR.source
    + "|\\b(unable|not able|cannot|can ?not|will not|won'?t|do(es)? not)\\s+(be able\\s+)?(to\\s+)?(offer|provide|support)\\s+(a\\s+)?(skilled worker|tier 2|work) (visa|permit)"
    + "|\\b(kein|keine|nicht)\\b[^.]{0,40}\\b(visum|visa|arbeitserlaubnis|sponsoring)\\b"
    + "|\\b(g(ü|ue)ltige )?arbeitserlaubnis\\b[^.]{0,40}\\b(voraussetzung|erforderlich|notwendig)\\b"
    + "|\\b(valid |existing )?(eu |german |uk )?work permit\\b[^.]{0,30}\\b(is )?(required|a must|mandatory)\\b",
  "i",
);
export const CITIZEN_REQUIRED = /\bus citizen(ship)?\b[^.]{0,40}\b(required|requirement|only|must)\b(?![^.]{0,30}\b(or|and) (a )?(lawful )?permanent resident)|\bmust be (a )?us citizen\b(?![^.]{0,30}\b(or|and) (a )?(lawful )?permanent resident)|\bus citizens only\b|\b(british|uk|canadian|australian) citizen(ship)?\b[^.]{0,30}\b(required|only|must)\b|\bmust be an? (british|uk|canadian|australian) citizen\b/i;
/** Open to citizens and permanent residents, closed to anyone on a visa. */
export const CITIZEN_OR_PR = /\b(us )?citizens?\b[^.]{0,20}\b(or|and) (a |an )?(lawful |legal )?permanent residents?\b|\bgreen card holders?\b[^.]{0,30}\b(only|required|must)\b|\bmust be (a |an )?(us citizen|citizen) or (a |an )?(lawful |legal )?permanent resident\b/i;

const CLEARANCE_NOUN = String.raw`(secret|top secret|ts\/sci|ts|public trust|security|government|dod|dhs|dv|sc|nv[12]|baseline|q|l) (security )?clearance`;
/** Held at hire, said with a qualifier that leaves no doubt. */
export const CLEARANCE_ACTIVE = new RegExp(
  String.raw`\b(active|current|existing|in-scope)\b[^.]{0,25}\b${CLEARANCE_NOUN}\b`
    + String.raw`|\b(must|required to) (have|hold|possess)\b[^.]{0,30}\b${CLEARANCE_NOUN}\b`
    + String.raw`|\bminimum clearance required to start\b`
    + String.raw`|\bclearance required\s*:\s*active\b`,
  "i",
);
/** "Clearance required": held at hire unless the same sentence says it may be obtained. */
export const CLEARANCE_REQUIRED = new RegExp(
  String.raw`\b${CLEARANCE_NOUN}\b[^.]{0,25}\b(is |are )?(required|mandatory)\b|\bclearance (is )?required\b`,
  "i",
);
/** The clearance may be obtained after hire: only citizenship decides it. */
export const CLEARANCE_OBTAIN = new RegExp(
  String.raw`\b(ability|able|eligib\w*|willing\w*|must be able)\b[^.]{0,40}\b(obtain|attain|get|acquire|be granted|qualify for|hold|maintain)\b[^.]{0,40}\bclearance\b`
    + String.raw`|\bclearance\b[^.]{0,30}\b(eligib\w*|obtainable|to be obtained|will be sponsored)\b`
    + String.raw`|\beligib\w* (for|to obtain) (a |an )?${CLEARANCE_NOUN}\b`,
  "i",
);
/** Mentions that are not a requirement at all. */
const NOT_A_CLEARANCE_REQUIREMENT = /\b(previously held|any current or previous|details of any|if you (already )?(have|hold)|no clearance)\b|\bclearance required( for start)?\s*:?\s*(no|none|n\/a|not required)\b/i;
/** Obtaining these needs citizenship; a public-trust position does not. */
const CITIZEN_ONLY_CLEARANCE = /\b(secret|top secret|ts\/sci|ts|dod|dhs|q|l|government|security) (security )?clearance\b/i;

/** "U.S." breaks the rubric's [^.] windows: read it as "US" (v2 only; legacy reads the text as it ran). */
export const normaliseUS = (s: string) => s.replace(/\bU\.S\.A?\.?(?=[\s,;:)]|$)/g, "US").replace(/\bu\.s\.a?\.?(?=[\s,;:)]|$)/g, "us");

/** The sentence around a match: the span the rubric judges a requirement by. */
function sentenceAround(text: string, index: number, len: number): string {
  const stops = /[.;\n••]|\s-\s/g;
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(stops)) {
    const i = m.index ?? 0;
    if (i < index) start = i + m[0].length;
    else if (i >= index + len) { end = i; break; }
  }
  return text.slice(start, end);
}

/** Clearance as a credential. The first requirement-shaped mention decides. */
export function clearanceVerdict(t: Pick<ResumeTruth, "citizen" | "clearance">, rawDesc: string): { fail: boolean; why: string | null } {
  const desc = normaliseUS(rawDesc);
  const sentences = (re: RegExp) => [...desc.matchAll(new RegExp(re.source, "gi"))]
    .map((m) => ({ m: m[0], s: sentenceAround(desc, m.index ?? 0, m[0].length) }))
    .filter((x) => !NOT_A_CLEARANCE_REQUIREMENT.test(x.s));
  const held = sentences(CLEARANCE_ACTIVE).length > 0
    || sentences(CLEARANCE_REQUIRED).some((x) => !CLEARANCE_OBTAIN.test(x.s));
  if (held && !t.clearance) return { fail: true, why: "needs an active clearance" };
  const obtain = sentences(CLEARANCE_OBTAIN).filter((x) => CITIZEN_ONLY_CLEARANCE.test(x.s));
  if (obtain.length && !t.citizen) return { fail: true, why: "clearance needs citizenship" };
  return { fail: false, why: null };
}

// ─── Licences ──────────────────────────────────────────────────────────────
/** RN multistate (Nurse Licensure Compact) states, as the rubric reads them (2026). CT and MA enacted but not implemented. */
export const NLC: ReadonlySet<string> = new Set([
  "AL", "AZ", "AR", "CO", "DE", "FL", "GA", "ID", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MS", "MO", "MT", "NE", "NH",
  "NJ", "NM", "NC", "ND", "OH", "OK", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);
const NLC_PENDING: ReadonlySet<string> = new Set(["CT", "MA"]);
/** Countries whose register is national: a licence held "in GB" covers every GB posting. */
const NATIONAL: Partial<Record<LicenceKind, ReadonlySet<string>>> = {
  rn: new Set(["GB", "AU", "IE", "NZ"]), pharmacist: new Set(["GB", "AU", "IE"]), pt: new Set(["GB", "AU", "IE"]),
  cdl: new Set(["US", "GB", "AU", "DE", "IE"]), electrician: new Set(["GB", "DE"]), cpa: new Set(["GB", "IE", "IN"]),
};
const CA_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK"]);
const AU_STATES = new Set(["QLD", "NSW", "VIC", "SA", "WA", "TAS", "ACT", "NT"]);
const REGION_NAMES: Record<string, string> = {
  ...STATES, MB: "manitoba", NS: "nova scotia", NB: "new brunswick", SK: "saskatchewan", NL: "newfoundland", PE: "prince edward island",
  SA: "south australia", TAS: "tasmania", ACT: "australian capital territory", NT: "northern territory",
};

/** Licence families a TITLE alone demands (the job cannot be done without one). */
const TITLE_DEMAND: Array<{ kind: LicenceKind; re: RegExp; grade?: LicenceHeld["grade"] }> = [
  { kind: "rn", re: /\b(registered nurse|rn|r\.n\.|staff nurse|charge nurse|clinical nurse|travel nurse|nurse resident|new grad(uate)? nurse|graduate nurse)\b/i },
  { kind: "lpn", re: /\b(lpn|lvn|licensed (practical|vocational) nurse)\b/i },
  { kind: "np", re: /\b(nurse practitioner|aprn|fnp)\b/i },
  { kind: "pharmacist", re: /\bpharmacist\b/i },
  { kind: "pta", re: /\b(physical therapist assistant|physical therapy assistant|pta)\b/i },
  { kind: "pt", re: /^(?!.*\bassistant\b).*\b(physical therapist|physiotherapist)\b/i },
  { kind: "electrician", re: /\bmaster electrician\b/i, grade: "master" },
  { kind: "electrician", re: /\b(journeyman|journey ?(wo)?man|journey ?person|licensed|approved) electrician\b|\belectrician\b[^,|]*\b(journeyman|licen[cs]ed)\b/i, grade: "journeyman" },
  { kind: "cdl", re: /\b(cdl[- ]?a|class a (cdl|driver)|cdl driver|tractor[- ]trailer|otr (truck )?driver|hgv|lgv|class 1 (driver|hgv)|c\+e|az driver)\b/i },
];

/** Requirement-shaped mentions of a licence family in a description. */
const DESC_MENTION: Array<{ kind: LicenceKind; re: RegExp }> = [
  { kind: "rn", re: /\b(registered nurse|rn|r\.n\.)\b[^.;\n]{0,40}\b(licen[cs]e|licensure|registration)\b|\blicensed (as an? )?(registered nurse|rn)\b|\bnmc (registration|registered|pin)\b|\bregistered with the nmc\b|\bnursing licen[cs]e\b/i },
  { kind: "lpn", re: /\b(lpn|lvn|licensed practical nurse)\b[^.;\n]{0,30}\blicen[cs]e\b/i },
  { kind: "pharmacist", re: /\bpharmacist\b[^.;\n]{0,30}\b(licen[cs]e|licensure|registration)\b|\blicensed (as an? )?pharmacist\b|\bgphc\b[^.;\n]{0,20}\b(registration|registered)\b|\bregistered with the gphc\b/i },
  { kind: "pt", re: /\b(physical therapist|physical therapy|physiotherapist|pt)\b[^.;\n]{0,30}\b(licen[cs]e|licensure|registration)\b|\bhcpc\b[^.;\n]{0,20}\b(registration|registered)\b/i },
  { kind: "pta", re: /\b(physical therapist assistant|pta)\b[^.;\n]{0,30}\b(licen[cs]e|licensure|certification)\b/i },
  { kind: "teacher", re: /\b(teaching|teacher|educator'?s?|educator)\b[^.;\n]{0,25}\b(licen[cs]e|certificate|certification|credential)\b|\b(qualified teacher status|qts)\b/i },
  { kind: "electrician", re: /\b(journeyman|journeyperson|master|electrical|electrician'?s?)\b[^.;\n]{0,25}\blicen[cs]e\b|\blicensed electrician\b/i },
  { kind: "epa608", re: /\bepa\b[^.;\n]{0,20}\b(608|section 608|universal)\b|\b608 (universal )?certif/i },
  { kind: "cdl", re: /\b(cdl|commercial driver'?s? licen[cs]e)\b|\bclass (a|b) (licen[cs]e|cdl)\b|\bc\+e licen[cs]e\b|\bclass 1 licen[cs]e\b/i },
  { kind: "cpa", re: /\b(cpa|certified public accountant|aca|acca|chartered accountant)\b[^.;\n]{0,30}\b(licen[cs]e|certification|qualified|designation|required|must)\b|\bactive cpa\b|\bmust be a (licensed )?cpa\b/i },
  { kind: "pe", re: /\b(pe|p\.e\.|professional engineer(ing)?)\b[^.;\n]{0,25}\b(licen[cs]e|licensure|registration)\b|\blicensed professional engineer\b/i },
];
const REQUIRED_WORDS = /\b(required|requires|require|must|mandatory|need(ed|s)?|valid|current|active|unrestricted|unencumbered|hold|possess|minimum qualifications?|requirements?|essential)\b/i;
const PREFERRED_WORDS = /\b(preferred|a plus|an asset|desired|desirable|nice to have|bonus|advantageous|ideally|recommended|not required|optional)\b/i;
/** An apprentice's licence or registration is issued on hire: never a gap. */
const APPRENTICE_LICENCE = /\bapprentice\w*\b[^.;\n]{0,30}\b(licen[cs]e|registration|card)\b/i;
const PENDING_WORDS = /\b(or eligible|eligible (for|to)|[a-z]+-eligible|eligibility|within \d+\s*(days|months|weeks)|within (thirty|sixty|ninety|30|60|90|six|twelve)\b|upon hire|prior to (start|hire|employment)|before (the )?start|obtain(ed)?|pending|in process|willing(ness)? to (obtain|get|acquire)|ability to (obtain|get|acquire)|pursuing|working towards?|graduate nurse permit|temporary permit|by endorsement|reciprocity)\b/i;

const gradeRank = (g: LicenceHeld["grade"] | undefined): number => (g === "master" ? 3 : g === "journeyman" ? 2 : g === "apprentice" ? 1 : 0);

/** Codes that are also ordinary upper-case words in a shouted sentence ("IN", "OR", "ME", "OK", "HI"). */
const AMBIGUOUS_CODES = new Set(["IN", "OR", "ME", "OK", "HI", "ACT"]);
/** US states, provinces, AU states and national registers a sentence names. */
function jurisdictionsIn(sentence: string): string[] {
  const out = new Set<string>();
  for (const [code, name] of Object.entries(REGION_NAMES)) {
    if (new RegExp(`\\b${escape(name)}\\b`, "i").test(sentence)) out.add(code);
  }
  // A code counts only when written as one (", TX", "TX RN", "(QLD)"); "Texas" is caught by name above.
  for (const m of sentence.matchAll(/(?:^|[\s,(/])([A-Z]{2,3})(?=[\s,)/]|$)/g)) {
    if (REGION_NAMES[m[1]] && !AMBIGUOUS_CODES.has(m[1])) out.add(m[1]);
  }
  if (/\b(nmc|gphc|hcpc|qts)\b/i.test(sentence) || /\b(uk|united kingdom|england|scotland|wales|nhs)\b/i.test(sentence)) out.add("GB");
  if (/\bahpra\b/i.test(sentence) || /\baustralia(n)?\b/i.test(sentence)) out.add("AU");
  return [...out];
}

function covers(have: LicenceHeld, jur: string): boolean {
  if (!have.region) return true; // a national certificate (EPA 608) has no jurisdiction
  if (have.region === jur) return true;
  if (have.kind === "rn" && have.compact && NLC.has(have.region) && (NLC.has(jur) || NLC_PENDING.has(jur))) return true;
  const nat = NATIONAL[have.kind];
  if (nat?.has(have.region) && (jur === have.region || (have.region === "AU" && AU_STATES.has(jur)))) return true;
  if (have.kind === "cdl" && have.region.length === 2 && STATES[have.region] && STATES[jur] && !CA_PROVINCES.has(jur)) return true; // a US CDL is good in every state
  if (have.kind === "cdl" && CA_PROVINCES.has(have.region) && CA_PROVINCES.has(jur)) return true; // a Class 1 is good across Canada
  if (have.kind === "electrician" && AU_STATES.has(have.region) && AU_STATES.has(jur)) return true; // AU mutual recognition
  return false;
}

/**
 * The v2 licence rule: "fail" with a reason, or "ok". Reads the description's
 * requirement sentences; with no description, only a licensed title's family.
 */
export function licenceVerdict(t: Pick<ResumeTruth, "held">, title: string, desc: string | null): { fail: boolean; why: string | null } {
  const held = t.held ?? [];
  const has = (k: LicenceKind) => held.filter((h) => h.kind === k);
  if (desc) {
    for (const { kind, re } of DESC_MENTION) {
      const g = new RegExp(re.source, "gi");
      for (const m of desc.matchAll(g)) {
        const sent = sentenceAround(desc, m.index ?? 0, m[0].length);
        if (PREFERRED_WORDS.test(sent) || PENDING_WORDS.test(sent) || APPRENTICE_LICENCE.test(sent)) continue;
        if (!REQUIRED_WORDS.test(sent)) continue;
        const mine = has(kind);
        if (!mine.length) return { fail: true, why: `requires a ${kind} licence: "${sent.trim().slice(0, 120)}"` };
        if (kind === "electrician") {
          // "Journeyman or Master" asks for journeyman; master alone asks for master.
          const need = /\bjourney/i.test(sent) ? 2 : /\bmaster\b/i.test(sent) ? 3 : 0;
          if (need && !mine.some((h) => gradeRank(h.grade) >= need)) return { fail: true, why: `requires a ${need === 3 ? "master" : "journeyman"} electrician licence` };
        }
        if (kind === "cdl" && /\bclass a\b|\bcdl[- ]?a\b/i.test(sent) && !mine.some((h) => h.grade === "A")) return { fail: true, why: "requires a Class A licence" };
        const jurs = jurisdictionsIn(sent).filter((j) => j !== "US");
        if (jurs.length && !jurs.some((j) => mine.some((h) => covers(h, j)))) {
          return { fail: true, why: `requires a ${kind} licence in ${jurs.join("/")}; holds ${mine.map((h) => h.region ?? "?").join("/")}` };
        }
      }
    }
  }
  for (const d of TITLE_DEMAND) {
    if (!d.re.test(title)) continue;
    const mine = has(d.kind);
    if (!mine.length) return { fail: true, why: `the title needs a ${d.kind} licence` };
    if (d.grade && !mine.some((h) => gradeRank(h.grade) >= gradeRank(d.grade))) return { fail: true, why: `the title needs a ${d.grade} ${d.kind} licence` };
    break;
  }
  return { fail: false, why: null };
}

// ─── The verdict ───────────────────────────────────────────────────────────
export function autoJudge(t: ResumeTruth, row: PostingRow, desc: string | null, rubric: Rubric = "v2"): Verdict {
  const reasons: string[] = [];
  const title = row.title ?? "";
  // ROLE
  let role: Role = "off";
  if (t.target.some((re) => re.test(title))) role = "target";
  else if (t.adjacent.some((re) => re.test(title))) role = "adjacent";
  else if (t.oldCareer.some((re) => re.test(title))) role = "old";
  else if (t.related.some((re) => re.test(title))) role = "related";
  if ((role === "target" || role === "adjacent") && t.oldCareer.some((re) => re.test(title)) && !t.target.some((re) => re.test(title))) role = "old";
  reasons.push(`role:${role}`);

  // SENIORITY
  let seniority: Verdict["seniority"] = "ok";
  if (t.tooSenior.some((re) => re.test(title))) { seniority = "too_senior"; reasons.push("title above level"); }
  else if (typeof row.minYears === "number" && row.minYears > t.maxMinYears) { seniority = "too_senior"; reasons.push(`asks ${row.minYears}y > ${t.maxMinYears}`); }
  else if (t.tooJunior.some((re) => re.test(title))) { seniority = "too_junior"; reasons.push("title below level"); }
  else if (t.profile === "senior" && row.experienceBand === "entry") { seniority = "too_junior"; reasons.push("entry band"); }

  // LOCATION + AUTH
  let location: Verdict["location"] = "unknown";
  let auth: Verdict["auth"] = "ok";
  const loc = row.location ?? "";
  let country = row.country ?? null;
  if (!country && US_HINT.test(loc)) country = "US";
  const isRemote = row.workMode === "remote" || row.remote === true || /\bremote\b/i.test(loc);
  if (country && !t.authorized.includes(country)) {
    auth = "fail"; location = "mismatch"; reasons.push(`country ${country} not authorized`);
  } else if (isRemote) {
    location = country ? "remote_ok" : "unknown"; reasons.push(country ? "remote in-country" : "remote, country unknown");
  } else if (loc && inMetro(loc, t.metro)) {
    location = "ok"; reasons.push("in metro");
  } else if (t.relocate === "country" && country && t.authorized.includes(country)) {
    location = "ok"; reasons.push("relocates in-country");
  } else if (Array.isArray(t.relocate) && loc && t.relocate.some((rg) => namesRegion(loc, rg))) {
    location = "ok"; reasons.push("relocates to region");
  } else if (country && t.authorized.includes(country) && !namesPlace(loc) && !inMetro(loc, t.metro)) {
    location = "unknown"; reasons.push(`place not named: ${loc}`);
  } else if (loc || country) {
    location = "mismatch"; reasons.push(`not commutable: ${loc || country}`);
  }

  let licence: Verdict["licence"] = "ok";
  if (rubric === "legacy") {
    if (auth === "ok" && desc) {
      if (t.sponsorshipFuture && NO_SPONSOR.test(desc)) { auth = "fail"; reasons.push("no sponsorship"); }
      if (!t.citizen && CITIZEN_ONLY.test(desc)) { auth = "fail"; reasons.push("citizen/clearance only"); }
    }
  } else {
    const d = desc ? normaliseUS(desc) : null;
    const pr = t.permanentResident ?? ("declaredAuth" in t && (t as { declaredAuth?: string }).declaredAuth === "permanent_resident");
    if (auth === "ok" && d) {
      if (t.sponsorshipFuture && NO_SPONSOR_V2.test(d)) { auth = "fail"; reasons.push("no sponsorship"); }
      else if (!t.citizen && CITIZEN_REQUIRED.test(d)) { auth = "fail"; reasons.push("citizenship required"); }
      else if (!t.citizen && !pr && CITIZEN_OR_PR.test(d)) { auth = "fail"; reasons.push("citizens and permanent residents only"); }
    }
    if (desc) {
      const c = clearanceVerdict(t, desc);
      if (c.fail) {
        if (c.why === "clearance needs citizenship") { if (auth === "ok") { auth = "fail"; reasons.push(c.why); } }
        else { licence = "fail"; reasons.push(c.why!); }
      }
    }
    const l = licenceVerdict(t, title, desc);
    if (l.fail) { licence = "fail"; reasons.push(l.why!); }
  }
  const shortlist = (role === "target" || role === "adjacent") && seniority === "ok" && location !== "mismatch" && auth === "ok" && licence === "ok";
  return { role, seniority, location, auth, licence, shortlist, reasons, reviewed: false, descRead: !!desc };
}

type Override = Partial<Pick<Verdict, "role" | "seniority" | "location" | "auth" | "licence">> & { note?: string };
export const OVERRIDES: Record<string, Override> = readJson("judgments/overrides.json");
export const POSTING_FACTS: Record<string, Partial<PostingRow> & { note?: string }> = readJson("judgments/posting-facts.json");

/** The automatic verdict, with the posting's hand-corrected facts and the pair's hand override applied. */
export function judge(t: ResumeTruth, row: PostingRow, desc: string | null, rubric: Rubric = "v2"): Verdict {
  const fixed = { ...row, ...(POSTING_FACTS[row.id] ?? {}) };
  const v = autoJudge(t, fixed, desc, rubric);
  const o = OVERRIDES[`${t.id}::${row.id}`];
  if (o) {
    const { note, ...fields } = o;
    Object.assign(v, fields);
    v.reviewed = true;
    if (note) v.note = note;
    v.shortlist = (v.role === "target" || v.role === "adjacent") && v.seniority === "ok" && v.location !== "mismatch" && v.auth === "ok" && v.licence === "ok";
  }
  return v;
}
