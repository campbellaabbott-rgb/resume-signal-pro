/**
 * THE INTERVIEW PREP SET, ASKED IN CALLS A MODEL CAN FINISH (S10-009).
 *
 * WHAT WAS WRONG. The paid prep set asked gemini-2.5-pro for 14 questions,
 * each with a full spoken STAR model answer, inside max_tokens 9,000; a Pro
 * member's set asked for 6 inside 4,000. Gemini 2.5's thinking counts against
 * that cap, and the largest legitimate reply measures about three times the
 * cap before any thinking (below), so the reply came back cut off, JSON.parse
 * failed, and the buyer got a 500 after one model with the rest of the chain
 * unused. A reply that was cut off or empty was never treated as a failure.
 *
 * NOW.
 *   - Every cap is the largest legitimate reply, measured from the fields the
 *     prompt asks for (QUESTION_FIELDS, PROFILE_FIELDS, TIPS_FIELDS,
 *     EVALUATION_FIELDS) by the Full Analysis's rules (analysis-parts.ts:
 *     a string with no stated length 220 characters, a sentence 260, an
 *     answer written to be spoken 2,000, an enum its longest value, a list
 *     with no stated count six items; JSON serialized; 3 characters a token
 *     with at most 10% headroom), plus THINKING_TOKENS. The 14-question set
 *     as one reply measures 27,466 tokens before thinking, so it is asked as
 *     two parallel calls of 7 (12,967 and 14,504 tokens), not started on
 *     flash: the paid product keeps gemini-2.5-pro writing it, and halving
 *     the reply keeps each call inside what pro's 80 s attempt and flash's
 *     45 s can write.
 *   - Each call walks the chain past a reply that is cut off, empty or not
 *     JSON (_shared/ai-fallback.ts callAIForUsableReply), with what is left
 *     of the 125 s budget: pro (80 s), then flash, then gpt-5-mini when the
 *     caller's chain starts on pro (THE CLOCK, below).
 *   - The two halves are merged into the object one call produced: the first
 *     half's profile and tips, all 14 questions in category order, ids 1-14.
 *
 * src/test/interview-prep-is-asked-in-calls-a-model-can-finish.test.ts
 * re-measures every cap from these tables and holds the tables to the text
 * the prompt sends.
 *
 * Pure: no imports.
 */

export const CATEGORY_ORDER = ["Behavioral", "Situational", "Technical", "Culture Fit"] as const;
export type PrepCategory = typeof CATEGORY_ORDER[number];

// The fields a reply carries and the longest each legitimately runs. A
// number is the characters of one string; [n, chars] is a list of n strings;
// "number" is a JSON number (measured as 100, as the Full Analysis does).
// Held to the prompt by the test: every field here appears in the format the
// call sends, and the format sends no field that is not here.
export const QUESTION_FIELDS = {
  id: "number",
  category: 11, // "Culture Fit"
  question: 220,
  whyAsked: 220,
  strongAnswerTips: [6, 220],
  redFlags: [6, 220],
  sampleOpener: 260, // "A strong first sentence"
  timeLimit: 9, // "2 minutes"
  difficulty: 6, // "Medium"
} as const;
/** The paid set's extra field: a full STAR answer as the candidate would say it in two minutes. */
export const MODEL_ANSWER_CHARS = 2_000;
export const PROFILE_FIELDS = { targetRole: 220, difficulty: 6, interviewType: 220 } as const;
export const TIPS_FIELDS = { beforeInterview: [6, 220], duringInterview: [6, 220], closingQuestions: [6, 220] } as const;
export const EVALUATION_FIELDS = {
  score: "number", // 1-10
  grade: 2, // "A+"
  strengths: [6, 220],
  improvements: [6, 220],
  revisedAnswer: 2_000, // a stronger version of a spoken answer
  recruiterReaction: 220,
} as const;

// The caps, measured by the test from the tables above (characters of the
// largest legitimate reply / 3, rounded up): the free and Pro set (6
// questions, profile and tips) 25,854 characters, 8,618 tokens, against the
// 4,000 it was given; the paid set's first half (7 questions with model
// answers, profile and tips) 43,511 characters, 14,504 tokens; its second
// half (7 questions) 38,900 characters, 12,967 tokens; an answer's score
// 4,995 characters, 1,665 tokens, against 1,500. The whole paid set as one
// reply would be 82,396 characters, 27,466 tokens: three times the 9,000 it
// was given, thinking not counted. Each call sends its cap plus
// THINKING_TOKENS.
export const SET_OUTPUT_TOKENS = 8_700;
export const PAID_FIRST_HALF_OUTPUT_TOKENS = 14_600;
export const PAID_SECOND_HALF_OUTPUT_TOKENS = 13_000;
export const EVALUATION_OUTPUT_TOKENS = 1_700;

