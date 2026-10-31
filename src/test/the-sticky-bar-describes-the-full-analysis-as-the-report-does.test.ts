// @vitest-environment node
/**
 * THE STICKY BAR DESCRIBES THE FULL ANALYSIS AS THE REPORT DOES (the final
 * recheck of land/all, 2026-10-31).
 *
 * The free report stopped selling the Full Analysis as the free scan's fixes
 * applied to your résumé: it is "a separate, deeper analysis"
 * (freeResults.nextSteps.fullAnalysisDescOwn), and the pending free-report
 * changelog entry says so. With FULL_ANALYSIS_ON_SALE on (sales stay on, owner
 * 2026-10-27) the scanner page's sticky bar shows again before a scan, and it
 * still said "Applies the fixes your free scan finds to your own resume"
 * ("Your scan's fixes, applied." on a phone), in nine languages. Both lines now
 * open with the report's own words for the product, in each language, and keep
 * the bar's payment sentence; the bar is not hidden (no sales pause).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Tree = Record<string, unknown>;
const at = (t: Tree, path: string) => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Tree)[k] : undefined), t) as string;
const tree = (lng: string) => JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${lng}.json`), "utf8")) as Tree;
/** The report's description up to its colon: the product, in that language's words. */
const product = (own: string) => own.split(":")[0].trim();

describe("the sticky bar names the Full Analysis in the report's words", () => {
  for (const lng of LOCALES) {
    it(lng, () => {
      const t = tree(lng);
      const own = at(t, "freeResults.nextSteps.fullAnalysisDescOwn");
      expect(own, "the report's description").toMatch(/:/);
      for (const key of ["stickyCta.features", "stickyCta.featuresMobile"]) {
        const line = at(t, key);
        expect(line.startsWith(product(own)), `${lng} ${key}: "${line}"`).toBe(true);
        expect(line.length, `${lng} ${key}`).toBeGreaterThan(product(own).length + 4);
      }
    });
  }

  it("no language keeps the fixes-applied wording", () => {
    expect(at(tree("en"), "stickyCta.features")).not.toMatch(/fixes/i);
    expect(at(tree("en"), "stickyCta.featuresMobile")).not.toMatch(/fixes/i);
    expect(at(tree("en-GB"), "stickyCta.features")).not.toMatch(/fixes/i);
  });
});
