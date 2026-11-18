// @vitest-environment node
/**
 * A UNICODE .TXT RÉSUMÉ IS READ AS TEXT (S14X-283, C-S14-133).
 *
 * The page read an uploaded .txt with file.text(), which is UTF-8 only.
 * Notepad's "Unicode" and Word's "Unicode Text" save UTF-16 with a
 * byte-order mark, so every letter came back with a NUL beside it and setup
 * read nothing it could use; a windows-1252 file lost its accents. readTextFile
 * honours the mark, falls back to windows-1252 for bytes that are not UTF-8,
 * applies the parsers' intake cleanup, and says whether the result is still
 * not text, which resumeTextFrom answers as "" (its contract for every
 * failure). The five page call sites that still call file.text() move to it
 * after the round (call-sites lane).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn(async () => ({ data: null, error: new Error("not called") })) } } }));

const { readTextFile, resumeTextFrom } = await import("@/lib/resumeText");

const RESUME = "Jane Doe\r\nIngénieure logiciel — Lyon\r\nCo‑founded a start-up; Kuber­netes, Python\r\n";
const READ = "Jane Doe\r\nIngénieure logiciel — Lyon\r\nCo-founded a start-up; Kubernetes, Python\r\n";

function utf16(text: string, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out.set(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[2 + i * 2] = bigEndian ? c >> 8 : c & 0xff;
    out[3 + i * 2] = bigEndian ? c & 0xff : c >> 8;
  }
  return out;
}
const file = (bytes: Uint8Array | string, name = "resume.txt") => new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type: "text/plain" });

describe("readTextFile", () => {
  it("reads UTF-16 little-endian and big-endian files by their mark", async () => {
    expect(await readTextFile(file(utf16(RESUME, false)))).toEqual({ text: READ, garbled: false });
    expect(await readTextFile(file(utf16(RESUME, true)))).toEqual({ text: READ, garbled: false });
  });

  it("drops a UTF-8 mark and reads plain UTF-8 as before, cleaned the same way", async () => {
    const utf8 = new TextEncoder().encode(RESUME);
    expect((await readTextFile(file(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])))).text).toBe(READ);
    expect((await readTextFile(file(utf8))).text).toBe(READ);
  });

  it("reads windows-1252 bytes with their accents", async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("Ing"), 0xe9, ...new TextEncoder().encode("nieure logiciel, Montr"), 0xe9, ...new TextEncoder().encode("al, 2019 to 2024")]);
    const { text, garbled } = await readTextFile(file(bytes));
    expect(text).toBe("Ingénieure logiciel, Montréal, 2019 to 2024");
    expect(garbled).toBe(false);
  });

  it("says a binary file renamed .txt is not text", async () => {
    const binary = new Uint8Array(400).map((_, i) => (i * 37) % 32);
    expect((await readTextFile(file(binary))).garbled).toBe(true);
  });
});

describe("resumeTextFrom, the setup panels' reader", () => {
  it("answers a UTF-16 résumé's text", async () => {
    expect(await resumeTextFrom(file(utf16(RESUME, false)))).toBe(READ);
  });

  it("answers \"\" for a file that is not text", async () => {
    expect(await resumeTextFrom(file(new Uint8Array(400).map((_, i) => (i * 37) % 32)))).toBe("");
  });
});
