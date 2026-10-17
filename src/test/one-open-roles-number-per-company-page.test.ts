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
 *
 * Every figure names what its date is (honesty review of 3ebdcbb2): the
 * list's figure is "read" at the board's read; the board-level fill-curve
 * count is "counted" when it was computed (it used to print as "read 1 hr
 * ago" beside "this board read 46 min ago"); with the board's read time
 * missing the list's figure is "counted" when the list answered; and a figure
 * with no date at all prints no line.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { buildLanderModel, chooseOpenRoles, LIST_COUNT_CAP, type LanderInput } from "@/lib/company/lander-model";
import { openRolesLine, CompanyHeader } from "@/components/jobs/company/CompanyHeader";
import { CompanyResultsLine } from "@/components/jobs/company/CompanyLander";
import { date as fmtDate } from "@/lib/format";
// Dates as the site's one formatter prints them for English readers (src/lib/format.ts: day, month, year), so the guard keeps its "reader's language" claim without pinning one calendar style.
const D = (day: string) => fmtDate(day, { lng: "en" });


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
    expect(chooseOpenRoles(i)).toEqual({ value: 967, floor: false, asOf: i.boardReadAt, basis: "read" });
  });

  it("past the cap, the board-level count when it is at least the cap, with its own floor flag and computation time", () => {
    const i = input({ listTotal: LIST_COUNT_CAP, listFloor: true, feedTotal: 21_067, feedFloor: true });
    expect(chooseOpenRoles(i)).toEqual({ value: 21_067, floor: true, asOf: i.feedAsOf, basis: "counted" });
  });

  it("past the cap with no larger board count, the cap itself as a floor, marked as the cap", () => {
    const i = input({ listTotal: LIST_COUNT_CAP, listFloor: true, feedTotal: 9_000 });
    expect(chooseOpenRoles(i)).toEqual({ value: LIST_COUNT_CAP, floor: true, asOf: i.boardReadAt, basis: "read", capped: true });
    expect(chooseOpenRoles(input({ listTotal: LIST_COUNT_CAP, listFloor: true, feedTotal: null }))?.capped).toBe(true);
  });

  it("a visitor filter does not turn the board's figure into the filtered count", () => {
    const filtered = input({ listTotal: 12, visitorFilters: ["q"] });
    expect(chooseOpenRoles(filtered)).toEqual({ value: 967, floor: true, asOf: filtered.feedAsOf, basis: "counted" });
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
    expect(openRolesLine(t, { value: 967, floor: false, asOf: minsAgo(46), basis: "read" }, "en")).toBe("967 roles dated in the last 30 days · read 46 min ago");
    expect(openRolesLine(t, { value: 21_067, floor: true, asOf: minsAgo(212), basis: "counted" }, "en")).toBe("21,067+ roles dated in the last 30 days · counted 3 hr, 32 min ago");
    expect(openRolesLine(t, { value: 10_000, floor: true, asOf: minsAgo(5), basis: "read", capped: true }, "en")).toBe("10,000+ roles dated in the last 30 days · we count up to 10,000 · read 5 min ago");
    expect(openRolesLine(t, { value: 1, floor: false, asOf: null }, "en"), "a count with no date is not printed").toBeNull();
    expect(openRolesLine(t, null, "en")).toBeNull();
  });

  it("with the board's read time missing, the list's figure is dated by its answer, or carries none", () => {
    const answered = minsAgo(0);
    expect(chooseOpenRoles(input({ boardReadAt: null, listAnsweredAt: answered }))).toEqual({ value: 967, floor: false, asOf: answered, basis: "counted" });
    const undated = buildLanderModel(input({ boardReadAt: null }));
    expect(undated.openRoles).toEqual({ value: 967, floor: false, asOf: null, basis: "counted" });
    const { container } = render(createElement(MemoryRouter, null,
      createElement(CompanyHeader, { model: undated, token: "acme", system: null, boardReadAt: null, onWatch: () => {} }),
      createElement(CompanyResultsLine, { model: undated, shown: 20, boardReadAt: null }),
    ));
    expect(container.querySelector("[data-company-answer]"), "no bare count in the header").toBeNull();
    expect(container.querySelector("[data-company-results]"), "no bare count in the results line").toBeNull();
    expect(container.textContent).not.toMatch(/967/);
    cleanup();
    const dated = buildLanderModel(input({ boardReadAt: null, listAnsweredAt: answered }));
    render(createElement(MemoryRouter, null, createElement(CompanyHeader, { model: dated, token: "acme", system: null, boardReadAt: null, onWatch: () => {} })));
    expect(document.querySelector("[data-company-answer]")?.textContent).toBe("967 roles dated in the last 30 days · counted just now");
  });

  it("the answer line and the results line render one model's figure identically", () => {
    const model = buildLanderModel(input({ listTotal: LIST_COUNT_CAP, listFloor: true, feedTotal: 19_936, feedFloor: true }));
    const { container } = render(createElement(MemoryRouter, null,
      createElement(CompanyHeader, { model, token: "dominos", system: "SmartRecruiters", boardReadAt: minsAgo(46), onWatch: () => {} }),
      createElement(CompanyResultsLine, { model, shown: 69, boardReadAt: minsAgo(46) }),
    ));
    const answer = container.querySelector("[data-company-answer]")?.textContent ?? "";
    const results = container.querySelector("[data-company-results]")?.textContent ?? "";
    expect(answer).toContain("19,936+ roles dated in the last 30 days");
    expect(results).toContain("Showing 69 of 19,936+ roles dated in the last 30 days");
    // The board-level count is dated by its computation in BOTH places, never as a "read".
    expect(answer).toContain("counted 30 min ago");
    expect(results).toContain("counted 30 min ago");
    expect(container.textContent).not.toMatch(/read 30 min ago/);
    // No second figure, and no exact-looking copy of the floor.
    expect(container.textContent).not.toMatch(/\b19936\b|\b10,000\+|\b19,936(?!\+)/);
  });
});

describe("every figure in the header names its date", () => {
  it("the pay share prints the date its pair was read, and the work-mode split the read it came from", () => {
    const model = buildLanderModel(input({ listTotal: 847 }));
    render(createElement(MemoryRouter, null, createElement(CompanyHeader, {
      model, token: "acme", system: "Workday", boardReadAt: minsAgo(46), onWatch: () => {},
      workMode: { remote: 10, hybrid: 20, onsite: 30, unstated: 787 },
      payStated: { k: 212, n: 1653, asOf: "2026-10-01T12:00:00Z" },
    })));
    const pay = document.querySelector("[data-fact='pay']")?.textContent ?? "";
    const mode = document.querySelector("[data-fact='workMode']")?.textContent ?? "";
    expect(pay).toBe(`Pay stated on212 of 1,653 · read ${D("2026-10-01")}`);
    expect(mode).toBe("Work mode10 remote · 20 hybrid · 30 on-site · 787 not stated · read 46 min ago");
  });

  it("a fact with no date is left out rather than printed bare", () => {
    const model = buildLanderModel(input({ listTotal: 847, boardReadAt: null }));
    render(createElement(MemoryRouter, null, createElement(CompanyHeader, {
      model, token: "acme", system: "Workday", boardReadAt: null, onWatch: () => {},
      workMode: { remote: 10, hybrid: 20, onsite: 30, unstated: 787 },
      payStated: { k: 212, n: 1653, asOf: null },
    })));
    expect(document.querySelector("[data-fact='pay']")).toBeNull();
    expect(document.querySelector("[data-fact='workMode']")).toBeNull();
    expect(document.querySelector("[data-fact='system']")?.textContent).toBe("Hiring systemWorkday");
  });
});
