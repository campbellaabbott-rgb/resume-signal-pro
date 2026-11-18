// @vitest-environment node
//
// Node, not jsdom: pdfjs-serverless mistakes jsdom for a browser, and the
// handler half bundles the functions with esbuild, which refuses jsdom's
// TextEncoder (helpers/edge-harness.ts).
/**
 * EVERY PARSE REFUSAL IS SAID IN THE READER'S LANGUAGE (S14X-183, M-S14-159,
 * C-S14-096).
 *
 * parse-pdf and parse-docx named two of their refusals with a code (a damaged
 * file, an unreadable font), and the page translated only those. Every other
 * refusal (an empty file, a password-protected or invalid PDF, too many
 * pages, a scanned PDF, an old .doc, a document with no text) answered an
 * English sentence and no code, so a German reader got the server's English
 * under a generic title. Every refusal now answers a code, each code has its
 * strings in the nine languages, and a Word document with garbled text is no
 * longer titled as a PDF.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { PARSE_FAILURE_CODES, parseFailureCopy, parseNoticeCopy } from "@/lib/parse-failure-copy";
import { mergeShards, type Bundle } from "@/i18n/merge-shards";
import { emptyDocx, garbledDocx, altChunkDocx, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";
import { readMainLocale, readShards } from "./helpers/locale-strings";
import { codeOf } from "./helpers/strip-comments";
import { pdfFixture } from "./helpers/pdf-pages";
import { parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const Zip = JSZip as unknown as ZipClass;

/** A t() over one language's main locale with its shards merged in, as the running page has it. */
function translator(file: string) {
  const bundle = mergeShards(readMainLocale(file), readShards(file));
  return (key: string, values: Record<string, unknown> = {}) => {
    let v: unknown = bundle;
    for (const part of key.split(".")) v = (v as Bundle | undefined)?.[part];
    if (typeof v !== "string") return key;
    return v.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
  };
}
const de = translator("de.json");
const en = translator("en.json");

function pdfWithPages(n: number, text = false): Uint8Array {
  const doc = new jsPDF();
  for (let p = 0; p < n; p++) {
    if (p > 0) doc.addPage();
    if (text) doc.text(`Page ${p + 1}`, 15, 20);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(504).fill(0)]);

let pdf: ParserHarness;
let docx: ParserHarness;
const answered: Array<{ fn: string; case: string; status: number; body: Record<string, unknown> }> = [];
beforeAll(async () => {
  pdf = await parserHarness("parse-pdf");
  docx = await parserHarness("parse-docx");
  const runs: Array<[string, string, () => Promise<{ status: number; body: Record<string, unknown> }>]> = [
    ["parse-pdf", "an empty file", () => pdf.upload("resume.pdf", new Uint8Array(0))],
    ["parse-pdf", "a password-protected PDF", () => pdf.upload("resume.pdf", pdfFixture("password-protected.pdf"))],
    ["parse-pdf", "a file that is not a PDF", () => pdf.upload("resume.pdf", pdfFixture("corrupted.pdf"))],
    ["parse-pdf", "a 51-page PDF", () => pdf.upload("resume.pdf", pdfWithPages(51, true))],
    ["parse-pdf", "a blank PDF", () => pdf.upload("resume.pdf", pdfWithPages(1))],
    ["parse-docx", "an empty file", () => docx.upload("resume.docx", new Uint8Array(0))],
    ["parse-docx", "an old .doc or a locked .docx", () => docx.upload("resume.docx", OLE)],
    ["parse-docx", "a document with no text", async () => docx.upload("resume.docx", await emptyDocx(Zip))],
    ["parse-docx", "a document with garbled text", async () => docx.upload("resume.docx", await garbledDocx(Zip))],
    ["parse-docx", "a web export whose page is missing", async () => docx.upload("resume.docx", await altChunkDocx(Zip, { unreadable: true }))],
  ];
  for (const [fn, name, run] of runs) answered.push({ fn, case: name, ...(await run()) });
});

