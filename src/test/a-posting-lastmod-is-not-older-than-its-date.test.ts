// @vitest-environment node
/**
 * A POSTING'S LASTMOD IS NOT OLDER THAN ITS OWN DATE (SEO audit 2026-11-18,
 * CRAWL-9).
 *
 * The sitemap's lastmod moves when a page's fingerprint moves, and the
 * fingerprint is blind to dates (contentFingerprint), so a posting its
 * employer re-dated kept the lastmod of its first text: MGM Resorts 281193,
 * first baked 2026-11-08 and re-dated by MGM to 2026-11-12, served datePosted
 * 2026-11-12 under a sitemap lastmod of 2026-11-08, a page that says it has
 * not changed since before it was posted. A posting page now hands its
 * employer-stated day as a floor on its lastmod (withLastmodFloor).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FINGERPRINT_VERSION, contentFingerprint, pageDates, withLastmodFloor } from "../../scripts/prerender-pages.mjs";

const PATH_TEXT = "Sr Data Scientist Commercial Analytics - Corporate\nMGM Resorts\nPosted 2026-11-08, as stated by the employer.";
const fp = contentFingerprint(PATH_TEXT);
const PRIOR = { fp, fpv: FINGERPRINT_VERSION, lastmod: "2026-11-08", changed: "2026-11-08" };

describe("MGM 281193, re-dated 11-12, its text otherwise the same", () => {
  it("the date-blind fingerprint does not move", () => {
    expect(contentFingerprint(PATH_TEXT.replace("2026-11-08", "2026-11-12"))).toBe(fp);
  });

  it("its lastmod is the employer's new date, not the first bake's", () => {
    const d = withLastmodFloor(pageDates({ fp, prior: PRIOR, today: "2026-11-18" }), "2026-11-12", "2026-11-18");
    expect(d.lastmod).toBe("2026-11-12");
    // What changed is still the day the text last moved.
    expect(d.changed).toBe("2026-11-08");
  });

  it("pageDates takes the floor itself", () => {
    expect(pageDates({ fp, prior: PRIOR, today: "2026-11-18", floor: "2026-11-12" }).lastmod).toBe("2026-11-12");
    expect(pageDates({ fp, prior: PRIOR, today: "2026-11-18" }).lastmod).toBe("2026-11-08");
  });

  it("a floor never moves a lastmod back, nor past today", () => {
    expect(withLastmodFloor(pageDates({ fp, prior: { ...PRIOR, changed: "2026-11-15", lastmod: "2026-11-15" }, today: "2026-11-18" }), "2026-11-12", "2026-11-18").lastmod).toBe("2026-11-15");
    expect(withLastmodFloor(pageDates({ fp, prior: PRIOR, today: "2026-11-18" }), "2026-11-30", "2026-11-18").lastmod).toBe("2026-11-18");
    expect(withLastmodFloor(pageDates({ fp, prior: PRIOR, today: "2026-11-18" }), null, "2026-11-18").lastmod).toBe("2026-11-08");
    expect(withLastmodFloor(null, "2026-11-12", "2026-11-18")).toBeNull();
  });

  it("the bake hands every posting page its stated day, to both readers of its dates", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/lastmodFloor: String\(job\.postedAt\)\.slice\(0, 10\),/);
    expect(src).toMatch(/floor: typeof page\.lastmodFloor === "string" \? page\.lastmodFloor : null,/);
    // write() hands the floor to pageDates; the ledger's re-read wraps it.
    expect(src).toMatch(/const dates = pageDates\(\{[^}]*exact: fpEntry\.exact, floor: fpEntry\.floor \}\);/);
    expect(src).toMatch(/withLastmodFloor\(pageDates\(\{[^}]*\}\), fp\.floor, TODAY\)/);
  });
});
