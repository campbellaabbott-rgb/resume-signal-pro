/**
 * A HIRING MIX POOLED ACROSS AN EMPLOYER'S SITES SAYS SO (S13-116).
 *
 * get_company_intel pools every career site an employer runs on one hiring
 * system. Live 2026-10-17: the three PwC Workday sites (1,124, 1,514 and 353
 * roles) got the byte-identical answer — finance 739, engineering 512,
 * data_ai 172; India 1,172, US 255, Mexico 182 — and the 353-role campus
 * page printed "India 1,172" under "the open roles we read", its bars beyond
 * the page's own figure. The block now says the counts are the employer's
 * whole hiring system, prints the total those lists prove beside the page's
 * own, and judges placement against that pooled total.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HiringMix, mixFacts } from "@/components/jobs/company/HiringMix";
import type { CompanyIntel } from "@/components/jobs/CompanyIntelPanel";

const intel = (categories: Array<[string, number]>, countries: Array<[string, number]>): CompanyIntel => ({
  employees: null, employee_basis: null, yc_batch: null, median_usd_floor: null, usd_n: null, net_7d: null,
  categories: categories.map(([category, n]) => ({ category, n })),
  countries: countries.map(([country, n]) => ({ country, n })),
});
const PWC = intel([["finance", 739], ["engineering", 512], ["data_ai", 172]], [["IN", 1172], ["US", 255], ["MX", 182]]);
const exact = (value: number) => ({ value, floor: false, asOf: null });

describe("mixFacts", () => {
  it("marks the PwC campus page's mix as pooled, with the total the lists prove", () => {
    const f = mixFacts(PWC, exact(353), "2026-10-17T10:00:00Z");
    expect(f?.pooled).toEqual({ atLeast: 1609, page: 353 });
  });

  it("keeps a single board's own mix unpooled (positive control)", () => {
    const f = mixFacts(intel([["finance", 60], ["engineering", 30]], [["US", 80], ["CA", 10]]), exact(100), null);
    expect(f).not.toBeNull();
    expect(f?.pooled).toBeUndefined();
  });

  it("refuses a pooled mix whose countries place under half of the pooled total", () => {
    expect(mixFacts(intel([["finance", 900], ["engineering", 600]], [["US", 300]]), exact(353), null)).toBeNull();
  });
});

describe("HiringMix", () => {
  it("heads a pooled mix as the employer's hiring system and prints both totals", () => {
    render(<HiringMix facts={mixFacts(PWC, exact(353), "2026-10-17T10:00:00Z")} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Hiring mix across the employer's hiring system/);
    expect(text).toMatch(/at least 1,609 open roles\), not only the 353 on this page/);
    expect(document.querySelector("[data-company-mix-basis]")?.getAttribute("data-company-mix-basis")).toBe("pooled");
  });
});
