// FROZEN COPY of postingExcerptOf from supabase/functions/agent-mcp/posting-excerpt.ts
// as main held it at c7abaf00d (2026-11-17), which is what production serves,
// before MCP upgrade 3 lane L4 normalised its input. Read only by
// src/test/a-run-of-spaces-or-unclosed-tags-costs-the-apply-excerpt-linear-time-and-changes-no-line.test.ts,
// which asserts the shipped function picks the same lines as this one on
// every real text in the fixtures and on random markup. It imports the same
// shared break and textOf the shipped module does, so the comparison is of
// this function alone. Never imported by an edge function; never edited.
import { BOILERPLATE_SENTENCE, SENTENCE_BREAK } from "../../../supabase/functions/_shared/self-apply";
import { textOf } from "../../../supabase/functions/_shared/form-readers-extra";

/** A line about how to apply. */
const HOW_TO_APPLY_LINE = new RegExp(
  [
    String.raw`\bhow to apply\b`, String.raw`\bto apply\b`, String.raw`\bapply (?:by|via|online|through|with|before)\b`,
    String.raw`\bplease (?:submit|send|include|attach|upload|apply|provide)\b`, String.raw`\bcover letter\b`, String.raw`\bportfolio\b`,
    String.raw`\bwriting sample\b`, String.raw`\breferences\b`, String.raw`\bdeadline\b`, String.raw`\bclosing date\b`,
  ].join("|"),
  "i",
);

/** A line stating something the applicant must have or be. */
const REQUIREMENT_LINE = new RegExp(
  [
    String.raw`\brequire(?:d|s|ments?)\b`, String.raw`\bmust (?:have|be|hold|possess)\b`, String.raw`\bqualifications?\b`, String.raw`\bminimum\b`,
    String.raw`\bessential\b`, String.raw`\beligib`, String.raw`\bauthori[sz]ed to work\b`, String.raw`\bright to work\b`, String.raw`\bsponsor`,
    String.raw`\bvisa\b`, String.raw`\blicen[cs]e[ds]?\b`, String.raw`\bcertifi(?:ed|cation)\b`, String.raw`\bdegree\b`,
    String.raw`\byears? of (?:\w+ )?experience\b`, String.raw`\bbackground check\b`, String.raw`\bdrug (?:test|screen)`, String.raw`\bclearance\b`,
  ].join("|"),
  "i",
);

/** A heading that opens a requirements or how-to-apply section. */
const SECTION_HEAD = /^\W*(?:(?:key |minimum |basic |preferred |essential |required )?(?:requirements|qualifications|skills(?: and experience)?)|what (?:you(?:'ll| will)? (?:need|bring)|we(?:'re| are) looking for)|about you|who you are|must[- ]haves?|how to apply|to apply|application process)\b/i;

/** A short line ending in a colon, or a known heading: where one section stops and the next starts. */
const ANY_HEAD = /^.{0,60}:$|^\W*(?:responsibilities|duties|what you(?:'ll| will) do|about (?:us|the (?:role|company|team|job))|who we are|company description|job description|additional information|what we offer|our offer|benefits|perks|why (?:join|work)|the role|your role|compensation|salary|location)\b.{0,30}$/i;

const EXCERPT_LINE_MAX = 240;

/**
 * Up to eight of the posting's own lines on how to apply and what it requires
 * (at most three on applying), in the posting's order, boilerplate excluded:
 * the employer's words, so the AI can tell the person what is asked without a
 * second call when no form was read.
 */
export function postingExcerptOf(text: string): string[] {
  const segs = String(text ?? "").split(SENTENCE_BREAK).map((x) => textOf(x)).filter(Boolean);
  const apply: number[] = [];
  const req: number[] = [];
  let inSection = false;
  segs.forEach((seg, i) => {
    if (seg.length <= 70 && SECTION_HEAD.test(seg)) { inSection = true; return; }
    if (seg.length <= 70 && ANY_HEAD.test(seg)) { inSection = false; return; }
    if (seg.length < 20 || BOILERPLATE_SENTENCE.test(seg)) return;
    if (HOW_TO_APPLY_LINE.test(seg)) { if (apply.length < 3) apply.push(i); return; }
    if ((inSection || REQUIREMENT_LINE.test(seg)) && req.length < 6) req.push(i);
  });
  const seen = new Set<string>();
  return [...apply, ...req].sort((a, b) => a - b)
    .map((i) => (segs[i].length > EXCERPT_LINE_MAX ? `${segs[i].slice(0, EXCERPT_LINE_MAX - 1).trimEnd()}…` : segs[i]))
    .filter((x) => (seen.has(x) ? false : (seen.add(x), true)))
    .slice(0, 8);
}
