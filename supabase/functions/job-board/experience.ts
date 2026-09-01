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

export const EXPERIENCE_BANDS = ["entry", "mid", "senior", "expert"] as const;
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
  const forward = /(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?\b[^.?!\n]{0,30}?(?:experience|exp\b|work|professional|industry|hands-on)/g;
  // "(experience|minimum|at least|requires)[ :of] <n> year(s)"
  const backward = /(?:experience|minimum|at least|requires?|require)\s*(?:of|:|is)?\s*(\d{1,2})\s*\+?\s*years?/g;
  for (const re of [forward, backward]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 40) nums.push(n);
    }
  }
  return nums.length ? Math.max(...nums) : null;
}

// Seniority from the title alone, when no explicit years are stated. Returns null
// for titles with no seniority signal — honest "unspecified" rather than a guess.
export function bandFromTitle(title: string): ExperienceBand | null {
  const t = title.toLowerCase();
  if (/\b(chief|ceo|cfo|coo|cto|ciso|cmo|cro|c-level|vp|svp|evp|vice president|head of|director|managing director|partner)\b/.test(t)) return "expert";
  if (/\b(senior|sr\.?|staff|principal|lead|architect|distinguished)\b/.test(t)) return "senior";
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
