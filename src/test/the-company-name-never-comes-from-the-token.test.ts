/**
 * THE COMPANY NAME NEVER COMES FROM THE TOKEN (audit CP15, CP16).
 *
 * While the list loaded, failed or was refused, the H1 read "Open roles at
 * Andurilindustries" (a prettified token) and stayed that way on a 503 or a
 * 429. Board labels that name no employer reached the H1 and possessives
 * ("Open roles at Mint Velvet | Mint Velvet", "Prosperity Bank's career
 * website", "Open roles at Corporate"). Held here: the name comes from data
 * in one order (stored, baked, cached) or not at all, in which case the H1 is
 * a skeleton bar; two equal halves collapse and "career website" comes off;
 * a generic label is marked and never put in a sentence.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildLanderModel, cleanBoardName, isGenericBoardLabel, landerName, type LanderInput } from "@/lib/company/lander-model";
import { CompanyHeader } from "@/components/jobs/company/CompanyHeader";
import { codeOf } from "./helpers/strip-comments";

const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "andurilindustries", storedName: null, bakedName: null, cachedName: null,
  listTotal: null, listFloor: false, feedTotal: null, feedFloor: false, feedAsOf: null,
  boardReadAt: null, source: "greenhouse", agency: false, collision: null, isUsajobs: false,
  loading: true, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
});

describe("the name comes from data, in one order, or not at all", () => {
  it("stored, then baked, then cached", () => {
    expect(landerName({ storedName: "Anduril Industries", bakedName: "Anduril", cachedName: "A" })).toEqual({ name: "Anduril Industries", generic: false, from: "stored" });
    expect(landerName({ storedName: null, bakedName: "Anduril Industries", cachedName: "A" })).toEqual({ name: "Anduril Industries", generic: false, from: "baked" });
    expect(landerName({ storedName: "  ", bakedName: null, cachedName: "Anduril Industries" })).toEqual({ name: "Anduril Industries", generic: false, from: "cached" });
  });

  it("with no name from data there is no name: never the token, prettified or not", () => {
    for (const o of [{ loading: true }, { loading: false, error: true }, { loading: false, budgetRefusal: true, listTotal: 0 }]) {
      const m = buildLanderModel(input(o));
      expect(m.name).toEqual({ name: null, generic: false, from: null });
    }
    const src = codeOf(readFileSync(resolve(__dirname, "../lib/company/lander-model.ts"), "utf8"));
    expect(src).not.toMatch(/prettyToken|\.token\b[^:]*(?:toUpperCase|replace)/);
    expect(src).not.toMatch(/@\/pages\/Jobs/);
  });

  it("the header shows a skeleton bar, and no token text, until a name arrives", () => {
    const { container } = render(createElement(MemoryRouter, null,
      createElement(CompanyHeader, { model: buildLanderModel(input()), token: "andurilindustries", system: "Greenhouse", boardReadAt: null, onWatch: () => {} })));
    const h1 = container.querySelector("h1")!;
    expect(h1.textContent).toBe("Loading the employer's name");
    expect(h1.querySelector("[aria-hidden='true']")?.className).toMatch(/\bbg-muted\b/);
    expect(container.textContent).not.toMatch(/andurilindustries/i);
  });
});

describe("a board name as it should read in a heading", () => {
  it("collapses two equal halves and drops a trailing 'career website'", () => {
    expect(cleanBoardName("Mint Velvet | Mint Velvet")).toBe("Mint Velvet");
    expect(cleanBoardName("Prosperity Bank's career website")).toBe("Prosperity Bank");
    expect(cleanBoardName("Prosperity Bank career website")).toBe("Prosperity Bank");
    expect(cleanBoardName("CLEAR - Corporate")).toBe("CLEAR - Corporate");
    expect(cleanBoardName("Career website")).toBe("Career website");
    expect(cleanBoardName("  ")).toBeNull();
  });

  it("marks a label that names a careers page, and keeps real names", () => {
    for (const g of ["Corporate", "Open Roles", "Careers", "Jobs", "External", "Experience site"]) expect(isGenericBoardLabel(g), g).toBe(true);
    for (const n of ["Clear", "Domino's", "Corporate Express", "Jobs & Talent Ltd"]) expect(isGenericBoardLabel(n), n).toBe(false);
  });

  it("a generic label never enters a possessive or the subtitle's sentence", () => {
    const m = buildLanderModel(input({ storedName: "Corporate", loading: false, listTotal: 40 }));
    expect(m.name).toEqual({ name: "Corporate", generic: true, from: "stored" });
    const { container } = render(createElement(MemoryRouter, null,
      createElement(CompanyHeader, { model: m, token: "mic1003mei", system: "UKG", boardReadAt: null, onWatch: () => {} })));
    expect(container.querySelector("h1")?.textContent).toBe("Roles on the “Corporate” board (UKG)");
    expect(container.textContent).not.toMatch(/Corporate['’]s|Watch Corporate\b/);
    expect(container.textContent).toContain("Live jobs straight from this board's own hiring system.");
  });
});
