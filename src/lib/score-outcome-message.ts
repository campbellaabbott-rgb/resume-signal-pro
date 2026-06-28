// Pure logic extracted out of ScoreHero.tsx so it's testable without
// importing the component (which pulls in the Supabase client and other
// React/component side effects just to reach two plain functions).

// Industry-specific framing of what "getting filtered" actually means in that
// field — the consequence differs by industry even though the underlying
// score and tier thresholds don't. Deliberately just a different noun phrase
// plugged into the same hedged sentence structure below, not a new computed
// number — there's no real data behind this, just better-targeted wording.
export const getFilterPhrase = (industry: string): string => {
  const i = industry.toLowerCase();
  if (/legal|finance|consulting|accounting|investment/.test(i)) return "rigid, compliance-style ATS screens";
  if (/health|nursing|medical|pharma/.test(i)) return "credential-focused applicant tracking systems";
  if (/creative|design|marketing/.test(i)) return "automated filters before a recruiter ever sees it";
  if (/sales/.test(i)) return "ATS systems screening hundreds of applicants per role";
  return "automated ATS screens";
};

// Reframes the existing, already-calibrated score into outcome language —
// deliberately hedged ("likely", "at risk") rather than a fabricated precise
// probability. The score itself doesn't change; this only translates the same
// tier thresholds RadialGauge already uses into what actually matters to the
// person reading it: will this get filtered out before a human sees it.
export const getOutcomeMessage = (
  score: number,
  industry: string
): { text: string; status: "success" | "warning" | "destructive" } => {
  const filterPhrase = getFilterPhrase(industry);
  if (score >= 85) return { text: `Strong candidate for clearing ${filterPhrase}`, status: "success" };
  if (score >= 70) return { text: `Likely to clear most ${filterPhrase}`, status: "success" };
  if (score >= 50) return { text: `At risk of being filtered by ${filterPhrase}`, status: "warning" };
  return { text: `High risk of being filtered by ${filterPhrase} before a human sees it`, status: "destructive" };
};
