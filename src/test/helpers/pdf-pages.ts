/**
 * A PDF's pages as pdf.js text items, read with the pdfjs-serverless release
 * parse-pdf imports, and a fixture of parse-pdf's own __fixtures__ folder.
 * Use from a file marked `@vitest-environment node` (pdfjs-serverless
 * mistakes jsdom for a browser).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolvePDFJS } from "pdfjs-serverless";
import { pageTextFromItems, type PdfTextItem } from "../../../supabase/functions/parse-pdf/page-text";

export const PDF_FIXTURES = resolve(__dirname, "../../../supabase/functions/parse-pdf/__fixtures__");
export const pdfFixture = (name: string) => new Uint8Array(readFileSync(resolve(PDF_FIXTURES, name)));

export async function pdfItems(data: Uint8Array): Promise<PdfTextItem[][]> {
  const { getDocument } = await resolvePDFJS();
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: PdfTextItem[][] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items as PdfTextItem[]);
  return pages;
}

/** The text parse-pdf's page reader makes of each page, pages joined by a blank line. */
export const pdfText = async (data: Uint8Array) => (await pdfItems(data)).map(pageTextFromItems).join("\n\n");
