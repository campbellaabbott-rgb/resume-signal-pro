// Experience-level detection for job postings.
//
// Honest by construction, in priority order:
//   1. If the posting TEXT states a year requirement ("5+ years of experience",
//      "3–5 years"), we cite it — minYears is a real number pulled from the text.
//   2. Otherwise we classify seniority from the TITLE (Senior/Staff/Director/
//      Intern…) — the same kind of inference the board already makes for `category`.
//   3. If neither gives a signal, the band is null ("unspecified"): the posting is
//      simply excluded from experience-filtered results, never assigned a made-up
//      level.
// Pure — no I/O — so it is unit-testable and runs at both ingestion and backfill.

// Shared with public-api via ../_shared/board-domains.ts — see that file.
export { EXPERIENCE_BANDS } from "../_shared/board-domains.ts";
import { EXPERIENCE_BANDS } from "../_shared/board-domains.ts";
export type ExperienceBand = typeof EXPERIENCE_BANDS[number];

export function isExperienceBand(x: string): x is ExperienceBand {
  return (EXPERIENCE_BANDS as readonly string[]).includes(x);
}

// minYears → band. Round, non-overlapping boundaries that match how postings
// actually phrase requirements: 0–2 entry, 3–5 mid, 6–9 senior, 10+ expert.
// (So a "8 years" ask lands in senior, which is how the market reads it, and
// 10+/principal-level lands in expert.)
export function bandFromYears(minYears: number): ExperienceBand {
  if (minYears <= 2) return "entry";
  if (minYears <= 5) return "mid";
  if (minYears <= 9) return "senior";
  return "expert";
}

// S12-126: a figure that is not a requirement. "Graduate of an MA school or
// 5+ years of experience" offers the years as one way in, not a floor (a Humana
// medical assistant was filed mid); "5 years preferred", "a plus", "nice to
// have" and a "Preferred Qualifications" heading above the line are wishes.
// "2 or 3 years" stays a requirement: the "or" follows a number.
const WISH = /\b(?:preferred|preferably|a plus|nice[- ]to[- ]have|desired|desirable|ideally|is an asset|an advantage)\b/;
const WISH_HEADING = /\b(?:preferred|desired|nice[- ]to[- ]have|bonus|additional)\s+(?:qualifications|skills|experience|requirements)\b/g;
const NEED_HEADING = /\b(?:required|minimum|basic|essential)\s+(?:qualifications|skills|experience|requirements)\b|\brequirements\s*:/g;
const lastIndexOf = (re: RegExp, s: string): number => {
  let at = -1;
  re.lastIndex = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) at = m.index;
  return at;
};
function notBinding(t: string, at: number, end: number, before: string): boolean {
  if (/\bor\s+(?:an?\s+)?(?:equivalent\s+(?:of\s+)?)?(?:at\s+least\s+|minimum\s+(?:of\s+)?)?$/.test(before) && !/\d\s*or\s+$/.test(before)) return true;
  const s0 = Math.max(t.lastIndexOf(".", at), t.lastIndexOf(";", at), t.lastIndexOf(",", at), t.lastIndexOf("\n", at), t.lastIndexOf("!", at), t.lastIndexOf("?", at)) + 1;
  const cut = t.slice(end).search(/[.;,!?\n]/);
  if (WISH.test(t.slice(s0, cut < 0 ? t.length : end + cut))) return true;
  const head = t.slice(Math.max(0, at - 3000), at);
  return lastIndexOf(WISH_HEADING, head) > lastIndexOf(NEED_HEADING, head);
}

