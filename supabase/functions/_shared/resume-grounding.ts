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

import { canonPhone, canonUrl } from "./contact-guard.ts";

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
  /** Contact fields blanked: a value the source résumé lacks, or a placeholder ("N/A"). */
  removedContact: string[];
  /** The resume with ungrounded skills/certs and contact values removed. Only meaningful when ok. */
  cleaned: TailoredResumeShape;
}

/**
 * THE CONTACT LINE IS COPIED, NEVER ADDED (S11-017). The kit's tool schema
 * makes every contact field a required string, so a résumé with no phone,
 * LinkedIn or website came back with invented ones ("(512) 555-0142",
 * "linkedin.com/in/janedoe") or a placeholder ("N/A", "Not provided"), and
 * the PDF and DOCX exporters printed them under a "nothing was invented"
 * banner. Each contact value must come from the source:
 *   - email: the same address appears in the source;
 *   - phone: the same digits as a phone in the source (canonPhone);
 *   - linkedIn / website / any URL: the same host and path (canonUrl);
 *   - fullName and location: their significant words appear in the source;
 *   - title (the headline under the name) is the résumé's own tailoring and
 *     is not contact information, so it is left alone.
 * A placeholder is blanked whatever the field.
 */
const CONTACT_PLACEHOLDER = /^(?:n\/?a|none|not provided|not available|not applicable|not listed|unknown|tbd|-+|—|\[[^\]]*\]|\([^)]*\))$/i;
const SOURCE_PHONE_RUN = /\+?\d[\d\s().-]{6,18}\d/g;

export function groundContact(sourceResume: string, contact: Record<string, string> | null | undefined): { contact: Record<string, string>; removed: string[] } {
  const out: Record<string, string> = {};
  const removed: string[] = [];
  const hay = " " + normalizeForMatch(sourceResume) + " ";
  const lower = sourceResume.toLowerCase();
  const sourceUrls = lower.replace(/https?:\/\//g, "").replace(/(^|[\s(|,])www\./g, "$1");
  const sourcePhones = new Set([...sourceResume.matchAll(SOURCE_PHONE_RUN)].map((m) => canonPhone(m[0])));
  for (const [field, raw] of Object.entries(contact ?? {})) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) { out[field] = ""; continue; }
    if (CONTACT_PLACEHOLDER.test(value)) { out[field] = ""; removed.push(`${field}: ${value}`); continue; }
    const key = field.toLowerCase();
    let supported: boolean;
    if (key === "title" || key === "headline") {
      supported = true;
    } else if (key.includes("email") || /@/.test(value)) {
      supported = lower.includes(value.toLowerCase());
    } else if (key.includes("phone") || key.includes("mobile")) {
      const digits = canonPhone(value);
      supported = digits.length >= 7 && (sourcePhones.has(digits) || sourceResume.includes(value));
    } else if (key.includes("linkedin") || key.includes("website") || key.includes("url") || key.includes("github") || key.includes("portfolio") || /\.[a-z]{2,}(\/|$)/i.test(value)) {
      const canon = canonUrl(value);
      supported = canon.length > 3 && sourceUrls.includes(canon);
    } else if (key === "fullname" || key === "name") {
      supported = tokensSupported(hay, value, 1);
    } else if (key === "location") {
      supported = tokensSupported(hay, value, 0.5);
    } else {
      supported = tokensSupported(hay, value, 0.75);
    }
    if (supported) out[field] = raw as string;
    else { out[field] = ""; removed.push(`${field}: ${value}`); }
  }
  return { contact: out, removed };
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

// The grouped arm ("10,000", "1,000,000") runs before the bare-integer arm,
// which would otherwise split "10,000" into "10" and "000", both dropped as
// small counts, so an invented "10,000 users" passed (sweep S8-032).
// Dot and space grouping ("10.000", "1.000.000", "10 000") are read the same
// way: generate-cover-letter writes Spanish for Spanish postings. A single
// dot group counts only with exactly three digits after it, and a space group
// never runs into a hyphen ("3 100-person teams").
const NUM_CLAIM = /\$\s?\d[\d,.]*\s?[kKmMbB]?|\d+(?:[.,]\d+)?\s?%|\d+(?:\.\d+)?x\b|\b\d+(?:[.,]\d+)?\s?[kKmMbB]\b|\b\d{1,3}(?:,\d{3})+\b|\b\d{1,3}(?:\.\d{3})+\b(?![.,]\d)|\b\d{1,3}(?:[ \u00A0\u202F]\d{3})+\b(?![-\u2010\u2011])|\b\d{2,}\b/g;
const GROUPED = /^\d{1,3}(?:[,. \u00A0\u202F]\d{3})+$/;
const SPACE_GROUPED = /^(\d{1,3})[ \u00A0\u202F](\d{3}(?:[ \u00A0\u202F]\d{3})*)$/;

/**
 * Canonical digit-string for matching: "1,200" == "1200", "32 %" == "32%",
 * and "$250,000." == "$250,000". The currency arm above (and the source
 * digit-run below) swallow a sentence's full stop, so a figure ending a
 * sentence on one side and not the other was refused as invented: an honest
 * cover letter or apply kit got a 422 (register L5-06).
 */
const canonNum = (s: string) => {
  const t = s.replace(/[\s\u00A0\u202F,]/g, "").toLowerCase().replace(/\.+$/, "");
  return t.replace(/(^|[^\d.])(\d{1,3}(?:\.\d{3})+)$/, (_m, pre: string, n: string) => pre + n.replace(/\./g, ""));
};

const numClaims = (text: string): string[] =>
  [...(text.matchAll(NUM_CLAIM))].map((m) => m[0]).filter((raw) => {
    const grouped = GROUPED.test(raw.trim());
    const bare = grouped ? raw.replace(/\D/g, "") : raw.replace(/[^0-9.]/g, "");
    const isBareInt = grouped || /^\d+$/.test(raw.trim());
    if (isBareInt && Number(bare) < 13) return false;      // small counts: allowed
    if (isBareInt && /^(19|20)\d{2}$/.test(bare)) return false; // years: handled elsewhere
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
    const digits = canon.replace(/[^0-9.]/g, "").replace(/\.+$/, "");
    if (sourceNums.has(canon) || sourceNums.has(digits)) continue;
    // "2 500" may be a small count and a figure ("2 500-seat venues" without
    // the hyphen): it passes when its tail is the source's, as it did before.
    const sp = claim.trim().match(SPACE_GROUPED);
    if (sp && Number(sp[1]) < 13 && sourceNums.has(canonNum(sp[2]))) continue;
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

  // Contact values the source lacks are blanked, not refused: a missing
  // LinkedIn is no reason to withhold a kit, an invented one is never shipped.
  const groundedContact = groundContact(sourceResume, resume.contact);

  return {
    ok: issues.length === 0,
    issues,
    removedSkills,
    removedCertifications,
    removedContact: groundedContact.removed,
    cleaned: { ...resume, contact: groundedContact.contact, skills: keptSkills, certifications: keptCerts },
  };
}
