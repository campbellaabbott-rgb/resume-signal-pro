// @vitest-environment node
//
// Node, not jsdom: pdfjs-serverless mistakes jsdom for a browser, and the
// handler half bundles parse-pdf with esbuild, which refuses jsdom's
// TextEncoder (helpers/edge-harness.ts).
/**
 * A RIGHT-TO-LEFT PDF READS IN THE ORDER IT IS WRITTEN (S14X-044, C-S14-039,
 * M-S14-097).
 *
 * pdf.js gives each Hebrew or Arabic run's text in reading order, but a
 * line's items in the order Chrome drew them, left to right. parse-pdf joined
 * them in that order, so every Hebrew line holding a number, an email or a
 * Latin word came out in reversed pieces: ".25%אנשים בפיתוח מוצר חדש שהגדיל
 * את ההכנסות ב- 10 הובלתי צוות של". A right-to-left line is now read right to
 * left, a run of Latin letters kept as one left-to-right unit, a number on
 * its own.
 *
 * Arabic is damaged inside pdf.js itself (its joined letters come back in the
 * wrong order: "اململكة" for "المملكة"), which no ordering repairs, so an
 * upload whose letters are at least 30% Arabic is accepted with notice
 * rtl_unreliable, which recommends a .docx or pasted text. Its text is kept.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { pageTextFromItems, type PdfTextItem } from "../../supabase/functions/parse-pdf/page-text";
import { pdfFixture, pdfText } from "./helpers/pdf-pages";
import { parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

describe("a Hebrew résumé printed by Chrome", () => {
  it("reads each line in the order it is written", async () => {
    const got = lines(await pdfText(pdfFixture("chrome-he.pdf")));
    for (const want of [
      "נועה כהן",
      "noa.cohen@gmail.com | 052-123-4567 | תל אביב",
      "מנהלת מוצר בכירה, וויקס 2019 – היום",
      "הובלתי צוות של 10 אנשים בפיתוח מוצר חדש שהגדיל את ההכנסות ב-25%.",
      "שיפרתי את שיעור ההמרה של משתמשים חדשים מ-3% ל-5.5%.",
      "מנהלת מוצר, מונדיי.קום 2015 – 2019",
      "ניהול מוצר, SQL, Figma, Jira, ניתוח נתונים, אנגלית ברמת שפת אם",
    ]) expect(got, want).toContain(want);
  });
});

describe("the ordering rule", () => {
  const item = (str: string, x: number, width: number, eol = false): PdfTextItem => ({ str, transform: [1, 0, 0, 1, x, 700], width, height: 10, hasEOL: eol, dir: /[֐-׿]/.test(str) ? "rtl" : "ltr" });

  it("an English page with a Hebrew word keeps the order it was drawn in", () => {
    const items = [item("Languages: English,", 50, 90), item(" ", 140, 3), item("עברית", 143, 25), item(" ", 168, 3), item("(native)", 171, 35)];
    expect(pageTextFromItems(items)).toBe("Languages: English, עברית (native)");
  });

  it("a page with no right-to-left letters is joined exactly as before", () => {
    const items = [item("Jane", 50, 20), item(" ", 70, 3), item("Doe", 73, 15, true), { str: "Engineer", transform: [1, 0, 0, 1, 50, 680], width: 40, height: 10 }];
    expect(pageTextFromItems(items)).toBe("Jane Doe\nEngineer");
  });
});

let pdf: ParserHarness;
beforeAll(async () => { pdf = await parserHarness("parse-pdf"); });

describe("parse-pdf, run", () => {
  it("a Hebrew PDF answers its lines in order, with no notice", async () => {
    const r = await pdf.upload("resume.pdf", pdfFixture("chrome-he.pdf"));
    expect(r.status).toBe(200);
    expect(String(r.body.text)).toContain("הובלתי צוות של 10 אנשים");
    expect(String(r.body.text)).toContain("052-123-4567");
    expect(r.body.notice).toBeUndefined();
  });

  it("an Arabic PDF is accepted with its text and the notice that says pdf.js cannot rebuild its letters", async () => {
    const r = await pdf.upload("resume.pdf", pdfFixture("chrome-ar.pdf"));
    expect(r.status).toBe(200);
    expect(r.body.notice).toBe("rtl_unreliable");
    expect(String(r.body.text)).toContain("العربية السعودية");
  });
});
