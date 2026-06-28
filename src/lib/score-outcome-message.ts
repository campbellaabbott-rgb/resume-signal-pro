// Pure logic extracted out of ScoreHero.tsx so it's testable without
// importing the component (which pulls in the Supabase client and other
// React/component side effects just to reach two plain functions).
//
// Returns translation KEYS and a tier, not final English strings — the
// component is responsible for translating them via i18next (filterPhrase
// keys under scoreHero.filterPhrase.*, outcome keys under
// scoreHero.outcome.*, interpolating {{filterPhrase}}). Keeping the
// language-agnostic tier logic here and the actual translated strings in
// the locale files is what makes this work in all 9 supported languages
// instead of always rendering English regardless of the site's language.

export type FilterPhraseKey = "compliance" | "credential" | "recruiterScreen" | "volume" | "generic";
export type OutcomeTier = "strong" | "likely" | "atRisk" | "highRisk";
export type OutcomeStatus = "success" | "warning" | "destructive";

// Industry-specific framing of what "getting filtered" actually means in that
// field — the consequence differs by industry even though the underlying
// score and tier thresholds don't. Deliberately just a different noun phrase
// plugged into the same hedged sentence structure below, not a new computed
// number — there's no real data behind this, just better-targeted wording.
export const getFilterPhraseKey = (industry: string): FilterPhraseKey => {
  const i = industry.toLowerCase();
  if (/legal|finance|consulting|accounting|investment/.test(i)) return "compliance";
  if (/health|nursing|medical|pharma/.test(i)) return "credential";
  if (/creative|design|marketing/.test(i)) return "recruiterScreen";
  if (/sales/.test(i)) return "volume";
  return "generic";
};

// Reframes the existing, already-calibrated score into outcome language —
// deliberately hedged ("likely", "at risk") rather than a fabricated precise
// probability. The score itself doesn't change; this only translates the same
// tier thresholds RadialGauge already uses into what actually matters to the
// person reading it: will this get filtered out before a human sees it.
export const getOutcomeTier = (score: number): OutcomeTier => {
  if (score >= 85) return "strong";
  if (score >= 70) return "likely";
  if (score >= 50) return "atRisk";
  return "highRisk";
};

export const getOutcomeStatus = (tier: OutcomeTier): OutcomeStatus => {
  if (tier === "strong" || tier === "likely") return "success";
  if (tier === "atRisk") return "warning";
  return "destructive";
};

/**
 * Convenience combinator for callers that just want the tier/status/filter
 * key together, e.g. for passing to i18next's t() with interpolation.
 */
export const getOutcome = (
  score: number,
  industry: string
): { tier: OutcomeTier; status: OutcomeStatus; filterPhraseKey: FilterPhraseKey } => {
  const tier = getOutcomeTier(score);
  return { tier, status: getOutcomeStatus(tier), filterPhraseKey: getFilterPhraseKey(industry) };
};
