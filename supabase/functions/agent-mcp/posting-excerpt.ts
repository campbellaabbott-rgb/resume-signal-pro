/**
 * THE POSTING'S OWN LINES ON APPLYING AND REQUIREMENTS (connect W4,
 * APPLY-1107-06), for apply_myself when no form was read. Kept beside the
 * connector, not in _shared, because only agent-mcp reads it and every byte in
 * _shared counts toward job-board's deploy upload (src/test/the-upload-tally-
 * counts-every-shared-file-and-every-comment.test.ts).
 */
import { BOILERPLATE_SENTENCE, SENTENCE_BREAK } from "../_shared/self-apply.ts";
import { textOf } from "../_shared/form-readers-extra.ts";

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