/*
 * THE CLOCK (recheck of S10-009). The first build cut gemini-2.5-pro at 80 s
 * on the writing tools' quality chain (_shared/writing-allowance.ts: pro,
 * gpt-5, gpt-5-mini), which left gpt-5 45 s and gpt-5-mini nothing; the
 * second gave every model the chain's default 55 s, which cut pro inside its
 * measured tail and left gpt-5-mini 15 s. Neither gave any model a realistic
 * window for this reply: each paid half (14,504 and 12,967 tokens) is larger
 * than the Full Analysis core (10,400), whose pro tail measures 45-95 s, and
 * gpt-5 is a reasoning model as slow as pro. So a prep set whose chain
 * starts on pro (Pro members, past buyers, paid deliveries) walks the chain
 * the Full Analysis's split was built for: pro first and cut at 80 s, then
 * gemini-2.5-flash, several times faster on the same output, with the 45 s
 * left, then gpt-5-mini (prepChain). Pro stays the model that writes the
 * set; only the fallback changes. A free account's chain (flash, then
 * gpt-5-mini, 55 s each) is unchanged.
 */
export const PREP_PRO_MODEL = "google/gemini-2.5-pro";
export const PREP_PRO_ATTEMPT_MS = 80_000;
const PREP_FALLBACK_AFTER_PRO = ["google/gemini-2.5-flash", "openai/gpt-5-mini"] as const;

/** The models a prep call walks, and the first one's attempt, from the writing chain its caller is on. */
export function prepChain(writing: readonly string[]): { models: string[]; attemptTimeoutMs?: number } {
  if (writing[0] !== PREP_PRO_MODEL) return { models: [...writing] };
  return { models: [PREP_PRO_MODEL, ...PREP_FALLBACK_AFTER_PRO], attemptTimeoutMs: PREP_PRO_ATTEMPT_MS };
}

export interface PrepCall {
  label: "set" | "first half" | "second half";
  premium: boolean;
  counts: Readonly<Record<PrepCategory, number>>;
  /** The interviewProfile and interviewTips sections: in the set and the first half only. */
  profileAndTips: boolean;
  /** The angles this call covers (the paid halves split them so they do not ask the same thing). */
  angles?: string;
  /** What the other half writes, for a call that runs beside one. */
  parallelNote?: string;
  outputTokens: number;
}

const total = (c: Readonly<Record<PrepCategory, number>>) => CATEGORY_ORDER.reduce((n, k) => n + c[k], 0);

/**
 * The calls one prep set makes. The free and Pro set (6 questions) is one
 * call, as before. The paid set (14: 4 behavioral, 4 situational, 3
 * technical, 3 culture fit) is two parallel calls of 7 that together ask for
 * exactly those 14 and those angles.
 */
export function prepCalls(premium: boolean): PrepCall[] {
  if (!premium) {
    return [{ label: "set", premium, counts: { Behavioral: 2, Situational: 2, Technical: 1, "Culture Fit": 1 }, profileAndTips: true, outputTokens: SET_OUTPUT_TOKENS }];
  }
  return [
    {
      label: "first half",
      premium,
      counts: { Behavioral: 2, Situational: 2, Technical: 2, "Culture Fit": 1 },
      profileAndTips: true,
      angles: "leadership, conflict and technical depth",
      parallelNote: "A parallel call writes 7 other questions (2 behavioral, 2 situational, 1 technical, 2 culture fit) on failure, ambiguity and motivation; do not ask about those angles.",
      outputTokens: PAID_FIRST_HALF_OUTPUT_TOKENS,
    },
    {
      label: "second half",
      premium,
      counts: { Behavioral: 2, Situational: 2, Technical: 1, "Culture Fit": 2 },
      profileAndTips: false,
      angles: "failure, ambiguity and motivation",
      parallelNote: "A parallel call writes 7 other questions (2 behavioral, 2 situational, 2 technical, 1 culture fit) on leadership, conflict and technical depth, plus the interview profile and tips; do not ask about those angles.",
      outputTokens: PAID_SECOND_HALF_OUTPUT_TOKENS,
    },
  ];
}

const QUESTION_FIELD_TEXT = (premium: boolean) => premium
  ? `"strongAnswerTips": ["Tip for a strong answer", "Another tip"],
      "redFlags": ["What would make the interviewer concerned"],
      "sampleOpener": "A strong first sentence to start the answer",
      "modelAnswer": "A full, specific model answer using the STAR method (Situation, Task, Action, Result), written as if the candidate is speaking, referencing their ACTUAL resume experience — not a generic template",`
  : `"strongAnswerTips": ["Tip for a strong answer", "Another tip"],
      "redFlags": ["What would make the interviewer concerned"],
      "sampleOpener": "A strong first sentence to start the answer",`;

