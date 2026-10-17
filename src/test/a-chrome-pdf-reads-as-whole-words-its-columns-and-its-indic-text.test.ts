// @vitest-environment node
//
// Node, not jsdom: pdfjs-serverless mistakes jsdom for a browser (see
// supabase/functions/parse-pdf/pdfjs-contract.test.ts), and the handler half
// bundles parse-pdf with esbuild, which refuses jsdom's TextEncoder.
/**
 * A CHROME PDF READS AS WHOLE WORDS, ITS COLUMNS ARE SEEN, ITS INDIC TEXT IS
 * ACCEPTED, AND A BROKEN FILE IS NOT AN OUTAGE.
 *
 * Every fixture here was printed by headless Chrome (Skia), the engine behind
 * Chrome, Edge and most online résumé builders, and is read with the same
 * pdfjs-serverless release parse-pdf imports.
 *
 *  S11-006  Skia ends a pdf.js text item at every fi/fl/ff ligature glyph,
 *           and parse-pdf joined items on one baseline with a space:
 *           "Certi fi ed Microsoft O ffi ce", "fi ona.ho ff man@gmail.com",
 *           and the contact reader took "man@gmail.com" as the address.
 *           Items that touch are now one word; only a real gap is a space.
 *  S11-035  Skia gives Devanagari and Bengali conjuncts no ToUnicode entry,
 *           so pdf.js emits U+0000 for them, and looksGarbled refused the
 *           upload as "corrupted, re-export it". The NULs are dropped when
 *           they are the only control bytes in Indic text, and the visitor
 *           is told a .docx or pasted text reads them exactly.
 *  S11-036  The sidebar-then-main layout (one upward jump) and a row-
 *           interleaved table (no jump) both passed as "no multi-column
 *           layout"; a one-column page whose dates Chrome writes first must
 *           still pass.
 *  S11-033  A damaged stream or page tree threw past the two named load
 *           errors into the catch-all 500, which the browser retried and
 *           counted as an outage. It is a 422 naming the file.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";
import { resolvePDFJS } from "pdfjs-serverless";
import {
  detectMultiColumnRisk,
  dropUnnamedIndicGlyphs,
  pageTextFromItems,
  type PdfTextItem,
} from "../../supabase/functions/parse-pdf/page-text";
import { isDamagedPdfError, looksGarbled } from "../../supabase/functions/_shared/text-validation";
import { deriveContact } from "@/lib/resumeContact";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const FIXTURES = resolve(__dirname, "../../supabase/functions/parse-pdf/__fixtures__");
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

type Page = { items: PdfTextItem[]; width: number; height: number };

async function pagesOf(data: Uint8Array): Promise<Page[]> {
  const { getDocument } = await resolvePDFJS();
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: Page[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ items: (await page.getTextContent()).items as PdfTextItem[], width: vp.width, height: vp.height });
  }
  return pages;
}

const textOf = (pages: Page[]) => pages.map((p) => pageTextFromItems(p.items)).join("\n\n");
const multiColumn = (pages: Page[]) => pages.some((p) => detectMultiColumnRisk(p.items, { width: p.width, height: p.height }));

describe("S11-006: touching items are one word", () => {
  it("a Chrome PDF in a ligature font reads as whole words, and the contact reader gets the real address", async () => {
    const pages = await pagesOf(fixture("chrome-ligatures.pdf"));
    // The defect, measured on the same file: a space between every item.
    const spaced = pages[0].items.map((i) => i.str ?? "").join(" ");
    expect(spaced).toContain("Certi fi ed");

    const text = textOf(pages);
    expect(text).toContain("Fiona Hoffman");
    expect(text).toContain("fiona.hoffman@gmail.com | linkedin.com/in/fionahoffman");
    expect(text).toContain("Certified Microsoft Office specialist who streamlined the workflow of fifty staff.");
    expect(text).toContain("Efficient, effective and influential in difficult offline projects.");
    expect(text).not.toMatch(/ (fi|fl|ff|ffi|ffl) /);

    const contact = deriveContact(text);
    expect(contact.email?.value ?? contact.email).toBe("fiona.hoffman@gmail.com");
  });

  it("a real gap is still a space, and an item with no width is still joined by a space", () => {
    const at = (str: string, x: number, width?: number): PdfTextItem => ({ str, transform: [12, 0, 0, 12, x, 700], height: 12, width });
    expect(pageTextFromItems([at("Senior", 50, 36), at("Analyst", 90, 40)])).toBe("Senior Analyst");
    expect(pageTextFromItems([at("Certi", 50, 25.5), at("fi", 75.5, 6.2), at("ed", 81.7, 12)])).toBe("Certified");
    expect(pageTextFromItems([at("Senior", 50), at("Analyst", 90)])).toBe("Senior Analyst");
  });

  it("a ligature character reads as its letters", () => {
    expect(pageTextFromItems([{ str: "Certiﬁed workﬂow", transform: [12, 0, 0, 12, 50, 700], height: 12 }])).toBe("Certified workflow");
  });
});

describe("S11-035: Indic glyphs pdf.js could only name as U+0000", () => {
  for (const [name, script] of [["chrome-hindi.pdf", /[ऀ-ॿ]/], ["chrome-bengali.pdf", /[ঀ-৿]/]] as const) {
    it(`${name}: refused before, accepted with the count of characters it lost`, async () => {
      const raw = textOf(await pagesOf(fixture(name)));
      expect(raw).toContain("\u0000");
      expect(looksGarbled(raw), "the defect: refused as corrupted").toBe(true);

      const kept = dropUnnamedIndicGlyphs(raw);
      expect(kept.dropped).toBeGreaterThan(10);
      expect(kept.text).not.toContain("\u0000");
      expect(script.test(kept.text)).toBe(true);
      expect(looksGarbled(kept.text)).toBe(false);
    });
  }

  it("NULs in Latin text, or any other control byte, are left for looksGarbled to refuse", () => {
    const latin = ("Senior engineer with eight years of experience \u0000\u0000 ").repeat(6);
    expect(dropUnnamedIndicGlyphs(latin).dropped).toBe(0);
    expect(looksGarbled(dropUnnamedIndicGlyphs(latin).text)).toBe(true);
    const hindiWithOtherControls = ("वरिष्ठ सॉफ्टवेयर इंजीनियर \u0000\u0001 ").repeat(6);
    expect(dropUnnamedIndicGlyphs(hindiWithOtherControls).dropped).toBe(0);
  });
});

describe("S11-036: the column layouts an ATS misreads", () => {
  it("the sidebar-then-main two-column résumé is a multi-column risk", async () => {
    expect(multiColumn(await pagesOf(fixture("chrome-sidebar-two-column.pdf")))).toBe(true);
  });

  it("a row-interleaved two-column table is a multi-column risk", async () => {
    const pages = await pagesOf(fixture("chrome-interleaved-rows.pdf"));
    expect(textOf(pages)).toMatch(/Python\s+Software Engineer, Globex/);
    expect(multiColumn(pages)).toBe(true);
  });

  it("a one-column page with right-floated dates that Chrome writes first is not", async () => {
    const pages = await pagesOf(fixture("chrome-one-column-floated-dates.pdf"));
    expect(textOf(pages).startsWith("2019 - Present")).toBe(true);
    expect(multiColumn(pages)).toBe(false);
  });

  it("a plain one-column résumé is not, nor the ligature page", async () => {
    const doc = new jsPDF();
    ["Jane Doe", "jane.doe@example.com", "EXPERIENCE", "Senior Analyst, Acme Corp, 2020 - Present", "- Cut vendor spend by $250,000", "- Led a team of five", "EDUCATION", "BSc Economics, 2016"]
      .forEach((l, i) => doc.text(l, 15, 20 + i * 8));
    expect(multiColumn(await pagesOf(new Uint8Array(doc.output("arraybuffer"))))).toBe(false);
    expect(multiColumn(await pagesOf(fixture("chrome-ligatures.pdf")))).toBe(false);
  });
});

describe("S11-033: the error names that mean the file is broken", () => {
  for (const name of ["damaged-flate-stream.pdf", "damaged-page-tree.pdf"]) {
    it(`${name} throws an error parse-pdf now classes as a damaged file`, async () => {
      let caught: unknown;
      try { await pagesOf(fixture(name)); } catch (e) { caught = e; }
      expect(caught).toBeTruthy();
      expect(isDamagedPdfError(caught)).toBe(true);
    });
  }
  it("our own bugs are not the file's fault", () => {
    expect(isDamagedPdfError(new TypeError("x is undefined"))).toBe(false);
    expect(isDamagedPdfError({ name: "PasswordException" })).toBe(false);
    expect(isDamagedPdfError(null)).toBe(false);
  });
});

// ── the handler, bundled and run with only its network faked ───────────────

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key",
};
let handler: EdgeHandler;
let db: FakeDb;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { void p.catch(() => {}); } };
  g.__parseResolvePDFJS = resolvePDFJS;
  handler = await loadEdgeHandler("parse-pdf", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__parseClient; }",
    "https://esm.sh/pdfjs-serverless@0.4.1?target=deno": "export const resolvePDFJS = (...a) => globalThis.__parseResolvePDFJS(...a);",
  });
});

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.log_parse_failure = () => ({ data: null, error: null });
  (globalThis as Record<string, unknown>).__parseClient = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
});

async function upload(name: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append("file", new File([fixture(name)], name, { type: "application/pdf" }));
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/parse-pdf", { method: "POST", body: form }));
  return { status: res.status, body: await res.json() };
}

describe("parse-pdf, run", () => {
  it("a damaged file is a 422 that names the file, never a 500", async () => {
    for (const name of ["damaged-flate-stream.pdf", "damaged-page-tree.pdf"]) {
      const r = await upload(name);
      expect(r.status, name).toBe(422);
      expect(r.body.code, name).toBe("damaged_file");
    }
  });

  it("a ligature PDF answers whole words", async () => {
    const r = await upload("chrome-ligatures.pdf");
    expect(r.status).toBe(200);
    expect(String(r.body.text)).toContain("fiona.hoffman@gmail.com");
    expect(String(r.body.text)).toContain("Certified Microsoft Office");
  });

  it("a Hindi PDF from Chrome is accepted, with the notice that names what it lost", async () => {
    const r = await upload("chrome-hindi.pdf");
    expect(r.status).toBe(200);
    expect(r.body.notice).toBe("unread_characters");
    expect(Number(r.body.unreadCharacters)).toBeGreaterThan(10);
    expect(String(r.body.text)).not.toContain("\u0000");
  });

  it("the sidebar résumé answers multiColumnDetected, the floated-dates page does not", async () => {
    expect((await upload("chrome-sidebar-two-column.pdf")).body.multiColumnDetected).toBe(true);
    expect((await upload("chrome-one-column-floated-dates.pdf")).body.multiColumnDetected).toBe(false);
  });
});
