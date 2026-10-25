// @vitest-environment node
/**
 * A ONE-WORD NEGATION LEAVES THE PLACE AND THE MODE; A NEGATED PLACE IS NOT
 * SEARCHED FOR (wave 4 round 2 review, search lens; S12-172 made true, and
 * since the descope of 2026-10-25 the negation itself is origin/main's).
 *
 * WHAT WAS WRONG.
 *   - Wave 4's first S12-017 fix made "not" swallow everything after it, up
 *     to the next operator, before the place and intent lift ran: "nurse not
 *     night shift in Boston" excluded "night shift in boston" (Boston lost),
 *     and "software engineer not senior remote" lost the remote filter.
 *   - S12-172 stopped lifting "not in Texas" into the location filter, but the
 *     words stayed: the search fell through to nurse AND texas, so "nurse jobs
 *     not in Texas" served only Texas nurses.
 *
 * WHAT HOLDS NOW. The exclusion is origin/main's again (the descope test and
 * the corpus test prove it): "not" takes exactly one word, so the place and
 * the mode after it stay, and through the shipped handler "nurse not night
 * shift in Boston" excludes "night" (main's answer; S12-017, the phrase, is
 * its own search project) and still lifts Boston; "software engineer not
 * senior remote" filters remote and excludes "senior". "nurse jobs not in
 * Texas" drops "not in Texas" from the words, lifts no location, and names
 * "placeExclusion" in ignoredFilters, which the page words as a filter it
 * could not apply.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { splitExclusions } from "../../supabase/functions/job-board/search-routing";
import { negatedTrailingPlace } from "../../supabase/functions/job-board/query-place";
import * as ORIGIN_MAIN from "./fixtures/w4b-fix3-search/origin-main-exclusion";
import { bootBoardList, row, type BoardList } from "./helpers/board-list";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

describe("the word after 'not' is the only word excluded, so the place and the mode stay", () => {
  it.each([
    ["nurse not night shift in Boston", "nurse shift in Boston", ["night"]],
    ["software engineer not senior remote", "software engineer remote", ["senior"]],
    ["driver not cdl texas", "driver texas", ["cdl"]],
    ["teacher not substitute part time", "teacher part time", ["substitute"]],
    ["warehouse not forklift near Dallas", "warehouse near Dallas", ["forklift"]],
  ])("%s", (q, positive, excluded) => {
    expect(splitExclusions(q)).toEqual({ positive, excluded });
    expect(splitExclusions(q), "origin/main's answer").toEqual(ORIGIN_MAIN.splitExclusions(q));
  });

  it("controls: a stopword still vetoes, and an exclusion that would eat the query is left alone", () => {
    expect(splitExclusions("director not for profit")).toEqual({ positive: "director not for profit", excluded: [] });
    expect(splitExclusions("not manager")).toEqual({ positive: "not manager", excluded: [] });
  });
});

describe("a negated place is dropped from the words", () => {
  it("names the head without the negation and the place", () => {
    expect(negatedTrailingPlace("nurse jobs not in Texas")).toEqual({ head: "nurse jobs", place: "Texas" });
    expect(negatedTrailingPlace("remote jobs but not in Texas")).toEqual({ head: "remote jobs", place: "Texas" });
    expect(negatedTrailingPlace("nurse jobs in Texas")).toBeNull();
    expect(negatedTrailingPlace("nurse not in charge")).toBeNull();
  });
});

describe("through the shipped handler", () => {
  let board: BoardList;
  beforeAll(async () => { board = await bootBoardList(); });
  beforeEach(() => {
    board.reset();
    board.answer((q) => (q.table === "job_board_postings" ? { data: [row("greenhouse:acme:1", "Registered Nurse", { location: "Boston, MA", country: "US" })], error: null } : undefined));
  });

  it("'nurse not night shift in Boston' excludes main's word and still lifts Boston", async () => {
    const r = await board.post({ action: "list", q: "nurse not night shift in Boston", limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toEqual(["night"]);
    expect(JSON.stringify(r.intentFilters ?? [])).toMatch(/boston/i);
  });

  it("'software engineer not senior remote' filters remote and excludes senior", async () => {
    const r = await board.post({ action: "list", q: "software engineer not senior remote", limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toEqual(["senior"]);
    expect(r.intentFilters).toContain("remote");
  });

  it("'nurse jobs not in Texas' searches no Texas and says the place could not be left out", async () => {
    const r = await board.post({ action: "list", q: "nurse jobs not in Texas", limit: 20, groupSimilar: false });
    expect(JSON.stringify(r.intentFilters ?? [])).not.toMatch(/texas/i);
    expect(r.ignoredFilters).toContain("placeExclusion");
    const texts = board.db.queries.filter((q) => q.table === "job_board_postings")
      .flatMap((q) => q.calls.filter(([m]) => m === "textSearch" || m === "or" || m === "ilike").map(([, a]) => JSON.stringify(a)));
    const rpc = JSON.stringify(board.db.rpcArgs("search_jobs"));
    expect(`${texts.join(" ")} ${rpc}`, "the word texas is not searched").not.toMatch(/texas/i);
  });
});
