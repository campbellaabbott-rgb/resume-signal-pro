/**
 * THE HEAD OF AN /industries AND A /roles PAGE, WRITTEN ONCE FOR BOTH RENDERERS.
 *
 * 41 sitemap pages shared their meta description with another page (SEO-019,
 * live and baked alike). Each description opened with the field's keyword
 * list and named the page's own role or industry only at the end, so the
 * bake's 160-character clamp cut the one distinguishing word off and the
 * three role pages of a field read the same sentence. The name now comes
 * first, the keyword list is shortened until the whole sentence fits, and the
 * React page and the bake print the same title and description from here.
 *
 * Titles keep the 68-character SERP budget the bake applied and React did not
 * ("… — ATS Guide" when the long form does not fit).
 */
import { displayKeyword, displayTitle, inSentence } from "./display-case";

const DESCRIPTION_MAX = 160;
const TITLE_MAX = 68;

/** One spelling of a keyword: case, spaces and hyphens folded, and a plural "s" off each word of four letters or more. */
const variantKey = (k: string) =>
  k.toLowerCase().replace(/[-\s]+/g, " ").trim().split(" ").map((w) => (w.length >= 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)).join("");

/**
 * THE KEYWORDS A DESCRIPTION NAMES (SEO audit 2026-11-18, CONTENT-N6). The
 * scanner's tables hold each spelling it matches, so a description that took
 * the table's head read "patient care, patient, patients" and "client,
 * clients"; and a few tokens carry the field's word after a plural to narrow
 * a match ("clients beauty", "patients dental"), which reads as a typo in a
 * sentence. A description names a keyword once, by its first spelling, and
 * leaves out a token that ends with a word of the field's slug after a plural.
 * Measured over the 2,907 primary and secondary keywords of all 58 tables
 * (2026-11-21): 21 later spellings and 11 narrowing tokens left out, each
 * read and none a distinct keyword. The page's own lists are unchanged.
 */
export function descriptionKeywords(keywords: readonly string[], slug?: string): string[] {
  const fieldWords = new Set(String(slug ?? "").toLowerCase().split("_").filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const words = k.toLowerCase().replace(/-/g, " ").trim().split(/\s+/);
    if (words.length > 1 && fieldWords.has(words[words.length - 1]) && /[^s]s$/.test(words[words.length - 2])) continue;
    const v = variantKey(k);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(k);
  }
  return out;
}

/**
 * The longest sentence inside the limit: the first form with as many keywords
 * as fit, then the next (shorter) form, dropping keywords from the end. The
 * last form with one keyword always fits a real page; a page it did not fit
 * would fail seo-react-keyword-pages-case-acronyms-only.
 */
function fitKeywords(builds: Array<(list: string) => string>, keywords: string[], industry: string | undefined, most: number): string {
  const shown = descriptionKeywords(keywords, industry).slice(0, most).map((k) => displayKeyword(k, industry));
  for (const build of builds) {
    for (let n = shown.length; n >= 1; n--) {
      const s = build(shown.slice(0, n).join(", "));
      if (s.length <= DESCRIPTION_MAX) return s;
    }
  }
  return builds[builds.length - 1](shown.slice(0, 1).join(", "));
}

export interface KeywordPageHead {
  /** The page's display name: "HR", "RN", "VP of Product". */
  name: string;
  title: string;
  description: string;
}

/** /industries/<slug>: `keywords` is the field's primary table in its own order. */
export function industryKeywordsHead(slug: string, keywords: string[]): KeywordPageHead {
  const name = displayTitle(slug);
  const lower = inSentence(name);
  return {
    name,
    title: `${name} Resume Keywords — What ATS Systems Look For`,
    description: fitKeywords(
      [
        (list) => `${name} resume keywords ATS systems look for: ${list}, plus the titles and certifications our ${lower} scanner checks. Free scan.`,
        (list) => `${name} resume keywords ATS systems look for: ${list}, plus titles and certifications. Free scan.`,
      ],
      keywords,
      slug,
      6,
    ),
  };
}

/** /roles/<slug>: `roleTitle` is the role's display title (ROLE_PAGES), `keywords` its field's primary table. */
export function roleKeywordsHead(roleTitle: string, industrySlug: string, keywords: string[]): KeywordPageHead {
  const name = roleTitle;
  const field = inSentence(displayTitle(industrySlug));
  const long = `${name} Resume Keywords — What ATS Systems Look For`;
  return {
    name,
    title: long.length > TITLE_MAX ? `${name} Resume Keywords — ATS Guide` : long,
    description: fitKeywords(
      [
        (list) => `${name} resume keywords from the ${field} tables our scanner checks: ${list}, plus certifications and titles. Free ATS scan.`,
        (list) => `${name} resume keywords from the ${field} tables: ${list}, plus certifications and titles. Free ATS scan.`,
        (list) => `${name} resume keywords: ${list}, plus certifications and titles. Free ATS scan.`,
      ],
      keywords,
      industrySlug,
      5,
    ),
  };
}
