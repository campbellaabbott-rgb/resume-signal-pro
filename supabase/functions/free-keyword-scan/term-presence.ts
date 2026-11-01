/**
 * IS THIS TERM ON THE PAGE, AS A WORD OF ITS OWN? One presence test for the
 * scanner (both forks) and the report page's keyword cards (src/config,
 * register S13-092). Moved here from market-intelligence.ts, which
 * re-exports it.
 */

// ─── IS THIS SKILL ON THE RÉSUMÉ? (register S13-004) ────────────────────────
//
// The scan's presence test was includes(): "java" was found in "JavaScript",
// "git" in "digital", "excel" in "excellence", "ml" in "html", "ui" in
// "build", "aws" in "award" and "law", and a plural strip turned "aws" into
// "aw". Those real gaps were dropped from the keyword card, kept out of the
// prompt's "verified absent" list, and the model was told the skills were
// there. A term now counts only where it stands as a token of its own: no
// letter, digit, "+", "#" or "&" on either side ("c" is not in "c++", "java"
// is not in "javascript", "ids" not in "P&IDs"), and no "." in front of it
// ("net" is not in "asp.net");
// a "." after it is a sentence end or a file suffix ("node" is in "node.js").
// A term of one character is read in the original case and refuses "&", "-"
// and "'" beside it, so "R" is not in "R&D" and "C" is not in "C-suite".
//
// HOW IT LOOKS (the review of 2026-11-01). The first version compiled two to
// six Unicode-class regexes for every term it was asked about and kept them in
// a cache with no bound. Each cost about 1.5 ms to compile and ~50 KB of heap
// to keep, so one cold scan spent 0.4-0.85 s on presence checks and a warm
// isolate grew ~6 MB per scan of new model keywords. The test now finds each
// spelling with indexOf on the text, prepared once per text, and checks the
// one character on either side against two fixed character classes. No
// pattern is built per term and nothing per term is kept.

/** A letter or digit in any script; ASCII is decided without a regex. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
function isLetterOrDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  if (c < 128) return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  return LETTER_OR_DIGIT.test(ch);
}

/** The whole character (one code point) that ends just before index i. */
function charBefore(text: string, i: number): string {
  if (i <= 0) return '';
  const c = text.charCodeAt(i - 1);
  if (c >= 0xdc00 && c <= 0xdfff && i >= 2) {
    const h = text.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1];
}

/** The whole character (one code point) that starts at index j. */
function charAt(text: string, j: number): string {
  if (j >= text.length) return '';
  const c = text.charCodeAt(j);
  if (c >= 0xd800 && c <= 0xdbff && j + 1 < text.length) {
    const l = text.charCodeAt(j + 1);
    if (l >= 0xdc00 && l <= 0xdfff) return text.slice(j, j + 2);
  }
  return text[j];
}

/** What may not stand beside a term: a letter or digit, or one of `extra`. */
const blocks = (ch: string, extra: string) => ch !== '' && (isLetterOrDigit(ch) || extra.includes(ch));
// Before a word-shaped term: no "+", "#", "&", and no "." ("net" in "asp.net").
const LEFT_EXTRA = '+#.&';
// After a word-shaped term: a "." is a sentence end or a file suffix.
const RIGHT_EXTRA = '+#&';
// A lone character also refuses "'" and "-" ("R&D", "C-suite", "R's").
const LONE_LEFT_EXTRA = "+#.&'-";
const LONE_RIGHT_EXTRA = "+#&'-";

/** One text, read once: spaces folded, a lower-case copy, and the two aligned. */
type Prepared = { original: string; lower: string; aligned: string };

function prepare(text: string): Prepared {
  // A line break inside a phrase ("machine\nlearning") is still the phrase.
  const original = text.replace(/\s+/g, ' ');
  const lower = original.toLowerCase();
  // A few characters lower-case to two ("İ"); the case-aware checks below
  // need an index in `lower` to be the same character in `original`.
  let aligned = lower;
  if (lower.length !== original.length) {
    let out = '';
    for (const ch of original) { const l = ch.toLowerCase(); out += l.length === ch.length ? l : ch; }
    aligned = out;
  }
  return { original, lower, aligned };
}

// The scanner asks about one résumé (and a handful of titles) many times in a
// row; the last few texts are kept, never more.
const PREPARED_LIMIT = 4;
const preparedCache = new Map<string, Prepared>();
function prepared(text: string): Prepared {
  let p = preparedCache.get(text);
  if (p) return p;
  p = prepare(text);
  if (preparedCache.size >= PREPARED_LIMIT) preparedCache.delete(preparedCache.keys().next().value as string);
  preparedCache.set(text, p);
  return p;
}

/** For tests: how many prepared texts are held (never more than PREPARED_LIMIT). */
export function presenceCacheSize(): number {
  return Math.max(preparedCache.size, lowerCache.size);
}

