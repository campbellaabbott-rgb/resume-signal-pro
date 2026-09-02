// Grounding validator for tailored resumes: the prompt PROMISES no invented
// experience — this module VERIFIES it. Every employer, school, and year in
// the output must exist in the source resume; titles and degrees must share
// their significant tokens with it; skills and certifications that aren't in
// the source are stripped and reported rather than shipped. Pure module —
// unit-tested from vitest, no Deno APIs.
//
// POLICY — validated vs streaming paths: the non-stream functions
// (generate-apply-package, generate-cover-letter, generate-application-answers)
// run these validators server-side and REFUSE ungrounded output (422). The
// *-stream variants cannot (tokens are already delivered as they stream), so
// they are prompt-guarded only and remain interactive/human-reviewed surfaces.
// Anything autonomous — overnight kit pre-drafting, the apply agent — MUST
// call the validated non-stream paths, never the stream variants.

export interface TailoredExperience {
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
}

export interface TailoredEducation {
  school: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  details: string;
}

export interface TailoredResumeShape {
  contact: Record<string, string>;
  summary: string;
  experience: TailoredExperience[];
  education: TailoredEducation[];
  skills: string[];
  certifications: string[];
}

export interface GroundingReport {
  ok: boolean;
  /** Fatal fabrications (employer/school/title/degree/year not in source). */
  issues: string[];
  /** Non-fatal: stripped because the source resume doesn't support them. */
  removedSkills: string[];
  removedCertifications: string[];
  /** The resume with ungrounded skills/certs removed. Only meaningful when ok. */
  cleaned: TailoredResumeShape;
}

/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "the", "of", "and", "a", "an", "at", "in", "for", "to", "de", "la", "el",
  "senior", "sr", "junior", "jr", "lead", "principal", "staff", "i", "ii", "iii",
]);

/** Significant tokens: normalized, minus stopwords/seniority prefixes. */
const sigTokens = (s: string) =>
  normalizeForMatch(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));

/**
 * Token containment: at least `ratio` of the needle's significant tokens
 * appear in the haystack. Lets "Sr. Software Eng" match "Senior Software
 * Engineer" while rejecting titles the candidate never held.
 */
function tokensSupported(hay: string, needle: string, ratio: number): boolean {
  const tokens = sigTokens(needle);
  if (tokens.length === 0) return true; // nothing substantive to verify
  const hit = tokens.filter((tk) => hay.includes(tk)).length;
  return hit / tokens.length >= ratio;
}

const yearsIn = (s: string) => [...s.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m[0]);

// ── Numeric claim grounding ─────────────────────────────────────────────────
// The structural validator above catches invented employers/titles/dates, but
// a model can still decorate a bullet or cover letter with a metric the
// candidate never claimed ("boosted conversion 32%"). Numbers are the
// highest-stakes tokens in application material — every impact-shaped figure
// in the OUTPUT must literally exist in the SOURCE resume.
//
// Impact-shaped = percentages, currency amounts, multipliers (3x), suffixed
// magnitudes (10k/2M/1B), and bare integers >= 13. Small bare integers (team
// of 4, 3 stakeholders) are allowed: they're usually structural phrasing, and
// flagging them would reject harmless drafts far more often than it would
// catch lies. Years are already validated structurally where they matter.

const NUM_CLAIM = /\$\s?\d[\d,.]*\s?[kKmMbB]?|\d+(?:[.,]\d+)?\s?%|\d+(?:\.\d+)?x\b|\b\d+(?:[.,]\d+)?\s?[kKmMbB]\b|\b\d{2,}\b/g;

/** Canonical digit-string for matching: "1,200" == "1200", "32 %" == "32%". */
const canonNum = (s: string) => s.replace(/[\s,]/g, "").toLowerCase();

const numClaims = (text: string): string[] =>
  [...(text.matchAll(NUM_CLAIM))].map((m) => m[0]).filter((raw) => {
    const bare = raw.replace(/[^0-9.]/g, "");
    const isBareInt = /^\d+$/.test(raw.trim());
    if (isBareInt && Number(bare) < 13) return false;      // small counts: allowed
    if (isBareInt && /^(19|20)\d{2}$/.test(raw.trim())) return false; // years: handled elsewhere
    return true;
  });

/**
 * Every impact-shaped number in `text` must appear in `sourceResume`
 * (canonicalized). Returns the unsupported claims, empty when clean.
 */
