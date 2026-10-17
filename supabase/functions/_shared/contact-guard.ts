/**
 * Contact-integrity guard for the paid résumé and cover letter.
 *
 * Deterministically strips any URL, email or phone-shaped string in the
 * output that the original résumé does not contain. The prompt forbids
 * inventing contact details, but an audit caught a fabricated
 * linkedin.com/in/... slipping through: prompts ask, code enforces.
 *
 * Items are compared in canonical form (sweep S8-033): a phone by its digits
 * without the country code, a URL by host and path lowercased without the
 * scheme, "www." or a trailing slash. Comparing literal substrings deleted
 * the buyer's own phone when the model wrote "(555) 010-0199" for
 * "555-010-0199", and their LinkedIn and GitHub when it added https://www.
 * A literal copy is always kept, and the source's phones are read with the
 * same bounded pattern as the output's: a greedy digit run merged
 * "NY 11215 555-010-0199" into one number that no output phone could equal.
 */

const URL_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s|,)]+/gi,
  /(?:https?:\/\/)?(?:www\.)?(?:github\.com|behance\.net|dribbble\.com)\/[^\s|,)]+/gi,
];
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}/g;
// Any phone-shaped run in the source, however it was punctuated.
const SOURCE_PHONE = /\+?\d[\d\s().-]{6,18}\d/g;
const SOURCE_URL = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s|,)]*/gi;

export const canonPhone = (s: string): string => {
  const digits = s.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

export const canonUrl = (s: string): string =>
  s.toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[.;:!?]+$/, "")
    .replace(/\/+$/, "");

export function stripInventedContact(text: string, original: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const origLower = original.toLowerCase();
  const sourcePhones = new Set([
    ...[...original.matchAll(SOURCE_PHONE)].map((m) => canonPhone(m[0])),
    ...[...original.matchAll(PHONE)].map((m) => canonPhone(m[0])),
  ]);
  const sourceUrls = new Set([...original.matchAll(SOURCE_URL)].map((m) => canonUrl(m[0])));

  let out = text;
  for (const re of URL_PATTERNS) {
    out = out.replace(re, (match) => {
      if (sourceUrls.has(canonUrl(match))) return match;
      removed.push(match);
      return "";
    });
  }
  out = out.replace(EMAIL, (match) => {
    if (origLower.includes(match.toLowerCase())) return match;
    removed.push(match);
    return "";
  });
  out = out.replace(PHONE, (match) => {
    if (original.includes(match) || sourcePhones.has(canonPhone(match))) return match;
    removed.push(match);
    return "";
  });
  // Tidy contact-line separators left dangling by a removal (" | | ", trailing "|")
  if (removed.length > 0) {
    out = out.replace(/\s*\|\s*(?=\||$)/gm, "").replace(/\|\s*$/gm, "").replace(/^\s*\|\s*/gm, "");
  }
  return { text: out, removed };
}