/**
 * Every index where `needle` sits in `hay` with nothing in `leftExtra` (or a
 * letter or digit) just before it and nothing in `rightExtra` just after.
 * An edge is checked only where the needle starts or ends with a letter or
 * digit, unless `alwaysEdge`: a term that starts or ends with a symbol
 * (".net", "c++", "c#") carries its own edge on that side, so ".NET" is in
 * "ASP.NET" and "C++" in "C++17".
 */
function findToken(
  hay: string, needle: string, leftExtra: string, rightExtra: string,
  alwaysEdge: boolean, accept?: (at: number) => boolean,
): boolean {
  if (!needle) return false;
  const checkLeft = alwaysEdge || isLetterOrDigit(charAt(needle, 0));
  const checkRight = alwaysEdge || isLetterOrDigit(charBefore(needle, needle.length));
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    if (checkLeft && blocks(charBefore(hay, at), leftExtra)) continue;
    if (checkRight && blocks(charAt(hay, at + needle.length), rightExtra)) continue;
    if (accept && !accept(at)) continue;
    return true;
  }
  return false;
}

/** One exact spelling, as its own token (a lone character in its own case). */
function hasToken(p: Prepared, term: string): boolean {
  if (term.length === 1) return findToken(p.original, term.toUpperCase(), LONE_LEFT_EXTRA, LONE_RIGHT_EXTRA, true);
  return findToken(p.lower, term, LEFT_EXTRA, RIGHT_EXTRA, false);
}

// An abbreviation asked for is on the page when its expansion is. The
// reverse (an expansion asked for, the abbreviation on the page) holds only
// where the abbreviation cannot mean anything else: "ML" is millilitres on a
// nurse's résumé, "CV" is the résumé itself, "DL" a driving licence, so a
// short one is not read as the long skill.
const ABBREVIATIONS: Array<[string, string]> = [
  ['ml', 'machine learning'], ['dl', 'deep learning'], ['nlp', 'natural language processing'],
  ['cv', 'computer vision'], ['ux', 'user experience'], ['ui', 'user interface'],
  ['p&l', 'profit and loss'], ['m&a', 'mergers and acquisitions'],
  ['dcf', 'discounted cash flow'], ['roi', 'return on investment'], ['kpi', 'key performance indicator'],
  ['seo', 'search engine optimization'], ['sem', 'search engine marketing'],
  ['crm', 'customer relationship management'], ['ehr', 'electronic health records'],
  ['ci/cd', 'continuous integration'], ['oop', 'object oriented programming'],
  ['aws', 'amazon web services'], ['gcp', 'google cloud platform'], ['k8s', 'kubernetes'],
];
const ABBREVIATION_READS_BACK = new Set(['nlp', 'p&l', 'm&a', 'dcf', 'roi', 'kpi', 'seo', 'crm', 'ehr', 'ci/cd', 'oop', 'aws', 'gcp', 'k8s']);
// Two names of one product, read both ways. "ts" (TS/SCI clearance), "py",
// "crm" for Salesforce and "containerization" for Docker are not here: none
// of them names only that skill.
const SAME_PRODUCT: Array<[string, string]> = [
  ['postgres', 'postgresql'], ['node.js', 'nodejs'], ['react.js', 'reactjs'],
  ['vue.js', 'vuejs'], ['salesforce', 'sfdc'],
];
const SAME_SKILL_INDEX = new Map<string, string[]>();
const addSame = (from: string, to: string) => SAME_SKILL_INDEX.set(from, [...(SAME_SKILL_INDEX.get(from) ?? []), to]);
for (const [abbr, full] of ABBREVIATIONS) {
  addSame(abbr, full);
  if (ABBREVIATION_READS_BACK.has(abbr)) addSame(full, abbr);
}
for (const [a, b] of SAME_PRODUCT) { addSame(a, b); addSame(b, a); }

/** Spacing and hyphen forms ("full stack", "full-stack", "fullstack") and "&" as "and". */
function spacingForms(n: string): string[] {
  const out = new Set<string>([n]);
  if (/[\s\-/]/.test(n)) {
    out.add(n.replace(/[\s\-/]+/g, ''));
    out.add(n.replace(/[\s/]+/g, '-'));
    out.add(n.replace(/[-/]+/g, ' ').replace(/\s+/g, ' '));
  }
  if (n.includes('&')) out.add(n.replace(/\s*&\s*/g, ' and '));
  return [...out];
}

/**
 * The spellings of `term` the résumé may carry: the term, its spacing and
 * hyphen forms, "&" as "and", and the same-skill names above. Plurals are
 * read by resumeHasTerm.
 */
export function termSpellings(term: string): string[] {
  const n = term.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!n) return [];
  const out = new Set<string>(spacingForms(n));
  for (const s of [...out]) for (const alt of SAME_SKILL_INDEX.get(s) ?? []) for (const f of spacingForms(alt)) out.add(f);
  return [...out];
}

/**
 * The plural or singular of one spelling ("launch"/"launches",
 * "strategy"/"strategies", "process"/"processes", "kpi"/"kpis"). An ending is
 * stripped only when four or more characters stay ("aws" and "apis" keep
 * theirs: an acronym's plural is read by acronymSingular below). No other
 * form of the word counts: reading "test" as "testing" would read "drug test"
 * as QA work and "dress code" as coding.
 */
