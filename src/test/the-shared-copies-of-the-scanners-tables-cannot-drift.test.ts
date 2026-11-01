/**
 * THE SHARED COPIES OF THE SCANNER'S TABLES CANNOT DRIFT (register S13-097).
 *
 * supabase/functions/_shared/industry-detection.ts was a third copy of the
 * scanner's detector that had already drifted: it still matched 2-3 letter
 * healthcare titles ('rn', 'do', 'pt', 'ot') with includes(), and only the
 * stream fork's copy was held to the scanner's bytes. The board's fit scorer,
 * save-lead, the corrections digest and the market-pulse mail read their
 * tables from _shared. Today those tables match; the next change to the
 * scanner would not have reached them.
 *
 * The _shared copy is now the scanner's file, byte for byte, and this test
 * holds all three copies together. _shared/market-intelligence.ts stays a
 * smaller file (its one reader, send-market-pulse, takes KEYWORD_FREQUENCY;
 * copying the scanner's 106 KB file would add to every function's deploy
 * tally, which counts the whole _shared folder), so the table it serves is
 * held equal to the scanner's instead.
 *
 * Measured on 414 real postings as the job description (corpus in
 * ~/.config/resumebooster/free-scan-wave-corpora/S13-097): the old _shared
 * detector put 339 in healthcare, the scanner's 68. Of the 269 labelled
 * disagreements main was right on 11 and the branch on 260; the 9 the branch
 * gets wrong are real healthcare postings that main called healthcare only
 * because it called almost everything healthcare.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectIndustry } from "../../supabase/functions/_shared/industry-detection";
import { KEYWORD_FREQUENCY as SHARED_FREQ } from "../../supabase/functions/_shared/market-intelligence";
import { KEYWORD_FREQUENCY as SCANNER_FREQ } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import { NON_HEALTHCARE_POSTINGS } from "./fixtures/non-healthcare-postings";

const root = resolve(__dirname, "../../supabase/functions");
const read = (f: string) => readFileSync(resolve(root, f), "utf8");

describe("one industry detector, three places", () => {
  it("_shared and the stream fork carry the scanner's file byte for byte", () => {
    const scanner = read("free-keyword-scan/industry-detection.ts");
    expect(read("_shared/industry-detection.ts")).toBe(scanner);
    expect(read("free-keyword-scan-stream/industry-detection.ts")).toBe(scanner);
  });
  it("the market-pulse table is the scanner's", () => {
    expect(SHARED_FREQ).toEqual(SCANNER_FREQ);
  });
});

describe("the _shared detector no longer reads 'internal' as nursing", () => {
  const resume = "Jane Doe\nMarketing Manager, Acme Corp, 2019 - Present\n- Ran paid search and email campaigns\nSkills: HubSpot, Google Analytics";
  for (const [name, { text }] of Object.entries(NON_HEALTHCARE_POSTINGS)) {
    it(name, () => expect(detectIndustry(resume, undefined, text).jdIndustry).not.toBe("healthcare"));
  }
});