describe("every refusal answers a code the page knows", () => {
  it("each refused upload is a 422 with a code", () => {
    for (const a of answered) {
      expect(a.status, `${a.fn}: ${a.case}`).toBe(422);
      expect(PARSE_FAILURE_CODES, `${a.fn}: ${a.case} answered ${JSON.stringify(a.body.code)}`).toContain(a.body.code);
    }
  });

  it("the codes are the ones each case is", () => {
    const code = (fn: string, name: string) => answered.find((a) => a.fn === fn && a.case === name)?.body.code;
    expect(code("parse-pdf", "an empty file")).toBe("empty_file");
    expect(code("parse-pdf", "a password-protected PDF")).toBe("password_protected");
    expect(["invalid_pdf", "damaged_file"]).toContain(code("parse-pdf", "a file that is not a PDF"));
    expect(code("parse-pdf", "a 51-page PDF")).toBe("too_many_pages");
    expect(code("parse-pdf", "a blank PDF")).toBe("scanned_or_empty");
    expect(code("parse-docx", "an empty file")).toBe("empty_file");
    expect(code("parse-docx", "an old .doc or a locked .docx")).toBe("legacy_doc_or_encrypted");
    expect(code("parse-docx", "a document with no text")).toBe("empty_or_too_short");
    expect(code("parse-docx", "a document with garbled text")).toBe("garbled_text");
    expect(code("parse-docx", "a web export whose page is missing")).toBe("web_export");
    const many = answered.find((a) => a.case === "a 51-page PDF")!.body;
    expect([many.pages, many.max]).toEqual([51, 50]);
    expect(answered.find((a) => a.case === "a document with garbled text")!.body.file).toBe("docx");
  });

  it("every code either handler can answer has strings", () => {
    for (const fn of ["parse-pdf", "parse-docx"]) {
      const src = codeOf(readFileSync(resolve(__dirname, `../../supabase/functions/${fn}/index.ts`), "utf8"));
      const codes = [...src.matchAll(/\bcode:\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
      expect(codes.length, fn).toBeGreaterThanOrEqual(7);
      for (const c of codes) expect(PARSE_FAILURE_CODES, `${fn} answers ${c}`).toContain(c);
    }
  });
});

describe("the page says each one in German", () => {
  it("a German reader gets German copy for every refusal, never the server's English", () => {
    for (const a of answered) {
      const copy = parseFailureCopy(de, a.body);
      const english = parseFailureCopy(en, a.body);
      expect(copy, `${a.fn}: ${a.case}`).not.toBeNull();
      expect(copy!.title, a.case).not.toMatch(/^ingestParsers\.|^homepage\./);
      expect(copy!.title, a.case).not.toBe(english!.title);
      expect(copy!.description, a.case).not.toBe(english!.description);
      expect(copy!.description, a.case).not.toBe(a.body.error);
    }
  });

  it("the page count reaches the sentence, and a Word document is not called a PDF", () => {
    const many = answered.find((a) => a.case === "a 51-page PDF")!.body;
    expect(parseFailureCopy(de, many)!.description).toContain("51");
    expect(parseFailureCopy(de, many)!.description).toContain("50");
    const garbled = answered.find((a) => a.case === "a document with garbled text")!.body;
    expect(parseFailureCopy(en, garbled)!.title).not.toMatch(/PDF/);
    expect(parseFailureCopy(en, { code: "garbled_text" })!.title).toMatch(/PDF/);
  });

  it("the two rate limits are said too", () => {
    for (const code of ["rate_limited_budget", "rate_limited_function"]) {
      expect(parseFailureCopy(de, { code })!.title).toBe("Gerade zu viele Uploads");
    }
  });

  it("the new notices are said with their numbers", () => {
    expect(parseNoticeCopy(de, { notice: "rtl_unreliable" })!.title).toMatch(/Reihenfolge/);
    expect(parseNoticeCopy(de, { notice: "image_pages_skipped", skippedPages: 11 })!.description).toContain("11");
    expect(parseNoticeCopy(de, { notice: "unread_characters", unreadCharacters: 3 })).not.toBeNull();
    expect(parseNoticeCopy(de, { notice: "something_else" })).toBeNull();
  });
});
