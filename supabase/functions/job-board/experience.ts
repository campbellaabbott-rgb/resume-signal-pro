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
  // as 35 (L7-09). And no digit in the gap, so "21 years old ... 2 years of
  // experience" or "2 years Python, 8 years leadership experience" cannot
  // bind the first number to the second one's experience word.
  const forward = /(?<!\d)(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?\b[^.?!\n\d]{0,30}?(?:experience|exp\b|work|professional|industry|hands-on)/g;
  // "(experience|minimum|at least|requires)[ :of] <n> year(s)"
  const backward = /(?:experience|minimum|at least|requires?|require)\s*(?:of|:|is)?\s*(?<!\d)(\d{1,2})\s*\+?\s*years?/g;
  for (const re of [forward, backward]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const n = Number(m[1]);
      const at = m.index + m[0].indexOf(m[1]);
      const before = t.slice(Math.max(0, at - 24), at);
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 16);
      // A MINIMUM AGE IS NOT EXPERIENCE (L8-15): "at least 18 years of age",
      // "21 years old or older". Cut entry roles' fit by 60% and filed cashiers
      // under expert.
      if (/^\s*(?:of\s+age|old|or\s+older|of\s+older)/.test(after) || /\b(?:age|aged)\s*(?:of\s*)?$/.test(before)) continue;
      // THE COMPANY'S YEARS ARE NOT THE CANDIDATE'S (L7-09): "for more than 40
      // years, X has been the industry's partner", "for over 135 years".
      if (/\b(?:for|over|nearly|almost)\s+(?:more\s+than\s+|over\s+|nearly\s+|almost\s+)?$/.test(before)) continue;
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
const STAFF_RUNG = /\bstaff\s+(?:(?:software|data|machine learning|ml|ai|product|security|site reliability|platform|backend|back-end|frontend|front-end|full[- ]?stack|systems?|infrastructure|cloud|devops|mobile|research|applied|hardware|firmware|network)\s+)*(?:engineer|scientist|developer|designer|architect|analyst|researcher|swe|sre)\b/;
const LEAD_NOT_A_RUNG = /\b(?:shift|team|crew|store|line|floor|cashier|sales|retail|warehouse|production|area|key|front end|front desk|kitchen|cook|bar|server)\s+lead\b|\blead\s+(?:cashier|teller|associate|server|cook|host|clerk|driver|custodian|housekeeper|caregiver|cleaner|picker|packer|sales associate)\b/;
const FIRM_PARTNER = /\b(?:managing|equity|senior|founding|general|named)\s+partner\b|\bpartner\s*,\s*(?:law|legal|litigation|corporate|tax|audit|advisory|consulting)\b/;
export function bandFromTitle(title: string): ExperienceBand | null {
  const t = title.toLowerCase();
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
