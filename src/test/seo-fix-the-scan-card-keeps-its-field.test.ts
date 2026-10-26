/**
 * THE FREE-SCAN MATCHES CARD KEEPS THE FIELD OF A FALLBACK SCAN (the round's
 * review, 2026-10-24). S13-132 keyed INDUSTRY_TO_CATEGORY by the industry
 * pages' slugs and dropped seven the stream fallback scanner emits; the card
 * (LiveMatches) looked its category up there, so a fallback scan of a nurse
 * whose occupation could not be resolved asked the board for every opening.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INDUSTRY_TO_CATEGORY, SCAN_INDUSTRY_TO_CATEGORY, isBoardCategory } from "@/lib/job-board-categories";

const ROOT = resolve(__dirname, "../..");
const stream = readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan-stream/index.ts"), "utf8");
const VALID = [...(/const VALID_INDUSTRIES = \[([\s\S]*?)\];/.exec(stream)?.[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

describe("the scan's industry words reach a board field", () => {
  it("reads the stream scanner's own list", () => {
    expect(VALID.length).toBeGreaterThan(40);
    for (const s of ["software_engineering", "human_resources", "nursing", "accounting"]) expect(VALID).toContain(s);
  });
  it("maps the slugs the stream emits that the page map does not carry", () => {
    for (const [slug, field] of [["software_engineering", "engineering"], ["human_resources", "people_hr"], ["nursing", "healthcare"], ["accounting", "finance"]] as const) {
      expect(VALID).toContain(slug);
      expect(INDUSTRY_TO_CATEGORY[slug], `${slug} is not a page slug`).toBeUndefined();
      expect(SCAN_INDUSTRY_TO_CATEGORY[slug]).toBe(field);
    }
    for (const v of Object.values(SCAN_INDUSTRY_TO_CATEGORY)) expect(isBoardCategory(v)).toBe(true);
    for (const [k, v] of Object.entries(INDUSTRY_TO_CATEGORY)) expect(SCAN_INDUSTRY_TO_CATEGORY[k]).toBe(v);
  });
  it("is the map the card reads", () => {
    const card = readFileSync(resolve(ROOT, "src/components/LiveMatches.tsx"), "utf8");
    expect(card).toMatch(/const category = SCAN_INDUSTRY_TO_CATEGORY\[industry\];/);
  });
});
