// @vitest-environment node
/**
 * A COVERAGE NOTE SPEAKS OF THE BOARD, NOT THIS SEARCH (MCP upgrade 3, W1 lane
 * L2: U3-05(d) as revised by M8).
 *
 * WHAT WAS WRONG: c07 (2026-11-16) sent workMode remote and experience senior
 * and got filterCoverage {workMode: 0.262, experience: 0.388}: two filters
 * that quietly drop most of the board, said only as decimals an AI rarely
 * relays. The design's fix, "this search left out the other 74%", stated a
 * per-search fact from a board-wide figure: filterCoverage is the share of
 * the whole board that states the field (a cached stats row), the same defect
 * the 2026-09-26 board-controls audit removed from the site.
 *
 * WHAT IS TRUE NOW (agent-mcp/search-notes.ts coverageNote): when a
 * row-selecting filter covers under half the board, one sentence says the
 * share is of all postings on the board, that postings which do not state the
 * field are left out of this search, and how to include them. At half or
 * more it says nothing. A filter that selects stated rows on purpose
 * (hasStatedPay, vendor) gets no sentence, and salary says nothing when
 * includeUnstatedPay already brings the unstated rows back.
 */
import { describe, expect, it } from "vitest";
import { coverageNote } from "../../supabase/functions/agent-mcp/search-notes";

/** A board-wide share told as a fact about this search: the defect M8 named. */
const PER_SEARCH = /this search left out|left out the other|\d+% of (?:this|these) (?:search|results)|this search's|\bonly \d+% of (?:the )?results/i;

describe("the sentence", () => {
  it("c07's workMode, exactly as the critique worded it", () => {
    expect(coverageNote({ workMode: 0.262 }, { workMode: "remote" })).toBe(
      "workMode is stated on about 26% of all postings on the board; postings that do not state it are left out of this search. Leave it out to include them.",
    );
  });

  it("c07 in full: both filters, in a fixed order", () => {
    expect(coverageNote({ workMode: 0.262, experience: 0.388 }, { workMode: "remote", experience: "senior" })).toBe(
      "workMode is stated on about 26% of all postings on the board; postings that do not state it are left out of this search. Leave it out to include them. " +
        "experience is stated on about 39% of all postings on the board; postings that do not state it are left out of this search. Leave it out to include them.",
    );
  });

  it("remote true is the same column, and names the argument the caller sent", () => {
    expect(coverageNote({ workMode: 0.262 }, { remote: true })).toBe(
      "A work mode is stated on about 26% of all postings on the board; postings that do not state one are left out of this search. Leave remote out to include them.",
    );
  });

  it("a floor and a ceiling together are one sentence about pay", () => {
    expect(coverageNote({ salaryFloor: 0.31, salaryCeiling: 0.31 }, { salaryMin: 90000, salaryMax: 120000 })).toBe(
      "Pay is stated on about 31% of all postings on the board; postings that do not state it are left out of this search. Leave salaryMin and salaryMax out, or send includeUnstatedPay: true, to include them.",
    );
  });

  it("pay names its widening argument, and says nothing once it is sent", () => {
    expect(coverageNote({ salaryFloor: 0.31 }, { salaryMin: 90000 })).toBe(
      "Pay is stated on about 31% of all postings on the board; postings that do not state it are left out of this search. Leave salaryMin out, or send includeUnstatedPay: true, to include them.",
    );
    expect(coverageNote({ salaryCeiling: 0.31 }, { salaryMax: 120000 })).toMatch(/Leave salaryMax out, or send includeUnstatedPay: true/);
    expect(coverageNote({ salaryFloor: 0.31 }, { salaryMin: 90000, includeUnstatedPay: true })).toBeUndefined();
  });

  it("the other row-selecting fields say the same, under their own names", () => {
    for (const k of ["employmentType", "department", "maxYears", "payBasis", "country"]) {
      expect(coverageNote({ [k]: 0.2 }, { [k]: "x" }), k).toBe(
        `${k} is stated on about 20% of all postings on the board; postings that do not state it are left out of this search. Leave it out to include them.`,
      );
    }
  });

  it("a share under one percent is said as under 1%, never as about 0%", () => {
    expect(coverageNote({ maxYears: 0.004 }, { maxYears: 2 })).toMatch(/^maxYears is stated on under 1% of all postings on the board;/);
  });
});

describe("when it is said", () => {
  it("only under half the board", () => {
    expect(coverageNote({ workMode: 0.5 }, { workMode: "remote" })).toBeUndefined();
    expect(coverageNote({ country: 0.93 }, { country: "DE" })).toBeUndefined();
    expect(coverageNote({ workMode: 0.499 }, { workMode: "remote" })).toMatch(/about 50%/);
  });

  it("never for a filter that selects stated rows on purpose", () => {
    expect(coverageNote({ hasStatedPay: 0.31 }, { hasStatedPay: true })).toBeUndefined();
    expect(coverageNote({ vendor: 0.1 }, { vendor: "greenhouse" })).toBeUndefined();
  });

  it("never with no coverage figures, or figures that are not shares", () => {
    expect(coverageNote(undefined, {})).toBeUndefined();
    expect(coverageNote(null, {})).toBeUndefined();
    expect(coverageNote({}, {})).toBeUndefined();
    expect(coverageNote({ workMode: Number.NaN }, { workMode: "remote" })).toBeUndefined();
    expect(coverageNote({ workMode: 1.4 }, { workMode: "remote" })).toBeUndefined();
    expect(coverageNote({ workMode: "0.2" as unknown as number }, { workMode: "remote" })).toBeUndefined();
  });

  it("never states a board-wide share as a fact about this search", () => {
    const all = { workMode: 0.262, experience: 0.388, salaryFloor: 0.31, employmentType: 0.2, department: 0.1, maxYears: 0.15, payBasis: 0.3, country: 0.4 };
    const args = { workMode: "remote", experience: "senior", salaryMin: 1, employmentType: "x", department: "x", maxYears: 1, payBasis: "hourly", country: "DE" };
    const note = coverageNote(all, args)!;
    expect(note).not.toMatch(PER_SEARCH);
    for (const s of note.split(/(?<=\.) (?=[A-Za-z])/).filter((x) => /stated on/.test(x))) expect(s).toMatch(/of all postings on the board/);
  });
});
