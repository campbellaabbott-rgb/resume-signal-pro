// STEP 1 — PARSE, THROUGH THE PRODUCT'S OWN PARSER CORES, LOCALLY.
//
// Each résumé .txt is rendered to a PDF (jsPDF, Helvetica 10pt, the way a
// "Save as PDF" résumé looks) and to a DOCX (the `docx` package, one paragraph
// per line, headings bold), then read back exactly as parse-pdf / parse-docx
// read an upload:
//   PDF : pdfjs-serverless getDocument -> getTextContent per page ->
//         pageTextFromItems (parse-pdf/page-text.ts) -> dropUnnamedIndicGlyphs
//   DOCX: readDocxBody (parse-docx/docx-text.ts, mammoth + jszip) ->
//         withHeaderFooter (parse-docx/header-footer.ts)
// TWO-COLUMN résumés (held-out manifest layout "two-column") mark each line as
// "LEFT || RIGHT"; the PDF puts the left text in a 160pt sidebar and the right
// text in the main column on the same baseline, the layout the parser's
// multi-column check exists for. The DOCX keeps them as one tab-separated line.
//
// Nothing is uploaded; nothing touches the network. The PDF read is the
// pipeline's canonical input and is written to <set>/parsed/<id>.pdf.txt.
// The dev set's parsed texts are the ones the 2026-10-12 BEFORE run used and
// are not overwritten unless --rewrite-dev is passed; the run checks a fresh
// read of them matches.
//
// usage: ./node_modules/.bin/tsx scripts/match-bench/01-parse.ts [--set dev|heldout|all] [--rewrite-dev]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { FIX, OUT, ROOT } from "./paths.ts";
import { RESUMES } from "../../src/test/fixtures/match-bench/dev/manifest.ts";
import { HELDOUT } from "../../src/test/fixtures/match-bench/heldout/manifest.ts";
import { resumeRoleTerms, resumeYears } from "../../supabase/functions/_shared/fit-score.ts";
import * as pageText from "../../supabase/functions/parse-pdf/page-text.ts";
import * as docxText from "../../supabase/functions/parse-docx/docx-text.ts";
import * as headerFooter from "../../supabase/functions/parse-docx/header-footer.ts";

const require = createRequire(join(ROOT, "package.json"));
const { jsPDF } = require("jspdf");
const docx = require("docx");
const mammothMod = require("mammoth");
const JSZip = require("jszip");
const { resolvePDFJS } = await import("pdfjs-serverless");

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SET = (arg("--set") ?? "all") as "dev" | "heldout" | "all";
const REWRITE_DEV = process.argv.includes("--rewrite-dev");
mkdirSync(join(OUT, "files"), { recursive: true });

const HEADING = /^[A-Z][A-Z &/,'()-]{3,}$/;
const SPLIT = " || ";

function toPdf(text: string, twoColumn: boolean): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 54, width = 612 - margin * 2, bottom = 792 - margin;
  const leftW = 160, gap = 16, rightX = margin + leftW + gap, rightW = width - leftW - gap;
  let y = margin;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (twoColumn && line.includes("||")) {
      const [l, r] = line.split("||").map((s) => s.trim());
      doc.setFontSize(10);
      doc.setFont("helvetica", HEADING.test(l) ? "bold" : "normal");
      const lw: string[] = l ? doc.splitTextToSize(l, leftW) : [""];
      doc.setFont("helvetica", HEADING.test(r) ? "bold" : "normal");
      const rw: string[] = r ? doc.splitTextToSize(r, rightW) : [""];
      const rows = Math.max(lw.length, rw.length);
      for (let i = 0; i < rows; i++) {
        if (y > bottom) { doc.addPage(); y = margin; }
        if (lw[i]) { doc.setFont("helvetica", HEADING.test(l) ? "bold" : "normal"); doc.text(lw[i], margin, y); }
        if (rw[i]) { doc.setFont("helvetica", HEADING.test(r) ? "bold" : "normal"); doc.text(rw[i], rightX, y); }
        y += 13;
      }
      continue;
    }
    const isHead = HEADING.test(line.trim()) || y === margin;
    doc.setFont("helvetica", isHead ? "bold" : "normal");
    doc.setFontSize(isHead && y === margin ? 14 : 10);
    const wrapped: string[] = line ? doc.splitTextToSize(line, width) : [""];
    for (const w of wrapped) {
      if (y > bottom) { doc.addPage(); y = margin; }
      doc.text(w, margin, y);
      y += isHead && y === margin ? 18 : 13;
    }
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

async function toDocx(text: string): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun } = docx;
  const paras = text.split("\n").map((line: string, i: number) => {
    const flat = line.includes(SPLIT) ? line.split("||").map((s) => s.trim()).filter(Boolean).join("\t") : line;
    return new Paragraph({ children: [new TextRun({ text: flat, bold: i === 0 || HEADING.test(flat.trim()), size: i === 0 ? 28 : 20 })] });
  });
  const d = new Document({ sections: [{ children: paras }] });
  return new Uint8Array(await Packer.toBuffer(d));
}

