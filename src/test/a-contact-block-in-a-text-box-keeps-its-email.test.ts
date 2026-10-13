// @vitest-environment node
/**
 * A CONTACT BLOCK IN A TEXT BOX KEEPS ITS EMAIL (S12-128, parse-docx.2026-10-11.26).
 *
 * S11-034 stopped mammoth throwing on a text box written as mc:AlternateContent
 * with a Choice and no Fallback, and its test checked every line but the one
 * inside the box: mammoth reads only the Fallback, so the box's text was read
 * as nothing, and a résumé that keeps its contact block in a text box lost its
 * email (deno run of the shipped module: hasEmail=false). Such a box is now
 * lifted into the text where it sat. Run with the npm mammoth and jszip; the
 * Deno test (parse-docx/docx_test.ts) runs the esm.sh builds parse-docx ships.
 */
import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import JSZip from "jszip";
import { liftChoiceOnlyTextBoxes, readDocxBody } from "../../supabase/functions/parse-docx/docx-text";
import { RESUME_LINES, textBoxNoFallbackDocx, transitionalDocx, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";

const Zip = JSZip as unknown as ZipClass;
const libs = { mammoth: mammoth as never, JSZip: JSZip as never };
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

describe("a text box with no Fallback is read (S12-128)", () => {
  it("the email inside it comes back on its own line, in place", async () => {
    const { body } = await readDocxBody(await textBoxNoFallbackDocx(Zip), libs);
    const L = RESUME_LINES;
    expect(lines(body)).toEqual([L.name, L.email, L.heading, L.role, L.bullet]);
  });

  it("a box that has a Fallback is left for mammoth, and an ordinary document is untouched", async () => {
    const withFallback = '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:txbxContent><w:p><w:r><w:t>a@b.co</w:t></w:r></w:p></w:txbxContent></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>';
    expect(liftChoiceOnlyTextBoxes(withFallback)).toEqual({ xml: withFallback, count: 0 });
    const { body } = await readDocxBody(await transitionalDocx(Zip), libs);
    expect(lines(body)).toHaveLength(5);
  });

  it("several paragraphs in one box are several lines, and escaped text stays escaped", () => {
    const box = '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><wps:txbx><w:txbxContent><w:p><w:r><w:t>Jane &amp; Co</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">jane@</w:t></w:r><w:r><w:t>example.com</w:t></w:r></w:p></w:txbxContent></wps:txbx></mc:Choice></mc:AlternateContent></w:r>';
    const { xml, count } = liftChoiceOnlyTextBoxes(`<w:p>${box}</w:p>`);
    expect(count).toBe(1);
    expect(xml).toContain('<w:t xml:space="preserve">Jane &amp; Co</w:t>');
    expect(xml).toContain('<w:t xml:space="preserve">jane@example.com</w:t>');
    expect(xml).not.toContain("mc:AlternateContent");
  });
});
