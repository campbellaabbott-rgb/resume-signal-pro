/**
 * THE BOARD HANDS NO FEDERAL POSTING TO THE AGENT UNTIL THE REACH COUNTS THEM
 * (OD16 review, 2026-11-19).
 *
 * The first cut of OD16 took usajobs off MCP_WITHHELD_SOURCES, and the board's
 * hand-off read that list alone (isWithheldSource, S14X-054). So every federal
 * posting on the board grew a "hand this job to your AI" control, and a search
 * filtered to USAJOBS was handed on whole, while the connector hands a federal
 * posting on only once the agency's who-may-apply statement is stored: none
 * before agent-mcp 2026-11-19.1 serves (the build before it refuses the id),
 * none before job-board .104 stores a statement, and at most 10,000 a lap
 * until .105. The same page's AI line already said "USAJOBS and
 * SmartRecruiters postings stay on this website".
 *
 * The hand-off now follows the flag that line turns on
 * (FEDERAL_ROWS_IN_REACH): while the reach leaves the federal postings out,
 * the board does not hand one on, and it does the day the flag flips.
 *
 * TEETH: at fdd56d5e2 isWithheldSource("usajobs") was false, so the first,
 * third and fourth tests fail there (a federal vendor was kept in the search
 * arguments and named in no prompt).
 */
import { describe, expect, it } from "vitest";
import {
  handoffWithholds, isWithheldSource, searchPrompt, toSearchJobsArgs, withheldVendorLabels,
} from "../lib/agent-handoff";
import { FEDERAL_ROWS_IN_REACH, FEDERAL_SOURCE, REACH_LEAVES_OUT, reachLeavesOut } from "../lib/home/board-figures";
import { MCP_WITHHELD_SOURCES } from "../config/mcp-tools";

describe("the hand-off and the AI line turn on one flag", () => {
  it("the board hands a federal posting on exactly when the AI line counts the federal postings", () => {
    expect(FEDERAL_SOURCE).toBe("usajobs");
    // usajobs is not a withheld system any more (OD16): the hold below is the flag's, not the list's.
    expect(MCP_WITHHELD_SOURCES).not.toContain(FEDERAL_SOURCE);
    expect(isWithheldSource(FEDERAL_SOURCE)).toBe(REACH_LEAVES_OUT.includes(FEDERAL_SOURCE));
    expect(isWithheldSource(FEDERAL_SOURCE)).toBe(!FEDERAL_ROWS_IN_REACH);
    expect(isWithheldSource(" USAJOBS ")).toBe(!FEDERAL_ROWS_IN_REACH);
  });

  it("both states of the flag: held while the reach leaves them out, handed on once it counts them", () => {
    for (const inReach of [false, true]) {
      expect(handoffWithholds("usajobs", inReach), `federalInReach=${inReach}`).toBe(!inReach);
      expect(handoffWithholds("usajobs", inReach)).toBe(reachLeavesOut(inReach).includes("usajobs"));
      // A withheld system is held whatever the flag says, and an ordinary one never is.
      expect(handoffWithholds("smartrecruiters", inReach)).toBe(true);
      expect(handoffWithholds("greenhouse", inReach)).toBe(false);
      expect(handoffWithholds(null, inReach)).toBe(false);
    }
  });
});

describe("while the reach leaves the federal postings out", () => {
  // Each expectation is the published state's; the day the flag flips these
  // fail and name what the hand-off must then do instead.
  const held = !FEDERAL_ROWS_IN_REACH;

  it("a search filtered to USAJOBS loses that vendor, and the key when nothing is left", () => {
    expect(toSearchJobsArgs({ q: "nurse", vendor: "greenhouse,usajobs" }).vendor).toBe(held ? "greenhouse" : "greenhouse,usajobs");
    expect("vendor" in toSearchJobsArgs({ q: "nurse", vendor: "usajobs" })).toBe(!held);
    // Nothing else of the search is touched.
    expect(toSearchJobsArgs({ q: "nurse", vendor: "usajobs" }).query).toBe("nurse");
  });

  it("the prompt names USAJOBS among what was left out, and says where those postings open", () => {
    const labels = withheldVendorLabels({ vendor: "greenhouse,usajobs,smartrecruiters" });
    expect(labels).toEqual(held ? ["USAJOBS", "SmartRecruiters"] : ["SmartRecruiters"]);
    const prompt = searchPrompt(toSearchJobsArgs({ q: "nurse", vendor: "greenhouse,usajobs" }), { withheld: withheldVendorLabels({ vendor: "greenhouse,usajobs" }) });
    if (held) {
      expect(prompt).toContain("The board's filter also named USAJOBS, whose postings the server does not hand on, so they are not included here; they stay on the job board.");
      expect(prompt).not.toMatch(/"vendor":"[^"]*usajobs/);
    } else {
      expect(prompt).toMatch(/"vendor":"greenhouse,usajobs"/);
    }
  });
});
