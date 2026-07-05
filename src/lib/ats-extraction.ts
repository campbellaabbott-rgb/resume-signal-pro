// Independent extraction proof for the Complete Resume Rewrite.
//
// This deliberately does NOT use any of our own scoring. It runs both the old
// and new resume text through the open-source `compromise` NLP library
// (https://github.com/spencermountain/compromise, MIT) plus the standard
// field-extraction rules ATS parsers share (RFC-style email/phone regexes,
// section-header dictionaries), and reports what an independent parser can
// actually pull out of each version. The UI shows the two extractions side by
// side — the proof is the extraction itself, never a score delta of ours.

export interface AtsExtraction {
  nameGuess: string | null;
  emails: string[];
  phones: string[];
  links: string[];
  sectionsDetected: string[];
  organizations: string[];
  datesFound: string[];
  bulletCount: number;
  quantifiedBullets: number;
  wordCount: number;
  /** Non-empty lines the parser could not classify into any known field. */
  unclassifiedLines: number;
}

// Section headers recognized by virtually every ATS parser (Lever, Greenhouse,
// Workday all key on these words).
const SECTION_HEADERS: Record<string, RegExp> = {
  Summary: /^(professional\s+)?(summary|profile|objective|about)\b/i,
  Experience: /^(work\s+|professional\s+|relevant\s+)?(experience|employment|history)\b/i,
  Education: /^education\b/i,
  Skills: /^(technical\s+|core\s+)?(skills|competencies|technologies)\b/i,
  Certifications: /^(certifications?|licenses?)\b/i,
  Projects: /^projects?\b/i,
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const LINK_RE = /(https?:\/\/[^\s|,;]+|(?:www\.|linkedin\.com|github\.com)[^\s|,;]+)/gi;
const DATE_RE = /\b((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}\s*[-–—]\s*(\d{4}|present|current)|\d{4})\b/gi;
const BULLET_RE = /^\s*([•●▪◦‣·*-]|\d+\.)\s+/;

export async function extractResumeFields(text: string): Promise<AtsExtraction> {
  // compromise is ~250KB — load it only when the proof step actually runs.
  const { default: nlp } = await import("compromise");

  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const nonEmpty = lines.filter((l) => l.length > 0);

  const emails = Array.from(new Set(text.match(EMAIL_RE) || []));
  const phones = Array.from(new Set((text.match(PHONE_RE) || []).map((p) => p.trim()).filter((p) => p.replace(/\D/g, "").length >= 10)));
  const links = Array.from(new Set((text.match(LINK_RE) || []).map((l) => l.replace(/[.,;]$/, ""))));

  const sectionsDetected: string[] = [];
  for (const [name, re] of Object.entries(SECTION_HEADERS)) {
    if (nonEmpty.some((l) => re.test(l))) sectionsDetected.push(name);
  }

  // compromise entity extraction — organizations and person names.
  const doc = nlp(text);
  const organizations = Array.from(new Set(doc.organizations().out("array") as string[])).slice(0, 12);
  const people = doc.people().out("array") as string[];
  // ATS parsers take the name from the top of the document; prefer a person
  // entity found in the first few lines.
  const topLines = nonEmpty.slice(0, 3).join(" ");
  const nameGuess =
    people.find((p) => topLines.toLowerCase().includes(p.toLowerCase())) ||
    people[0] ||
    null;

  const datesFound = Array.from(new Set((text.match(DATE_RE) || []).map((d) => d.trim()))).slice(0, 20);

  const bulletLines = nonEmpty.filter((l) => BULLET_RE.test(l));
  const bulletCount = bulletLines.length;
  const quantifiedBullets = bulletLines.filter((l) => /\d/.test(l.replace(BULLET_RE, ""))).length;

  // Lines the parser can't classify: not a bullet, not a detected section
  // header, contains no recognizable contact/date entity. These are the lines
  // an ATS is most likely to mangle or silently drop.
  const classifiable = (l: string) =>
    BULLET_RE.test(l) ||
    Object.values(SECTION_HEADERS).some((re) => re.test(l)) ||
    EMAIL_RE.test(l) || LINK_RE.test(l) || DATE_RE.test(l) ||
    (nameGuess !== null && l.toLowerCase().includes(nameGuess.toLowerCase())) ||
    organizations.some((o) => l.toLowerCase().includes(o.toLowerCase()));
  const unclassifiedLines = nonEmpty.filter((l) => {
    // Reset lastIndex on the global regexes before reuse.
    EMAIL_RE.lastIndex = 0; LINK_RE.lastIndex = 0; DATE_RE.lastIndex = 0;
    return !classifiable(l);
  }).length;

  return {
    nameGuess,
    emails,
    phones,
    links,
    sectionsDetected,
    organizations,
    datesFound,
    bulletCount,
    quantifiedBullets,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    unclassifiedLines,
  };
}

/** Serialize a BuilderResume to plain text the same way an ATS text-extracts a DOCX. */
export function resumeToPlainText(resume: {
  contact: { fullName: string; title: string; email: string; phone: string; location: string; linkedIn: string; website: string };
  summary: string;
  experience: Array<{ company: string; title: string; location: string; startDate: string; endDate: string; bullets: string[] }>;
  education: Array<{ school: string; degree: string; field: string; startDate: string; endDate: string; details: string }>;
  skills: string[];
  certifications: string[];
}): string {
  const lines: string[] = [];
  lines.push(resume.contact.fullName);
  if (resume.contact.title) lines.push(resume.contact.title);
  lines.push([resume.contact.email, resume.contact.phone, resume.contact.location, resume.contact.linkedIn, resume.contact.website].filter(Boolean).join(" | "));
  if (resume.summary) {
    lines.push("", "SUMMARY", resume.summary);
  }
  if (resume.experience.length) {
    lines.push("", "EXPERIENCE");
    for (const job of resume.experience) {
      lines.push(`${job.title} — ${job.company}${job.location ? `, ${job.location}` : ""}`);
      if (job.startDate || job.endDate) lines.push(`${job.startDate} – ${job.endDate}`);
      for (const b of job.bullets) if (b.trim()) lines.push(`• ${b}`);
    }
  }
  if (resume.education.length) {
    lines.push("", "EDUCATION");
    for (const e of resume.education) {
      lines.push([e.degree, e.field].filter(Boolean).join(", ") + (e.school ? ` — ${e.school}` : ""));
      if (e.startDate || e.endDate) lines.push(`${e.startDate} – ${e.endDate}`);
      if (e.details) lines.push(e.details);
    }
  }
  if (resume.skills.length) lines.push("", "SKILLS", resume.skills.join(", "));
  if (resume.certifications.length) lines.push("", "CERTIFICATIONS", resume.certifications.join(", "));
  return lines.join("\n");
}
