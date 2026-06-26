// Deterministic, rule-based simulation of how a real ATS text parser would read
// this resume — NOT an AI judgment call. Every check here is a mechanical pattern
// match against the same extracted text the AI analysis also sees, so results are
// reproducible and explainable: "we found 0 date patterns" is a fact, not a guess.
// This exists specifically to give a more honest signal than an LLM's holistic ATS
// score, which estimates compatibility but can't actually tell you what a real
// parser extracted.

export type ParseCheckStatus = "pass" | "warning" | "fail";

export interface ParseCheckResult {
  id: string;
  label: string;
  status: ParseCheckStatus;
  detail: string;
}

export interface AtsParseSimulationResult {
  overallConfidence: number; // 0-100, deterministic — see computeOverallConfidence
  checks: ParseCheckResult[];
}

const SECTION_PATTERNS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "summary", label: "Summary / Objective", pattern: /\b(summary|profile|objective|about me)\b/i },
  { id: "experience", label: "Experience", pattern: /\b(experience|employment history|work history|professional experience)\b/i },
  { id: "education", label: "Education", pattern: /\b(education|academic background)\b/i },
  { id: "skills", label: "Skills", pattern: /\b(skills|technical skills|core competencies|key skills)\b/i },
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const LINKEDIN_PATTERN = /linkedin\.com\/in\/[A-Za-z0-9-]+/i;

// Matches "Jan 2020", "January 2020", "01/2020", "2020-2023", "2020 - Present", etc.
const DATE_PATTERN = /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}\s*[-–—to]+\s*(?:present|current|\d{4})|\b(19|20)\d{2}\b)/gi;

// U+FFFD (replacement character) appears when a PDF's font encoding can't be
// mapped to a real Unicode codepoint — the same failure mode a real ATS text
// extractor would hit, since most use the same category of PDF text layer.
const BROKEN_ENCODING_PATTERN = /�/g;

function checkSections(text: string): ParseCheckResult {
  const found = SECTION_PATTERNS.filter((s) => s.pattern.test(text));
  const missing = SECTION_PATTERNS.filter((s) => !s.pattern.test(text));

  if (missing.length === 0) {
    return {
      id: "sections",
      label: "Section Headers",
      status: "pass",
      detail: `All ${SECTION_PATTERNS.length} standard section headers detected (${found.map((s) => s.label).join(", ")}).`,
    };
  }

  if (found.length === 0) {
    return {
      id: "sections",
      label: "Section Headers",
      status: "fail",
      detail: "No standard section headers detected. Most ATS parsers segment a resume by recognizing labels like \"Experience\" or \"Education\" — without them, your content may get dumped into one unstructured block.",
    };
  }

  return {
    id: "sections",
    label: "Section Headers",
    status: "warning",
    detail: `Detected: ${found.map((s) => s.label).join(", ")}. Missing a recognizable header for: ${missing.map((s) => s.label).join(", ")}.`,
  };
}

function checkContactInfo(text: string): ParseCheckResult {
  const hasEmail = EMAIL_PATTERN.test(text);
  const hasPhone = PHONE_PATTERN.test(text);
  const hasLinkedIn = LINKEDIN_PATTERN.test(text);

  if (hasEmail && hasPhone) {
    return {
      id: "contact",
      label: "Contact Info Extraction",
      status: "pass",
      detail: `Email and phone number were both extractable via standard pattern matching.${hasLinkedIn ? " LinkedIn URL also found." : ""}`,
    };
  }

  if (!hasEmail && !hasPhone) {
    return {
      id: "contact",
      label: "Contact Info Extraction",
      status: "fail",
      detail: "No email or phone number could be extracted from the text. If these are present in your file but not detected, they may be in an image, text box, or header/footer that text extraction skips.",
    };
  }

  return {
    id: "contact",
    label: "Contact Info Extraction",
    status: "warning",
    detail: `${hasEmail ? "Email" : "Phone number"} was extractable, but ${hasEmail ? "no phone number" : "no email"} was found in a standard format.`,
  };
}

function checkDateParsing(text: string): ParseCheckResult {
  const matches = text.match(DATE_PATTERN) || [];
  const uniqueDates = new Set(matches.map((m) => m.toLowerCase()));

  if (uniqueDates.size >= 2) {
    return {
      id: "dates",
      label: "Date Parsing",
      status: "pass",
      detail: `Found ${uniqueDates.size} distinct date patterns — an ATS can likely determine your employment timeline and tenure at each role.`,
    };
  }

  if (uniqueDates.size === 0) {
    return {
      id: "dates",
      label: "Date Parsing",
      status: "fail",
      detail: "No recognizable date patterns (e.g. \"Jan 2020\", \"2020-2023\") were found. ATS systems use dates to calculate experience duration and gaps — without them, that calculation fails silently.",
    };
  }

  return {
    id: "dates",
    label: "Date Parsing",
    status: "warning",
    detail: `Only ${uniqueDates.size} date pattern found. If you have multiple roles, most of them may be missing parseable start/end dates.`,
  };
}

function checkEncoding(text: string): ParseCheckResult {
  const matches = text.match(BROKEN_ENCODING_PATTERN);
  if (!matches || matches.length === 0) {
    return {
      id: "encoding",
      label: "Character Encoding",
      status: "pass",
      detail: "No broken character encoding detected in the extracted text.",
    };
  }

  return {
    id: "encoding",
    label: "Character Encoding",
    status: "fail",
    detail: `${matches.length} character(s) failed to decode during text extraction (shown as replacement characters). This usually means an embedded font in your PDF isn't mapped to standard Unicode — likely from a template with custom icon fonts or unusual symbols, and a real ATS using the same extraction method would see the same garbled text.`,
  };
}

function checkLayout(multiColumnDetected: boolean | undefined): ParseCheckResult | null {
  if (multiColumnDetected === undefined) {
    return null; // Not applicable — only computed for PDF uploads with position data.
  }

  if (!multiColumnDetected) {
    return {
      id: "layout",
      label: "Column Layout",
      status: "pass",
      detail: "No multi-column layout detected — text extracts in a single, linear reading order.",
    };
  }

  return {
    id: "layout",
    label: "Column Layout",
    status: "fail",
    detail: "A multi-column layout was detected in your PDF. Text extractors (including most ATS systems) read PDFs in the order content appears in the file, not visual reading order — a two-column resume often gets its columns interleaved or read out of sequence, scrambling your actual content.",
  };
}

function computeOverallConfidence(checks: ParseCheckResult[]): number {
  if (checks.length === 0) return 0;
  const weights: Record<ParseCheckStatus, number> = { pass: 100, warning: 55, fail: 0 };
  const total = checks.reduce((sum, c) => sum + weights[c.status], 0);
  return Math.round(total / checks.length);
}

export function simulateAtsParse(
  resumeText: string,
  options?: { multiColumnDetected?: boolean }
): AtsParseSimulationResult {
  const checks: ParseCheckResult[] = [
    checkSections(resumeText),
    checkContactInfo(resumeText),
    checkDateParsing(resumeText),
    checkEncoding(resumeText),
  ];

  const layoutCheck = checkLayout(options?.multiColumnDetected);
  if (layoutCheck) checks.push(layoutCheck);

  return {
    overallConfidence: computeOverallConfidence(checks),
    checks,
  };
}
