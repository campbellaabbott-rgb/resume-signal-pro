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
const presencePatternCache = new Map<string, RegExp>();
function presencePattern(term: string): RegExp {
  let re = presencePatternCache.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A term that starts or ends with a symbol (".net", "c++", "c#") carries
    // its own edge on that side: ".NET" is in "ASP.NET", "C++" in "C++17".
    const left = /^[\p{L}\p{N}]/u.test(term) ? `(?<![\\p{L}\\p{N}+#.&])` : '';
    const right = /[\p{L}\p{N}]$/u.test(term) ? `(?![\\p{L}\\p{N}+#&])` : '';
    re = term.length === 1
      ? new RegExp(`(?<![\\p{L}\\p{N}+#.&'\\-])${escaped}(?![\\p{L}\\p{N}+#&'\\-])`, 'u')
      : new RegExp(`${left}${escaped}${right}`, 'u');
    presencePatternCache.set(term, re);
  }
  return re;
}

/** One exact spelling, as its own token (a lone character in its own case). */
function hasToken(lower: string, original: string, term: string): boolean {
  if (term.length === 1) return presencePattern(term.toUpperCase()).test(original);
  return presencePattern(term).test(lower);
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The plural or singular of one spelling ("launch"/"launches",
 * "strategy"/"strategies", "process"/"processes", "kpi"/"kpis"). An ending is
 * stripped only when four or more characters stay ("aws" and "apis" keep
 * theirs). No other form of the word counts: reading "test" as "testing"
 * would read "drug test" as QA work and "dress code" as coding.
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
 * accounting standard) are other acronyms.
 */
function hasInflection(lower: string, original: string, s: string): boolean {
  const lastLen = (s.match(/[a-z]+$/)?.[0] ?? '').length;
  return inflections(s).some(({ form, added }) => {
    if (!added || lastLen > 4) return hasToken(lower, original, form);
    const key = `plural:${form}`;
    let re = presencePatternCache.get(key);
    if (!re) {
      const stem = form.slice(0, form.length - added.length);
      const body = escapeRe(stem).replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
      re = new RegExp(`(?<![\\p{L}\\p{N}+#.&])${body}${added}(?![\\p{L}\\p{N}+#&])`, 'u');
      presencePatternCache.set(key, re);
    }
    return re.test(original);
  });
}

/** True when the résumé carries `term` (or one of its spellings) as a token of its own. */
export function resumeHasTerm(resumeText: string, term: string): boolean {
  // A line break inside a phrase ("machine\nlearning") is still the phrase.
  const original = resumeText.replace(/\s+/g, ' ');
  const lower = original.toLowerCase();
  return termSpellings(term).some(s => hasToken(lower, original, s) || hasInflection(lower, original, s));
}
