// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild, which refuses
// jsdom's TextEncoder (helpers/edge-harness.ts).
/**
 * A CSV SAVED BY EXCEL KEEPS ITS ACCENTS (S14X-148, M-S14-123).
 *
 * The CSV branch of parse-spreadsheet read the upload with file.text(), which
 * is UTF-8 only. Excel's "CSV" on Windows writes windows-1252, so "Ingénieur"
 * arrived as "Ing�nieur", and "Unicode Text" / "CSV UTF-16" exports
 * arrived as text full of NULs. Every CSV upload from the job-list importer
 * goes through this branch (the page posts the file as form data).
 *
 * Now the bytes are decoded by decodeCsvBytes: a UTF-16 byte-order mark is
 * honoured, a UTF-8 one dropped, and bytes that are not valid UTF-8 are read
 * as windows-1252. Valid UTF-8 and plain ASCII read exactly as before.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as csv from "../../supabase/functions/parse-spreadsheet/csv";
import { spreadsheetHarness, type SpreadsheetHarness } from "./helpers/spreadsheet-handler";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const HEADER = "Title,Company,Description\r\n";
const ROW = "Ingénieur données,Société Générale,Créer des pipelines à Zürich\r\n";

/** windows-1252: every character here is in Latin-1, one byte each. */
const cp1252 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const utf16le = (s: string, bom = true) => {
  const out = new Uint8Array((bom ? 2 : 0) + s.length * 2);
  if (bom) out.set([0xff, 0xfe]);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[(bom ? 2 : 0) + i * 2] = c & 0xff; out[(bom ? 2 : 0) + i * 2 + 1] = c >> 8; }
  return out;
};
const utf16be = (s: string) => {
  const out = new Uint8Array(2 + s.length * 2);
  out.set([0xfe, 0xff]);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 + i * 2] = c >> 8; out[2 + i * 2 + 1] = c & 0xff; }
  return out;
};
const utf8 = (s: string, bom = false) => {
  const body = new TextEncoder().encode(s);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
};

let h: SpreadsheetHarness;
beforeAll(async () => { h = await spreadsheetHarness(); });

async function firstJob(bytes: Uint8Array): Promise<{ title: string; company: string; description: string }> {
  const res = await h.post(h.multipart("jobs.csv", bytes));
  expect(res.status).toBe(200);
  const body = await res.json() as { jobs: Array<{ title: string; company: string; description: string }> };
  return body.jobs[0];
}

describe("the CSV upload reads the bytes Excel wrote", () => {
  it("a windows-1252 CSV keeps its accents", async () => {
    const job = await firstJob(cp1252(HEADER + ROW));
    expect(job.title).toBe("Ingénieur données");
    expect(job.company).toBe("Société Générale");
    expect(job.description).toBe("Créer des pipelines à Zürich");
  });

  it("a UTF-16LE CSV with its byte-order mark reads the same", async () => {
    const job = await firstJob(utf16le(HEADER + ROW));
    expect(job.title).toBe("Ingénieur données");
  });

  it("a UTF-8 CSV with a byte-order mark reads the same, its header found", async () => {
    const job = await firstJob(utf8(HEADER + ROW, true));
    expect(job.title).toBe("Ingénieur données");
  });
});

describe("decodeCsvBytes", () => {
  const decode = (csv as unknown as { decodeCsvBytes?: (b: Uint8Array) => string }).decodeCsvBytes;

  it("exists, beside the CSV reader", () => {
    expect(typeof decode).toBe("function");
  });

  it("reads each encoding by its mark, and bytes that are not UTF-8 as windows-1252", () => {
    const text = HEADER + ROW;
    expect(decode!(cp1252(text))).toBe(text);
    expect(decode!(utf16le(text))).toBe(text);
    expect(decode!(utf16be(text))).toBe(text);
    expect(decode!(utf8(text, true))).toBe(text);
    // windows-1252's own letters beyond Latin-1: the euro sign and curly quotes.
    expect(decode!(Uint8Array.from([0x80, 0x20, 0x93, 0x61, 0x94]))).toBe("€ “a”");
  });

  it("leaves plain ASCII and valid UTF-8 exactly as they were", () => {
    expect(decode!(utf8("a,b\n1,2\n"))).toBe("a,b\n1,2\n");
    expect(decode!(utf8("名前,会社\n田中,株式会社\n"))).toBe("名前,会社\n田中,株式会社\n");
  });
});