async function parsePdf(bytes: Uint8Array): Promise<{ text: string; pages: number; multiColumn: boolean }> {
  const { getDocument } = await resolvePDFJS();
  const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  let full = "";
  let multiColumn = false;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    full += pageText.pageTextFromItems(tc.items as any) + "\n\n";
    const vp = page.getViewport({ scale: 1 });
    if (!multiColumn && pageText.detectMultiColumnRisk(tc.items as any, { width: vp.width, height: vp.height })) multiColumn = true;
  }
  return { text: pageText.dropUnnamedIndicGlyphs(full.trim()).text.trim(), pages: doc.numPages, multiColumn };
}

async function parseDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = mammothMod.default ?? mammothMod;
  const r = await docxText.readDocxBody(bytes, { mammoth, JSZip });
  let text = r.body.trim();
  try { text = headerFooter.withHeaderFooter(text, await headerFooter.headerFooterLines(r.zip)).trim(); } catch { /* as parse-docx */ }
  return text;
}

const sets: Array<{ set: "dev" | "heldout"; items: Array<{ id: string; file: string; twoColumn: boolean; years: number }> }> = [];
if (SET !== "heldout") sets.push({ set: "dev", items: RESUMES.map((r) => ({ id: r.id, file: r.file, twoColumn: false, years: r.years })) });
if (SET !== "dev") sets.push({ set: "heldout", items: HELDOUT.map((r) => ({ id: r.id, file: r.file, twoColumn: r.layout === "two-column", years: r.years })) });

const rows: any[] = [];
let devDrift = 0;
for (const { set, items } of sets) {
  mkdirSync(join(FIX, set, "parsed"), { recursive: true });
  for (const r of items) {
    const raw = readFileSync(join(FIX, set, r.file), "utf8");
    const pdf = toPdf(raw, r.twoColumn);
    const dx = await toDocx(raw);
    writeFileSync(join(OUT, "files", `${r.id}.pdf`), pdf);
    writeFileSync(join(OUT, "files", `${r.id}.docx`), dx);
    const t0 = performance.now();
    const p = await parsePdf(pdf);
    const pdfMs = performance.now() - t0;
    const d = await parseDocx(dx);
    const target = join(FIX, set, "parsed", `${r.id}.pdf.txt`);
    if (set === "dev" && existsSync(target) && !REWRITE_DEV) {
      if (readFileSync(target, "utf8") !== p.text) { devDrift++; console.log(`  DRIFT ${r.id}: a fresh PDF read differs from the BEFORE run's parsed text`); }
    } else {
      writeFileSync(target, p.text);
    }
    writeFileSync(join(OUT, `${r.id}.docx.txt`), d);
    const terms = { pdf: resumeRoleTerms(p.text, 4), docx: resumeRoleTerms(d, 4) };
    rows.push({ set, id: r.id, chars: { raw: raw.length, pdf: p.text.length, docx: d.length }, pages: p.pages, multiColumn: p.multiColumn, twoColumn: r.twoColumn, pdfMs: Math.round(pdfMs), terms, years: resumeYears(p.text), trueYears: r.years });
    console.log(`${set.padEnd(7)} ${r.id.padEnd(42)} pdf ${String(p.text.length).padStart(5)}ch ${p.pages}p ${p.multiColumn ? "multi-col " : ""}${String(Math.round(pdfMs)).padStart(4)}ms  terms=${JSON.stringify(terms.pdf)}`);
  }
}
writeFileSync(join(OUT, "parse.json"), JSON.stringify(rows, null, 2));
console.log(`\nwrote ${join(OUT, "parse.json")}${devDrift ? `; ${devDrift} dev résumé(s) drifted from the BEFORE parse` : ""}`);
