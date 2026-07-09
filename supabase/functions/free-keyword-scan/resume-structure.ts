// Deterministic resume structure + extraction-quality analysis. Pure (no AI,
// no Deno APIs — unit-testable and importable from both scan functions as a
// byte-identical copy, like industry-detection.ts).
//
// Two jobs, both about accuracy:
//   1. computeParseQuality — is the extracted text even trustworthy? A mangled
//      PDF is the biggest SILENT accuracy killer: it yields a confidently wrong
//      report. Surfaced to the user as a warning when the parse looks bad.
//   2. parseResumeStructure / formatStructureForPrompt — a deterministic
//      scaffold (sections, dated positions, contact) injected into the AI
//      prompt so the model grounds its narrative in real structure instead of
//      misreading raw layout (the source of "missing skills section" /
//      "no contact info" / miscounted-jobs false positives).

export interface ParseQuality {
  verdict: "good" | "fair" | "poor";
  wordCount: number;
  issues: string[];
}

// Count characters that signal a broken extraction: the U+FFFD replacement
// char and C0 control chars (excluding tab/newline/carriage-return). A charCode
// loop keeps the source free of literal invisible characters.
function countGarbageChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xfffd || (c <= 0x08) || (c >= 0x0e && c <= 0x1f)) count++;
  }
  // Runs of 6+ identical characters are almost always extraction artifacts.
  count += (text.match(/(.)\1{5,}/g) || []).length;
  return count;
}

export function computeParseQuality(resumeText: string): ParseQuality {
  const wordCount = resumeText.split(/\s+/).filter(Boolean).length;
  // \p{L} = any Unicode letter, so non-Latin resumes (CJK, Arabic, Cyrillic,
  // Devanagari…) aren't wrongly flagged as symbol-heavy.
  const letters = (resumeText.match(/\p{L}/gu) || []).length;
  const letterRatio = resumeText.length > 0 ? letters / resumeText.length : 0;
  const garbage = countGarbageChars(resumeText);
  const hasSections = /\b(experience|education|skills|summary|employment)\b/i.test(resumeText);
  const issues: string[] = [];
  if (wordCount < 120) issues.push(`only ${wordCount} words extracted`);
  if (letterRatio < 0.55) issues.push("unusually low text-to-symbol ratio");
  if (garbage > 5) issues.push("garbled characters detected");
  if (!hasSections) issues.push("no standard resume sections found");
  const verdict = issues.length >= 2 ? "poor" : issues.length === 1 ? "fair" : "good";
  return { verdict, wordCount, issues };
}

export interface ResumeStructure {
  sections: string[];
  positionCount: number;
  experienceSpanYears: number | null;
  contact: { email: boolean; phone: boolean; linkedin: boolean; location: boolean };
}

const SECTION_PATTERNS: [string, RegExp][] = [
  ["Summary", /\b(summary|profile|objective|about\s+me)\b/i],
  ["Experience", /\b(experience|employment|work\s+history|professional\s+background)\b/i],
  ["Education", /\b(education|academic)\b/i],
  ["Skills", /\b(skills|competencies|proficiencies|technologies)\b/i],
  ["Certifications", /\b(certifications?|licen[cs]es?|credentials)\b/i],
  ["Projects", /\b(projects|portfolio)\b/i],
];

export function parseResumeStructure(resumeText: string): ResumeStructure {
  const sections = SECTION_PATTERNS.filter(([, re]) => re.test(resumeText)).map(([name]) => name);

  // Count dated positions from year ranges: "2019 - 2022", "2020-Present".
  const rangeRe = /((?:19|20)\d{2})\s*[-–—]{1,2}\s*((?:19|20)\d{2}|present|current|now|ongoing)/gi;
  const years: number[] = [];
  let positionCount = 0;
  const nowYear = new Date().getFullYear();
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(resumeText)) !== null) {
    positionCount++;
    const start = parseInt(m[1], 10);
    const endRaw = m[2].toLowerCase();
    const end = /^(present|current|now|ongoing)$/.test(endRaw) ? nowYear : parseInt(endRaw, 10);
    if (start >= 1950 && start <= nowYear) years.push(start);
    if (end >= 1950 && end <= nowYear) years.push(end);
  }
  const experienceSpanYears = years.length >= 2 ? Math.max(...years) - Math.min(...years) : null;

  // Contact patterns mirror the deterministic red-flag checks for consistency,
  // with international phone added.
  const contact = {
    email: /@[\w.-]+\.\w{2,}/.test(resumeText),
    phone: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(resumeText) || /\+\d[\d\s().-]{7,}\d/.test(resumeText),
    linkedin: /linkedin\.com|linkedin/i.test(resumeText),
    location: /\b([A-Z][a-z]+,\s*[A-Z]{2}\b|[A-Z][a-z]+,\s*[A-Z][a-z]+|\d{5}(-\d{4})?)\b/.test(resumeText),
  };

  return { sections, positionCount, experienceSpanYears, contact };
}

// Compact grounding block for the AI prompt. Phrased to prevent false NEGATIVES
// (claiming absent what is present) without forcing false positives — when in
// genuine doubt the model is told to defer to the resume text.
export function formatStructureForPrompt(s: ResumeStructure): string {
  const contactBits = [
    `email ${s.contact.email ? "yes" : "no"}`,
    `phone ${s.contact.phone ? "yes" : "no"}`,
    `LinkedIn ${s.contact.linkedin ? "yes" : "no"}`,
    `location ${s.contact.location ? "yes" : "no"}`,
  ].join(", ");
  const work = s.experienceSpanYears != null
    ? `${s.positionCount} dated position${s.positionCount === 1 ? "" : "s"} spanning ~${s.experienceSpanYears} year${s.experienceSpanYears === 1 ? "" : "s"}`
    : `${s.positionCount} dated position${s.positionCount === 1 ? "" : "s"} detected`;
  return `\n\n<deterministic_structure>
These were extracted deterministically from the raw text (not by you). Ground your analysis in them: do NOT report a "missing section", "missing contact info", or comparable issue that contradicts these facts. Ambiguous formatting can undercount an item, so when in genuine doubt prefer the resume text — but never flag as ABSENT something listed present here.
- Sections detected: ${s.sections.length ? s.sections.join(", ") : "none clearly detected"}
- Contact present: ${contactBits}
- Work history: ${work}
</deterministic_structure>`;
}
