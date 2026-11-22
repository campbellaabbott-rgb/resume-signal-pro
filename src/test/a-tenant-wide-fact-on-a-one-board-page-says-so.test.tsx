/**
 * A TENANT-WIDE FACT ON A ONE-BOARD PAGE SAYS SO (S14X-195).
 *
 * WHAT WAS WRONG. get_company_intel pools every career site an employer runs
 * on one hiring system. Live 2026-11-15, PwC's US Experienced Careers page
 * served 282 roles while the reader answered India 595, United States 284,
 * United Kingdom 110 and 285 USD postings, the same answer as PwC's Global
 * page. S13-116 taught the Hiring mix to say its counts were pooled; the
 * header still printed "Most roles in India, United States and United
 * Kingdom" and the Pay card "median across 285 USD postings", both as this
 * page's own, on a page serving 282 roles.
 *
 * WHAT THIS HOLDS. One test (pooled-scope.ts) judges the reader's counts
 * against the page's figure, and every surface reads its answer:
 *   1. counts above the page's figure are pooled; counts within it, a floor
 *      figure, or no figure leave today's wording;
 *   2. the header's countries fact says whose hiring system it covers, and
 *      on a page with no name to say it with it is left out;
 *   3. the Pay card's median says it covers the employer's whole hiring
 *      system, through the lander's rail;
 *   4. every locale carries the new strings with their placeholders.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { buildLanderModel, type LanderInput } from "@/lib/company/lander-model";
import type { CompanyIntel } from "@/components/jobs/CompanyIntelPanel";
import { CompanyLanderHeader, CompanyLanderRail, type CompanyProfileData } from "@/components/jobs/company/CompanyLander";
import { PaySummary, payFacts } from "@/components/jobs/company/PaySummary";
import { mixFacts } from "@/components/jobs/company/HiringMix";
import { IntelScopeContext, intelScope, pooledBeyondPage } from "@/components/jobs/company/pooled-scope";
import { COMPANY_SHARD_LOCALES, companyShard, loadCompanyShard } from "./helpers/company-shard";

const READ = "2026-11-15T09:00:00Z";
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "pwc~wd3~US_Experienced_Careers", storedName: "PwC", bakedName: null, cachedName: null,
  listTotal: 282, listFloor: false, feedTotal: null, feedFloor: false, feedAsOf: null,
  boardReadAt: READ, source: "workday", agency: false, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
});
const intel = (countries: Array<[string, number]>, usd: number | null, floor: number | null = 98000): CompanyIntel => ({
  employees: null, employee_basis: null, yc_batch: null, median_usd_floor: floor, usd_n: usd, net_7d: null,
  categories: [{ category: "finance", n: 300 }, { category: "engineering", n: 200 }],
  countries: countries.map(([country, n]) => ({ country, n })),
});
// The PwC answer of 2026-11-15, and a single board's own answer that fits its page.
const PWC = intel([["IN", 595], ["US", 284], ["GB", 110]], 285);
const OWN = { ...intel([["US", 200], ["CA", 50]], 40), categories: [{ category: "finance", n: 150 }, { category: "engineering", n: 90 }] };
const profile = (i: CompanyIntel | null): CompanyProfileData => ({
  intel: { intel: i, loading: false, readAt: READ }, perks: null, financials: null, lca: null, similar: [],
});
const header = (model: ReturnType<typeof buildLanderModel>, i: CompanyIntel | null) => render(createElement(MemoryRouter, null,
  createElement(CompanyLanderHeader, {
    model, token: "pwc~wd3~US_Experienced_Careers",
    labelOf: (s: string) => (s === "workday" ? "Workday" : null), source: "workday",
    profile: profile(i), boardReadAt: READ, onWatch: () => {}, onShowOnly: () => {},
  })));
const countriesFact = (c: HTMLElement) => c.querySelector("[data-fact='countries']");

beforeAll(async () => {
  loadCompanyShard();
  await i18n.changeLanguage("en");
});

describe("one test decides whose roles the intel counts", () => {
  it("counts above the page's figure are pooled, and the largest count is the total they prove", () => {
    expect(pooledBeyondPage([989, 500, 285], 282)).toEqual({ atLeast: 989, page: 282 });
    expect(pooledBeyondPage([250, 240, 40], 282)).toBeNull();
    expect(pooledBeyondPage([282], 282)).toBeNull();
  });

  it("the PwC answer is pooled on its 282-role page; a board's own answer is not", () => {
    expect(intelScope(PWC, buildLanderModel(input()))).toBe("pooled");
    expect(intelScope(OWN, buildLanderModel(input()))).toBe("page");
  });

  it("the USD count alone proves pooling when it exceeds the page", () => {
    const usdOnly = { ...intel([["US", 100]], 300), categories: [{ category: "finance", n: 100 }] };
    expect(intelScope(usdOnly, buildLanderModel(input()))).toBe("pooled");
  });

  it("a floor figure, no figure and no intel are not judged, so today's wording stays", () => {
    expect(intelScope(PWC, buildLanderModel(input({ listTotal: 10000, listFloor: true })))).toBeNull();
    expect(intelScope(PWC, buildLanderModel(input({ loading: true, listTotal: null })))).toBeNull();
    expect(intelScope(null, buildLanderModel(input()))).toBeNull();
  });

  it("on a zero page any count is another board's, so it is pooled", () => {
    expect(intelScope(PWC, buildLanderModel(input({ listTotal: 0 })))).toBe("pooled");
  });

  it("the Hiring mix keeps its own verdict through the same test (S13-116 unchanged)", () => {
    const m = buildLanderModel(input());
    expect(mixFacts(PWC, m.openRoles, READ)?.pooled).toEqual({ atLeast: 989, page: 282 });
    expect(mixFacts(OWN, m.openRoles, READ)?.pooled).toBeUndefined();
  });
});

describe("the header's countries say whose hiring system they cover", () => {
  it("on PwC's 282-role page they are PwC's whole hiring system's", () => {
    const { container } = header(buildLanderModel(input()), PWC);
    const fact = countriesFact(container);
    expect(fact?.querySelector("dt")?.textContent).toBe("Most roles across the PwC hiring system in");
    expect(fact?.querySelector("dd")?.textContent).toMatch(/India.*United States.*United Kingdom/);
  });

  it("a board whose counts fit its page keeps 'Most roles in' (positive control)", () => {
    const { container } = header(buildLanderModel(input()), OWN);
    expect(countriesFact(container)?.querySelector("dt")?.textContent).toBe("Most roles in");
  });

  it("with no name to say whose, the pooled countries are left out rather than printed as this page's", () => {
    const { container } = header(buildLanderModel(input({ storedName: null })), PWC);
    expect(countriesFact(container)).toBeNull();
  });

  it("in German the label names the employer's hiring system too", async () => {
    await i18n.changeLanguage("de");
    try {
      const { container } = header(buildLanderModel(input()), PWC);
      expect(countriesFact(container)?.querySelector("dt")?.textContent).toBe("Die meisten Stellen im gesamten Bewerbungssystem von PwC in");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("the Pay card says whose postings its median covers", () => {
  it("through the lander's rail, PwC's 285 USD postings are its whole hiring system's", () => {
    const model = buildLanderModel(input());
    const { container } = render(createElement(MemoryRouter, null,
      createElement(CompanyLanderRail, { model, token: "pwc~wd3~US_Experienced_Careers", profile: profile(PWC), record: null, layoffRows: [] })));
    const line = container.querySelector("[data-pay-floor]");
    expect(line?.getAttribute("data-pay-floor")).toBe("pooled");
    expect(line?.textContent).toMatch(/median across 285 USD postings on this employer's whole hiring system/);
  });

  it("a board's own postings keep today's line (positive control)", () => {
    const model = buildLanderModel(input());
    const { container } = render(createElement(MemoryRouter, null,
      createElement(CompanyLanderRail, { model, token: "pwc~wd3~US_Experienced_Careers", profile: profile(OWN), record: null, layoffRows: [] })));
    const line = container.querySelector("[data-pay-floor]");
    expect(line?.getAttribute("data-pay-floor")).toBe("");
    expect(line?.textContent).toMatch(/median across 40 USD postings(?! on)/);
  });

  it("outside a lander the card keeps today's line", () => {
    const { container } = render(createElement(PaySummary, { facts: payFacts(PWC, READ) }));
    expect(container.querySelector("[data-pay-floor]")?.textContent).not.toMatch(/whole hiring system/);
    const pooled = render(createElement(IntelScopeContext.Provider, { value: "pooled" }, createElement(PaySummary, { facts: payFacts(PWC, READ) })));
    expect(pooled.container.querySelector("[data-pay-floor]")?.textContent).toMatch(/whole hiring system/);
  });
});

describe("every locale carries the new strings", () => {
  const leaf = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);

  it("all nine shards, each with the placeholders its English names", () => {
    expect(COMPANY_SHARD_LOCALES).toEqual(["de", "en", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"]);
    const gaps: string[] = [];
    for (const l of COMPANY_SHARD_LOCALES) {
      const s = companyShard(l);
      const label = leaf(s, "companyProfile.facts.countriesLabelPooled");
      if (typeof label !== "string" || !label.includes("{{company}}")) gaps.push(`${l} countriesLabelPooled`);
      for (const form of ["one", "other"]) {
        const v = leaf(s, `companyProfile.pay.floorPooled_${form}`);
        if (typeof v !== "string" || !["{{amount}}", "{{m}}", "{{currency}}"].every((p) => v.includes(p))) gaps.push(`${l} floorPooled_${form}`);
      }
    }
    expect(gaps).toEqual([]);
  });
});
