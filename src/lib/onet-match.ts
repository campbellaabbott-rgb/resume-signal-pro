/**
 * Whether an industry's O*NET occupation may be cited on a ROLE's page
 * (register L1-05).
 *
 * Each industry maps to one representative O*NET occupation, and every role
 * page in that industry printed it as "Core skills per the U.S. Department of
 * Labor": /roles/pilot cited 49-3011.00 Aircraft Mechanics, the dentist page
 * Dental Hygienists, the professor page Elementary School Teachers, the
 * plumber page Electricians. 120 of 174 role pages attributed someone else's
 * occupation to a government source. The block now appears only when the
 * occupation names the role itself: a word of the title other than a generic
 * one (manager, senior, specialist...) appears in the occupation's name.
 */

const GENERIC = new Set([
  "manager", "director", "specialist", "assistant", "associate", "coordinator", "officer",
  "representative", "senior", "junior", "lead", "chief", "head", "staff", "principal",
  "executive", "worker", "and", "the", "of", "for",
]);

const words = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, ""))
    .filter((w) => w && !GENERIC.has(w));

export function onetNamesRole(roleTitle: string, occupation: string | null | undefined): boolean {
  if (!occupation) return false;
  const occ = new Set(words(occupation));
  return words(roleTitle).some((w) => occ.has(w));
}

/** The industry's O*NET entry when it names this role, else null. */
export function onetForRole<T extends { occupation: string }>(roleTitle: string, onet: T | null | undefined): T | null {
  return onet && onetNamesRole(roleTitle, onet.occupation) ? onet : null;
}
