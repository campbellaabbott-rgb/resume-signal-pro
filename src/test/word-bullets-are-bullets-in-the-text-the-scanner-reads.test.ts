// @vitest-environment node
//
// Node, not jsdom: the docx library and jszip build real packages here.
/**
 * WORD'S BULLETS ARE BULLETS IN THE TEXT THE SCANNER READS (register S13-037).
 *
 * A list made with Word's bullet button keeps its glyph in numbering.xml, and
 * mammoth's raw text dropped it, so the scanner's tone audit and its
 * quantified-bullet count (which read lines that open with a bullet mark) saw
 * no bullets in any DOCX built that way, our own builder's export included
 * (src/lib/resume-builder-export.ts writes bullet: { level: 0 }). The report
 * said "Too passive, 0 active bullets" and "Quantified bullets: 0". parse-docx
 * now gives every paragraph whose numbering resolves to a bullet format a
 * "• " run before mammoth reads it; numbered lists, numbered headings,
 * numbering removed (numId 0) and a tracked change's old bullet get nothing.
 *
 * Corpus (~/.config/resumebooster/free-scan-wave-corpora/S13-037): 1,251
 * paragraphs. Real (every Word-saved .docx on this machine: mammoth's own test
 * documents) 15: main right on 13, the branch on 15. Producer (docx@9.7.1,
 * the library our builder exports with; synthetic content) 779: main 511, the
 * branch 779. Hand-written WordprocessingML (synthetic) 457: main 265, the
 * branch 457. Worse on none.
 */
import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import JSZip from "jszip";
import * as docx from "docx";
import { readDocxBody, readNumberingFormats, readStyleNumbering, listBulletsAsText } from "../../supabase/functions/parse-docx/docx-text";
import { RESUME_LINES, WORD_BULLETS, transitionalDocx, wordBulletsDocx, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";
import slice from "./fixtures/free-scan-wave/s13-037-list-shapes.json";

const Zip = JSZip as unknown as ZipClass;
const libs = { mammoth: mammoth as never, JSZip: JSZip as never };
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

describe("a document made with Word's bullet button", () => {
  it("keeps a bullet on each bullet, and on nothing else", async () => {
    const { body, listBullets } = await readDocxBody(await wordBulletsDocx(Zip), libs);
    const B = WORD_BULLETS;
    expect(lines(body)).toEqual([
      RESUME_LINES.name,
      B.heading,
      RESUME_LINES.role,
      ...B.bullets.map((t) => `• ${t}`),
      `• ${B.styled}`,
      B.removed,
      B.wasBullet,
      ...B.numbered,
    ]);
    expect(listBullets).toBe(4);
  });

  it("a document with no lists reads as it did", async () => {
    const { body, listBullets } = await readDocxBody(await transitionalDocx(Zip), libs);
    expect(listBullets).toBe(0);
    expect(body).not.toContain("•");
  });

  it("our own builder's DOCX export (docx bullet: { level: 0 }) keeps its bullets", async () => {
    const doc = new docx.Document({
      sections: [{
        children: [
          new docx.Paragraph({ children: [new docx.TextRun("Jane Doe")] }),
          new docx.Paragraph({ children: [new docx.TextRun("Operations Lead, Acme")] }),
          new docx.Paragraph({ children: [new docx.TextRun("Cut late deliveries 18% with a carrier scorecard")], bullet: { level: 0 } }),
          new docx.Paragraph({ children: [new docx.TextRun("Hired and trained 12 planners")], bullet: { level: 0 } }),
          new docx.Paragraph({ children: [new docx.TextRun("Python  •  SQL  •  Lean")] }),
        ],
      }],
    });
    const { body } = await readDocxBody(new Uint8Array(await docx.Packer.toBuffer(doc)), libs);
    expect(lines(body)).toEqual([
      "Jane Doe",
      "Operations Lead, Acme",
      "• Cut late deliveries 18% with a carrier scorecard",
      "• Hired and trained 12 planners",
      "Python  •  SQL  •  Lean",
    ]);
  });
});

describe("the numbering a paragraph names", () => {
  const numbering = readNumberingFormats(
    `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><mc:AlternateContent><mc:Choice Requires="w14"><w:numFmt w:val="custom" w:format="001"/></mc:Choice><mc:Fallback><w:numFmt w:val="decimal"/></mc:Fallback></mc:AlternateContent></w:lvl></w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
    `<w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:lvlOverride></w:num>` +
    `<w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num>`,
  );
  it("reads levels, level overrides and a w14 custom format's fallback", () => {
    expect(numbering.get("1")?.get("0")).toBe("decimal");
    expect(numbering.get("1")?.get("1")).toBe("bullet");
    expect(numbering.get("2")?.get("0")).toBe("bullet");
    expect(numbering.get("3")?.get("0")).toBe("decimal");
  });
  it("follows a style's basedOn to its numbering", () => {
    const styles = readStyleNumbering(
      `<w:style w:styleId="ListBullet"><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>` +
      `<w:style w:styleId="Mine"><w:basedOn w:val="ListBullet"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>`,
    );
    expect(styles.get("Mine")).toEqual({ numId: "2", ilvl: null });
    const { count } = listBulletsAsText(`<w:p><w:pPr><w:pStyle w:val="Mine"/></w:pPr><w:r><w:t>Led it</w:t></w:r></w:p>`, numbering, styles);
    expect(count).toBe(1);
  });
  it("claims nothing without a numbering part", () => {
    const xml = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Led it</w:t></w:r></w:p>`;
    expect(listBulletsAsText(xml, new Map(), new Map())).toEqual({ xml, count: 0 });
  });
});

describe("the corpus slice: every list shape the rule resolves or declines", () => {
  type Shape = { name: string; pPr: string; bullet: boolean };
  const s = slice as { numbering: string; styles: string; shapes: Shape[] };
  const numbering = readNumberingFormats(s.numbering);
  const styles = readStyleNumbering(s.styles);
  it("holds at least 19 shapes, both kinds", () => {
    expect(s.shapes.length).toBeGreaterThanOrEqual(19);
    expect(s.shapes.some((x) => x.bullet) && s.shapes.some((x) => !x.bullet)).toBe(true);
  });
  for (const shape of s.shapes) {
    it(`${shape.name} → ${shape.bullet ? "a bullet" : "no bullet"}`, () => {
      const xml = `<w:p w:rsidR="00A1B2C3">${shape.pPr}<w:r><w:t xml:space="preserve">Led the night shift</w:t></w:r></w:p>`;
      expect(listBulletsAsText(xml, numbering, styles).count).toBe(shape.bullet ? 1 : 0);
    });
  }
});