const QUESTION_TEXT = (premium: boolean) => `    {
      "id": 1,
      "category": "Behavioral" | "Technical" | "Situational" | "Culture Fit",
      "question": "The exact interview question",
      "whyAsked": "Why an interviewer asks this (what they're really evaluating)",
      ${QUESTION_FIELD_TEXT(premium)}
      "timeLimit": "2 minutes",
      "difficulty": "Easy" | "Medium" | "Hard"
    }`;

/** The OUTPUT FORMAT block a call sends: the set's exactly as it always was; the second half without the profile and tips. */
export function outputFormat(call: PrepCall): string {
  if (!call.profileAndTips) {
    return `{
  "questions": [
${QUESTION_TEXT(call.premium)}
  ]
}`;
  }
  return `{
  "interviewProfile": {
    "targetRole": "The role this interview is for",
    "difficulty": "Entry" | "Mid" | "Senior",
    "interviewType": "Behavioral + Technical mix based on role"
  },
  "questions": [
${QUESTION_TEXT(call.premium)}
  ],
  "interviewTips": {
    "beforeInterview": ["Tip 1", "Tip 2"],
    "duringInterview": ["Tip 1", "Tip 2"],
    "closingQuestions": ["Smart question to ask the interviewer", "Another one"]
  }
}`;
}

/** The output format an answer's score asks for, exactly as it always was. */
export const EVALUATION_FORMAT = `{
  "score": 1-10,
  "grade": "A+" | "A" | "B+" | "B" | "C" | "D" | "F",
  "strengths": ["What was good"],
  "improvements": ["What to improve"],
  "revisedAnswer": "A stronger version of their answer",
  "recruiterReaction": "What the interviewer would think hearing this"
}`;

/** The line that says how many questions of each kind this call writes. */
export function countsLine(call: PrepCall): string {
  const c = call.counts;
  const mix = `${c.Behavioral} behavioral, ${c.Situational} situational, ${c.Technical} technical, ${c["Culture Fit"]} culture fit`;
  if (call.label === "set") return `Generate exactly ${total(c)} questions: ${mix}.`;
  return `Generate exactly ${total(c)} questions: ${mix}. They are half of a 14-question mock-interview prep session; cover ${call.angles} in depth. ${call.parallelNote}`;
}

export type PrepReply = { questions: Array<Record<string, unknown>> } & Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A reply's JSON: the message as JSON, or the outermost {...} in it; null when neither parses. */
export function parseReplyJson(content: unknown): Record<string, unknown> | null {
  if (typeof content !== "string" || !content.trim()) return null;
  const attempt = (s: string) => {
    try {
      const v: unknown = JSON.parse(s);
      return isObject(v) ? v : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(content.trim());
  if (direct) return direct;
  const match = content.match(/\{[\s\S]*\}/);
  return match ? attempt(match[0]) : null;
}

const messageContent = (data: unknown): unknown =>
  (data as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content;

/** A call's reply when it can be delivered: JSON with at least one question, each question a question. Null otherwise. */
export function readPrepReply(data: unknown): PrepReply | null {
  const parsed = parseReplyJson(messageContent(data));
  if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
  const ok = parsed.questions.every((q) => isObject(q) && typeof q.question === "string" && q.question.trim().length > 0);
  return ok ? parsed as PrepReply : null;
}

/** An answer's score when it can be delivered: JSON with a score. Null otherwise. */
export function readEvaluation(data: unknown): Record<string, unknown> | null {
  const parsed = parseReplyJson(messageContent(data));
  return parsed && (typeof parsed.score === "number" || typeof parsed.score === "string") ? parsed : null;
}

/**
 * The object one call produced. The set is its reply as it came. The paid
 * halves become one set: the first half's every key (profile, tips), the
 * questions of both in category order (within a category, the first half's
 * first), numbered 1 to 14 so no two share an id.
 */
export function mergePrepSet(replies: PrepReply[]): PrepReply {
  if (replies.length === 1) return replies[0];
  const rank = (q: Record<string, unknown>) => {
    const i = CATEGORY_ORDER.findIndex((c) => c.toLowerCase() === String(q.category ?? "").trim().toLowerCase());
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  const questions = replies
    .flatMap((r) => r.questions)
    .map((q, at) => ({ q, at }))
    .sort((a, b) => rank(a.q) - rank(b.q) || a.at - b.at)
    .map(({ q }, i) => ({ ...q, id: i + 1 }));
  const merged: PrepReply = { ...replies[0], questions };
  for (const r of replies.slice(1)) {
    for (const k of ["interviewProfile", "interviewTips"]) if (merged[k] === undefined && r[k] !== undefined) merged[k] = r[k];
  }
  return merged;
}