// Pull the binding minimum-years requirement from posting text. Only counts year
// figures tied to an experience/work context (so "founded 10 years ago" or
// "401k after 1 year" don't register), and takes the MAX of the stated lower
// bounds — the highest floor is the requirement a candidate must clear (e.g.
// "2 years Python, 8 years leadership" ⇒ 8). Absurd values are ignored as noise.
export function parseMinYears(text: string): number | null {
  const t = text.toLowerCase().replace(/[–—]/g, "-"); // en/em dash → hyphen
  const nums: number[] = [];
  // "<n>[+ | -m] year(s) … (experience|work|industry|professional)", allowing a
  // short intervening noun phrase ("8 years of LEADERSHIP experience") but never
  // crossing a sentence boundary (so "founded 10 years ago. …experience" can't tie).
  // (?<!\d): the number starts where the digits start -- "135 years" was read
  // as 35 (L7-09). The gap (group 2) may hold "Python 3" or "Office 365" but
  // never another "<n> years", so "2 years Python, 8 years leadership
  // experience" binds only the 8. "to work" ("able to work weekends") is an
  // availability, not experience.
  // S12-126: "<n> or more years" is the same floor as "<n>+ years".
  const forward = /(?<!\d)(\d{1,2})\s*\+?\s*(?:or\s+more\s+)?(?:-\s*\d{1,2}\s*)?years?\b((?:(?!\d{1,2}\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?\b)[^.?!\n]){0,30}?)(?:experience|exp\b|(?<!\bto\s)work|professional|industry|hands-on)/g;
  // "(experience|minimum|at least|requires)[ :of] <n> year(s)"
  const backward = /(?:experience|minimum|at least|requires?|require)\s*(?:of|:|is)?\s*(?<!\d)(\d{1,2})\s*\+?\s*(?:or\s+more\s+)?years?/g;
  for (const re of [forward, backward]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const n = Number(m[1]);
      const at = m.index + m[0].indexOf(m[1]);
      const end = m.index + m[0].length;
      const before = t.slice(Math.max(0, at - 24), at);
      const gap = m[2] ?? "";
      const after = t.slice(end, end + 16);
      if (notBinding(t, at, end, before)) continue;
      // A MINIMUM AGE IS NOT EXPERIENCE (L8-15): "18 years or older and able
      // to work", "at least 18 years of age".
      if (/\b(?:of\s+age|old|older)\b/.test(gap) || /^\s*(?:of\s+age|old\b|or\s+older)/.test(after) || /\b(?:age|aged)\s*(?:of\s*)?$/.test(before)) continue;
      // THE COMPANY'S YEARS ARE NOT THE CANDIDATE'S (L7-09): "for over 15
      // years, Acme has been ...". Only a company clause; "over 10 years of
      // experience" is a requirement.
      if (/\b(?:for|over|nearly|almost)\s+(?:more\s+than\s+|over\s+|nearly\s+|almost\s+)?$/.test(before) && !/^\s*of\b/.test(gap)) {
        const s0 = Math.max(t.lastIndexOf(".", at), t.lastIndexOf("!", at), t.lastIndexOf("?", at), t.lastIndexOf("\n", at)) + 1;
        const sentence = t.slice(s0, end);
        if (/^\s*,/.test(gap) || /\b(?:we've|we have|we're|has been|have been|had been|founded|established|in business|since \d{4})\b/.test(sentence)) continue;
      }
      // A requirement above 20 years is a company-age or boilerplate sentence,
      // never a hiring bar on this board.
      if (Number.isFinite(n) && n >= 0 && n <= 20) nums.push(n);
    }
  }
  return nums.length ? Math.max(...nums) : null;
}

