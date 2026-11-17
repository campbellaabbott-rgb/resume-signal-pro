// @vitest-environment node
/**
 * A COVERAGE NOTE SPEAKS OF THE BOARD, NOT THIS SEARCH (MCP upgrade 3, W1 lane
 * L2: U3-05(d) as revised by M8, and by the lane review).
 *
 * WHAT WAS WRONG: c07 (2026-11-16) sent workMode remote and experience senior
 * and got filterCoverage {workMode: 0.262, experience: 0.388}: two filters
 * that quietly drop most of the board, said only as decimals an AI rarely
 * relays. The design's fix, "this search left out the other 74%", stated a
 * per-search fact from a board-wide figure: filterCoverage is the share of
 * the whole board that states the field (a cached stats row), the same defect
 * the 2026-09-26 board-controls audit removed from the site. The lane's first
 * build then:
 *   - told the AI to leave out one argument while another still dropped the
 *     same rows (workMode beside remote true; salaryMin beside hasStatedPay,
 *     where the board ignores includeUnstatedPay);
 *   - said "Leave remote out" when the board had read remote from a query
 *     word and no remote argument was sent;
 *   - printed the figures with no date, including the 2026-08-25 constants
 *     the board falls back to (and withholds filterCoverageAt for);
 *   - said "Pay is stated on" of the column the pay filter compares (a yearly
 *     figure, or a rate turned into one), which is not the share that states
 *     pay;
 *   - named argument keys as if they were posting fields ("maxYears is
 *     stated"), and said "about 50%" of a share under half.
 *
 * WHAT IS TRUE NOW (agent-mcp/search-notes.ts coverageNote): when a
 * row-selecting filter covers under half the board, one sentence says the
 * share is of all postings on the board, when the board counted it, that
 * postings which do not state the field are left out of this search, and
 * every argument sent that selects on it (or that the board read it from
 * words in the query). With no count time from the board it says nothing, as
 * the site does. At half or more it says nothing. A filter that selects
 * stated rows on purpose (hasStatedPay, vendor) gets no sentence, and pay
 * says nothing when includeUnstatedPay already brings those postings back.
 */
import { describe, expect, it } from "vitest";
import { normalizeFilters, filterViolations } from "../../supabase/functions/job-board/filters";
import { coverageNote } from "../../supabase/functions/agent-mcp/search-notes";

/** A board-wide share told as a fact about this search: the defect M8 named. */
const PER_SEARCH = /this search left out|left out the other|\d+% of (?:this|these) (?:search|results)|this search's|\bonly \d+% of (?:the )?results/i;
const AT = "2026-11-17T05:44:12.123Z";
const WHEN = "(counted 2026-11-17 05:44 UTC)";

describe("the sentence", () => {
  it("c07's workMode: the share is the board's, dated, and names the argument", () => {
    expect(coverageNote({ workMode: 0.262 }, { workMode: "remote" }, AT)).toBe(
      `A work mode is stated on about 26% of all postings on the board ${WHEN}; postings that do not state one are left out of this search. Leave workMode out to include them.`,
    );
  });

  it("c07 in full: both filters, in a fixed order", () => {
    expect(coverageNote({ workMode: 0.262, experience: 0.388 }, { workMode: "remote", experience: "senior" }, AT)).toBe(
      `A work mode is stated on about 26% of all postings on the board ${WHEN}; postings that do not state one are left out of this search. Leave workMode out to include them. ` +
        `An experience level is stated on about 39% of all postings on the board ${WHEN}; postings that do not state one are left out of this search. Leave experience out to include them.`,
    );
  });

  it("remote true is the same column, and names the argument the caller sent", () => {
    expect(coverageNote({ workMode: 0.262 }, { remote: true }, AT)).toBe(
      `A work mode is stated on about 26% of all postings on the board ${WHEN}; postings that do not state one are left out of this search. Leave remote out to include them.`,
    );
  });

  it("workMode and remote together: both are named, because either alone still drops the rows", () => {
    expect(coverageNote({ workMode: 0.262 }, { remote: true, workMode: "remote" }, AT)).toMatch(/Leave workMode and remote out to include them\.$/);
    // The board's own check: with workMode left out, remote true still drops a row that states no mode.
    const { applied } = normalizeFilters({ remote: true }, 25);
    expect(filterViolations([{ title: "Nurse", location: "Leeds", country: "GB", workMode: null, remote: null }], applied).some((v) => v.field === "remote")).toBe(true);
  });

  it("a work mode the board read from the query names the words, not an argument nobody sent", () => {
    expect(coverageNote({ workMode: 0.262 }, { query: "remote nurse" }, AT)).toMatch(/It was read from words in the query; take those words out to include them\.$/);
    expect(coverageNote({ workMode: 0.262 }, { query: "remote nurse" }, AT)).not.toMatch(/Leave remote out/);
  });

  it("pay speaks of the figure the pay filter compares, not of pay being stated", () => {
    expect(coverageNote({ salaryFloor: 0.31, salaryCeiling: 0.31 }, { salaryMin: 90000, salaryMax: 120000 }, AT)).toBe(
      `A pay figure the pay filter can compare (a yearly figure, or a rate turned into one) is on about 31% of all postings on the board ${WHEN}; postings without one are left out of this search. Leave salaryMin and salaryMax out, or send includeUnstatedPay: true, to include them.`,
    );
    expect(coverageNote({ salaryFloor: 0.31 }, { salaryMin: 90000 }, AT)).not.toMatch(/Pay is stated/);
  });

  it("pay names its widening argument, and says nothing once it is sent", () => {
    expect(coverageNote({ salaryFloor: 0.31 }, { salaryMin: 90000 }, AT)).toMatch(/Leave salaryMin out, or send includeUnstatedPay: true, to include them\.$/);
    expect(coverageNote({ salaryCeiling: 0.31 }, { salaryMax: 120000 }, AT)).toMatch(/Leave salaryMax out, or send includeUnstatedPay: true/);
    expect(coverageNote({ salaryFloor: 0.31 }, { salaryMin: 90000, includeUnstatedPay: true }, AT)).toBeUndefined();
  });

  it("beside hasStatedPay, includeUnstatedPay is never offered: the board ignores it there", () => {
    const note = coverageNote({ salaryFloor: 0.237, hasStatedPay: 0.283 }, { salaryMin: 50000, hasStatedPay: true }, AT)!;
    expect(note).toMatch(/Leave salaryMin out to include them\.$/);
    expect(note).not.toMatch(/includeUnstatedPay/);
    expect(coverageNote({ salaryFloor: 0.237 }, { salaryMin: 50000, hasStatedPay: true, includeUnstatedPay: true }, AT)).toMatch(/Leave salaryMin out to include them\.$/);
    const f = normalizeFilters({ salaryFloor: 50000, hasStatedPay: true, includeUnstatedPay: true }, 25);
    expect(f.applied.includeUnstatedPay).toBe(false);
    expect(f.ignored).toContain("includeUnstatedPay");
  });

  it("the other row-selecting fields say the field in plain words, and the argument only as the one to leave out", () => {
    const fields: Record<string, string> = {
      employmentType: "An employment type", department: "A department", maxYears: "A years-of-experience requirement",
      payBasis: "A pay basis (hourly or salaried)", country: "A country",
    };
    for (const [k, field] of Object.entries(fields)) {
      const note = coverageNote({ [k]: 0.2 }, { [k]: "x" }, AT)!;
      expect(note, k).toBe(`${field} is stated on about 20% of all postings on the board ${WHEN}; postings that do not state one are left out of this search. Leave ${k} out to include them.`);
      expect(note.startsWith(k), k).toBe(false);
    }
  });

  it("a share under one percent is said as under 1%, never as about 0%", () => {
    expect(coverageNote({ maxYears: 0.004 }, { maxYears: 2 }, AT)).toMatch(/^A years-of-experience requirement is stated on under 1% of all postings on the board/);
  });
});

