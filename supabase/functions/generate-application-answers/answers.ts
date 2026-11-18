/**
 * THE SCREENING ANSWERS' CAP, CHUNKS AND FACT CHECK.
 *
 * S12-148: the drafter took up to 25 questions, asked one 3,500-token call
 * for all of them, and returned at most 12, so a 15-question form came back
 * three answers short (and a long form's tail was cut by the token cap).
 * There is now ONE cap, ANSWER_CAP, for what is drafted and what is returned;
 * questions are drafted ANSWER_CHUNK at a time; anything past the cap is
 * named back to the person.
 *
 * S12-062: the drafter trusted the model's own supported:true, under a badge
 * that said "nothing invented", and a replayed draft invented a PhD and a
 * "$1.2M" figure marked supported. groundAnswers reads every answer against
 * the résumé (every sentence of an answer is about the candidate) and marks
 * one that names a credential, degree, figure, employer or title the résumé
 * does not state as needing the person, with a note saying what to fix.
 *
 * Pure: the Node tests import it directly.
 */
import { validateCandidateClaims, type ClaimContext } from "../_shared/resume-grounding.ts";

/** Questions drafted and returned for one form, at most. */
export const ANSWER_CAP = 20;
/** Questions per model call. */
export const ANSWER_CHUNK = 8;

/**
 * A SCREENING ANSWER IS A FEW SENTENCES, NOT A LETTER (S14X-090). Each
 * returned answer is at most ANSWER_MAX_CHARS, and a chunk's output cap is
 * sized from its questions (a reply's base plus TOKENS_PER_QUESTION each,
 * never past the flat 4,000 every chunk had), so one long question cannot
 * buy a 4,000-token essay.
 */
export const ANSWER_MAX_CHARS = 1_200;
export const TOKENS_PER_QUESTION = 350;
const REPLY_BASE_TOKENS = 1_500;
const CHUNK_TOKEN_CEILING = 4_000;

/** The output cap for one model call drafting `questions` answers. */
export function answersTokenCap(questions: number): number {
  return Math.min(CHUNK_TOKEN_CEILING, REPLY_BASE_TOKENS + Math.max(1, questions) * TOKENS_PER_QUESTION);
}

/** An answer cut to ANSWER_MAX_CHARS at its last whole sentence (or word) inside it. */
export function clipAnswer(text: string): string {
  if (text.length <= ANSWER_MAX_CHARS) return text;
  const head = text.slice(0, ANSWER_MAX_CHARS - 1);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= ANSWER_MAX_CHARS / 2) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(" ");
  return `${(space >= ANSWER_MAX_CHARS / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

/**
 * A question that asks for a whole document this drafter never writes: a
 * cover or motivation letter, a personal statement, an essay, a rewritten
 * résumé or a list of interview questions. Those are other tools with their
 * own allowance; the question is handed back for the person (class "writing").
 */
const ASKS_FOR_WRITING = new RegExp([
  String.raw`\bcover(?:ing)?[\s-]+letter`,
  String.raw`\b(?:motivation(?:al)?|application)\s+letter`,
  String.raw`\bletter\s+of\s+(?:motivation|interest|intent|application)`,
  String.raw`\bwrite\s+(?:me\s+|us\s+)?(?:a|an)\s+(?:short\s+|brief\s+|full\s+)?letter\b`,
  String.raw`\bpersonal\s+statement`,
  String.raw`\bstatement\s+of\s+(?:purpose|interest|intent)`,
  String.raw`\bessay\b`,
  String.raw`\b(?:re-?write|tailor|improve|update)\s+(?:my|your|the|this)\s+(?:r[eé]sum[eé]|cv)\b`,
  String.raw`\b(?:list|give|write|generate|prepare)\b[^.?!]{0,30}\binterview\s+questions\b`,
  String.raw`\blettre\s+de\s+motivation`,
  String.raw`\b(?:anschreiben|motivationsschreiben|bewerbungsschreiben|motivatiebrief|sollicitatiebrief)\b`,
  String.raw`\bcarta\s+de\s+(?:presentaci[oó]n|motivaci[oó]n|apresenta[cç][aã]o)`,
].join("|"), "i");

export function asksForWriting(label: string): boolean {
  return ASKS_FOR_WRITING.test(String(label ?? ""));
}

export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type DraftedAnswer = { question: string; answer: string; supported: boolean; note: string; anticipated?: boolean };

/** What the check found in one answer, as short phrases for the note. */
export function answerIssues(resumeText: string, answer: string, ctx: ClaimContext = {}): string[] {
  // An answer is the candidate speaking, often without an "I": every sentence
  // is read as first person, so every figure must be on the résumé (never only
  // in the posting).
  return validateCandidateClaims(resumeText, answer, { ...ctx, allFirstPerson: true });
}

/** The answers with every unsupported claim marked for the person. */
export function groundAnswers(resumeText: string, answers: readonly DraftedAnswer[], ctx: ClaimContext = {}): DraftedAnswer[] {
  return answers.map((a) => {
    const issues = answerIssues(resumeText, a.answer, ctx);
    if (issues.length === 0) return a;
    const what = issues.slice(0, 3).join("; ");
    const note = `Check this before you use it: ${what}. Remove it, or add it to your résumé if it is true.`;
    return { ...a, supported: false, note: a.supported || !a.note ? note : `${a.note} ${note}` };
  });
}
