/**
 * A DESCRIPTION IS NEVER CUT AT AN ABBREVIATION (B09, DESC-10).
 *
 * /guides/freelance-work-on-resume served the meta description "The structure
 * decision (one consolidated role vs." on 2026-11-07: 49 characters, a bracket
 * left open, because the bake's sentence splitter took every "vs." for the end
 * of a sentence. It also skipped text it could not match, so "the U.S.
 * Department of Labor" came out as "S. Department of Labor". fitSentence
 * (scripts/prerender-copy.mjs) now ends a sentence only where one ends, keeps
 * a prefix of the text, and never returns a cut with a bracket open. Measured
 * over the 360 real texts of more than 160 characters the site carries in
 * English (corpora/fit-sentence-descriptions-2026-11-08.json): 0 worse than
 * main, 13 of main's fragments repaired, 0 fragments.
 */
import { describe, expect, it } from "vitest";
import { GUIDES } from "@/data/guides";
import { VENDORS } from "@/data/ats-vendors";
import { bracketsBalanced, fitSentence, sentenceEnds } from "../../scripts/prerender-copy.mjs";

const LONG = "x".repeat(40);

describe("fitSentence", () => {
  it("keeps a text that fits whole", () => {
    expect(fitSentence("Short and whole.")).toBe("Short and whole.");
  });

  it("never ends at vs., e.g., i.e., U.S., Inc. or St.", () => {
    const t = `The structure decision (one consolidated role vs. a projects section) and the bullet formula for gigs. Then what to do when a project has no metrics, and why. ${LONG} ${LONG}.`;
    expect(fitSentence(t)).toBe("The structure decision (one consolidated role vs. a projects section) and the bullet formula for gigs.");
    for (const abbr of ["vs.", "e.g.", "i.e.", "U.S.", "Inc.", "St.", "etc."]) {
      const s = `Pick one ${abbr} then the next clause runs on long enough to pass the budget of the snippet ${LONG} ${LONG} ${LONG}. Then more.`;
      const out = fitSentence(s);
      expect(out.endsWith(abbr), `${abbr}: ${out}`).toBe(false);
    }
  });

  it("keeps a prefix of the text: 'the U.S. Department' is never 'S. Department'", () => {
    const t = "Take keywords from three sources: the posting; the U.S. Department of Labor's O*NET data for your occupation. Use each term once, attached to evidence, and never stuff them anywhere.";
    const out = fitSentence(t);
    expect(t.startsWith(out)).toBe(true);
    expect(out).toBe("Take keywords from three sources: the posting; the U.S. Department of Labor's O*NET data for your occupation.");
  });

  it("never returns a cut with a bracket left open", () => {
    const t = `A first sentence that fits (and opens a bracket. That runs on) well past the snippet budget ${LONG} ${LONG} ${LONG}.`;
    const out = fitSentence(t);
    expect(bracketsBalanced(out) || out === t).toBe(true);
    expect(out).not.toBe("A first sentence that fits (and opens a bracket.");
  });

  it("does not end a sentence before a lower-case word or a dash", () => {
    expect(sentenceEnds("Ask “authorised to work in the US?” — and more. Next one.")).toEqual(["Ask “authorised to work in the US?” — and more.".length, "Ask “authorised to work in the US?” — and more. Next one.".length]);
  });

  it("ends a sentence before a price", () => {
    expect(sentenceEnds("Not running right now. $5 once.")).toEqual(["Not running right now.".length, "Not running right now. $5 once.".length]);
  });

  it("leaves a text whose first sentence alone is too long to the clamp", () => {
    const t = `One sentence with no end inside the budget ${LONG} ${LONG} ${LONG} ${LONG}.`;
    expect(fitSentence(t)).toBe(t);
  });
});

describe("the descriptions the bake cuts this way", () => {
  it("every guide's description goes out as whole sentences with its brackets closed", () => {
    for (const g of Object.values(GUIDES)) {
      const out = fitSentence(g.description);
      expect(g.description.startsWith(out), g.slug).toBe(true);
      expect(bracketsBalanced(out), `${g.slug}: ${out}`).toBe(true);
      expect(out.length, `${g.slug}: ${out}`).toBeLessThanOrEqual(160);
      expect(out.length, `${g.slug}: ${out}`).toBeGreaterThanOrEqual(70);
    }
  });

  it("every ATS guide's first answer is cut at a sentence, never mid-word", () => {
    for (const [k, v] of Object.entries(VENDORS as Record<string, { behaviors: Array<{ a: string }> }>)) {
      const out = fitSentence(v.behaviors[0].a);
      expect(out === v.behaviors[0].a || /[.!?]["'”’)\]]*$/.test(out), `${k}: ${out}`).toBe(true);
    }
  });
});
