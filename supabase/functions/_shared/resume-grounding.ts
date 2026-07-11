// Grounding validator for tailored resumes: the prompt PROMISES no invented
// experience — this module VERIFIES it. Every employer, school, and year in
// the output must exist in the source resume; titles and degrees must share
// their significant tokens with it; skills and certifications that aren't in
// the source are stripped and reported rather than shipped. Pure module —
// unit-tested from vitest, no Deno APIs.

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
