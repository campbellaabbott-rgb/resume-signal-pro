/**
 * A LINE WRITTEN TO AN AI THAT NO PATTERN WAS WRITTEN FOR IS COUNTED
 * HONESTLY (MCP upgrade 3, W1 lane L4, second review of F5).
 *
 * WHAT WAS WRONG. The corpus test beside this one pins lines the patterns
 * were changed for, so it says how well the reader does on what it was
 * shown and nothing about what it was not. A second review wrote 40 fresh
 * lines to an AI after reading the patterns and the reader flagged 17.
 *
 * WHAT IS NOW TRUE. fixtures/posting-lines-to-an-ai-holdout-2026-11-17.json
 * holds 40 lines written to an AI and 40 that only mention one, written
 * before the reader was changed for that review and never used to change
 * a pattern. With the reader at c9f535e10 it flagged 19 and 20 came back in
 * postingExcerpt; now it flags 22, 16 come back, and 2 are left out
 * unquoted by the backstop. It flags none of the 40 mention-only lines and
 * keeps 39 of them, as before. Those are floors here: a change may do
 * better, never worse. Whatever reads addressedToAi must not take its
 * absence as proof that a posting holds no line written to an AI. Change no
 * pattern for a line in this file: write a new holdout instead.
 */
import { describe, expect, it } from "vitest";
import { isAddressedToAi, requirementsExcerptOf } from "../../supabase/functions/agent-mcp/posting-excerpt";
import HOLDOUT from "./fixtures/posting-lines-to-an-ai-holdout-2026-11-17.json";
import TUNED from "./fixtures/posting-lines-to-an-ai-2026-11-17.json";

type Counts = { flagged: number; inPostingExcerpt: number; leftOutUnquoted: number; mentionOnlyFlagged: number; mentionOnlyInPostingExcerpt: number };
const H = HOLDOUT as { addressed: string[]; mentionOnly: string[]; measured: { atC9f535e10: Counts; afterChange: Counts } };
const T = TUNED as {
  addressed: string[];
  mentionOnly: string[];
  fromReview: { addressed: string[]; mentionOnly: string[] };
  fromSecondReview: { addressed: string[]; mentionOnly: string[] };
};

const OWN = ["3+ years of experience in B2B marketing", "Strong written communication skills"];
const REQUIREMENTS = ["Requirements:", ...OWN.map((l) => `· ${l}`)].join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function measure(): Counts {
  const c: Counts = { flagged: 0, inPostingExcerpt: 0, leftOutUnquoted: 0, mentionOnlyFlagged: 0, mentionOnlyInPostingExcerpt: 0 };
  for (const line of H.addressed) {
    const r = requirementsExcerptOf(`${REQUIREMENTS}\n${line}`);
    const quote = r.addressedToAi?.[0];
    if (quote) expect(squash(line), line).toContain(squash(quote).replace(/^…|…$/g, ""));
    const leaked = r.postingExcerpt.some((l) => !OWN.includes(l));
    if (isAddressedToAi(line) && quote) c.flagged++;
    if (leaked) c.inPostingExcerpt++;
    if (!quote && !leaked) c.leftOutUnquoted++;
  }
  for (const line of H.mentionOnly) {
    const r = requirementsExcerptOf(`${REQUIREMENTS}\n${line}`);
    if (isAddressedToAi(line) || r.addressedToAi) c.mentionOnlyFlagged++;
    if (r.postingExcerpt.some((l) => !OWN.includes(l))) c.mentionOnlyInPostingExcerpt++;
  }
  return c;
}

describe("a line written to an AI that no pattern was written for is counted honestly", () => {
  it("holds 40 lines of each kind, none of them among the lines the patterns were changed for", () => {
    expect(H.addressed).toHaveLength(40);
    expect(H.mentionOnly).toHaveLength(40);
    expect(new Set(H.addressed).size).toBe(40);
    expect(new Set(H.mentionOnly).size).toBe(40);
    const tuned = new Set([
      ...T.addressed,
      ...T.mentionOnly,
      ...T.fromReview.addressed,
      ...T.fromReview.mentionOnly,
      ...T.fromSecondReview.addressed,
      ...T.fromSecondReview.mentionOnly,
    ]);
    expect([...H.addressed, ...H.mentionOnly].filter((l) => tuned.has(l))).toEqual([]);
  });

  it("does at least as well as was measured after the change, and the fixture says what that was", () => {
    const now = measure();
    const was = H.measured.afterChange;
    expect(was).toEqual({ flagged: 22, inPostingExcerpt: 16, leftOutUnquoted: 2, mentionOnlyFlagged: 0, mentionOnlyInPostingExcerpt: 39 });
    expect(now.flagged).toBeGreaterThanOrEqual(was.flagged);
    expect(now.inPostingExcerpt).toBeLessThanOrEqual(was.inPostingExcerpt);
    expect(now.mentionOnlyFlagged).toBe(0);
    expect(now.mentionOnlyInPostingExcerpt).toBeGreaterThanOrEqual(was.mentionOnlyInPostingExcerpt);
    expect(now.flagged + now.inPostingExcerpt + now.leftOutUnquoted).toBe(H.addressed.length);
    expect(H.measured.atC9f535e10).toEqual({ flagged: 19, inPostingExcerpt: 20, leftOutUnquoted: 1, mentionOnlyFlagged: 0, mentionOnlyInPostingExcerpt: 39 });
  });
});
