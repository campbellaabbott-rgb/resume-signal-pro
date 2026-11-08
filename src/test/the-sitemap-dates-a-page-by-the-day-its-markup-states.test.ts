/**
 * THE SITEMAP DATES A PAGE BY THE DAY ITS OWN MARKUP STATES (B09, DATE-09).
 *
 * On 2026-11-07 the sitemap said nine guides changed on 2026-10-31 while
 * their Article markup said 07-06, 10-10, 10-24 and 10-25; /ghost-job-index
 * said 10-31 against its Dataset's 11-06, and the benchmarks page 11-02
 * against 11-06. Two answers to "when did this page change" from one bake.
 *
 * Now one pageDates result feeds both. A guide's Article takes the lastmod
 * the sitemap prints (its stated date, or the later day its text changed); a
 * data page states the day its figures were measured as an EXACT date, and
 * the sitemap prints that day and no other.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pageDates } from "../../scripts/prerender-pages.mjs";
import { codeOf } from "./helpers/strip-comments";

const TODAY = "2026-11-08";
const prior = { fp: "old", changed: "2026-10-31" };

describe("pageDates", () => {
  it("an exact stated date is the lastmod, whatever the fingerprint did", () => {
    expect(pageDates({ fp: "new", legacyFp: "new", prior, today: TODAY, stated: "2026-11-06", exact: true }).lastmod).toBe("2026-11-06");
    expect(pageDates({ fp: "old", legacyFp: "old", prior, today: TODAY, stated: "2026-10-20", exact: true }).lastmod).toBe("2026-10-20");
  });

  it("a stated date that is not exact gives way to a later change of the page", () => {
    expect(pageDates({ fp: "new", legacyFp: "new", prior, today: TODAY, stated: "2026-10-25" }).lastmod).toBe(TODAY);
    expect(pageDates({ fp: "old", legacyFp: "old", prior, today: TODAY, stated: "2026-10-25" }).lastmod).toBe("2026-10-31");
    expect(pageDates({ fp: "old", legacyFp: "old", prior, today: TODAY, stated: "2026-11-02" }).lastmod).toBe("2026-11-02");
  });

  it("never dates a page after the bake", () => {
    expect(pageDates({ fp: "x", legacyFp: "x", prior, today: TODAY, stated: "2026-12-01", exact: true }).lastmod).toBe(TODAY);
  });

  it("a page the ledger never saw takes its stated date", () => {
    expect(pageDates({ fp: "x", legacyFp: "x", prior: null, today: TODAY, stated: "2026-07-06" }).lastmod).toBe("2026-07-06");
  });
});

describe("the bake prints one date in both places", () => {
  const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));

  it("write() hands a page's markup the lastmod the sitemap will print", () => {
    expect(code).toMatch(/const dates = pageDates\(\{[^}]*exact[^}]*\}\);/);
    expect(code).toMatch(/const built = typeof page\.jsonLd === "function" \? \{ \.\.\.page, jsonLd: page\.jsonLd\(dates\.lastmod\) \} : page;\s*renderFile\(built\);/);
    expect(code).toMatch(/exact: fp\.exact/);
  });

  it("a guide's Article states that lastmod as its dateModified", () => {
    expect(code).toMatch(/const jsonLd = \(lastmod\) => \[\{[\s\S]{0,600}dateModified: lastmod/);
  });

  it("each data page states its figures' day as an exact date", () => {
    for (const k of ["ghost", "entry", "trends", "pay"]) {
      expect(code).toContain(`...(DATA_FIGURES.${k}.modified ? { lastmod: DATA_FIGURES.${k}.modified, lastmodExact: true } : {})`);
    }
  });
});
