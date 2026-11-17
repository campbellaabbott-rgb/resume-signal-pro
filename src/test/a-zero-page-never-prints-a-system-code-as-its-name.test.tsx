/**
 * A ZERO PAGE NEVER PRINTS A SYSTEM CODE AS ITS NAME (RC-OI-42, header half).
 *
 * WHAT WAS WRONG. A board with no name from data, once its list had answered,
 * was headed by its token: the H1 and the page title read 'Roles on the
 * "recruiting~ORB1000OENG~99afc845-..." board' on the Orbital Engineering
 * zero page (and on Convergint's, before its override), and the actions
 * menu was labelled "More actions for" the same token. A UKG token is the
 * hiring system's address (path, client code, job-board id), never a word a
 * reader could know the board by. board-ui names those two boards from the
 * override map; this holds the header for every board the map does not name.
 *
 * WHAT THIS HOLDS:
 *   1. a token of several "~" parts never appears in the H1, the zero page's
 *      title or the header's labels; the heading names the hiring system
 *      when it is known ("Roles on a UKG board"), else "Roles on this board";
 *   2. a plain slug ("10kbi") is still the heading's label, and a named page
 *      keeps its name (positive controls);
 *   3. every locale carries the two headings and the menu label.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { buildLanderModel, type LanderInput } from "@/lib/company/lander-model";
import { CompanyHeader, tokenIsSystemCode, zeroPageHead } from "@/components/jobs/company/CompanyHeader";
import { COMPANY_SHARD_LOCALES, companyShard, loadCompanyShard } from "./helpers/company-shard";

const ORBITAL = "recruiting~ORB1000OENG~99afc845-206f-496e-bd6a-3427e944c046";
const CODE = "ORB1000OENG";
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: ORBITAL, storedName: null, bakedName: null, cachedName: null,
  listTotal: 0, listFloor: false, feedTotal: null, feedFloor: false, feedAsOf: null,
  boardReadAt: null, source: "ukg", agency: false, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
});
const mount = (o: Partial<LanderInput>, system: string | null) => {
  const model = buildLanderModel(input(o));
  return render(createElement(MemoryRouter, null,
    createElement(CompanyHeader, { model, token: o.token ?? ORBITAL, system, boardReadAt: null, onWatch: () => {} })));
};
const t = () => i18n.t.bind(i18n);

beforeAll(async () => {
  loadCompanyShard();
  await i18n.changeLanguage("en");
});

describe("a system address is never a heading", () => {
  it("guards the guard: the address test knows a UKG and a Workday token from a plain slug", () => {
    expect(tokenIsSystemCode(ORBITAL)).toBe(true);
    expect(tokenIsSystemCode("pwc~wd3~Global_Experienced_Careers")).toBe(true);
    expect(tokenIsSystemCode("10kbi")).toBe(false);
  });

  it("the Orbital zero page's H1 and every label in its header carry no system code", () => {
    const { container } = mount({}, null);
    expect(container.querySelector("h1")?.textContent).toBe("Roles on this board");
    expect(container.innerHTML).not.toContain(CODE);
    expect(container.querySelector("[aria-label^='More actions']")?.getAttribute("aria-label")).toBe("More actions for this board");
  });

  it("with the hiring system known the heading names it", () => {
    const { container } = mount({}, "UKG");
    expect(container.querySelector("h1")?.textContent).toBe("Roles on a UKG board");
    expect(container.innerHTML).not.toContain(CODE);
  });

  it("a page with roles and no name is headed the same way once its list has answered", () => {
    const { container } = mount({ listTotal: 12 }, "UKG");
    expect(container.querySelector("h1")?.textContent).toBe("Roles on a UKG board");
    expect(container.innerHTML).not.toContain(CODE);
  });

  it("the zero page's title names no system code", () => {
    const m = buildLanderModel(input());
    expect(zeroPageHead(t(), m, ORBITAL).title).toBe("Roles on this board");
    expect(zeroPageHead(t(), m, ORBITAL, "UKG").title).toBe("Roles on a UKG board");
    expect(JSON.stringify(zeroPageHead(t(), m, ORBITAL))).not.toContain(CODE);
  });
});

describe("positive controls", () => {
  it("a plain slug is still the heading's label, in the H1 and the title", () => {
    const { container } = mount({ token: "10kbi", source: "greenhouse" }, null);
    expect(container.querySelector("h1")?.textContent).toBe("Roles on the “10kbi” board");
    expect(zeroPageHead(t(), buildLanderModel(input({ token: "10kbi" })), "10kbi").title).toBe("Roles on the “10kbi” board");
  });

  it("a named page keeps its name", () => {
    const { container } = mount({ storedName: "Orbital Engineering" }, null);
    expect(container.querySelector("h1")?.textContent).toBe("Orbital Engineering");
    expect(zeroPageHead(t(), buildLanderModel(input({ storedName: "Orbital Engineering" })), ORBITAL).title).toBe("Orbital Engineering jobs");
  });
});

describe("every locale carries the headings", () => {
  it("all nine shards have both headings and the menu label, the system heading naming its system", () => {
    const gaps: string[] = [];
    for (const l of COMPANY_SHARD_LOCALES) {
      const cp = (companyShard(l) as { companyProfile: Record<string, unknown> }).companyProfile;
      const actions = cp.actions as Record<string, unknown>;
      if (typeof cp.h1SystemBoard !== "string" || !cp.h1SystemBoard.includes("{{system}}")) gaps.push(`${l} h1SystemBoard`);
      if (typeof cp.h1ThisBoard !== "string" || cp.h1ThisBoard.includes("{{")) gaps.push(`${l} h1ThisBoard`);
      if (typeof actions.moreThis !== "string" || actions.moreThis.includes("{{")) gaps.push(`${l} actions.moreThis`);
    }
    expect(COMPANY_SHARD_LOCALES).toHaveLength(9);
    expect(gaps).toEqual([]);
  });
});
