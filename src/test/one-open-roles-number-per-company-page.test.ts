/**
 * ONE OPEN-ROLES NUMBER PER COMPANY PAGE (audit CP7, CP10, CP3).
 *
 * Domino's printed "10,000+" in the answer line, "19936+" on the Hiring
 * Health card and "19953 more" in the detail pane; twelve of twenty-six pages
 * printed an exact N in one place and "N+" in another. The page now chooses
 * ONE OpenRolesValue {value, floor, asOf} in lander-model.ts and every surface
 * prints that object through the same formatter. This file holds the choice
 * (each rule beside the case that would break it) and renders the answer line
 * and the results line from one model to show they cannot disagree.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { buildLanderModel, chooseOpenRoles, LIST_COUNT_CAP, type LanderInput } from "@/lib/company/lander-model";
import { openRolesLine, CompanyHeader } from "@/components/jobs/company/CompanyHeader";
import { CompanyResultsLine } from "@/components/jobs/company/CompanyLander";

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "acme", storedName: "Acme", bakedName: null, cachedName: null,
  listTotal: 967, listFloor: false, feedTotal: 967, feedFloor: true, feedAsOf: minsAgo(30),
  boardReadAt: minsAgo(46), source: "greenhouse", agency: false, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
});
const t = i18n.t.bind(i18n);

describe("the figure is chosen once", () => {
  it("under the list's cap, the list's own exact total, as of the board's read -- never a '+' borrowed from the feed", () => {
    const i = input();
    expect(chooseOpenRoles(i)).toEqual({ value: 967, floor: false, asOf: i.boardReadAt });
  });

  it("past the cap, the board-level count when it is at least the cap, with its own floor flag and computation time", () => {
    const i = input({ listTotal: LIST_COUNT_CAP, listFloor: true, feedTotal: 21_067, feedFloor: true });
    expect(chooseOpenRoles(i)).toEqual({ value: 21_067, floor: true, asOf: i.feedAsOf });
  });

  it("past the cap with no larger board count, the cap itself as a floor, marked as the cap", () => {
    const i = input({ listTotal: LIST_COUNT_CAP, listFloor: true, feedTotal: 9_000 });
    expect(chooseOpenRoles(i)).toEqual({ value: LIST_COUNT_CAP, floor: true, asOf: i.boardReadAt, capped: true });
    expect(chooseOpenRoles(input({ listTotal: LIST_COUNT_CAP, listFloor: true, feedTotal: null }))?.capped).toBe(true);
  });

  it("a visitor filter does not turn the board's figure into the filtered count", () => {
    const filtered = input({ listTotal: 12, visitorFilters: ["q"] });
    expect(chooseOpenRoles(filtered)).toEqual({ value: 967, floor: true, asOf: filtered.feedAsOf });
    const remembered = { value: 967, floor: false, asOf: minsAgo(50) };
    expect(chooseOpenRoles({ ...filtered, lastUnfiltered: remembered })).toBe(remembered);
  });

  it("while the list is loading, failed or unanswered there is no figure unless one was already measured", () => {
    expect(chooseOpenRoles(input({ loading: true, feedTotal: null }))).toBeNull();
    expect(chooseOpenRoles(input({ error: true, feedTotal: 0 }))).toBeNull();
    expect(chooseOpenRoles(input({ listTotal: null, feedTotal: 40 }))?.value).toBe(40);
  });

  it("a board with no open roles is the zero variant and prints no open-roles figure at all", () => {
    const m = buildLanderModel(input({ listTotal: 0, feedTotal: 0 }));
    expect(m.variant).toBe("zero");
    expect(m.openRoles).toBeNull();
  });
});

describe("every surface prints the same object the same way", () => {
  it("formats the count in the reader's language, with '+' only on a floor, and names its date basis", () => {
    expect(openRolesLine(t, { value: 967, floor: false, asOf: minsAgo(46) }, "en")).toBe("967 open roles · read 46 min ago");
    expect(openRolesLine(t, { value: 21_067, floor: true, asOf: minsAgo(212) }, "en")).toBe("21,067+ open roles · read 3 hr 32 min ago");
    expect(openRolesLine(t, { value: 10_000, floor: true, asOf: minsAgo(5), capped: true }, "en")).toBe("10,000+ open roles · we count up to 10,000");
    expect(openRolesLine(t, { value: 1, floor: false, asOf: null }, "en")).toBe("1 open role");
    expect(openRolesLine(t, null, "en")).toBeNull();
  });

  it("the answer line and the results line render one model's figure identically", () => {
    const model = buildLanderModel(input({ listTotal: LIST_COUNT_CAP, listFloor: true, feedTotal: 19_936, feedFloor: true }));
    const { container } = render(createElement(MemoryRouter, null,
      createElement(CompanyHeader, { model, token: "dominos", system: "SmartRecruiters", boardReadAt: minsAgo(46), onWatch: () => {} }),
      createElement(CompanyResultsLine, { model, shown: 69, boardReadAt: minsAgo(46) }),
    ));
    const answer = container.querySelector("[data-company-answer]")?.textContent ?? "";
    const results = container.querySelector("[data-company-results]")?.textContent ?? "";
    expect(answer).toContain("19,936+ open roles");
    expect(results).toContain("Showing 69 of 19,936+ open roles");
    expect(results).toContain("this board read 46 min ago");
    // No second figure, and no exact-looking copy of the floor.
    expect(container.textContent).not.toMatch(/\b19936\b|\b10,000\+|\b19,936(?!\+)/);
  });
});
