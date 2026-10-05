// @vitest-environment node
//
// Node, not jsdom: pdfjs-serverless mistakes jsdom for a browser (see
// supabase/functions/parse-pdf/pdfjs-contract.test.ts).
/**
 * A PDF REACHES THE SCANNER LINE BY LINE (register L5-01).
 *
 * parse-pdf joined every pdf.js text item on a page with a space, so each
 * page arrived as ONE line. The scanner reads a résumé line by line, so every
 * PDF upload was scanned as 0 sections, 0 roles and 0 bullets.
 *
 * Run against real pdf.js output: a multi-line résumé is written with jsPDF,
 * read back with the same pdfjs-serverless parse-pdf imports, and passed
 * through the function's own page-text module. The fixture parse-pdf already
 * had (valid-with-text.pdf) holds a single item, which is how a test of it
 * stayed green while every real résumé was flattened.
 */
import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { resolvePDFJS } from "pdfjs-serverless";
import { pageTextFromItems, type PdfTextItem } from "../../supabase/functions/parse-pdf/page-text";

const RESUME_LINES = [
  "Jane Doe",
  "jane.doe@example.com | (555) 010-0199",
  "EXPERIENCE",
  "Senior Analyst, Acme Corp, Jan 2020 - Present",
  "- Cut vendor spend by $250,000 annually",
  "- Led a team of five analysts",
  "Analyst, Beta Inc, Mar 2017 - Dec 2019",
  "- Built the quarterly forecasting model",
  "EDUCATION",
  "BSc Economics, State University, 2016",
];

async function itemsOf(lines: string[]): Promise<PdfTextItem[]> {
  const doc = new jsPDF();
  lines.forEach((line, i) => doc.text(line, 15, 20 + i * 8));
  const data = new Uint8Array(doc.output("arraybuffer"));
  const { getDocument } = await resolvePDFJS();
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  const page = await pdf.getPage(1);
  return (await page.getTextContent()).items as PdfTextItem[];
}

describe("parse-pdf's page text keeps the lines", () => {
  it("a real multi-line PDF comes out as the same lines, in order", async () => {
    const text = pageTextFromItems(await itemsOf(RESUME_LINES));
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines.length, `got:\n${text}`).toBe(RESUME_LINES.length);
    expect(lines).toEqual(RESUME_LINES);
  });

  it("the old join really did flatten it (the defect, measured on the same file)", async () => {
    const items = await itemsOf(RESUME_LINES);
    const flattened = items.map((i) => i.str ?? "").join(" ");
    expect(flattened.includes("\n")).toBe(false);
  });

  it("a producer that sets no end-of-line mark still breaks on a new baseline", () => {
    const at = (str: string, y: number): PdfTextItem => ({ str, transform: [10, 0, 0, 10, 50, y], height: 10, hasEOL: false });
    const text = pageTextFromItems([at("EXPERIENCE", 700), at("Senior", 680), at("Analyst", 680), at("Acme", 660)]);
    expect(text.split("\n")).toEqual(["EXPERIENCE", "Senior Analyst", "Acme"]);
  });

  it("items on one line still join with a space, as before", () => {
    const text = pageTextFromItems([
      { str: "Senior", transform: [10, 0, 0, 10, 50, 700], height: 10 },
      { str: "Analyst", transform: [10, 0, 0, 10, 90, 700], height: 10, hasEOL: true },
      { str: "", transform: [10, 0, 0, 10, 50, 700], height: 0, hasEOL: true },
      { str: "Acme", transform: [10, 0, 0, 10, 50, 680], height: 10 },
    ]);
    expect(text).toBe("Senior Analyst\n\nAcme");
  });
});
