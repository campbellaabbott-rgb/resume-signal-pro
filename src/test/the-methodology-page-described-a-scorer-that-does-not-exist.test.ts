import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { SCAN_ATS_SYSTEMS, SCORE_AI_BAND, SCORE_AUDIT_PARTS } from "@/config/score-method";

/**
 * WHAT WAS WRONG (register L4-05; SEO report S4, measured 2026-10-08 with a
 * Googlebot UA): /methodology published a seven-factor weighting
 * (25/20/15/15/10/10/5) while every report's "Why this score" splits the
 * score 35/30/25/10, said the score came from "50+ factors" while it is the
 * AI's industry-weighted reading clamped to within 12 points of a rule-based
 * score, and claimed "50+ ATS platforms", "+40 more", "90% of the job market"
 * and validation "by real outcomes from thousands of job seekers" over a scan
 * whose compatibility step names six systems and a site with no outcome
 * survey. Two headings sat over nothing for crawlers.
 *
 * The page now renders from a mirror of the scorer's constants, and this
 * reads the edge function and fails when the mirror and the scorer disagree.
 */

const ROOT = resolve(__dirname, "../..");
const SCAN = codeOf(readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan/index.ts"), "utf8"));

describe("the methodology mirror matches the scorer it describes", () => {
  it("the four audit parts and their points are the scoreAudit items, in order", () => {
    const items = [...SCAN.matchAll(/\{ label: '([^']+)', earned: [^}]*?possible: (\d+)/g)].map((m) => Number(m[2]));
    expect(items).toEqual(SCORE_AUDIT_PARTS.map((p) => p.possible));
    expect(SCORE_AUDIT_PARTS.reduce((a, p) => a + p.possible, 0)).toBe(100);
  });

  it("the AI band is the clamp atsScoreEstimate applies", () => {
    const m = /atsScoreEstimate = Math\.max\(ruleBasedAts - (\d+), Math\.min\(ruleBasedAts \+ (\d+), aiAts\)\)/.exec(SCAN);
    expect(m, "the clamp moved").toBeTruthy();
    expect(Number(m![1])).toBe(SCORE_AI_BAND);
    expect(Number(m![2])).toBe(SCORE_AI_BAND);
  });

  it("the systems are the ones the scan's compatibility step names", () => {
    const m = /ATS System Compatibility: Analyze compatibility with major ATS platforms \(([^)]+)\)/.exec(SCAN);
    expect(m, "the compatibility step moved").toBeTruthy();
    expect(m![1].split(",").map((s) => s.trim())).toEqual([...SCAN_ATS_SYSTEMS]);
  });
});

describe("no locale makes the claims the scorer cannot back", () => {
  const files = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    it(`${file}: methodologyPage claims no 50+, no market share, no +40 more, no outcome validation`, () => {
      const m = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales", file), "utf8")).methodologyPage;
      const text = JSON.stringify(m);
      expect(text).not.toMatch(/50\s?\+|\+\s?40|90\s?%|\b40\b/);
      expect(m.scoringFactors, "the invented seven-factor table").toBeUndefined();
      expect(m.atsPlatforms, "per-system market-share labels").toBeUndefined();
      expect(m.steps.scoringAlgorithm.description).toContain("{{band}}");
      expect(m.atsPlatformsSubtitle).toContain("{{count}}");
      for (const p of SCORE_AUDIT_PARTS) expect(m.audit[p.key].label, `${file} ${p.key}`).toBeTruthy();
    });
  }
});

describe("the page and the bake render from the mirror", () => {
  it("Methodology.tsx and the /methodology bake read the mirror, and the bake lists the systems under their heading", () => {
    const page = codeOf(readFileSync(resolve(ROOT, "src/pages/Methodology.tsx"), "utf8"));
    expect(page).toMatch(/SCORE_AUDIT_PARTS\.map\(/);
    expect(page).toMatch(/SCAN_ATS_SYSTEMS\.map\(/);
    expect(page).toMatch(/\{ band: SCORE_AI_BAND \}/);
    const bake = codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));
    const at = bake.indexOf('path: "/methodology"');
    const block = bake.slice(at, bake.indexOf("write({", at + 10));
    expect(block).toMatch(/D\.SCORE_AUDIT_PARTS\.map\(/);
    expect(block).toMatch(/M\.atsPlatformsTitle[\s\S]*D\.SCAN_ATS_SYSTEMS\.map\(/);
  });
});
