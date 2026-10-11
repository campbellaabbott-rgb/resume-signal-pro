/**
 * AN ALTERNATIVE REVIEW KEPT ITS AI SCORE AND RANK, AND AN OVERRIDE ERASED
 * THE AI'S (sweep S8-111, S8-041).
 *
 * Shortlist's ADA "Alt review" inserted a decision (its error ignored) and
 * showed a browser alert; the candidate kept its score, its place in the
 * score-ordered list and its score in the exports. And "Override score"
 * overwrote the AI score in place, so the record no longer said what the
 * model scored. The page now reads both from the append-only decision log:
 * a candidate routed to alternative review has no rank and shows no score,
 * and an override is shown beside an AI score that is never rewritten.
 */
import { describe, expect, it } from "vitest";
import { rankCandidates, reviewsFromDecisions } from "@/lib/shortlist-review";

const at = (m: number) => new Date(Date.UTC(2026, 9, 9, 10, m)).toISOString();

describe("the ranked list", () => {
  const candidates = [
    { id: "a", score: 91 },
    { id: "b", score: 64 },
    { id: "c", score: 77 },
    { id: "d", score: null },
  ];
  const reviews = reviewsFromDecisions([
    { candidate_id: "a", action: "alt_review_requested", new_value: null, created_at: at(1) },
    { candidate_id: "b", action: "override_score", new_value: "70", created_at: at(2) },
    { candidate_id: "b", action: "override_score", new_value: "85", created_at: at(3) },
    { candidate_id: "d", action: "alt_review_requested", new_value: null, created_at: at(4) },
  ]);

  it("leaves an alternative review unranked and unscored, after everyone ranked", () => {
    const ranked = rankCandidates(candidates, reviews);
    expect(ranked.map((c) => [c.id, c.rank, c.shownScore])).toEqual([
      ["b", 1, 85],
      ["c", 2, 77],
      ["a", null, null],
      ["d", null, null],
    ]);
  });

  it("shows the latest override and keeps the AI's own score", () => {
    const b = rankCandidates(candidates, reviews).find((c) => c.id === "b")!;
    expect(b.shownScore).toBe(85);
    expect(b.score).toBe(64);
  });
});
