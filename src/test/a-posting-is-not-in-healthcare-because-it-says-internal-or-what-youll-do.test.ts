/**
 * A POSTING IS NOT IN HEALTHCARE BECAUSE IT SAYS "INTERNAL" OR "WHAT YOU'LL DO"
 * (register S11-007).
 *
 * The job-posting scorer matched every industry title with includes(), and
 * healthcare's titles include 'rn', 'do', 'pt', 'ot' and 'md'. "internal",
 * "document", "support" and "not" all scored as nursing titles: healthcare
 * came out on top for 33 of 39 real software, marketing, accounting and sales
 * postings, jdIndustry was set to healthcare, the report was benchmarked
 * against healthcare and the model was told to frame the gaps as a move into
 * it. Whole words are not enough either: "WHAT YOU'LL DO", "Baltimore, MD",
 * "FT/PT" and "overtime (OT)" are ordinary posting text. An abbreviation now
 * counts only beside a full title of the same field, and the posting must
 * name its field (a title or a multi-word phrase) before it anchors anything.
 *
 * Run against the shipped industry-detection.ts, and the stream fork's copy
 * is held to the same bytes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateJobPostingScore, detectIndustry, INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { NON_HEALTHCARE_POSTINGS, NURSING_POSTING } from "./fixtures/non-healthcare-postings";

const topOf = (text: string) =>
  Object.keys(INDUSTRY_KEYWORDS)
    .map((industry) => ({ industry, ...calculateJobPostingScore(text, industry) }))
    .sort((a, b) => b.score - a.score)[0];

const MARKETING_RESUME = `Jane Doe
Marketing Manager, Acme Corp, 2019 - Present
- Ran paid search and email marketing campaigns
- Grew organic traffic 40% with SEO
Skills: HubSpot, Google Analytics, content marketing`;

describe("a posting outside healthcare is scored as its own field", () => {
  for (const [name, { expect: field, text }] of Object.entries(NON_HEALTHCARE_POSTINGS)) {
    it(`${name}: tops ${field}, healthcare earns no title, and the scan is never framed as a move into healthcare`, () => {
      expect(topOf(text).industry).toBe(field);
      expect(calculateJobPostingScore(text, "healthcare").titleHits).toBe(0);
      const detected = detectIndustry(MARKETING_RESUME, undefined, text);
      expect(detected.jdIndustry).not.toBe("healthcare");
      expect(detected.industry).not.toBe("healthcare");
    });
  }
});

describe("a nursing posting is still healthcare", () => {
  it("the full title carries its abbreviation with it", () => {
    const r = calculateJobPostingScore(NURSING_POSTING, "healthcare");
    expect(r.titleHits).toBeGreaterThanOrEqual(2);
    expect(r.signals.join(" ")).toContain('"rn"');
    expect(topOf(NURSING_POSTING).industry).toBe("healthcare");
    expect(detectIndustry(MARKETING_RESUME, undefined, NURSING_POSTING).jdIndustry).toBe("healthcare");
  });
});

describe("the stream fork carries the same detector", () => {
  it("byte for byte", () => {
    const root = resolve(__dirname, "../../supabase/functions");
    expect(readFileSync(resolve(root, "free-keyword-scan-stream/industry-detection.ts"), "utf8"))
      .toBe(readFileSync(resolve(root, "free-keyword-scan/industry-detection.ts"), "utf8"));
  });
});
