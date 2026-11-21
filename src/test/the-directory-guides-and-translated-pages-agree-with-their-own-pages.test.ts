/**
 * THE DIRECTORY, THE GUIDES AND THE TRANSLATED PAGES SAY WHAT THEIR OWN PAGES
 * SAY.
 *
 *   SEO-F17  /companies printed each employer's own board count beside a
 *            link to a page that states the employer's pooled count (HPE 842
 *            against 1,704, PwC 891 against 2,008, 2026-11-15).
 *   SEO-F18  /ats/:vendor, the score benchmark study and the translated CV
 *            pages carried no BreadcrumbList, while the English CV pages did.
 *   SEO-F16  /ats descriptions opened with the bare reply to the page's
 *            question ("Yes.", "Unreliably."), which a search result does
 *            not show.
 *
 * The bake's main needs the live database, so the wiring is read from the
 * shipped source; the description is run.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VENDORS } from "@/data/ats-vendors";
import { atsGuideDescription } from "../../scripts/prerender-seo.mjs";
import { fitSentence } from "../../scripts/prerender-copy.mjs";

const BAKE = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
const from = (start: string, end: string) => {
  const a = BAKE.indexOf(start);
  expect(a, `${start} moved`).toBeGreaterThan(-1);
  return BAKE.slice(a, BAKE.indexOf(end, a));
};

describe("/companies (SEO-F17)", () => {
  it("states the count its linked page states: pooled when the page pools, else the board's own", () => {
    const rows = from("// ---- /companies: the directory", "COMPANY_PAGE_COUNT = employersListed;");
    expect(rows).toContain("const pooledRow = pooledOpen(c);");
    expect(rows).toContain("— ${fmt(pooledRow ? pooledRow.open : o)} open roles");
    expect(rows).not.toContain("— ${fmt(o)} open roles");
    const page = from("const pageOf = (c, info, robots, canonicalTo = null) => {", "});");
    expect(page).toContain("openN: pooled ? pooled.open : openN");
  });
});

describe("BreadcrumbList (SEO-F18)", () => {
  it("on every /ats guide", () => {
    expect(from("// ---- /ats/:vendor", "content: `")).toContain('breadcrumbLd([{ name: "Home", path: "/" }, { name: data.name, path: `/ats/${vendor}` }])');
  });
  it("on the score benchmark study", () => {
    expect(from("// ---- /research/ats-score-benchmarks", "content: `")).toContain('breadcrumbLd([{ name: "Home", path: "/" }, { name: "ATS score benchmarks", path: "/research/ats-score-benchmarks" }])');
  });
  it("on every translated CV page, as on the English ones", () => {
    const translated = from("// Localized pages per CV_LOCALES", "content: `");
    // In the page's own language, and shown as well as marked up (the
    // review): a-translated-cv-page-shows-the-trail-it-marks-up-in-its-own-language.
    expect(translated).toContain("breadcrumbLd(trail)");
    expect(from("path: `/cv-standards/${D.COUNTRY_SLUGS[iso]}`", "content: `")).toContain("breadcrumbLd(");
  });
});

describe("/ats descriptions (SEO-F16)", () => {
  const vendors = Object.values(VENDORS as Record<string, { name: string; behaviors: Array<{ q: string; a: string }> }>);
  it("open with no bare reply word", () => {
    for (const v of vendors) {
      const d = atsGuideDescription(v);
      expect(d, v.name).not.toMatch(/^(?:Yes|No|Unreliably|Often not)\b/);
      expect(d.length, v.name).toBeLessThanOrEqual(160);
      // A capital, or a name that is spelled lower case ("iCIMS reads...").
      expect(/^[a-z]/.test(d) && !d.startsWith(v.name), `${v.name}: ${d}`).toBe(false);
    }
  });
  it("the premise: two of the answers open with one (Lever's 'Yes.', Workday's 'Unreliably.')", () => {
    const opens = vendors.map((v) => fitSentence(v.behaviors[0].a)).filter((s) => /^(?:Yes|Unreliably)\./.test(s));
    expect(opens.length).toBeGreaterThanOrEqual(2);
  });
  it("keeps an answer that opens with a sentence of its own", () => {
    const v = { name: "Acme ATS", behaviors: [{ q: "q", a: "Acme ATS reads every column of a two-column resume, but it reorders them by height before it parses them." }] };
    expect(atsGuideDescription(v)).toBe(v.behaviors[0].a);
  });
});
