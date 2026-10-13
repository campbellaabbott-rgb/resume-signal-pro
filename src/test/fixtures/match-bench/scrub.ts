/**
 * Nothing personal travels in the bench corpus. Posting descriptions sometimes
 * name a recruiter's email, a phone line or a profile link; the rubric reads
 * sponsorship, citizenship and licence wording, none of which needs them.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** NANP (+1 (555) 555-0100, 555.555.0100), UK (07700 900123, +44 20 7946 0000), and other +CC groupings. */
const PHONE = /(?<![\w$£€])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?|\d{2,5}[\s.-])\d{3,4}[\s.-]\d{3,4}(?![\d,.]*\d)/g;
const PROFILE = /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in|github\.com|twitter\.com|x\.com)\/[\w%-]+\/?/gi;

export function scrubPersonal(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PROFILE, "[profile]").replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, "");
    // Years and salary ranges ("2019 - 2024", "60 000 - 80 000") are not phone numbers.
    if (digits.length < 9) return m;
    if (/^(19|20)\d{2}\D+(19|20)\d{2}$/.test(m.trim())) return m;
    return "[phone]";
  });
}

/** For the corpus test: anything that still looks like a contact detail. */
export function personalLeft(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(EMAIL)) out.push(m[0]);
  for (const m of text.matchAll(PROFILE)) out.push(m[0]);
  for (const m of text.matchAll(PHONE)) if (m[0].replace(/\D/g, "").length >= 9 && !/^(19|20)\d{2}\D+(19|20)\d{2}$/.test(m[0].trim())) out.push(m[0]);
  return out;
}
