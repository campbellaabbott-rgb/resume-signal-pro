/**
 * A PREVIEW'S REPLY: ITS MEASURED CAP AND WHAT COUNTS AS ONE (S13-065).
 *
 * The preview asked gemini-2.5-flash for its four fields inside max_tokens
 * 600. Flash's thinking counts against that cap, so a reply could come back
 * cut off or empty, and an empty or unparsable reply was a 500 from the first
 * model with the rest of the chain unused.
 *
 * NOW the cap is the largest legitimate reply, measured from the fields the
 * prompt asks for by the Full Analysis's rules (analysis-parts.ts: a label
 * 60 characters, "2-3 sentences" 450, a bullet 260, anything else 220;
 * serialized; 3 characters a token with at most 10% headroom): heading (a
 * 3-6 word label) 60, body 450 (the longest any product's task asks for is
 * 2-3 sentences: the cover letter's opening paragraph, the recruiter
 * summary, the new-grad verdict), before (the original bullet) 260, note
 * (one short line) 220: 1,036 characters, 346 tokens, so 380, plus the
 * model's thinking (THINKING_TOKENS). A reply cut off at that cap, empty, not
 * JSON or with no body goes to the next model (callAIForUsableReply).
 *
 * src/test/a-preview-and-the-diagnostic-count-only-a-reply-that-was-written.test.ts
 * re-measures the cap from PREVIEW_FIELDS and holds the fields to
 * PREVIEW_FORMAT, the JSON the prompt asks for.
 *
 * Pure: no imports.
 */

/** The longest each field legitimately runs, in characters. */
export const PREVIEW_FIELDS = { heading: 60, body: 450, before: 260, note: 220 } as const;
export const PREVIEW_OUTPUT_TOKENS = 380;

/** The JSON the prompt asks for, exactly as it always did. */
export const PREVIEW_FORMAT = `{
  "heading": "a short 3-6 word label for this sample",
  "body": "the sample itself — concise, high-quality, ready to use",
  "before": "the original weak version (ONLY for rewrite/tailoring tasks; otherwise null)",
  "note": "one short supporting line if the task asks for one; otherwise null"
}`;

export interface PreviewReply {
  heading: string | null;
  body: string;
  before: string | null;
  note: string | null;
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
};

/**
 * A gateway reply's preview when it can be shown: the message as JSON (or the
 * outermost {...} in it) with a non-empty body. Null otherwise, so the next
 * model is asked.
 */
export function readPreviewReply(data: unknown): PreviewReply | null {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  const body = clean(p.body);
  if (!body) return null;
  return { heading: clean(p.heading), body, before: clean(p.before), note: clean(p.note) };
}
