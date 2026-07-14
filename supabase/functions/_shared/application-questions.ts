// Classifier for job-application form questions — the honesty core of the apply
// agent. It decides which questions an AI may draft an answer for (substantive,
// resume-grounded free-text) and which it must NEVER touch:
//   - identity/contact  → autofilled from the user's profile, not written by AI
//   - file uploads       → the resume/cover-letter attachments
//   - demographic/EEO    → the candidate's own to disclose; auto-answering is
//                          inappropriate and can be non-compliant
//   - factual/status     → work authorization, sponsorship, salary, start date,
//                          relocation — NOT derivable from a resume, so an AI would
//                          have to guess. We refuse; the user fills these in.
// Only "draftable" questions get a grounded AI draft. Pure + unit-tested.

export type QuestionClass = "identity" | "file" | "demographic" | "factual" | "draftable";

export interface AppQuestion {
  label: string;
  required?: boolean;
  /** normalized field type, e.g. "input_text" | "textarea" | "input_file" */
  type?: string;
}

const IDENTITY = /\b(first\s*name|last\s*name|full\s*name|preferred\s*name|middle\s*name|e-?mail|phone|mobile|street|address|city|state|province|zip|postal|country|linkedin|github|portfolio|personal\s*website|website|twitter|url)\b/i;
const FILE = /\b(resume|résumé|cv|cover\s*letter|upload|attach|transcript|portfolio\s*file)\b/i;
// Protected/voluntary self-ID — never auto-answered. Stems match suffixed forms
// ("disability", "pronouns") so no trailing word-boundary can slip them through.
const DEMOGRAPHIC = /\b(gender|sex|race|ethnic\w*|hispanic|latin[ox]|veteran|disab\w*|sexual\s+orientation|pronoun\w*|date\s+of\s+birth|marital|religio\w*)/i;
// Facts a resume can't establish — must come from the candidate.
const FACTUAL = /(authoriz\w*\s*to\s*work|work\s*authoriz|require\s*(?:visa\s*)?sponsor|sponsorship|need\s*sponsor|require\s*a\s*visa|salary|compensation|desired\s*pay|expected\s*(?:pay|salary|compensation)|pay\s*expectation|notice\s*period|start\s*date|available\s*to\s*start|when\s*can\s*you\s*start|willing\s*to\s*relocate|relocat|able\s*to\s*commute|are\s*you\s*(?:at\s*least\s*)?18|legally\s*(?:eligible|authorized)|do\s*you\s*now\s*or\s*in\s*the\s*future)/i;

export function classifyQuestion(label: string, fieldType?: string): QuestionClass {
  const l = label ?? "";
  const t = (fieldType ?? "").toLowerCase();
  // Protected self-ID wins over everything — even if phrased oddly.
  if (DEMOGRAPHIC.test(l)) return "demographic";
  if (t.includes("file") || FILE.test(l)) return "file";
  if (IDENTITY.test(l)) return "identity";
  if (FACTUAL.test(l)) return "factual";
  return "draftable";
}

/** The subset an AI should draft grounded answers for (everything else stays with
 *  the candidate or is autofilled). */
export function selectDraftable(questions: readonly AppQuestion[]): AppQuestion[] {
  return questions.filter((q) => classifyQuestion(q.label ?? "", q.type) === "draftable");
}
