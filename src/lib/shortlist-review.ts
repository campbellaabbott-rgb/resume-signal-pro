// What Shortlist's append-only decision log says about each candidate beyond
// its status (sweep S8-041, S8-111). A reviewer's override is a decision, not
// a rewrite of the AI score, and a candidate routed to alternative review
// (ADA / accommodation) leaves the ranking and shows no score.

/** What the decision log says about a candidate beyond its status (sweep S8-041, S8-111). */
export interface CandidateReview {
  /** The latest reviewer override; the AI score itself is never rewritten. */
  overrideScore: number | null;
  /** Routed to non-automated review: no score, no rank, marked in exports. */
  altReview: boolean;
}

/** Each candidate's latest override and alternative-review request, from the append-only log. */
export function reviewsFromDecisions(rows: Array<{ candidate_id: string; action: string; new_value: string | null; created_at: string }>): Record<string, CandidateReview> {
  const out: Record<string, CandidateReview> = {};
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const d of sorted) {
    const r = (out[d.candidate_id] ??= { overrideScore: null, altReview: false });
    if (d.action === "alt_review_requested") r.altReview = true;
    if (d.action === "override_score") {
      const n = Number(d.new_value);
      if (d.new_value != null && Number.isFinite(n)) r.overrideScore = n;
    }
  }
  return out;
}

/** Scored candidates by the reviewer's score where there is one, else the AI's; alternative reviews last, unranked. */
export function rankCandidates<T extends { id: string; score: number | null }>(candidates: T[], reviews: Record<string, CandidateReview>): Array<T & { rank: number | null; shownScore: number | null }> {
  const alt = (c: T) => reviews[c.id]?.altReview === true;
  const shown = (c: T) => reviews[c.id]?.overrideScore ?? c.score;
  const scored = candidates.filter(c => !alt(c)).sort((a, b) => (shown(b) ?? -1) - (shown(a) ?? -1));
  return [
    ...scored.map((c, i) => ({ ...c, rank: i + 1, shownScore: shown(c) })),
    ...candidates.filter(alt).map(c => ({ ...c, rank: null, shownScore: null })),
  ];
}
