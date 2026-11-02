/**
 * AN EMPLOYER'S EXTRA BLOCKLIST IS A LIST OF PHRASES, NEVER A PROGRAM (S13-073).
 *
 * The request body's redactionConfig.extraBlocklist (COMPLIANCE.md: an
 * employer may add to the redaction baseline, never shrink it) used to reach
 * _shared/redaction.ts verbatim, which compiles each entry with new RegExp and
 * runs it over the whole resume. A signed-in caller could send a
 * catastrophic-backtracking pattern ("(a+)+$", "(\w+\s?)+$") and spend the
 * isolate's CPU inside String.replace before any metering or model call: one
 * such entry took nearly ten seconds over a 40,000-character resume.
 *
 * So an entry is read as a literal phrase: trimmed, at most PHRASE_MAX
 * characters, every regular-expression character escaped, and matched case
 * insensitively. A literal pattern has nothing to backtrack over. At most
 * ENTRIES_MAX entries are read, a feature name keeps only [a-z0-9_] (it labels
 * the redaction mark), and anything malformed is dropped rather than failing
 * the evaluation. No page sends the field today; this is the bound on a
 * direct call.
 *
 * Plain TypeScript, no imports: the Node suite imports it directly.
 */

export const ENTRIES_MAX = 20;
export const PHRASE_MAX = 64;
const FEATURE_MAX = 40;

export type CallerBlocklist = { extraBlocklist?: Array<{ feature: string; pattern: string }> };

/** A phrase as a regular expression that matches exactly that text. */
export function literalPattern(phrase: string): string {
  return phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The body's redactionConfig as literal phrases, bounded; {} when it holds none. */
export function callerBlocklist(raw: unknown): CallerBlocklist {
  const list = raw && typeof raw === "object" ? (raw as { extraBlocklist?: unknown }).extraBlocklist : undefined;
  if (!Array.isArray(list)) return {};
  const out: Array<{ feature: string; pattern: string }> = [];
  for (const entry of list.slice(0, ENTRIES_MAX)) {
    if (!entry || typeof entry !== "object") continue;
    const { feature, pattern } = entry as { feature?: unknown; pattern?: unknown };
    if (typeof pattern !== "string" || typeof feature !== "string") continue;
    const phrase = pattern.trim().slice(0, PHRASE_MAX);
    const name = feature.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, FEATURE_MAX);
    if (!phrase || !name) continue;
    out.push({ feature: name, pattern: literalPattern(phrase) });
  }
  return out.length ? { extraBlocklist: out } : {};
}
