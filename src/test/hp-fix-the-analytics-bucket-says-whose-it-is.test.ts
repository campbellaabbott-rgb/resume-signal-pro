/**
 * THE ANALYTICS BUCKET SAYS WHOSE EVENTS IT HOLDS (review round of
 * 2026-10-26).
 *
 * Index sends useScrollDepth("home") and useTimeOnPage("home"), and after the
 * switch-over Index is the scanner (/resume-checker and the other tool
 * landings) while "/" sends neither (step 13). The owner's dashboard still
 * labelled the bucket "Home", so it would show scanner engagement as the new
 * homepage's. The bucket's key stays "home" (the events and the visitor
 * budget are keyed on it); its label says the scanner.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { ENGAGEMENT_PAGE_LABEL } from "@/pages/AnalyticsDashboard";

const ROOT = resolve(__dirname, "../..");

describe("the engagement buckets' labels", () => {
  it("the \"home\" bucket is labelled as the scanner's, wherever the dashboard names it", () => {
    expect(ENGAGEMENT_PAGE_LABEL.home).toBe("Scanner pages");
    expect(ENGAGEMENT_PAGE_LABEL.pricing).toBe("Pricing");
    const code = codeOf(readFileSync(resolve(ROOT, "src/pages/AnalyticsDashboard.tsx"), "utf8"));
    expect(code).not.toMatch(/label: "Home"/);
    expect(code).not.toMatch(/>Home</);
    expect(code).not.toMatch(/capitalize">\{page\}/);
    const index = codeOf(readFileSync(resolve(ROOT, "src/pages/Index.tsx"), "utf8"));
    expect(index).toMatch(/useScrollDepth\(['"]home['"]\)/);
  });
});
