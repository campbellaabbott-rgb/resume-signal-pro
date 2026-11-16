// @vitest-environment node
//
// Node, not jsdom: the handler half bundles parse-docx with esbuild, which
// refuses jsdom's TextEncoder (helpers/edge-harness.ts).
/**
 * A DOCX EXPORTED AS WEB CONTENT IS READ (S14X-281, C-S14-131).
 *
 * Résumé sites and HTML-to-Word converters (html-docx-js and its kind) write a
 * .docx whose body is one w:altChunk: a pointer to an embedded web page,
 * usually a MIME (.mht) message with quoted-printable HTML. Word renders it;
 * mammoth has no reader for it, so parse-docx found no text and refused the
 * upload as "inside an image or text box". The pre-pass now follows the
 * altChunk's relationship, unwraps the MIME part, decodes it, and puts the
 * page's lines where the altChunk sat. When the part cannot be read the
 * refusal says what the file is (code web_export) and how to fix it.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import mammoth from "mammoth";
import JSZip from "jszip";
import { readDocxBody } from "../../supabase/functions/parse-docx/docx-text";
import { altChunkLines, htmlLines } from "../../supabase/functions/parse-docx/alt-chunk";
import { ALT_CHUNK, altChunkDocx, transitionalDocx, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";
import { parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const Zip = JSZip as unknown as ZipClass;
const libs = { mammoth: mammoth as never, JSZip: JSZip as never };
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
const bytes = (s: string) => new TextEncoder().encode(s);

describe("the embedded page, as lines", () => {
  it("block elements are lines; head, script, style and comments are not text; entities are decoded", () => {
    const html = `<html><head><title>T</title><style>p{}</style><script>var a = "<p>no</p>";</script></head><body><!-- hidden --><h1>Ana Lima</h1><p>ana@example.com&nbsp;|&nbsp;Lisboa</p><div>Product &amp; Data</div><ul><li>Grew NPS 12&#37;</li><li>Caf&eacute; &mdash; &#x2713;</li></ul>a<br>b<table><tr><td>2019</td><td>2021</td></tr></table></body></html>`;
    expect(htmlLines(html)).toEqual(["Ana Lima", "ana@example.com | Lisboa", "Product & Data", "Grew NPS 12%", "Café — ✓", "a", "b", "2019 2021"]);
  });

  it("a MIME message is unwrapped and its quoted-printable body decoded, soft breaks and UTF-8 bytes included", () => {
    const mht = "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"B\"\r\n\r\n--B\r\nContent-Type: text/html; charset=\"utf-8\"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>Ing=C3=A9nieur logiciel, a very long line that the mail program wrapped =\r\nhere</p><p class=3D\"x\">Lyon</p>\r\n--B--\r\n";
    expect(altChunkLines(bytes(mht))).toEqual(["Ingénieur logiciel, a very long line that the mail program wrapped here", "Lyon"]);
  });

  it("a base64 part, a windows-1252 charset and a bare HTML part are read too", () => {
    const b64 = Buffer.from("<p>Jo&atilde;o Silva</p><p>São Paulo</p>", "utf8").toString("base64");
    const mime = `Content-Type: multipart/related; boundary=X\r\n\r\n--X\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}\r\n--X--\r\n`;
    expect(altChunkLines(bytes(mime))).toEqual(["João Silva", "São Paulo"]);
    const cp1252 = new Uint8Array([...bytes("<meta charset=\"windows-1252\"><p>Ing"), 0xe9, ...bytes("nieur</p>")]);
    expect(altChunkLines(cp1252)).toEqual(["Ingénieur"]);
    expect(altChunkLines(bytes("<html><body><p>Plain page</p></body></html>"))).toEqual(["Plain page"]);
  });
});

describe("a document whose body is one altChunk", () => {
  it("reads the page's lines in order", async () => {
    const { body, altChunks } = await readDocxBody(await altChunkDocx(Zip), libs);
    expect(lines(body)).toEqual(ALT_CHUNK.lines);
    expect(altChunks).toEqual({ read: 1, unreadable: 0 });
  });

  it("an ordinary document has no altChunk to read", async () => {
    const { altChunks } = await readDocxBody(await transitionalDocx(Zip), libs);
    expect(altChunks).toEqual({ read: 0, unreadable: 0 });
  });
});

let docx: ParserHarness;
beforeAll(async () => { docx = await parserHarness("parse-docx"); });

describe("parse-docx, run", () => {
  it("answers 200 with the résumé's lines", async () => {
    const r = await docx.upload("resume.docx", await altChunkDocx(Zip));
    expect(r.status).toBe(200);
    expect(lines(String(r.body.text))).toEqual(ALT_CHUNK.lines);
  });

  it("an embedded page that cannot be read is refused as web content, with what to do", async () => {
    const r = await docx.upload("resume.docx", await altChunkDocx(Zip, { unreadable: true }));
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("web_export");
    expect(String(r.body.error)).toMatch(/web/i);
    expect(String(r.body.error)).toMatch(/Save As/);
  });
});
