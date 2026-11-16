// @vitest-environment node
//
// Node, not jsdom: pdfjs-serverless mistakes jsdom for a browser, and the
// handler half bundles parse-pdf with esbuild, which refuses jsdom's
// TextEncoder (helpers/edge-harness.ts).
/**
 * A RÉSUMÉ FOLLOWED BY IMAGE PAGES IS READ, AND SAYS WHAT IT SKIPPED
 * (S14X-282, C-S14-132).
 *
 * parse-pdf refused any PDF whose text was shorter than 200 characters per
 * page, so a one-page résumé followed by scanned certificates (a common
 * "combined application" upload) was refused as "a scanned image with little
 * or no selectable text". It is now refused only when no page carries a
 * résumé's worth of text; otherwise the text is read and the answer carries
 * notice image_pages_skipped with the number of pages that had next to none.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { scannedVerdict } from "../../supabase/functions/parse-pdf/page-text";
import { parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const BULLET = "Led a team of eight engineers that rebuilt the billing platform and cut invoice errors by 40% in two quarters.";

function resumeWithBlankPages(textPages: number, blankPages: number): Uint8Array {
  const doc = new jsPDF();
  doc.setFontSize(10);
  let first = true;
  for (let p = 0; p < textPages; p++) {
    if (!first) doc.addPage();
    first = false;
    doc.text("Jane Doe | jane@example.com | (415) 555-0134", 15, 20);
    for (let i = 0; i < 13; i++) doc.text(BULLET, 15, 30 + i * 7);
  }
  for (let p = 0; p < blankPages; p++) {
    if (!first) doc.addPage();
    first = false;
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

describe("scannedVerdict", () => {
  it("refuses only when no page has a résumé's worth of text", () => {
    expect(scannedVerdict([1500, 0, 0, 0])).toEqual({ refuse: false, imagePages: 3 });
    expect(scannedVerdict([2500, ...Array(15).fill(4)])).toEqual({ refuse: false, imagePages: 15 });
    expect(scannedVerdict([900, 600])).toEqual({ refuse: false, imagePages: 0 });
    expect(scannedVerdict([150, 150, 150])).toEqual({ refuse: true, imagePages: 0 });
    expect(scannedVerdict([0, 0])).toEqual({ refuse: true, imagePages: 0 });
    expect(scannedVerdict([])).toEqual({ refuse: true, imagePages: 0 });
  });
});

let pdf: ParserHarness;
beforeAll(async () => { pdf = await parserHarness("parse-pdf"); });

describe("parse-pdf, run", () => {
  it("one text page and eleven blank pages answers 200 with the text and image_pages_skipped, 11", async () => {
    const r = await pdf.upload("resume.pdf", resumeWithBlankPages(1, 11));
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(String(r.body.text)).toContain("jane@example.com");
    expect(r.body.pages).toBe(12);
    expect(r.body.notice).toBe("image_pages_skipped");
    expect(r.body.skippedPages).toBe(11);
  });

  it("twelve blank pages are still refused as scanned_or_empty", async () => {
    const r = await pdf.upload("resume.pdf", resumeWithBlankPages(0, 12));
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("scanned_or_empty");
  });

  it("a résumé with no blank page carries no notice", async () => {
    const r = await pdf.upload("resume.pdf", resumeWithBlankPages(2, 0));
    expect(r.status).toBe(200);
    expect(r.body.notice).toBeUndefined();
  });
});