export function unsupportedNumericClaims(sourceResume: string, text: string): string[] {
  const sourceNums = new Set(numClaims(sourceResume).map(canonNum));
  // Also index every raw digit-run in the source, so "32%" in the output is
  // supported by "32 percent" or "increased by 32" in the source.
  for (const m of sourceResume.matchAll(/\d[\d,.]*/g)) sourceNums.add(canonNum(m[0]));
  const bad: string[] = [];
  for (const claim of numClaims(text)) {
    const canon = canonNum(claim);
    const digits = canon.replace(/[^0-9.]/g, "");
    if (sourceNums.has(canon) || sourceNums.has(digits)) continue;
    bad.push(claim.trim());
  }
  return [...new Set(bad)];
}

/**
 * Grounding for free-prose application text (cover letters, summaries).
 * Every figure must come from the resume — or, when `supportingContext` is
 * provided (the job posting), from that context: letters legitimately cite
 * the employer's own numbers ("your 300% year-over-year growth"). Live
 * probing showed honest letters do this constantly, so resume-only grounding
 * here would reject good drafts. Resume BULLETS stay resume-only grounded in
 * validateTailoredResume — those are first-person candidate claims, and a JD
 * figure appearing there would be a lifted achievement, not context.
 */
export function validateProseClaims(sourceResume: string, text: string, supportingContext = ""): string[] {
  const source = supportingContext ? `${sourceResume}\n${supportingContext}` : sourceResume;
  const issues: string[] = [];
  for (const n of unsupportedNumericClaims(source, text)) {
    issues.push(supportingContext
      ? `Figure "${n}" appears in neither the resume nor the job posting`
      : `Figure "${n}" does not appear in the source resume`);
  }
  return issues;
}

export function validateTailoredResume(sourceResume: string, resume: TailoredResumeShape): GroundingReport {
  const hay = " " + normalizeForMatch(sourceResume) + " ";
  const hayYears = new Set(yearsIn(sourceResume));
  const issues: string[] = [];

  for (const exp of resume.experience ?? []) {
    const company = normalizeForMatch(exp.company ?? "");
    if (company && !hay.includes(company) && !tokensSupported(hay, exp.company, 1)) {
      issues.push(`Employer "${exp.company}" does not appear in the source resume`);
    }
    if (!tokensSupported(hay, exp.title ?? "", 0.5)) {
      issues.push(`Job title "${exp.title}" is not supported by the source resume`);
    }
    for (const y of [...yearsIn(exp.startDate ?? ""), ...yearsIn(exp.endDate ?? "")]) {
      if (!hayYears.has(y)) issues.push(`Year ${y} on "${exp.company}" does not appear in the source resume`);
    }
    // Bullets: rephrasing is fine, new impact figures are not.
    for (const n of unsupportedNumericClaims(sourceResume, (exp.bullets ?? []).join("\n"))) {
      issues.push(`Figure "${n}" in a "${exp.company}" bullet does not appear in the source resume`);
    }
  }

  for (const n of unsupportedNumericClaims(sourceResume, resume.summary ?? "")) {
    issues.push(`Figure "${n}" in the summary does not appear in the source resume`);
  }

  for (const edu of resume.education ?? []) {
    if (!tokensSupported(hay, edu.school ?? "", 0.75)) {
      issues.push(`School "${edu.school}" does not appear in the source resume`);
    }
    if (!tokensSupported(hay, edu.degree ?? "", 0.4)) {
      issues.push(`Degree "${edu.degree}" is not supported by the source resume`);
    }
    for (const y of [...yearsIn(edu.startDate ?? ""), ...yearsIn(edu.endDate ?? "")]) {
      if (!hayYears.has(y)) issues.push(`Year ${y} on "${edu.school}" does not appear in the source resume`);
    }
  }

  const removedSkills: string[] = [];
  const keptSkills = (resume.skills ?? []).filter((sk) => {
    const supported = tokensSupported(hay, sk, 1);
    if (!supported) removedSkills.push(sk);
    return supported;
  });

  const removedCertifications: string[] = [];
  const keptCerts = (resume.certifications ?? []).filter((c) => {
    // Certs are high-stakes claims — require 3/4 of tokens present.
    const supported = tokensSupported(hay, c, 0.75);
    if (!supported) removedCertifications.push(c);
    return supported;
  });

  return {
    ok: issues.length === 0,
    issues,
    removedSkills,
    removedCertifications,
    cleaned: { ...resume, skills: keptSkills, certifications: keptCerts },
  };
}
