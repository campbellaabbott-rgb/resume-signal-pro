// @vitest-environment node
/**
 * WHAT A CANDIDATE WROTE IS WHAT THE SCANNER READS.
 *
 * Each case below is a register item from the 2026-10-04 sweep, run against
 * the shipped module:
 *   L5-05  a job change across a calendar year is not a seven-month gap;
 *   L5-06  a figure ending a sentence is still the candidate's figure;
 *   L5-08  a quote from a non-Latin résumé is grounded, not dropped;
 *   L5-07  contact details in a Word page header reach the scanner;
 *   L5-09  a quoted multi-line CSV cell is one cell, an empty header no column;
 *   L5-17  a LinkedIn analysis missing fields renders, never crashes;
 *   L4-09  the homepage states the detection table's own industry count;
 *   L5-18  no market sentence a reader sees asserts a year as "now".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import { extractTimeline, getMarketInsight } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import { groundedIn, normalizeForGrounding } from "../../supabase/functions/free-keyword-scan/grounding";
import { unsupportedNumericClaims, validateProseClaims } from "../../supabase/functions/_shared/resume-grounding";
import { headerFooterLines, linesOfWordXml, withHeaderFooter, type ZipLike } from "../../supabase/functions/parse-docx/header-footer";
import { findColumnIndex, parseCSV } from "../../supabase/functions/parse-spreadsheet/csv";
import { coerceLinkedInAnalysis } from "../../supabase/functions/analyze-linkedin-profile/coerce";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("L5-05: the employment timeline", () => {
  it("consecutive jobs across a year boundary open no gap", () => {
    const t = extractTimeline([
      "Senior Analyst, Acme Corp",
      "Jan 2020 - Present",
      "Analyst, Beta Inc",
      "Mar 2017 - Dec 2019",
      "Junior Analyst, Gamma LLC",
      "Jun 2015 - Feb 2017",
    ].join("\n"));
    expect(t.entries).toHaveLength(3);
    expect(t.gapPeriods).toEqual([]);
    expect(t.hasSignificantGap).toBe(false);
    expect(t.formattedSummary).not.toMatch(/gap/i);
  });

  it("a real gap is measured in calendar months", () => {
    const t = extractTimeline(["Engineer, Acme", "Jan 2019 - Present", "Engineer, Beta", "Jan 2016 - Mar 2018"].join("\n"));
    expect(t.gapPeriods.map((g) => g.monthsGap)).toEqual([9]);
    expect(t.hasSignificantGap).toBe(true);
  });

  it("bare years never invent a gap, and an overlapping side job opens none", () => {
    expect(extractTimeline(["Engineer, Acme", "2020 - Present", "Engineer, Beta", "2016 - 2019"].join("\n")).gapPeriods).toEqual([]);
    const t = extractTimeline(["Engineer, Acme", "Jan 2015 - Present", "Consultant, Side Gig", "Mar 2017 - Jun 2017"].join("\n"));
    expect(t.gapPeriods).toEqual([]);
  });

  it("two ranges on one line are two roles", () => {
    expect(extractTimeline("Engineer, Acme 2015 - 2017, Lead, Beta 2018 - 2020").entries).toHaveLength(2);
  });
});

describe("L5-06: numeric grounding", () => {
  const resume = "Cut vendor spend by $250,000 annually and grew revenue 32%.";
  it("a figure that ends the draft's sentence is still the résumé's figure", () => {
    expect(unsupportedNumericClaims(resume, "I cut vendor spend by $250,000.")).toEqual([]);
    expect(validateProseClaims(resume, "I cut vendor spend by $250,000. I grew revenue 32%.")).toEqual([]);
  });
  it("and the other way round", () => {
    expect(unsupportedNumericClaims("Saved the firm $1,200,000.", "Saved $1,200,000 in a year")).toEqual([]);
  });
  it("an invented figure is still refused", () => {
    expect(unsupportedNumericClaims(resume, "I cut vendor spend by $400,000.")).toEqual(["$400,000."]);
  });
});

describe("L5-08: claim grounding in every script", () => {
  const hindi = "वरिष्ठ विश्लेषक\nमैंने 2018 में बिक्री प्रक्रिया को स्वचालित किया और लागत 30% घटाई";
  it("a verbatim Hindi bullet is grounded", () => {
    const appears = groundedIn(hindi);
    expect(normalizeForGrounding("बिक्री प्रक्रिया")).not.toBe("");
    expect(appears("मैंने 2018 में बिक्री प्रक्रिया को स्वचालित किया")).toBe(true);
    expect(appears("मैंने नई टीम बनाई")).toBe(false);
  });
  it("Latin text grounds exactly as before", () => {
    const appears = groundedIn("Led a team of five analysts at Acme.");
    expect(appears("Led a team of five analysts")).toBe(true);
    expect(appears("Led a team of fifty analysts")).toBe(false);
  });
});

describe("L5-07: Word page headers and footers", () => {
  async function docxWithHeader(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;
    zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>EXPERIENCE</w:t></w:r></w:p><w:p><w:r><w:t>Senior Analyst, Acme</w:t></w:r></w:p></w:body></w:document>`);
    zip.file("word/header1.xml", `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">jane@example.com </w:t></w:r><w:r><w:tab/><w:t>(555) 010-0199 &amp; linkedin.com/in/janedoe</w:t></w:r></w:p></w:hdr>`);
    zip.file("word/header2.xml", `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p></w:hdr>`);
    zip.file("word/footer1.xml", `<?xml version="1.0"?><w:ftr ${W}><w:p><w:r><w:t>Page 1</w:t></w:r></w:p><w:p><w:r><w:t>References on request</w:t></w:r></w:p></w:ftr>`);
    return zip.generateAsync({ type: "uint8array" });
  }

  it("mammoth alone loses the header (the defect)", async () => {
    const bytes = await docxWithHeader();
    const body = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    expect(body).not.toContain("jane@example.com");
  });

  it("the header lines come first, de-duplicated, and the footer after the body", async () => {
    const bytes = await docxWithHeader();
    const body = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value.trim();
    const parts = await headerFooterLines(await JSZip.loadAsync(bytes) as unknown as ZipLike);
    const text = withHeaderFooter(body, parts);
    expect(text.split("\n").filter(Boolean)).toEqual([
      "Jane Doe",
      "jane@example.com (555) 010-0199 & linkedin.com/in/janedoe",
      "EXPERIENCE",
      "Senior Analyst, Acme",
      "References on request",
    ]);
  });

  it("reads a paragraph's runs, tabs and entities as one line", () => {
    expect(linesOfWordXml(`<w:p><w:r><w:t>A&amp;B</w:t></w:r><w:r><w:tab/><w:t>C&#233;</w:t></w:r></w:p><w:p></w:p>`)).toEqual(["A&B Cé"]);
  });
});

describe("L5-09: the job-list CSV", () => {
  it("a quoted cell spanning lines is one cell, not extra jobs", () => {
    const csv = `Title,Company,Description\r\nAnalyst,Acme,"Own reporting.\n- Build dashboards in Tableau\n- Partner with finance"\nEngineer,Beta,"Ship ""fast"", safely"\n`;
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1][2]).toBe("Own reporting.\n- Build dashboards in Tableau\n- Partner with finance");
    expect(rows[2][2]).toBe('Ship "fast", safely');
  });

  it("an empty header (a pandas index column) matches nothing", () => {
    const headers = ["", "title", "company", "description", "url"];
    expect(findColumnIndex(headers, ["title", "job title"])).toBe(1);
    expect(findColumnIndex(headers, ["company"])).toBe(2);
    expect(findColumnIndex(headers, ["url", "link"])).toBe(4);
    expect(findColumnIndex(["", "x"], ["description"])).toBe(-1);
  });
});

describe("L5-17: the LinkedIn analysis has the shape the page reads", () => {
  it("a reply missing objects and arrays is filled in, not passed through", () => {
    const a = coerceLinkedInAnalysis({ linkedinScore: "71", headline: null, consistencyIssues: [{ description: "Title differs", severity: "HIGH" }, "junk"] });
    expect(a.linkedinScore).toBe(71);
    expect(a.linkedinGrade).toBe("C");
    expect(a.headline.issues).toEqual([]);
    expect(a.about.issues).toEqual([]);
    expect(a.profileCompleteness).toEqual({ score: 0, missing: [] });
    expect(a.missingFromLinkedIn).toEqual([]);
    expect(a.linkedinTips).toEqual([]);
    expect(a.consistencyIssues).toEqual([{ type: "other", description: "Title differs", severity: "high" }]);
  });
  it("garbage of any type still yields the full shape", () => {
    for (const raw of [null, 42, "text", [], { headline: [1, 2] }]) {
      const a = coerceLinkedInAnalysis(raw);
      expect(Array.isArray(a.headline.issues) && Array.isArray(a.linkedinTips) && typeof a.profileCompleteness.score === "number").toBe(true);
    }
  });
});

describe("L4-09: the homepage's industry count is the detection table's", () => {
  it("the structured data states exactly how many industries the scanner detects", () => {
    const index = read("src/pages/Index.tsx");
    const m = /const DETECTED_INDUSTRY_COUNT = (\d+);/.exec(index);
    expect(m, "the count constant is gone from Index.tsx").not.toBeNull();
    expect(Number(m![1])).toBe(Object.keys(INDUSTRY_KEYWORDS).length);
    expect(index).not.toMatch(/\b\d{2} industries\b/);
  });
});

describe("L5-18: market copy names no year as the present", () => {
  it("no market summary a reader sees asserts a year", () => {
    for (const [country, industry] of [["US", "technology"], ["GB", "technology"], ["US", "finance"], ["US", "product_management"], ["GB", "consulting"]]) {
      const insight = getMarketInsight(country, industry);
      expect(insight?.marketSummary ?? "", `${country}:${industry}`).not.toMatch(/\b20\d\d\b/);
    }
  });
});
