// @vitest-environment node
/**
 * A COMPANY PAGE PRINTS THE PAY LINE REACT PRINTS (SEO audit 2026-11-18,
 * GEO-3).
 *
 * The bake reads get_company_intel for every employer page, and the answer
 * carries median_usd_floor and usd_n, but the baked page printed no pay: the
 * figure appeared only once React's PaySummary ran, so an answer engine that
 * reads the served bytes never saw it. The bake now prints React's line under
 * React's gate (at least five postings stating USD pay), in React's words
 * (the English company shard) and number formats, dated the day it read the
 * figure. Visible text only: the page's markup carries no baseSalary.
 */
import { describe, expect, it } from "vitest";
import { companyLanderPage, landerFacts, landerPayFloor, landerPayHtml } from "../../scripts/prerender-pages.mjs";
import { PAY_MEDIAN_MIN_POSTINGS, payFacts } from "@/components/jobs/company/PaySummary";
import { intelScope } from "@/components/jobs/company/pooled-scope";
import { count, date, money } from "@/lib/format";
import { possessive } from "@/lib/company-display";
import SHARD from "@/i18n/shards/company/en.json";

const PAY = (SHARD as { companyProfile: { pay: Record<string, string> } }).companyProfile.pay;
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (t: string, v: Record<string, string>) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => v[k]);
const READ_ON = "2026-11-21";

/** The line React's PaySummary prints for this intel on a page serving `openN` roles. */
function reactLine(intel: Record<string, unknown>, openN: number | null): string | null {
  const facts = payFacts(intel as never, `${READ_ON}T00:00:00Z`);
  if (!facts?.floor) return null;
  const pooled = intelScope(intel as never, { variant: "open", openRoles: openN === null ? null : { value: openN, floor: false } } as never) === "pooled";
  const key = `${pooled ? "floorPooled" : "floor"}_${facts.floor.m === 1 ? "one" : "other"}`;
  const line = fill(PAY[key], { amount: money(Math.round(facts.floor.amount), "USD", { lng: "en" }), m: count(facts.floor.m, { lng: "en" }), currency: "USD" });
  return `${line} · ${fill(PAY.read, { date: date(READ_ON, { lng: "en" }) })}`;
}
const bakedLine = (html: string) => (/<p data-company-pay="">([^<]*)<\/p>/.exec(html)?.[1] ?? null);
const unesc = (s: string | null) => (s === null ? null : s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));

const ACME = { usd_n: 285, median_usd_floor: 84250.4, countries: [{ n: 120, country: "US" }], categories: [{ n: 90, category: "engineering" }] };

describe("the pay line", () => {
  it("is React's line, word for word, on a page serving more roles than the reader counted", () => {
    const html = landerPayHtml(landerPayFloor(ACME), { openN: 400, readOn: READ_ON, esc });
    expect(unesc(bakedLine(html))).toBe(reactLine(ACME, 400));
    expect(bakedLine(html)).toContain("$84,250");
    expect(bakedLine(html)).not.toContain("whole hiring system");
  });

  it("says the median covers the whole hiring system when the reader counted more roles than the page serves", () => {
    const html = landerPayHtml(landerPayFloor(ACME), { openN: 200, readOn: READ_ON, esc });
    expect(unesc(bakedLine(html))).toBe(reactLine(ACME, 200));
    expect(bakedLine(html)).toContain("whole hiring system");
  });

  it("keeps the page's own wording when the page has no count to judge by", () => {
    expect(unesc(bakedLine(landerPayHtml(landerPayFloor(ACME), { openN: null, readOn: READ_ON, esc })))).toBe(reactLine(ACME, null));
  });

  it("carries the Pay heading and React's basis sentence", () => {
    const html = landerPayHtml(landerPayFloor(ACME), { openN: 400, readOn: READ_ON, esc });
    expect(html).toContain(`<h2>${PAY.title}</h2>`);
    expect(html).toContain(esc(PAY.basis));
  });
});

describe("the gate is React's", () => {
  it("prints nothing under five postings stating USD pay, or with no positive median", () => {
    expect(PAY_MEDIAN_MIN_POSTINGS).toBe(5);
    for (const intel of [{ ...ACME, usd_n: 4 }, { ...ACME, median_usd_floor: null }, { ...ACME, median_usd_floor: 0 }, { countries: [], categories: [] }, null]) {
      expect(landerPayFloor(intel)).toBeNull();
      expect(reactLine((intel ?? {}) as Record<string, unknown>, 400)).toBeNull();
    }
    expect(landerPayHtml(null, { openN: 400, readOn: READ_ON, esc })).toBe("");
  });

  it("prints at exactly five, as React does", () => {
    const five = { ...ACME, usd_n: 5 };
    expect(unesc(bakedLine(landerPayHtml(landerPayFloor(five), { openN: 400, readOn: READ_ON, esc })))).toBe(reactLine(five, 400));
  });
});

describe("a baked company page", () => {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const href = (t: string) => `/jobs/company/${t}`;
  const page = (intel: unknown) => companyLanderPage({
    token: "acme", name: "Acme", primaryToken: "acme", openN: 400, intelOn: READ_ON,
    facts: landerFacts(intel, { countryName: () => "United States", fieldLabel: () => "Engineering & IT" }),
    boardCompanies: 31000, site: "https://resumebooster.work", esc, possessive, fmt, href,
  }) as { content: string; jsonLd: unknown[] };

  it("prints the pay line in its body, and no pay in its markup", () => {
    const p = page(ACME);
    expect(unesc(bakedLine(p.content))).toBe(reactLine(ACME, 400));
    expect(JSON.stringify(p.jsonLd)).not.toMatch(/baseSalary|84250/);
  });

  it("with no pay figure, prints no Pay section", () => {
    expect(page({ ...ACME, usd_n: 3 }).content).not.toContain("data-company-pay");
  });
});
