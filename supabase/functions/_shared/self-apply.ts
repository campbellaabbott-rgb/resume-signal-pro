/**
 * WHO ANSWERS EACH QUESTION WHEN A PERSON APPLIES WITH THEIR OWN AI.
 *
 * apply_myself (agent-mcp) hands the employer's real form to the person's AI.
 * This module decides, per question, who may write the answer -- and the rule
 * is DEFAULT-DENY, because the classifier's own default is `draftable`: every
 * label no rule catches lands there, and an adversarial review on 2026-10-11
 * ran it over the corpus and found "Have you ever been terminated from a job?",
 * "Why are you leaving your current role?", "Please list two professional
 * references" and "explain any gaps" all marked draftable. Handing those to an
 * AI as "draft this from the CV" invites an invented employment history in
 * the person's name.
 *
 * So the AI drafts ONLY when all of these hold:
 *   - the classifier calls the question draftable;
 *   - the control is free text (a select, radio, checkbox, yes/no, date,
 *     number, a question with options, or a type nobody recognises is the
 *     person's to choose -- a model picking an option is a model stating a
 *     fact);
 *   - and the question is about WORK DONE (asksAboutWorkDone: a résumé prompt
 *     naming the work, asking nothing of the person's own status), or it is
 *     one of a short list of motivation questions (why this role or employer,
 *     cover-letter text, "anything else you'd like us to know") that asks
 *     nothing of the person's status either;
 *   - and it is ONE ask: no word about leaving a job anywhere in it, and every
 *     sentence after the first a plain instruction ("Tell us in a few
 *     sentences.") rather than a second question or anything factual. The
 *     review of 9fe3bc0d found a motivation opening carrying "When could you
 *     start?", "Have you previously applied to us?" and "interested in
 *     leaving", and work-done prompts carrying a second ask, all drafted whole;
 *   - and the employer's hint under the label, read as part of the question,
 *     asks for nothing factual either (hintIsPlain, sweep S12-082).
 * Everything else goes to the person: identity fields to "your_details",
 * attachments to "your_documents", demographic questions (voluntary, never
 * drafted), consents (the AI never ticks one), factual questions with their
 * topic named, and every other draftable question with cvMayHelp so the
 * person knows the CV may help them write it.
 *
 * This is guidance the server gives the AI, written into each question; the
 * person checks everything and presses submit. Nothing here sends anything.
 *
 * Pure: no I/O, no clock. Imported by agent-mcp; replayed over the real-label
 * corpus by src/test/a-question-about-your-history-is-never-drafted-from-a-cv.
 */
import {
  CLAUSE_BREAK,
  FACTUAL,
  OWN_STATUS,
  PERSONAL_HISTORY,
  PERSON_ASKS,
  PERSON_FACT_NOUNS,
  PROTECTED_FACTUAL,
  asksAboutWorkDone,
  classifyQuestion,
  cleanQuestionLabel,
  topicOf,
  type QuestionClass,
} from "./application-questions.ts";
import { sponsorshipSense, type SponsorshipSense } from "./submission-packet.ts";
import { countriesIn } from "./work-countries.ts";

export type AnsweredBy = "you" | "your_details" | "your_documents" | "draft_from_your_cv";

export type SelfApplyInput = {
  label: string;
  required: boolean;
  type: string;
  options?: string[];
  hint?: string;
};

export type SelfApplyQuestion = SelfApplyInput & {
  n: number;
  answeredBy: AnsweredBy;
  /** For a factual question: what it asks about, so the AI can say why it is asking. */
  topic?: string;
  /** ISO-2 codes the label names, for a work-right or location question. */
  aboutCountry?: string[];
  sponsorshipSense?: SponsorshipSense;
  /** A demographic question: answering it is the person's choice, and so is declining. */
  voluntary?: true;
  /** The person answers, and their CV may help them do it. */
  cvMayHelp?: true;
};

/**
 * The motivation questions the AI may draft. Opening phrases only, so a
 * sentence that merely mentions the role later on is not one.
 */
