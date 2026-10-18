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
