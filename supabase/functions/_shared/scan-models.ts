/**
 * THE FREE SCANNER'S MODEL CHAIN, IN THE ONE PLACE BOTH ITS CALLERS READ.
 *
 * free-keyword-scan walks these in order for every analysis call, and
 * test-ai-fallback tests exactly these (register L10-19: the diagnostic used
 * to test gpt-5 -> gemini-2.5-pro -> gpt-5-mini, a chain no production path
 * ran, and passed for a configuration nobody used).
 *
 * Flash-first: production logs showed both parallel calls bound by
 * gemini-2.5-pro's 45-95s tail latency on heavy structured output. Flash is
 * several times faster on the same workload, and the post-call safety nets
 * (rule-based score clamp, claim grounding, consistency validation, schema
 * coercion) were built precisely so model choice can't corrupt the report.
 * Pro stays second as the quality fallback.
 *
 * (free-keyword-scan-stream keeps its own hand-copied list, as it does for
 * every shared module.)
 */
export const SCAN_MODEL_CHAIN: readonly string[] = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-4o-mini",
];