export const MOTIVATION =
  /^\s*(?:please\s+)?(?:(?:tell|share\s+with)\s+us\s+)?(?:(?:in\s+(?:a\s+few|\d+)\s+(?:words|sentences)[,:]?\s+)?(?:why\s+(?:do\s+you\s+want|would\s+you\s+like|are\s+you\s+(?:interested|applying|excited)|have\s+you\s+applied|did\s+you\s+apply)\b|why\s+(?:this\s+(?:role|position|job|company|team|opportunity)|us|our\s+company)\b|what\s+(?:interests|excites|attracts|draws|motivates|appeals\s+to)\s+you\b|what\s+(?:makes|made)\s+you\s+(?:want\s+to\s+apply|interested|apply)\b)|(?:cover\s*-?\s*letter|motivation(?:al)?\s+(?:letter|statement)|letter\s+of\s+motivation)\b|(?:is\s+there\s+)?anything\s+else\s+(?:you['’]?d|you\s+would)\s+like\s+(?:us\s+)?to\s+know\b|additional\s+information\b)/i;

/** The opening a motivation question shares with a status question ("why are you ..."), removed before OWN_STATUS reads the rest. */
const MOTIVATION_OPENING = /^\s*(?:please\s+)?(?:(?:tell|share\s+with)\s+us\s+)?why\s+are\s+you\s+(?:interested|applying|excited)\b/i;

const FREE_TEXT_TYPE = /^(?:input_text|textarea|text|string|longtext|long_text|short_text|shorttext|paragraph|free_?text|multi_?line(?:_text)?|text_?area|text_?field|essay|open|open_question|long_?answer|short_?answer)$/i;

/** True for a control a person types prose into, judged by its type and the absence of options. */
export function isFreeText(type: string, options?: string[]): boolean {
  if (options && options.length) return false;
  return FREE_TEXT_TYPE.test(String(type ?? "").trim());
}

export { topicOf };

/** Sentences, each keeping its own closing mark, so a later one can be read for a question mark. */
const SENTENCES = /(?<=[?!;])\s+|(?<=[a-z]{3}\.)\s+(?=[A-Z])/;

/** Leaving a job is the person's history, whatever question it sits in. */
const LEAVING = /\b(?:leav\w*|left)\b/i;

/**
 * True when every sentence after the first is a plain instruction: not a
 * question, nothing the classifier keeps from a model, and no factual topic.
 */
export function laterSentencesArePlain(label: string): boolean {
  return label.split(SENTENCES).slice(1).every((s) =>
    !s.includes("?") && classifyQuestion(s, "textarea") === "draftable" && topicOf(s) === "other");
}

/**
 * THE EMPLOYER'S HINT IS PART OF THE QUESTION (sweep S12-082). A form's note
 * under a label ("Include your salary expectations and whether you need
 * sponsorship") was never read: the label alone decided, and the packet then
 * printed the hint under "Questions your AI may draft". A question is drafted
 * only when its hint, every sentence of it, is a plain instruction or a
 * question about the work: nothing a factual list keeps from a model, no
 * factual topic, nothing about the person's own status, no word about leaving.
 */
export function hintIsPlain(hint: string | undefined): boolean {
  const h = cleanQuestionLabel(hint ?? "");
  if (!h) return true;
  if (LEAVING.test(h) || PROTECTED_FACTUAL.test(h) || PERSONAL_HISTORY.test(h) || PERSON_ASKS.test(h) || PERSON_FACT_NOUNS.test(h)) return false;
  return h.split(SENTENCES).every((s) =>
    classifyQuestion(s, "textarea") === "draftable" && topicOf(s) === "other" && !OWN_STATUS.test(s));
}

/**
 * True when the label is one of the motivation questions and asks nothing of
 * the person's status, and no fact either: "Why do you want to work here, and
 * how soon you could start" carries a second, factual ask (review of wave 4
 * round 2), nor a later clause naming a topic (recheck).
 */
export function isMotivationQuestion(label: string): boolean {
  const opening = MOTIVATION.exec(label);
  if (!opening || PROTECTED_FACTUAL.test(label) || PERSONAL_HISTORY.test(label) || LEAVING.test(label)) return false;
  if (FACTUAL.test(label) || PERSON_ASKS.test(label) || PERSON_FACT_NOUNS.test(label)) return false;
  if (!laterSentencesArePlain(label)) return false;
  const [firstSentence] = label.slice(opening.index + opening[0].length).split(SENTENCES);
  const clauses = (firstSentence ?? "").split(CLAUSE_BREAK);
  for (let i = 2; i < clauses.length; i += 2) if (topicOf(clauses[i]) !== "other") return false;
  return !OWN_STATUS.test(label.replace(MOTIVATION_OPENING, " "));
}

const COVER_LETTER = /cover\s*-?\s*letter|motivation(?:al)?\s+letter|letter\s+of\s+motivation/i;

/** A control the person picks from: never an upload slot, whatever its label names. */
const CHOICE_TYPE = /select|radio|check|bool|yes_?no/i;

/** One question, with who answers it and why. */
export function whoAnswers(q: SelfApplyInput, n: number): SelfApplyQuestion {
  const label = cleanQuestionLabel(q.label);
  const type = String(q.type ?? "");
  const cls: QuestionClass = classifyQuestion(label, type);
  const base: SelfApplyQuestion = {
    n, label, required: !!q.required, type,
    ...(q.options && q.options.length ? { options: q.options } : {}),
    ...(q.hint ? { hint: q.hint } : {}),
    answeredBy: "you",
  };
  const free = isFreeText(type, q.options);
  const sense = sponsorshipSense(label);
  const countries = countriesIn(label);
  // The employer's hint is read with the label (S12-082): one that asks for
  // a fact keeps the question with the person, and says what it is about.
  const plainHint = hintIsPlain(q.hint);
  const hintTopic = plainHint ? "other" : topicOf(cleanQuestionLabel(q.hint ?? ""));
  const hintExtras = hintTopic !== "other" ? { topic: hintTopic } : {};
  const factualExtras = {
    topic: topicOf(label),
    ...(countries.length ? { aboutCountry: countries } : {}),
    ...(sense ? { sponsorshipSense: sense } : {}),
  };
  switch (cls) {
    case "identity":
      return { ...base, answeredBy: "your_details" };
    case "file":
      // A text box that wants the cover letter itself is motivation text the
      // AI may draft; an upload slot is the person's document.
      if (free && plainHint && COVER_LETTER.test(label) && isMotivationQuestion(label)) return { ...base, answeredBy: "draft_from_your_cv" };
      if (free && COVER_LETTER.test(label) && isMotivationQuestion(label)) return { ...base, answeredBy: "you", cvMayHelp: true, ...hintExtras };
      // A label naming the résumé on a control with options ("I affirm that my
      // application, resume ... are accurate": I agree) is the person's own
      // declaration, which the AI never ticks; only an upload slot is a document.
      if ((q.options && q.options.length) || CHOICE_TYPE.test(type)) return { ...base, answeredBy: "you" };
      return { ...base, answeredBy: "your_documents" };
    case "demographic":
      return { ...base, answeredBy: "you", voluntary: true };
    case "consent":
      return { ...base, answeredBy: "you" };
    case "factual":
      return { ...base, answeredBy: "you", ...factualExtras };
    case "draftable":
    default: {
      if (free && plainHint && !LEAVING.test(label) && laterSentencesArePlain(label) && (asksAboutWorkDone(label) || isMotivationQuestion(label))) {
        return { ...base, answeredBy: "draft_from_your_cv" };
      }
      // A sponsorship or country word in a question the classifier let through
      // is still the person's: say what it is about.
      return { ...base, answeredBy: "you", cvMayHelp: true, ...hintExtras, ...(sense ? { sponsorshipSense: sense } : {}), ...(countries.length ? { aboutCountry: countries } : {}) };
    }
  }
}

/** Every question of a form, numbered from 1 in the form's own order. */
export function whoAnswersEach(questions: readonly SelfApplyInput[]): SelfApplyQuestion[] {
  return questions.map((q, i) => whoAnswers(q, i + 1));
}
