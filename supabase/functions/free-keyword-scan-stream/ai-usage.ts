/**
 * ONE LINE PER MODEL REPLY, NUMBERS ONLY (cost audit 2026-11-08, Do first #11).
 *
 * No function read the gateway's usage object, so every AI cost in that audit
 * was an estimate from prompt sizes, and the changes it proposes (the
 * heartbeat's hourly scan, a split prompt, a smaller thinking budget) could
 * not be checked before and after. Each reply a function parses itself now
 * prints one line, the same everywhere:
 *
 *   [AI-USAGE] context=<function or chain> model=<model id> prompt_tokens=<n>
 *   completion_tokens=<n> cached_tokens=<n or -> reasoning_tokens=<n or ->
 *   finish_reason=<value or ->
 *
 * (one line, single spaces). It carries numbers and identifiers only: never a
 * prompt, a reply, an address or a user id. A count the gateway did not send
 * prints '-', never 0, and anything where an identifier belongs that is not
 * one (a sentence in finish_reason) prints '-' too.
 *
 * The same file sits in scan-heartbeat, free-keyword-scan and
 * free-keyword-scan-stream, byte for byte (each function deploys its own
 * folder; src/test/every-model-reply-prints-its-token-counts-and-no-text
 * keeps the three copies identical).
 */

/** The counts of one reply. null: the gateway did not report it. */
export interface AiUsage {
  prompt: number | null;
  completion: number | null;
  cached: number | null;
  reasoning: number | null;
  finish: string | null;
}

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

const ident = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z0-9._:/-]{1,80}$/.test(v) ? v : null;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * The counts in a chat-completions reply (or a streamed reply's last usage
 * chunk). OpenAI's shape puts cached tokens under prompt_tokens_details and
 * reasoning tokens under completion_tokens_details; a flat field of the same
 * name is read when the nested one is absent.
 */
export function aiUsageOf(reply: unknown): AiUsage {
  const r = obj(reply);
  const u = obj(r.usage);
  const choices = Array.isArray(r.choices) ? r.choices : [];
  return {
    prompt: count(u.prompt_tokens),
    completion: count(u.completion_tokens),
    cached: count(obj(u.prompt_tokens_details).cached_tokens) ?? count(u.cached_tokens),
    reasoning: count(obj(u.completion_tokens_details).reasoning_tokens) ?? count(u.reasoning_tokens),
    finish: ident(obj(choices[0]).finish_reason),
  };
}

/** The [AI-USAGE] line for one reply. */
export function aiUsageLine(context: string, model: string, reply: unknown): string {
  const u = aiUsageOf(reply);
  const n = (v: number | null) => (v === null ? "-" : String(v));
  return `[AI-USAGE] context=${ident(context) ?? "-"} model=${ident(model) ?? "-"} prompt_tokens=${n(u.prompt)} completion_tokens=${n(u.completion)} cached_tokens=${n(u.cached)} reasoning_tokens=${n(u.reasoning)} finish_reason=${u.finish ?? "-"}`;
}
