export const EXPERIENCE_BANDS = ["entry", "mid", "senior", "expert"] as const;
export type ExperienceBand = typeof EXPERIENCE_BANDS[number];
export function isExperienceBand(x: string): x is ExperienceBand {
  return (EXPERIENCE_BANDS as readonly string[]).includes(x);
}
export function bandFromYears(minYears: number): ExperienceBand {
  if (minYears <= 2) return "entry";
  if (minYears <= 5) return "mid";
  if (minYears <= 9) return "senior";
  return "expert";
}
export function parseMinYears(text: string): number | null {
  const t = text.toLowerCase().replace(/[–—]/g, "-");
  const nums: number[] = [];
  const forward = /(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?\b[^.?!\n]{0,30}?(?:experience|exp\b|work|professional|industry|hands-on)/g;
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
