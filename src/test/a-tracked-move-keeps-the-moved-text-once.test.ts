// @vitest-environment node
/**
 * A TRACKED MOVE KEEPS THE MOVED TEXT, ONCE (S14X-125, M-S14-099, C-S14-130).
 *
 * With Track Changes on, Word records a cut-and-paste as a move: the text
 * stays where it was inside w:moveFrom and appears where it went inside
 * w:moveTo. mammoth 1.12.3 reads neither, so a résumé whose job title a coach
 * moved during review lost that line entirely ("Senior Product Manager,
 * Northwind Traders" read as nothing). mammoth 1.13.0 reads moveTo but throws
 * under Deno on every document (parse-docx/docx_test.ts), so the pin stays and
 * the pre-pass does what Word shows with changes accepted: a move's source is
 * dropped, as a deletion is, and its destination is kept, as an insertion is.
 */
import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import JSZip from "jszip";
import { readDocxBody, trackedMovesAccepted } from "../../supabase/functions/parse-docx/docx-text";
import { TRACKED_MOVE, trackedMoveDocx, transitionalDocx, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";

const Zip = JSZip as unknown as ZipClass;
const libs = { mammoth: mammoth as never, JSZip: JSZip as never };
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

describe("a document with tracked moves", () => {
  it("reads the moved line where it went, and only there", async () => {
    const { body } = await readDocxBody(await trackedMoveDocx(Zip), libs);
    const M = TRACKED_MOVE;
    expect(lines(body)).toEqual([
      "Jordan Ellis",
      "jordan.ellis@example.com | (415) 555-0134",
      "SUMMARY",
      M.summary,
      "EXPERIENCE",
      M.moved,
      M.bullet,
      "SKILLS",
      "SQL, Figma, Tableau",
    ]);
  });

  it("drops a move's source and unwraps its destination, leaving the move ranges alone", () => {
    const by = `w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"`;
    const xml = `<w:p><w:pPr><w:rPr><w:moveFrom ${by}/></w:rPr></w:pPr><w:moveFromRangeStart ${by} w:name="m"/><w:moveFrom ${by}><w:r><w:t>old</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="1"/></w:p>`
      + `<w:p><w:moveToRangeStart ${by} w:name="m"/><w:moveTo ${by}><w:r><w:t>new</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="1"/></w:p>`;
    const out = trackedMovesAccepted(xml);
    expect(out.count).toBe(3);
    expect(out.xml).not.toContain("old");
    expect(out.xml).toContain("<w:r><w:t>new</w:t></w:r>");
    expect(out.xml).toContain("<w:moveToRangeStart");
    expect(out.xml).toContain("<w:moveFromRangeEnd");
    expect(out.xml).not.toMatch(/<w:moveTo[\s>]|<\/w:moveTo>|<w:moveFrom[\s>]/);
  });

  it("leaves a document with no moves byte for byte", async () => {
    const xml = `<w:p><w:ins w:id="1"><w:r><w:t>kept</w:t></w:r></w:ins></w:p>`;
    expect(trackedMovesAccepted(xml)).toEqual({ xml, count: 0 });
    expect(lines((await readDocxBody(await transitionalDocx(Zip), libs)).body)).toHaveLength(5);
  });
});
