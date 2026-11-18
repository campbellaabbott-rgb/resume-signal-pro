// @vitest-environment node
//
// Node, not jsdom: the handler half bundles parse-docx with esbuild, which
// refuses jsdom's TextEncoder (helpers/edge-harness.ts).
/**
 * A DOCX THAT CANNOT BE UNPACKED IS THE FILE'S PROBLEM (S14X-124, M-S14-098).
 *
 * readDocxBody named a zip the reader refused and a document mammoth could not
 * walk as DamagedDocxError, a 422 about the file. Between those two steps it
 * read the main document part, the numbering and styles parts, and wrote the
 * rewritten zip, outside any guard: a part whose deflated bytes were damaged
 * (a truncated download, a bad sector) threw a plain Error from the zip
 * reader, which parse-docx answered with a 500. The browser retries a 500 and
 * counts it towards the parse circuit, so the visitor's next, valid file was
 * refused as an outage. Every read after the zip opens is now inside the same
 * guard.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import mammoth from "mammoth";
import JSZip from "jszip";
import { DamagedDocxError, readDocxBody } from "../../supabase/functions/parse-docx/docx-text";
import { damagedPartDocx, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";
import { parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const Zip = JSZip as unknown as ZipClass;
const libs = { mammoth: mammoth as never, JSZip: JSZip as never };
const PARTS = ["word/document.xml", "word/numbering.xml"] as const;

describe("a part whose bytes are damaged", () => {
  for (const part of PARTS) {
    it(`${part}: the zip opens, reading the part fails, and the failure is named as the file's`, async () => {
      const bytes = await damagedPartDocx(Zip, part);
      // The zip directory itself is intact: this is not the not-a-zip case.
      await expect(JSZip.loadAsync(bytes)).resolves.toBeTruthy();
      let caught: unknown;
      try { await readDocxBody(bytes, libs); } catch (e) { caught = e; }
      expect(caught, String(caught)).toBeInstanceOf(DamagedDocxError);
      expect((caught as DamagedDocxError).reason).toBe("unreadable_document");
    });
  }
});

let docx: ParserHarness;
beforeAll(async () => { docx = await parserHarness("parse-docx"); });

describe("parse-docx, run", () => {
  for (const part of PARTS) {
    it(`a damaged ${part} answers 422 damaged_file, never a 500`, async () => {
      const r = await docx.upload("resume.docx", await damagedPartDocx(Zip, part));
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("damaged_file");
    });
  }
});