function inflections(s: string): Array<{ form: string; added: string }> {
  const last = s.match(/[a-z]+$/)?.[0] ?? '';
  if (last.length < 3) return [];
  const out: Array<{ form: string; added: string }> = [];
  if (/[^aeiou]ies$/.test(s) && s.length - 2 >= 4) out.push({ form: `${s.slice(0, -3)}y`, added: '' });
  if (/(?:s|x|z|ch|sh)es$/.test(s) && s.length - 2 >= 4) out.push({ form: s.slice(0, -2), added: '' });
  if (/[^s]s$/.test(s) && s.length - 1 >= 4) out.push({ form: s.slice(0, -1), added: '' });
  if (/(?:s|x|z|ch|sh)$/.test(s)) out.push({ form: `${s}es`, added: 'es' });
  else if (/[^aeiou]y$/.test(s)) out.push({ form: `${s.slice(0, -1)}ies`, added: 'ies' });
  else out.push({ form: `${s}s`, added: 's' });
  return out;
}

/**
 * Whether the résumé carries a plural or singular of one spelling. An ending
 * added to a short last word must be written in lower case: "KPIs" and
 * "APIs" are plurals, "DCFS" (a family-services agency) and "IFRS" (an
 * accounting standard) are other acronyms. Every edge is checked, whatever
 * the spelling starts or ends with.
 */
function hasInflection(p: Prepared, s: string): boolean {
  const lastLen = (s.match(/[a-z]+$/)?.[0] ?? '').length;
  return inflections(s).some(({ form, added }) => {
    if (!added || lastLen > 4) return hasToken(p, form);
    const stemLen = form.length - added.length;
    return findToken(p.aligned, form, LEFT_EXTRA, RIGHT_EXTRA, true, (at) => {
      // The stem in either case (a letter a-z) or exactly as spelled; the
      // ending exactly as spelled, in lower case.
      for (let k = 0; k < form.length; k++) {
        const want = form[k];
        const got = p.original[at + k];
        if (k < stemLen && want >= 'a' && want <= 'z' ? got !== want && got !== want.toUpperCase() : got !== want) return false;
      }
      return true;
    });
  });
}

/**
 * The scanner's own tables are written in lower case, so their plural
 * acronyms cannot show their case. These are the entries of that shape (three
 * letters and a plural s) that ARE plurals; the rest of that shape are
 * acronyms whose S is a letter of their own (ACLS, PALS, ROAS, IFRS, HRIS,
 * CMMS, eNPS, PBIS...). Both scanners' tables count: the fallback's own
 * tables list "llms", "slos" and "kpis". The guard in
 * a-skill-is-on-the-resume-only-as-a-word-of-its-own holds every such table
 * entry to one side or the other.
 */
export const TABLE_PLURAL_ACRONYMS: ReadonlySet<string> = new Set(['apis', 'kpis', 'llms', 'okrs', 'qbrs', 'rfis', 'slis', 'slos', 'sops']);

/**
 * The singular of an acronym's plural: "APIs" is on the page where "API" is,
 * "KPIs" where "KPI" is. A plural is known by its case (three capitals and a
 * lower-case s, as a model or the page's cards write it) or by the reviewed
 * table entries above, and only a known plural is read back: lower-case
 * "aws", "ats" or "mls" are never "aw", "at" or "ml", "ACLS" is never "ACL",
 * and a two-letter stem ("PRs", "VMs") is too ambiguous to read back at all.
 * Once the plural is known, its singular counts in any case ("api automation").
 */
function acronymSingular(term: string): string | null {
  const t = term.trim();
  const lower = t.toLowerCase();
  return /^[A-Z]{3}s$/.test(t) || TABLE_PLURAL_ACRONYMS.has(lower) ? lower.slice(0, -1) : null;
}

/** True when the résumé carries `term` (or one of its spellings) as a token of its own. */
export function resumeHasTerm(resumeText: string, term: string): boolean {
  const p = prepared(resumeText);
  if (termSpellings(term).some(s => hasToken(p, s) || hasInflection(p, s))) return true;
  const singular = acronymSingular(term);
  return singular !== null && findToken(p.lower, singular, LEFT_EXTRA, RIGHT_EXTRA, false);
}

/**
 * True when `term` stands in `text` as a whole word or phrase, ignoring case:
 * no letter or digit on either side. The plain whole-word test the
 * market-intelligence tables use (hasWholeTerm): the same reading as its old
 * per-term pattern, on the text as written (spaces not folded), with no
 * pattern built per term.
 */
const lowerCache = new Map<string, string>();
export function textHasWholeTerm(text: string, term: string): boolean {
  const key = term.toLowerCase().trim();
  if (!key) return false;
  let lower = lowerCache.get(text);
  if (lower === undefined) {
    lower = text.toLowerCase();
    if (lowerCache.size >= PREPARED_LIMIT) lowerCache.delete(lowerCache.keys().next().value as string);
    lowerCache.set(text, lower);
  }
  return findToken(lower, key, '', '', true);
}