// Seniority from the title alone, when no explicit years are stated. Returns null
// for titles with no seniority signal — honest "unspecified" rather than a guess.
// L7-08. Bare "staff", "lead" and "partner" fit tech titles and law firms; on
// this board they are mostly hourly and entry roles (Staff Accountant, Staff
// Nurse, Kitchen Staff, Shift Lead, Lead Cashier, Care Partner), which the
// senior and expert filters filled with while the entry filter lost them.
// "staff" is senior only as the engineering rung; "lead" is not a rung beside
// a shift, a team, a crew or a store-floor job; "partner" is expert only as
// a firm's partner.
// The tech modifiers a Staff rung carries. S11-137: the list lacked iOS,
// Android, database, application, engineering and more, and the nouns lacked
// manager, so Staff iOS Engineer, Staff Database Engineer, Staff Product
// Manager and Staff Engineering Manager went from senior to unspecified. A
// manager is a rung only behind at least one of these words: a bare "Staff
// Manager" may run a staffing desk.
const STAFF_TECH = "software|data|machine learning|ml|ai|product|security|application|applications|site reliability|reliability|platform|backend|back-end|frontend|front-end|full[- ]?stack|systems?|infrastructure|cloud|devops|mobile|ios|android|web|database|research|applied|hardware|firmware|network|engineering|technical|program|ux|ui|qa|quality|test|automation|solutions|embedded|graphics|game|gameplay|compiler|distributed|analytics|performance";
const STAFF_RUNG = new RegExp(`\\bstaff\\s+(?:(?:${STAFF_TECH})\\s+)*(?:engineer|scientist|developer|designer|architect|analyst|researcher|swe|sre)\\b|\\bstaff\\s+(?:(?:${STAFF_TECH})\\s+)+manager\\b`);
const LEAD_NOT_A_RUNG = /\b(?:shift|team|crew|store|line|floor|cashier|sales|retail|warehouse|production|area|key|front end|front desk|kitchen|cook|bar|server)\s+lead\b|\blead\s+(?:cashier|teller|associate|server|cook|host|clerk|driver|custodian|housekeeper|caregiver|cleaner|picker|packer|sales associate)\b/;
const FIRM_PARTNER = /\b(?:managing|equity|senior|founding|general|named)\s+partner\b|\bpartner\s*,\s*(?:law|legal|litigation|corporate|tax|audit|advisory|consulting)\b/;
// S12-036: "senior" naming who is served, not the rung. "Housekeeper - Senior
// Living", "Senior Living Cook", "Nurse Aide | Senior Care", "Cook - Senior
// Community Services" were filed senior (55 of 60 live "senior living" rows on
// 2026-10-12 were entry and hourly jobs). A UK "Senior Carer" or "Senior Care
// Assistant/Worker" and a "Senior Community Manager" stay rungs: "senior care"
// before a role noun, and "senior community/services" at the start of a title,
// are the job's rank.
const CLIENTELE = /\bsenior\s+(?:living|cent(?:er|re)s?|housing|citizens?|residences?|apartments?|day\s+(?:program|services))\b|\bsenior\s+care\b(?!\s*(?:-\s*)?(?:assistant|worker|manager|supervisor|lead|practitioner|officer|coordinator|carer|support worker))|\bsenior\s+(?:communit(?:y|ies)|services)\b/g;
const withoutClientele = (t: string): string =>
  t.replace(CLIENTELE, (m, at: number) => (/^senior\s+(?:communit|services)/.test(m) && at === 0 ? m : " "));

export function bandFromTitle(title: string): ExperienceBand | null {
  const t = withoutClientele(title.toLowerCase());
  if (/\b(chief|ceo|cfo|coo|cto|ciso|cmo|cro|c-level|vp|svp|evp|vice president|head of|director|managing director)\b/.test(t) || FIRM_PARTNER.test(t)) return "expert";
  if (/\b(senior|sr\.?|principal|architect|distinguished)\b/.test(t) || STAFF_RUNG.test(t)) return "senior";
  if (/\blead\b/.test(t) && !LEAD_NOT_A_RUNG.test(t)) return "senior";
  if (/\b(intern|internship|trainee|apprentice|entry[ -]?level|junior|jr\.?|graduate|new grad|early career)\b/.test(t)) return "entry";
  return null;
}

export function detectExperience(
  title: string,
  description?: string | null,
): { band: ExperienceBand | null; minYears: number | null } {
  const minYears = parseMinYears(`${title}\n${description ?? ""}`);
  if (minYears != null) return { band: bandFromYears(minYears), minYears };
  return { band: bandFromTitle(title), minYears: null };
}
