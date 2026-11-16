// @vitest-environment node
/**
 * A TEXT BOX HOLDING A DRAWING KEEPS ITS EMAIL (S14X-126, M-S14-100).
 *
 * S12-128 lifts a text box written as mc:AlternateContent with a Choice and no
 * Fallback into the text, because mammoth reads only the Fallback. It took the
 * FIRST closing tag after the opening one as the block's end and asked whether
 * the span held a Fallback anywhere. A sidebar box holding an icon (a drawing
 * that is itself an mc:AlternateContent) therefore ended at the icon's close:
 * when the icon had its own Fallback, the sidebar was judged "has a Fallback"
 * and left for mammoth, which read nothing, and the contact block was lost;
 * when it had none, half a block was cut out and the rest left as broken
 * markup. The block now ends at its matching close (nested opens counted),
 * "has a Fallback" is asked of the outer block alone, and a nested drawing
 * contributes only the text it shows.
 */
import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import JSZip from "jszip";
import { liftChoiceOnlyTextBoxes, readDocxBody } from "../../supabase/functions/parse-docx/docx-text";
import { NESTED, NESTED_INNER, nestedTextBoxDocx, nestedTextBoxXml, WORD_TEXT_BOX_XML, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";
import { deriveContact } from "@/lib/resumeContact";

const Zip = JSZip as unknown as ZipClass;
const libs = { mammoth: mammoth as never, JSZip: JSZip as never };
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

describe("a Choice-only sidebar text box", () => {
  for (const inner of Object.keys(NESTED_INNER) as Array<keyof typeof NESTED_INNER>) {
    it(`holding ${inner === "none" ? "no drawing" : inner === "fallback" ? "an icon with its own Fallback" : "a Choice-only drawing"}: the email and phone are read`, async () => {
      const { body } = await readDocxBody(await nestedTextBoxDocx(Zip, inner), libs);
      expect(body).toContain(NESTED.email);
      expect(lines(body)).toContain(NESTED.phone);
      expect(lines(body)).toContain(NESTED.name);
      expect(lines(body)).toContain("EXPERIENCE");
      expect(deriveContact(body).email?.value).toBe(NESTED.email);
    });
  }

  it("is lifted as one block, with no markup of it left behind", () => {
    for (const inner of Object.keys(NESTED_INNER) as Array<keyof typeof NESTED_INNER>) {
      const { xml, count } = liftChoiceOnlyTextBoxes(nestedTextBoxXml(inner));
      expect(count, inner).toBe(1);
      expect(xml, inner).not.toMatch(/mc:AlternateContent|mc:Choice|mc:Fallback|w:txbxContent/);
      expect(xml, inner).toContain(NESTED.email);
    }
  });

  it("Word's own text box, which has a Fallback, is still left for mammoth", () => {
    expect(liftChoiceOnlyTextBoxes(WORD_TEXT_BOX_XML)).toEqual({ xml: WORD_TEXT_BOX_XML, count: 0 });
  });
});
