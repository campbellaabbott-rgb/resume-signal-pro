




import { INDUSTRY_KEYWORDS } from "./industry-detection.ts";

const DICTIONARY: string[] = (() => {
  const set = new Set<string>();
  for (const data of Object.values(INDUSTRY_KEYWORDS)) {
    for (const list of [data.primary, data.secondary, data.certifications, data.titles]) {
      for (const term of list) {
        const t = term.toLowerCase().trim();
        if (t.length >= 3) set.add(t);
      }
    }
  }
  
  return [...set].sort((a, b) => b.length - a.length);
})();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");







const TERM_RE = new Map<string, RegExp>();
const containsTerm = (haystack: string, term: string) => {
  let re = TERM_RE.get(term);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i");
    TERM_RE.set(term, re);
  }
  return re.test(haystack);
};

export interface FitResult {
  pct: number | null; 
  matched: string[];
  missing: string[];
  totalRecognized: number;
  

  coverage: number;
  

  precision: number;
}




































export interface ResumeScan {
  lower: string;
  terms: string[];
}










export function scanResume(resumeText: string): ResumeScan {
  const lower = resumeText.toLowerCase();
  
  
  
  
  const terms: string[] = [];
  for (const term of DICTIONARY) {
    if (terms.some((p) => p.includes(term))) continue;
    if (containsTerm(lower, term)) terms.push(term);
  }
  return { lower, terms };
}

export function computeFit(jobPosting: string, resume: string | ResumeScan, maxTerms = 60): FitResult {
  const postingLower = jobPosting.toLowerCase();
  const scan = typeof resume === "string" ? scanResume(resume) : resume;

  const postingTerms: string[] = [];
  for (const term of DICTIONARY) {
    if (postingTerms.length >= maxTerms) break;
    if (postingTerms.some((p) => p.includes(term))) continue;
    if (containsTerm(postingLower, term)) postingTerms.push(term);
  }

  
  
  
  const matched = postingTerms.filter((t) => containsTerm(scan.lower, t));
  const missing = postingTerms.filter((t) => !containsTerm(scan.lower, t));

  if (postingTerms.length === 0) {
    return { pct: null, matched, missing, totalRecognized: 0, coverage: 0, precision: 0 };
  }

  const coverage = matched.length / postingTerms.length;
  const precision = scan.terms.length ? matched.length / scan.terms.length : 0;
  const pct = coverage === 0 || precision === 0
    ? 0
    : Math.round(((2 * coverage * precision) / (coverage + precision)) * 100);

  return { pct, matched, missing, totalRecognized: postingTerms.length, coverage, precision };
}
