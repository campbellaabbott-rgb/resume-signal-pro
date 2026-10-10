/**
 * THE BIAS AUDIT COUNTED PENDING CANDIDATES AS NOT SELECTED, AND SPLIT ONE
 * GROUP INTO THREE (sweep S8-042).
 *
 * Shortlist's impact table is sold as LL144 audit preparation, under the
 * heading "Based on final HUMAN decisions". computeImpactAnalysis counted
 * every undecided candidate as not selected, and read demographics as free
 * text with only trim and lowercase, so "Female", "F" and "woman" were three
 * groups, each too small for the page to show its flag. And a scoring tool's
 * LL144 audit is a scoring-rate table (share above the median score), which
 * the view did not have.
 *
 * The register's own two cases, run against the real module, and the
 * scoring-rate table.
 */
import { describe, expect, it } from "vitest";
import { computeImpactAnalysis, raceCategory, sexCategory } from "../../supabase/functions/_shared/impact-ratio";

const people = (n: number, f: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => f(i));
/** A group by name, whatever its case. */
const grp = <G extends { group: string }>(list: G[], name: string) => list.find((g) => g.group.toLowerCase() === name.toLowerCase());

describe("selection rates read human decisions only", () => {
  it("a woman awaiting a decision is not counted as rejected", () => {
    // Men: 5 of 10 advanced. Women: 3 advanced, 2 rejected, 5 pending.
    const a = computeImpactAnalysis([
      ...people(10, (i) => ({ advanced: i < 5, sex: "male" })),
      ...people(3, () => ({ advanced: true, sex: "female" })),
      ...people(2, () => ({ advanced: false, sex: "female" })),
      ...people(5, () => ({ advanced: false, pending: true, sex: "female" })),
    ] as never);
    const women = grp(a.bySex, "female")!;
    const men = grp(a.bySex, "male")!;
    expect(women.total).toBe(5);
    expect(women.selectionRate).toBe(0.6);
    expect(men.selectionRate).toBe(0.5);
    expect(women.fourFifthsFlag).toBe(false);
    expect(men.fourFifthsFlag).toBe(false);
    expect(a.pendingExcluded).toBe(5);
  });
});

describe("one group is one group, however its members wrote it", () => {
  it("'Female', 'F' and 'woman' are one adequately-sampled group, and its disparity is flagged", () => {
    // Women under three spellings, 1 of 10 advanced in total; men 5 of 10.
    const spellings = ["Female", "F", "woman"];
    const a = computeImpactAnalysis([
      ...people(10, (i) => ({ advanced: i < 5, sex: "male" })),
      ...people(10, (i) => ({ advanced: i === 0, sex: spellings[i % 3] })),
    ] as never);
    expect(a.bySex.map((g) => g.group).sort()).toEqual(["Female", "Male"]);
    const women = a.bySex.find((g) => g.group === "Female")!;
    expect(women.total).toBe(10);
    expect(women.lowSample).toBe(false);
    expect(women.impactRatio).toBe(0.2);
    expect(women.fourFifthsFlag).toBe(true);
  });

  it("reads common spellings into EEO-1 categories, and counts what it cannot read apart", () => {
    expect(["M", "man", "Male"].map(sexCategory)).toEqual(["Male", "Male", "Male"]);
    expect(["Non-binary", "nonbinary"].map(sexCategory)).toEqual(["Another identity", "Another identity"]);
    expect(["Latina", "hispanic", "African American", "Caucasian", "multiracial"].map(raceCategory)).toEqual([
      "Hispanic or Latino", "Hispanic or Latino", "Black or African American", "White", "Two or more races",
    ]);
    const a = computeImpactAnalysis([{ advanced: true, sex: "prefer not to say" }, { advanced: false, sex: "female" }]);
    expect(a.unclassified).toBe(1);
    expect(a.bySex.map((g) => g.group)).toEqual(["Female"]);
  });
});

describe("the scoring-rate table", () => {
  it("is the share of each group scoring above the sample's median, with its impact ratio", () => {
    // Men score 60..69, women 50..59: the median is 59.5, so every man is
    // above it and no woman is.
    const a = computeImpactAnalysis([
      ...people(10, (i) => ({ advanced: false, pending: true, score: 60 + i, sex: "male" })),
      ...people(10, (i) => ({ advanced: false, pending: true, score: 50 + i, sex: "female" })),
    ] as never);
    expect(a.medianScore).toBe(59.5);
    const women = a.scoringBySex.find((g) => g.group === "Female")!;
    const men = a.scoringBySex.find((g) => g.group === "Male")!;
    expect(men.selectionRate).toBe(1);
    expect(women.selectionRate).toBe(0);
    expect(women.fourFifthsFlag).toBe(true);
    // Pending candidates have scores but no decisions: they feed only this table.
    expect(a.bySex).toEqual([]);
  });

  it("leaves out a candidate with no usable score (alternative review)", () => {
    const a = computeImpactAnalysis([
      ...people(5, (i) => ({ advanced: true, score: 70 + i, sex: "male" })),
      { advanced: true, score: null, sex: "female" },
    ] as never);
    expect(a.scoringBySex.map((g) => g.group)).toEqual(["Male"]);
  });
});
