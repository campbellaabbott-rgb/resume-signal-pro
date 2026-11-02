/**
 * ONE SCORE, ONE SET OF BANDS (register S13-019).
 *
 * The free report graded the same ATS score on four band systems: the hero
 * coloured at 70/50 and labelled at 85/70/50, the AI-ATS card used 80/60, the
 * section banner 75/60 and the share image 75/55. So a 72 was a green "Good"
 * in the hero and amber "Gaps to close" two cards later, and a 55 was amber in
 * the hero and red in the card and the banner.
 *
 * Every surface that grades the ATS score reads this module. The cut points
 * are the scanner's own rubric (free-keyword-scan/index.ts: 85-100, 70-84,
 * 50-69, below 50), so the page never softens or sharpens a score the
 * scanner already placed. The two top bands share the green tone: "excellent"
 * and "good" differ in the label only, never in colour.
 */

export type ScoreBand = "excellent" | "good" | "fair" | "weak";
export type ScoreTone = "success" | "warning" | "destructive";

/** The lowest score in each band, from the scanner's rubric. */
export const SCORE_BAND_FLOORS = { excellent: 85, good: 70, fair: 50 } as const;

/** The band a 0-100 ATS score falls in. A score that is not a number is weak. */
export function scoreBand(score: number): ScoreBand {
  const s = Number.isFinite(score) ? score : 0;
  if (s >= SCORE_BAND_FLOORS.excellent) return "excellent";
  if (s >= SCORE_BAND_FLOORS.good) return "good";
  if (s >= SCORE_BAND_FLOORS.fair) return "fair";
  return "weak";
}

/** The colour tone of a band: the two top bands are both green. */
export function bandTone(band: ScoreBand): ScoreTone {
  if (band === "excellent" || band === "good") return "success";
  if (band === "fair") return "warning";
  return "destructive";
}

/** The colour tone of a score. */
export function scoreTone(score: number): ScoreTone {
  return bandTone(scoreBand(score));
}

/** Hex colours for surfaces drawn outside the theme (the share image). */
export const TONE_HEX: Record<ScoreTone, string> = {
  success: "#34d399",
  warning: "#fbbf24",
  destructive: "#f87171",
};
