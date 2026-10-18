// @vitest-environment node
//
// Node, not jsdom: pdfjs-serverless mistakes jsdom for a browser (see
// supabase/functions/parse-pdf/pdfjs-contract.test.ts).
/**
 * A LETTER-SPACED HEADING IS A HEADING (S12-027, parse-pdf.2026-10-11.26).
 *
 * A résumé whose section titles are styled with letter-spacing, printed by
 * Chrome (the fixture: headless Chrome, h2 { letter-spacing: 0.3em }), reaches
 * pdf.js with a gap after every glyph, and pdf.js writes each gap as a space:
 * "W O R K" " " "E X P E R I E N C E". The scanner's section reader found one
 * section and reported Experience, Education and Skills empty (too_few),
 * where the same résumé untracked reads three. A run of single letters one
 * space apart inside an item is now the word it spells.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolvePDFJS } from "pdfjs-serverless";
import { pageTextFromItems, untrack, type PdfTextItem } from "../../supabase/functions/parse-pdf/page-text";

vi.setConfig({ testTimeout: 60_000 });

const FIXTURE = resolve(__dirname, "../../supabase/functions/parse-pdf/__fixtures__/chrome-tracked-headings.pdf");

async function itemsOf(path: string): Promise<PdfTextItem[]> {
  const { getDocument } = await resolvePDFJS();
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  return (await (await doc.getPage(1)).getTextContent()).items as PdfTextItem[];
}

describe("letter-spaced section titles read as words (S12-027)", () => {
  it("the Chrome fixture's headings come back as WORK EXPERIENCE, EDUCATION and SKILLS", async () => {
    const items = await itemsOf(FIXTURE);
    // The defect, measured on the same file: pdf.js spells the tracking out.
    expect(items.map((i) => i.str).filter((s) => /^(?:\S )+\S$/.test(s ?? ""))).toEqual(expect.arrayContaining(["W O R K", "E X P E R I E N C E", "E D U C A T I O N", "S K I L L S"]));
    const lines = pageTextFromItems(items).split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines).toContain("WORK EXPERIENCE");
    expect(lines).toContain("EDUCATION");
    expect(lines).toContain("SKILLS");
    // The scanner's section reader starts a section at a line that begins with its word.
    const headers = lines.filter((l) => l.length < 60 && /^(experience|work|education|skills)/i.test(l));
    expect(headers).toEqual(["WORK EXPERIENCE", "EDUCATION", "SKILLS"]);
  });

  it("positive control: ordinary text on the same page is untouched", async () => {
    const text = pageTextFromItems(await itemsOf(FIXTURE));
    expect(text).toContain("marta.lindqvist@example.com | +46 70 123 4567 | Stockholm");
    expect(text).toContain("Cut the monthly reporting cycle from five days to one by automating the SQL pipeline.");
    expect(text).toContain("SQL, Python, dbt, Tableau, Looker, experimentation, forecasting");
  });

  it("the rule: three letters or more, one space apart; a wider gap is a word gap; other text is left alone", () => {
    expect(untrack("W O R K")).toBe("WORK");
    expect(untrack("W O R K   E X P E R I E N C E")).toBe("WORK   EXPERIENCE");
    expect(untrack("É D U C A T I O N")).toBe("ÉDUCATION");
    expect(untrack("R & D")).toBe("R & D");
    expect(untrack("A B")).toBe("A B");
    expect(untrack("Data Analyst")).toBe("Data Analyst");
    expect(untrack("SQL, C, R")).toBe("SQL, C, R");
  });
});