describe("when it is said", () => {
  it("only under half the board, and a share under half never reads as half", () => {
    expect(coverageNote({ workMode: 0.5 }, { workMode: "remote" }, AT)).toBeUndefined();
    expect(coverageNote({ country: 0.93 }, { country: "DE" }, AT)).toBeUndefined();
    expect(coverageNote({ workMode: 0.499 }, { workMode: "remote" }, AT)).toMatch(/about 49%/);
    expect(coverageNote({ experience: 0.4999 }, { experience: "senior" }, AT)).toMatch(/about 49%/);
  });

  it("never without the board's count time: the board withholds it exactly when a figure may be an older pinned constant", () => {
    expect(coverageNote({ workMode: 0.262 }, { workMode: "remote" })).toBeUndefined();
    expect(coverageNote({ maxYears: 0.289, department: 0.405 }, { maxYears: 3, department: "x" }, undefined)).toBeUndefined();
    expect(coverageNote({ workMode: 0.262 }, { workMode: "remote" }, "")).toBeUndefined();
    expect(coverageNote({ workMode: 0.262 }, { workMode: "remote" }, "not a time")).toBeUndefined();
  });

  it("never for a filter that selects stated rows on purpose", () => {
    expect(coverageNote({ hasStatedPay: 0.31 }, { hasStatedPay: true }, AT)).toBeUndefined();
    expect(coverageNote({ vendor: 0.1 }, { vendor: "greenhouse" }, AT)).toBeUndefined();
  });

  it("never with no coverage figures, or figures that are not shares", () => {
    expect(coverageNote(undefined, {}, AT)).toBeUndefined();
    expect(coverageNote(null, {}, AT)).toBeUndefined();
    expect(coverageNote({}, {}, AT)).toBeUndefined();
    expect(coverageNote({ workMode: Number.NaN }, { workMode: "remote" }, AT)).toBeUndefined();
    expect(coverageNote({ workMode: 1.4 }, { workMode: "remote" }, AT)).toBeUndefined();
    expect(coverageNote({ workMode: "0.2" as unknown as number }, { workMode: "remote" }, AT)).toBeUndefined();
  });

  it("never states a board-wide share as a fact about this search, and every share carries its count time", () => {
    const all = { workMode: 0.262, experience: 0.388, salaryFloor: 0.31, employmentType: 0.2, department: 0.1, maxYears: 0.15, payBasis: 0.3, country: 0.4 };
    const args = { workMode: "remote", experience: "senior", salaryMin: 1, employmentType: "x", department: "x", maxYears: 1, payBasis: "hourly", country: "DE" };
    const note = coverageNote(all, args, AT)!;
    expect(note).not.toMatch(PER_SEARCH);
    const sentences = note.split(/(?<=\.) (?=[A-Z])/).filter((x) => /% of all postings/.test(x));
    expect(sentences).toHaveLength(8);
    for (const s of sentences) {
      expect(s).toMatch(/of all postings on the board \(counted 2026-11-17 05:44 UTC\)/);
      expect(s).not.toMatch(/^(?:workMode|experience|employmentType|department|maxYears|payBasis|country) is stated/);
    }
  });
});
