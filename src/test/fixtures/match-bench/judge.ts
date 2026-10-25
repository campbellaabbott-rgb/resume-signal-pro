/**
 * THE RECRUITER RUBRIC, ported from the 2026-10-12 BEFORE bench's judge.ts.
 * "Would a recruiter shortlist this candidate for this job?" on five questions:
 *
 *   role       target | adjacent | related | old (career changer's previous job) | off
 *   seniority  ok | too_junior (overqualified) | too_senior
 *   location   ok | remote_ok | mismatch | unknown
 *   auth       ok | fail (country authorisation, "no sponsorship", citizenship)
 *   licence    ok | fail
 *
 * shortlist = role in {target, adjacent} AND seniority ok AND location not
 * mismatch AND auth ok AND licence ok. Unknown location is not a mismatch.
 *
 * THE LICENCE RULE (spec 19.2, new). The BEFORE judge hard-coded licence = ok,
 * so no licence was ever checked. With `licences: true` the rubric applies the
 * licence-jurisdiction rule and the clearance-as-credential rule, to BEFORE and
 * AFTER alike. It is written from the posting's own words with its own
 * patterns, never from the product's extractor, so the judge cannot agree with
 * the system under test by construction:
 *   - a posting that requires a licence kind the candidate holds nowhere fails;
 *   - a licence held in another state is a transfer, not a fail (the spec's
 *     "not a gate"); a compact licence covers compact states;
 *   - a posting requiring an ACTIVE clearance fails a candidate who holds none.
 * With `licences: false` the port reproduces BEFORE exactly (the positive
 * control in src/test/match-bench.test.ts).
 *
 * Hand corrections: judgments/overrides.json ("<resumeId>::<postingId>") and
 * judgments/posting-facts.json (a posting's own metadata), as in BEFORE.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResumeTruth } from "./manifest";

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
  note?: string;
}
export interface PostingRow {
  id: string; title: string; company?: string | null; location?: string | null; country?: string | null;
  workMode?: string | null; remote?: boolean | null; minYears?: number | null; experienceBand?: string | null;
  category?: string | null; agency?: boolean | null;
}
export interface JudgeOptions { licences: boolean }

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
    if (!anyOtherState(loc, st)) return true;
  }
  return false;
}
const US_HINT = /\b(united states|usa|u\.s\.a?\.?)\b|(^|[^A-Za-z])US([^A-Za-z]|$)/;
const COUNTRY_WORDS = /\b(united states|usa|canada|united kingdom|england|scotland|wales|australia|india|germany|france|spain|ireland|mexico|philippines|netherlands|remote)\b/i;
export function namesPlace(loc: string): boolean {
  if (!loc.trim()) return false;
  if (COUNTRY_WORDS.test(loc) || US_HINT.test(loc)) return true;
  return Object.keys(STATES).some((c) => namesRegion(loc, c));
}

export const NO_SPONSOR = /\b(unable|not able|cannot|can ?not|will not|won'?t|do(es)? not|not)\s+(be able\s+)?(to\s+)?sponsor\b|\b(unable|not able|cannot|can ?not|will not|won'?t|do(es)? not|not)\s+(be able\s+)?(to\s+)?(provide|offer|support|consider)\b.{0,60}?\b(sponsor\w*|visas?|h-?1b)\b|without (the need for |requiring )?(current or future |now or in the future |present or future )?(employer[- ]|visa |immigration )?sponsorship|\bno (visa |immigration )?sponsorship\b|sponsorship (is |will )?not (be )?(available|offered|provided)|not eligible for (visa )?sponsorship|\bauthori[sz]ed to work\b.{0,60}?\b(now and|now or) in the future\b/i;
export const CITIZEN_ONLY = /\bu\.?s\.? citizen(ship)?\b[^.]{0,40}\b(required|requirement|only|must)\b|\bmust be (a )?u\.?s\.? citizen\b|\b(active |current )?(secret|top secret|ts\/sci|ts\/sci|security) clearance\b[^.]{0,40}\b(required|must|eligib)|\bclearance (is )?required\b|\bus citizens only\b/i;

// ---------------------------------------------------------------------------
// The licence rule (new, independent of _shared/licence-rules.ts)
// ---------------------------------------------------------------------------

export type HeldKind = "rn" | "lpn" | "np" | "pharmacist" | "pt" | "ot" | "teacher" | "electrician" | "cpa" | "cdl" | "epa608" | "nmc" | "ahpra";
export interface Held { kind: HeldKind; jurisdiction?: string; compact?: boolean }
/** What each dev résumé holds, written from the manifest's licences line (the truth a recruiter reads off the CV). */
export const HELD: Record<string, Held[]> = {
  "rn-ng-phoenix": [{ kind: "rn", jurisdiction: "AZ", compact: true }],
  "rn-mid-chicago": [{ kind: "rn", jurisdiction: "IL" }],
  "rn-sr-manchester": [{ kind: "nmc", jurisdiction: "GB" }],
  "fn-sr-chicago": [{ kind: "cpa", jurisdiction: "IL" }],
  "tr-ng-hvac-houston": [{ kind: "epa608" }],
  "tr-mid-brisbane": [{ kind: "electrician", jurisdiction: "QLD" }],
  "ed-ng-sacramento": [{ kind: "teacher", jurisdiction: "CA" }],
  "ed-mid-gap-raleigh": [{ kind: "teacher", jurisdiction: "NC" }],
};
const COMPACT = new Set(["AL", "AZ", "AR", "CO", "DE", "FL", "GA", "ID", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MS", "MO", "MT", "NE", "NH", "NJ", "NM", "NC", "ND", "OH", "OK", "PA", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]);

const TITLE_NEEDS: Array<[HeldKind, RegExp]> = [
  ["np", /\bnurse practitioner\b|\b(?:fnp|aprn|crnp)\b/i],
  ["lpn", /\b(?:lpn|lvn|licensed (?:practical|vocational) nurse)\b/i],
  ["rn", /\b(?:registered nurse|rn|staff nurse|charge nurse|nurse resident|graduate nurse|clinical nurse)\b/i],
  ["pharmacist", /\bpharmacist\b/i],
  ["pt", /\bphysical therapist\b(?!\s+(?:assistant|aide|tech))/i],
  ["ot", /\boccupational therapist\b(?!\s+(?:assistant|aide))/i],
  ["electrician", /\b(?:journeyman|journey[- ]level|master|licensed)\s+electrician\b/i],
  ["teacher", /\b(?:(?:elementary|middle|high|primary|secondary) school|kindergarten|k-?12|math(?:ematics)?|science|english|special education|sped)\s+teacher\b|^teacher\b/i],
];
const TEXT_NEEDS: Array<[HeldKind, RegExp]> = [
  ["cdl", /\bclass [ab] (?:cdl|commercial driver'?s licen[cs]e)\b[^.\n]{0,40}\b(?:required|must)\b|\b(?:valid |current )?cdl(?: class [ab])?\b[^.\n]{0,30}\b(?:required|is required|must)\b|\bmust (?:have|hold|possess) (?:a |an )?(?:valid )?(?:class [ab] )?cdl\b/i],
  ["cpa", /\b(?:active |current |valid )?cpa (?:licen[cs]e|certification)?\s*(?:is )?required\b|\bmust (?:be|hold) (?:an? )?(?:active |licensed )?cpa\b/i],
  ["epa608", /\bepa (?:section )?608\b[^.\n]{0,40}\b(?:required|must)\b|\bmust (?:have|hold|possess) (?:an? )?epa (?:section )?608\b/i],
];
const ACTIVE_CLEARANCE = /\b(?:active|current)\b[^.\n]{0,25}\b(?:secret|top secret|ts\/sci|public trust)\s+clearance\b|\bmust (?:currently )?(?:hold|possess|have) (?:an? )?(?:active )?(?:secret|top secret|ts\/sci|security) clearance\b/i;
const ELIGIBLE_OK = /\bor eligib\w*|\beligible for\b[^.\n]{0,20}\blicen|\bupon hire\b|\bwithin \d+ (?:days|months)\b/i;

function postingState(row: PostingRow): string | null {
  const loc = row.location ?? "";
  for (const c of Object.keys(STATES)) if (c.length === 2 && namesRegion(loc, c)) return c;
  return null;
}

/** The licence verdict for one candidate and one posting, from the posting's own words. */
export function licenceVerdict(t: ResumeTruth, row: PostingRow, desc: string | null): { licence: Verdict["licence"]; reason: string | null } {
  const held = HELD[t.id] ?? [];
  const title = row.title ?? "";
  const needs = new Set<HeldKind>();
  for (const [k, re] of TITLE_NEEDS) if (re.test(title)) { needs.add(k); break; }
  // A UK nursing post needs NMC registration, not a US RN licence.
  if (needs.has("rn") && (row.country === "GB" || /\b(?:nhs|england|united kingdom)\b/i.test(row.location ?? ""))) { needs.delete("rn"); needs.add("nmc"); }
  if (desc) for (const [k, re] of TEXT_NEEDS) if (re.test(desc)) needs.add(k);
  for (const k of needs) {
    const mine = held.filter((h) => h.kind === k);
    if (!mine.length) {
      if (desc && ELIGIBLE_OK.test(desc) && (k === "rn" || k === "teacher")) continue;
      return { licence: "fail", reason: `needs ${k}` };
    }
  }
  if (desc && ACTIVE_CLEARANCE.test(desc)) return { licence: "fail", reason: "needs an active clearance" };
  const st = postingState(row);
  for (const k of needs) {
    const mine = held.filter((h) => h.kind === k);
    if (st && mine.length && !mine.some((h) => h.jurisdiction === st || (h.compact && h.jurisdiction && COMPACT.has(h.jurisdiction) && COMPACT.has(st)))) {
      return { licence: "ok", reason: `${k} transfer to ${st}` };
    }
  }
  return { licence: "ok", reason: null };
}

export function autoJudge(t: ResumeTruth, row: PostingRow, desc: string | null, opts: JudgeOptions = { licences: false }): Verdict {
  const reasons: string[] = [];
  const title = row.title ?? "";
  let role: Role = "off";
  if (t.target.some((re) => re.test(title))) role = "target";
  else if (t.adjacent.some((re) => re.test(title))) role = "adjacent";
  else if (t.oldCareer.some((re) => re.test(title))) role = "old";
  else if (t.related.some((re) => re.test(title))) role = "related";
  if ((role === "target" || role === "adjacent") && t.oldCareer.some((re) => re.test(title)) && !t.target.some((re) => re.test(title))) role = "old";
  reasons.push(`role:${role}`);

  let seniority: Verdict["seniority"] = "ok";
  if (t.tooSenior.some((re) => re.test(title))) { seniority = "too_senior"; reasons.push("title above level"); }
  else if (typeof row.minYears === "number" && row.minYears > t.maxMinYears) { seniority = "too_senior"; reasons.push(`asks ${row.minYears}y > ${t.maxMinYears}`); }
  else if (t.tooJunior.some((re) => re.test(title))) { seniority = "too_junior"; reasons.push("title below level"); }
  else if (t.profile === "senior" && row.experienceBand === "entry") { seniority = "too_junior"; reasons.push("entry band"); }

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
  if (auth === "ok" && desc) {
    if (t.sponsorshipFuture && NO_SPONSOR.test(desc)) { auth = "fail"; reasons.push("no sponsorship"); }
    if (!t.citizen && CITIZEN_ONLY.test(desc)) { auth = "fail"; reasons.push("citizen/clearance only"); }
  }
  let licence: Verdict["licence"] = "ok";
  if (opts.licences) {
    const lv = licenceVerdict(t, row, desc);
    licence = lv.licence;
    if (lv.reason) reasons.push(lv.reason);
  }
  const shortlist = (role === "target" || role === "adjacent") && seniority === "ok" && location !== "mismatch" && auth === "ok" && licence === "ok";
  return { role, seniority, location, auth, licence, shortlist, reasons, reviewed: false };
}

type Override = Partial<Pick<Verdict, "role" | "seniority" | "location" | "auth" | "licence">> & { note?: string };
const JUDGMENTS = resolve(dirname(fileURLToPath(import.meta.url)), "judgments");
let OVR: Record<string, Override> | null = null;
let FACTS: Record<string, Partial<PostingRow> & { note?: string }> | null = null;

export function judge(t: ResumeTruth, row: PostingRow, desc: string | null, opts: JudgeOptions = { licences: false }): Verdict {
  FACTS ??= JSON.parse(readFileSync(resolve(JUDGMENTS, "posting-facts.json"), "utf8"));
  OVR ??= JSON.parse(readFileSync(resolve(JUDGMENTS, "overrides.json"), "utf8"));
  const fixed = { ...row, ...(FACTS![row.id] ?? {}) };
  const v = autoJudge(t, fixed, desc, opts);
  const o = OVR![`${t.id}::${row.id}`];
  if (o) {
    Object.assign(v, o);
    v.reviewed = true;
    if (o.note) v.note = o.note;
    v.shortlist = (v.role === "target" || v.role === "adjacent") && v.seniority === "ok" && v.location !== "mismatch" && v.auth === "ok" && v.licence === "ok";
  }
  return v;
}
