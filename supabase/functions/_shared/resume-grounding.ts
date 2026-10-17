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

/**
 * The same figure written with a magnitude suffix and in full: "120K" is
 * 120000 and "$1.2M" is $1200000 (critical path CP-018). canonNum kept the
 * suffix, so a draft that wrote "$120,000" for a résumé's "$120K" (or the
 * reverse) was refused as an invented figure. Returns the canonical forms a
 * figure also stands for, with and without its currency sign; empty when it
 * carries no suffix.
 */
const MAGNITUDE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };
const expandedForms = (canon: string): string[] => {
  const m = canon.match(/^(\D*?)(\d+(?:\.\d+)?)([kmb])$/);
  if (!m) return [];
  const full = String(Math.round(Number(m[2]) * MAGNITUDE[m[3]]));
  return m[1] ? [m[1] + full, full] : [full];
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
  // A suffixed figure in the source also stands for itself written in full.
  for (const canon of [...sourceNums]) for (const form of expandedForms(canon)) sourceNums.add(form);
  // Also index every raw digit-run in the source, so "32%" in the output is
  // supported by "32 percent" or "increased by 32" in the source.
  for (const m of sourceResume.matchAll(/\d[\d,.]*/g)) sourceNums.add(canonNum(m[0]));
  const bad: string[] = [];
  for (const claim of numClaims(text)) {
    const canon = canonNum(claim);
    const digits = canon.replace(/[^0-9.]/g, "").replace(/\.+$/, "");
    if (sourceNums.has(canon) || sourceNums.has(digits)) continue;
    if (expandedForms(canon).some((form) => sourceNums.has(form))) continue;
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

// ── A whole rewritten résumé as plain text (the Premium Package) ────────────
//
// CRITICAL PATH CP-018. The package's rewrite is one block of text with a
// skills section the prompt asks to fill with the posting's keywords, so a
// skills line could carry the posting's own numbers ("ISO 27001", "SOC 2")
// and be refused as an invented figure. Bullets stay résumé-only: a posting
// figure in a bullet would be a lifted achievement. And a rewrite that still
// invents a figure after its one repair is no longer refused outright: each
// line that carries one is put back to the résumé's own line (or left out
// when the résumé has no line like it), because a past buyer is owed a
// package made of their own facts, not a refusal.

/** A short line that may be a heading, its name captured without markup or a closing colon. */
const HEADING_LINE = /^\s*(#{1,6}\s*)?(\*\*|__)?\s*([\p{L}][\p{L} &/'’-]{1,48}?)\s*(?:\*\*|__)?\s*(:)?\s*(?:\*\*|__)?\s*$/u;
const SKILLS_NAME = /^(?:(?:core|key|technical|professional|relevant|additional|ats)\s+)?(?:skills?|competenc(?:y|ies)|keywords|technologies|tools(?:\s*(?:&|and)\s*technologies)?|technical proficiencies|areas of expertise|expertise|skills?\s*(?:&|and)\s*[\p{L} ]+)$/iu;
const SECTION_NAME = /^(?:(?:professional|work|career|employment|relevant|selected|key|academic|other)\s+)?(?:summary|profile|objective|experience|employment(?:\s+history)?|work history|history|education|projects?|certifications?|certificates?|licen[cs]es?(?:\s*(?:&|and)\s*certifications?)?|awards?|honou?rs|publications|languages|volunteer(?:ing)?|interests|references|achievements|accomplishments|training|courses|contact|personal details|highlights|leadership|activities|affiliations|memberships)$/iu;
/** "Skills: Python, SQL, ISO 27001" — a skills heading and its list on one line. */
const INLINE_SKILLS = /^\s*(?:[-*•]\s*)?(?:\*\*|__)?\s*(?:(?:core|key|technical|professional|relevant|additional|ats)\s+)?(?:skills?|competencies|keywords|technologies|tools|technical proficiencies|areas of expertise)\s*(?:\*\*|__)?\s*:/iu;

/**
 * For each line of `text`, whether it belongs to a skills section: a line
 * under a skills heading up to the next heading, or a one-line "Skills: …".
 * A heading is a known section name, or any short line marked up as one (a
 * markdown #, bold, or a closing colon), so a one-per-line skills list
 * ("Python", "Kubernetes") stays inside its section.
 */
export function skillsLineMask(text: string): boolean[] {
  const lines = String(text ?? "").split("\n");
  const mask: boolean[] = [];
  let inSkills = false;
  for (const line of lines) {
    const h = line.match(HEADING_LINE);
    const name = h?.[3]?.trim() ?? "";
    const isSkills = !!h && SKILLS_NAME.test(name);
    const isHeading = !!h && (isSkills || SECTION_NAME.test(name) || !!h[1] || !!h[2] || !!h[4]);
    if (isHeading) {
      inSkills = isSkills;
      mask.push(false);
      continue;
    }
    mask.push(inSkills || INLINE_SKILLS.test(line));
  }
  return mask;
}

/**
 * The figures a rewritten résumé states that the candidate never claimed: a
 * skills line may also cite the posting's own numbers, every other line only
 * the résumé's.
 */
export function rewrittenResumeFigureIssues(sourceResume: string, rewritten: string, posting = ""): string[] {
  const lines = String(rewritten ?? "").split("\n");
  const mask = skillsLineMask(rewritten);
  const body = lines.filter((_, i) => !mask[i]).join("\n");
  const skills = lines.filter((_, i) => mask[i]).join("\n");
  return [
    ...validateProseClaims(sourceResume, body),
    ...(skills ? validateProseClaims(sourceResume, skills, posting) : []),
  ];
}

const BULLET_PREFIX = /^(\s*(?:[-*•▪◦·–]|\d{1,2}[.)])?\s*)/;
const lineWords = (line: string) => new Set((line.toLowerCase().match(/\p{L}{3,}/gu) ?? []));

/**
 * The last resort after a repair: every line that still states a figure the
 * candidate never claimed is replaced by the résumé line most like it (its
 * words, by Dice overlap of at least 0.35, each résumé line used once), with
 * the draft's own bullet mark; a line the résumé has nothing like is left out.
 * Lines that pass are kept exactly as drafted.
 */
export function restoreUnsupportedLines(
  sourceResume: string,
  rewritten: string,
  posting = "",
): { text: string; restored: Array<{ from: string; to: string }>; dropped: string[] } {
  const sourceLines = String(sourceResume ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const sourceWords = sourceLines.map(lineWords);
  const used = new Set<number>();
  const lines = String(rewritten ?? "").split("\n");
  const mask = skillsLineMask(rewritten);
  const restored: Array<{ from: string; to: string }> = [];
  const dropped: string[] = [];
  const out: string[] = [];
  lines.forEach((line, i) => {
    const issues = unsupportedNumericClaims(mask[i] && posting ? `${sourceResume}\n${posting}` : sourceResume, line);
    if (issues.length === 0) { out.push(line); return; }
    const words = lineWords(line);
    let best = -1;
    let bestScore = 0;
    sourceWords.forEach((sw, j) => {
      if (used.has(j) || sw.size === 0 || words.size === 0) return;
      let shared = 0;
      for (const w of words) if (sw.has(w)) shared++;
      const score = (2 * shared) / (words.size + sw.size);
      if (score > bestScore) { bestScore = score; best = j; }
    });
    if (best >= 0 && bestScore >= 0.35) {
      used.add(best);
      const mark = (line.match(BULLET_PREFIX)?.[1] ?? "");
      const to = mark + sourceLines[best].replace(BULLET_PREFIX, "");
      restored.push({ from: line.trim(), to: to.trim() });
      out.push(to);
    } else {
      dropped.push(line.trim());
    }
  });
  return { text: out.join("\n"), restored, dropped };
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

// ── Claims about the candidate in prose: credentials, employers, titles ─────
//
// WHAT WAS WRONG (S12-071, S12-062). The cover letter's check read figures
// only, and accepted any figure the posting carried anywhere, so a letter
// could say "As an MSN-prepared CCRN, I managed a $40M budget" for a nurse
// whose résumé has none of it: MSN, CCRN and $40M were all in the posting,
// and the letter was delivered under "never invent". The screening-answer
// drafter checked nothing and trusted the model's own supported:true, under
// a badge that said nothing was invented.
//
// THE RULE. A sentence about the candidate (first person: I, my, me, and the
// same words in the languages the letters are written in) may state a
// credential, a figure, an employer ("at X") or a title held ("as a X") only
// when the résumé states it. A sentence about the employer may cite the
// posting's own figures and requirements. A credential in neither the résumé
// nor the posting is refused wherever it stands.

/** Credential abbreviations: matched as whole words, dots and hyphens ignored, case as written. */
const CREDENTIAL_ABBREVIATIONS = [
  "PhD", "Ph.D.", "DPhil", "EdD", "DNP", "PharmD", "DPT", "MD", "JD", "LLM",
  "MBA", "MSN", "BSN", "ADN", "MPH", "MHA", "MSW", "MEd", "MSc", "BSc", "MEng", "BEng", "BBA",
  "CCRN", "CEN", "RN", "LPN", "LVN", "NP", "APRN", "FNP", "CNA", "PA-C", "CRNA",
  "ACLS", "BLS", "PALS", "NRP", "TNCC",
  "CPA", "CFA", "CMA", "ACCA", "CIMA", "FRM", "CFP",
  "PMP", "CAPM", "PRINCE2", "CSM", "CSPO", "PSM", "SAFe", "ITIL",
  "CISSP", "CISA", "CISM", "CEH", "OSCP", "CCNA", "CCNP", "CCIE", "MCSE", "CompTIA",
  "PE", "EIT", "LEED", "SHRM-CP", "SHRM-SCP", "PHR", "SPHR", "CPC", "RHIA", "RHIT", "CPhT",
  "LCSW", "LMFT", "LPC", "BCBA", "OTR", "CDL",
];
const ABBREV_KEYS = new Map(CREDENTIAL_ABBREVIATIONS.map((a) => [a.replace(/[.-]/g, ""), a]));

/** Degree words, each with the résumé spellings that support it. */
const DEGREE_FAMILIES: Array<{ claim: RegExp; label: string; support: RegExp }> = [
  {
    claim: /\b(?:doctorate|doctoral degree|doctoral)\b/i,
    label: "a doctorate",
    support: /\b(?:ph\.?\s?d\.?|dphil|doctor(?:ate|al)?|ed\.?d|dnp|pharm\.?d|m\.?d\.?|j\.?d\.?|promotion|doktor)\b/i,
  },
  {
    claim: /\bmaster(?:'s|’s|s)?\s+(?:degree|of)\b|\bmaster['’]s\b/i,
    label: "a master's degree",
    support: /\b(?:master|masters|msc|m\.sc|m\.s\.|ms|ma|m\.a\.|mba|msn|meng|m\.eng|med|m\.ed|mph|mha|msw|llm|mfa)\b/i,
  },
  {
    claim: /\bbachelor(?:'s|’s|s)?\s+(?:degree|of)\b|\bbachelor['’]s\b/i,
    label: "a bachelor's degree",
    support: /\b(?:bachelor|bachelors|bsc|b\.sc|b\.s\.|bs|ba|b\.a\.|bsn|beng|b\.eng|bba|b\.com|bcom|licenciatura|licence|laurea|bachelier)\b/i,
  },
];

/** Words that mark a sentence as being about the writer, in the languages letters are written in. */
const FIRST_PERSON_EN = /\b(?:I|I'm|I’m|I've|I’ve|I'd|I’d|I'll|I’ll|[Mm]y|[Mm]e|[Mm]ine|[Mm]yself)\b/;
const FIRST_PERSON_OTHER = /(?:^|[\s(])(?:je|j'|j’|mon|mes|moi|ich|mein|meine|meinen|meinem|meiner|mir|mich|ik|mijn|mij|yo|mis|eu|meu|minha|meus|minhas|io|mio|mia|miei)(?=[\s,.;:!?)]|$)/i;
const isFirstPerson = (s: string) => FIRST_PERSON_EN.test(s) || FIRST_PERSON_OTHER.test(s);

/** Sentences, cut at a full stop, question or exclamation mark, or a line break. */
function sentencesOf(text: string): string[] {
  return String(text ?? "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** A text's words with dots and hyphens closed up and lower-cased ("Ph.D." -> "phd", "PA-C" -> "pac"). */
function compactWords(text: string): Set<string> {
  return new Set(String(text ?? "").split(/[^\p{L}\p{N}.-]+/u).map((w) => w.replace(/[.-]/g, "").toLowerCase()).filter(Boolean));
}

/** The credential abbreviations a text names, spelled as the text spells them. */
export function credentialMentions(text: string): string[] {
  const out = new Set<string>();
  for (const raw of String(text ?? "").split(/[^\p{L}\p{N}.-]+/u)) {
    const word = raw.replace(/^[-]+|[-]+$/g, "").replace(/(?<![A-Za-z]\.[A-Za-z])\.+$/, "");
    if (ABBREV_KEYS.has(word.replace(/[.-]/g, ""))) { out.add(word); continue; }
    // "MSN-prepared", "CCRN-certified": the credential before a hyphenated word.
    const head = word.split("-")[0];
    if (head !== word && ABBREV_KEYS.has(head)) out.add(head);
  }
  return [...out];
}

function credentialSupported(credential: string, words: Set<string>): boolean {
  return words.has(credential.replace(/[.-]/g, "").toLowerCase());
}

const TITLE_STOP = new Set(["at", "in", "for", "with", "where", "and", "who", "which", "that", "to", "on", "of", "from", "since", "during", "over", "i", "my"]);
const NOT_AN_EMPLOYER = new Set(["the", "a", "an", "least", "first", "last", "all", "once", "times", "home", "work", "night", "scale", "my", "your", "our", "this", "that", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

/** Up to four words of a title, stopping at a preposition or a clause word. */
function titleWords(fragment: string): string {
  const out: string[] = [];
  for (const w of fragment.trim().split(/\s+/)) {
    const bare = w.replace(/[^\p{L}\p{N}'-]/gu, "");
    if (!bare || TITLE_STOP.has(bare.toLowerCase())) break;
    out.push(bare);
    if (out.length >= 4 || /[,;:]$/.test(w)) break;
  }
  return out.join(" ");
}

/** Employers a first-person sentence places the writer at ("at Mayo Clinic"). */
function employersClaimed(sentence: string): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(/\bat\s+([A-Z][\p{L}\p{N}&'’.-]*(?:\s+(?:[A-Z][\p{L}\p{N}&'’.-]*|of|&|and)){0,4})/gu)) {
    const name = m[1].replace(/\s+(?:of|&|and)$/i, "").replace(/[.,]+$/, "").trim();
    if (!name || NOT_AN_EMPLOYER.has(name.toLowerCase())) continue;
    out.push(name);
  }
  return out;
}

/** Titles a first-person sentence says the writer held ("as a Nurse Manager, I", "worked as a ..."). */
function titlesClaimed(sentence: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b(?:worked|served|employed|working|serving|experience|years?|role|time|tenure)\s+as\s+(?:an?\s+|the\s+)?([^.!?;]+)/gi,
    /^As\s+(?:an?\s+|the\s+)?([A-Z][^,.!?;]+),/g,
  ];
  for (const re of patterns) {
    for (const m of sentence.matchAll(re)) {
      const t = titleWords(m[1]);
      if (t && !/^(?:result|well|such|part|soon|long|much|many|needed|required|possible)$/i.test(t)) out.push(t);
    }
  }
  return out;
}

export interface ClaimContext {
  /** The job posting: a sentence about the employer may cite it. */
  posting?: string;
  /** The role applied for: "as your next <role>" is not a claim to have held it. */
  jobTitle?: string;
  /** The employer applied to: "at <company>" is where the writer wants to work. */
  company?: string;
  /** Read every sentence as the candidate's own (a screening answer is). */
  allFirstPerson?: boolean;
}

/**
 * The claims in a letter or an answer (any prose about the candidate) that
 * the résumé does not support, as sentences a person or a repair prompt can
 * read. Empty when clean. Figures are checked here sentence by sentence; a
 * letter's whole-text figure check (validateProseClaims) still runs beside it.
 */
export function validateCandidateClaims(sourceResume: string, text: string, ctx: ClaimContext = {}): string[] {
  const issues = new Set<string>();
  const resumeWords = compactWords(sourceResume);
  const postingWords = compactWords(ctx.posting ?? "");
  const hay = " " + normalizeForMatch(sourceResume) + " ";
  const companyHay = " " + normalizeForMatch(ctx.company ?? "") + " ";
  const roleHay = " " + normalizeForMatch(ctx.jobTitle ?? "") + " ";

  for (const sentence of sentencesOf(text)) {
    const aboutMe = ctx.allFirstPerson === true || isFirstPerson(sentence);

    for (const c of credentialMentions(sentence)) {
      if (credentialSupported(c, resumeWords)) continue;
      if (!aboutMe && credentialSupported(c, postingWords)) continue;
      issues.add(aboutMe
        ? `Credential "${c}" is claimed for the candidate but is not on the résumé`
        : `Credential "${c}" appears on neither the résumé nor the posting`);
    }

    if (!aboutMe) continue;

    for (const fam of DEGREE_FAMILIES) {
      if (fam.claim.test(sentence) && !fam.support.test(sourceResume)) {
        issues.add(`The candidate is said to hold ${fam.label}, which the résumé does not show`);
      }
    }
    for (const n of unsupportedNumericClaims(sourceResume, sentence)) {
      issues.add(`Figure "${n}" is stated about the candidate but is not on the résumé`);
    }
    for (const employer of employersClaimed(sentence)) {
      const norm = normalizeForMatch(employer);
      if (!norm) continue;
      if (hay.includes(` ${norm} `) || tokensSupported(hay, employer, 1)) continue;
      if (ctx.company && (companyHay.includes(` ${norm} `) || tokensSupported(companyHay, employer, 0.75))) continue;
      issues.add(`Employer "${employer}" is not on the résumé`);
    }
    for (const title of titlesClaimed(sentence)) {
      if (tokensSupported(hay, title, 0.5)) continue;
      if (ctx.jobTitle && tokensSupported(roleHay, title, 0.75)) continue;
      issues.add(`Title "${title}" is not supported by the résumé`);
    }
  }
  return [...issues];
}
