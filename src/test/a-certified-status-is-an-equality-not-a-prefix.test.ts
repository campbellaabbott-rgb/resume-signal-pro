// @vitest-environment node
/**
 * A CERTIFIED STATUS IS AN EQUALITY, NOT A PREFIX.
 *
 * WHAT THIS GUARDS. scripts/load-oflc-lca.mjs decides which rows of the
 * Department of Labor's quarterly disclosure file may become a filed-wage
 * cell. The decision is one comparison, and it has to be an EQUALITY against
 * the certified status. Measured on the FY2026 Q3 file (2026-09-22):
 *
 *     401,412 rows whose status EQUALS the certified word
 *   + 26,303 rows whose status BEGINS with it and then says withdrawn
 *
 * A startsWith test therefore admits 26,303 applications the employer itself
 * pulled after certification -- rows that raise an employer's filed ceiling
 * with figures nobody stands behind. This is the same defect class as the
 * read-quality-by-EQUALITY rule in the actively-hiring verdict, where a
 * near-miss comparison quietly widened a cohort.
 *
 * WHY IT IS BEHAVIOURAL. A regex over the source would pass the day someone
 * writes the equality in a comment and the prefix in the code, which has
 * happened seven times in this repository. So the guard builds a real xlsx
 * (the zip, the sheet XML, the shared strings), streams it through the real
 * loader, and asserts on the cells that come out. The withdrawn row carries a
 * wage an order of magnitude above the certified ones, so a leak is visible in
 * the range itself and not only in a counter.
 *
 * TEETH. The last case writes a copy of the loader whose comparison is a
 * prefix test, imports it, streams the same file, and requires the withdrawn
 * wage to appear in the range. If that mutation cannot make this test fail,
 * the test is decoration. The copy is deleted afterwards.
 */
import { afterAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const LOADER = resolve(ROOT, "scripts/load-oflc-lca.mjs");
const MUTANTS: string[] = [];
const TMP = mkdtempSync(join(tmpdir(), "lca-guard-"));

afterAll(() => {
  for (const m of MUTANTS) { try { rmSync(m); } catch { /* best effort */ } }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

const HEADER = [
  "CASE_NUMBER", "CASE_STATUS", "VISA_CLASS", "JOB_TITLE", "SOC_CODE", "SOC_TITLE",
  "EMPLOYER_NAME", "WAGE_RATE_OF_PAY_FROM", "WAGE_RATE_OF_PAY_TO", "WAGE_UNIT_OF_PAY", "WORKSITE_STATE",
];

/** The status spellings the file actually carries. Written here, in the test that needs them, and
 *  never in a comment of the code under test. */
const CERTIFIED = "Certified";
const CERTIFIED_THEN_WITHDRAWN = "Certified - Withdrawn";
const WITHDRAWN_WAGE = "900000";

/** The hourly filing: certified, matched, and NOT a yearly figure. 70 an hour times the 2,080-hour
 *  year this loader used to assume is 145,600 -- a number that appears nowhere in the file and that
 *  a cell labelled "filed" must therefore not contain. Kept in the fixture precisely so a
 *  conversion coming back is visible in the range. */
const HOURLY_HIGH_IF_CONVERTED = 145600;

const ROWS: string[][] = [
  ["I-1", CERTIFIED, "H-1B", "SWE", "15-1252.00", "Software Developers", "ACME WIDGETS, INC.", "120000", "140000", "Year", "CA"],
  ["I-2", CERTIFIED, "H-1B", "SWE", "15-1252", "Software Developers", "Acme Widgets Inc", "124000", "132000", "Year", "CA"],
  ["I-3", CERTIFIED, "H-1B", "SWE", "15-1252", "Software Developers", "Acme Widgets", "130000", "135000", "Year", "CA"],
  ["I-7", CERTIFIED, "H-1B", "SWE", "15-1252", "Software Developers", "Acme Widgets Inc", "60", "70", "Hour", "CA"],
  ["I-4", CERTIFIED_THEN_WITHDRAWN, "H-1B", "SWE", "15-1252", "Software Developers", "ACME WIDGETS, INC.", WITHDRAWN_WAGE, WITHDRAWN_WAGE, "Year", "CA"],
  ["I-5", "Withdrawn", "H-1B", "SWE", "15-1252", "Software Developers", "ACME WIDGETS, INC.", "800000", "800000", "Year", "CA"],
  ["I-6", "Denied", "H-1B", "SWE", "15-1252", "Software Developers", "ACME WIDGETS, INC.", "700000", "700000", "Year", "CA"],
];

const CATALOG = [{ name: "Acme Widgets", source: "greenhouse", token: "acmewidgets" }];

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colName = (i: number) => { let s = ""; let n = i + 1; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
/**
 * A real xlsx: a zip whose sheet XML the loader must stream, not a JSON stand-in.
 *
 * Two shapes, because the real file uses the second and a reader that only
 * works on the first would read nothing from it and report an honest-looking
 * zero. `inline` writes every value into the cell; `shared` writes the value
 * once into a shared-string table and puts an INDEX in the cell, which is what
 * a generator produces for a 437,000-row sheet. The sheet also closes with a
 * page-break element whose name begins with the row tag, because a streaming
 * cutter that opens on that prefix never finds its close tag and grows until
 * the process dies.
 */
async function writeFixture(
  rows: string[][],
  opts: { strings?: "inline" | "shared"; padRows?: number; name?: string } = {},
): Promise<string> {
  const { strings = "inline", padRows = 0, name = "LCA_Disclosure_Data_FY2026_Q3.xlsx" } = opts;
  const padded = [...rows];
  for (let i = 0; i < padRows; i += 1) {
    padded.push(["P-" + i, "Denied", "H-1B", "Padding row " + i, "15-1252", "Software Developers", "Padding Employer " + i, "1", "1", "Year", "CA"]);
  }
  const all = [HEADER, ...padded];

  const table: string[] = [];
  const indexOfString = new Map<string, number>();
  const cellXml = (v: string, ref: string) => {
    if (v === "") return "";
    if (strings === "inline") return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    let at = indexOfString.get(v);
    if (at === undefined) { at = table.length; table.push(v); indexOfString.set(v, at); }
    return `<c r="${ref}" t="s"><v>${at}</v></c>`;
  };
  const body = all.map((cells, i) =>
    `<row r="${i + 1}">` + cells.map((c, j) => cellXml(c, `${colName(j)}${i + 1}`)).join("") + `</row>`).join("");

  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("xl/workbook.xml", "<workbook/>");
  zip.file("xl/worksheets/sheet1.xml",
    `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>${body}</sheetData><rowBreaks count="0"><brk id="1"/></rowBreaks></worksheet>`);
  if (strings === "shared") {
    zip.file("xl/sharedStrings.xml",
      `<?xml version="1.0"?><sst count="${table.length}">` + table.map((v) => `<si><t>${esc(v)}</t></si>`).join("") + `</sst>`);
  }
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const path = join(TMP, `${strings}-${padRows}-${name}`);
  writeFileSync(path, buf);
  return path;
}

type Loader = typeof import("../../scripts/load-oflc-lca.mjs");

async function loadReal(): Promise<Loader> {
  return (await import("../../scripts/load-oflc-lca.mjs")) as unknown as Loader;
}

/** A copy of the loader with one or more substitutions, written inside src/test so its relative
 *  imports still resolve, imported once, and deleted when the file finishes. */
async function loadMutant(...edits: Array<[find: string, replace: string]>): Promise<Loader> {
  let src = readFileSync(LOADER, "utf8");
  for (const [find, replace] of edits) {
    expect(src.includes(find), `the loader no longer contains ${JSON.stringify(find)} -- this mutation cannot prove anything`).toBe(true);
    src = src.split(find).join(replace);
  }
  const mutated = src
    .split('"../supabase/functions/layoff-filings/normalize.ts"').join('"../../supabase/functions/layoff-filings/normalize.ts"')
    .split('"./layoff-board-names-mirror.mjs"').join('"../../scripts/layoff-board-names-mirror.mjs"');
  const path = resolve(__dirname, `.lca-mutant-${MUTANTS.length}.mjs`);
  writeFileSync(path, mutated);
  MUTANTS.push(path);
  return (await import(/* @vite-ignore */ path)) as unknown as Loader;
}

async function runLoader(L: Loader, file: string) {
  const index = L.indexMirror(CATALOG.map((e) => ({ vendor: e.source, company_token: e.token, display_name: e.name })));
  return L.loadDisclosureFile({
    file, index,
    sourceUrl: "https://www.dol.gov/media/LCA_Disclosure_Data_FY2026_Q3.xlsx",
    fiscalQuarter: "FY2026 Q3", publishedOn: "2026-08-25",
  });
}

describe("the certified status is matched by equality", () => {
  it("keeps the exactly-certified rows and refuses the one whose status merely begins with the word", async () => {
    const L = await loadReal();
    const file = await writeFixture(ROWS);
    const { rows, counts } = await runLoader(L, file);

    expect(counts.certified, "four rows state exactly the certified status").toBe(4);
    // ...of which one was filed by the hour and is held rather than converted.
    expect(counts.matchedRows).toBe(3);
    expect(rows).toHaveLength(1);
    const cell = rows[0];
    expect(cell.company_token).toBe("acmewidgets");
    expect(cell.filings_n).toBe(3);
    // The three yearly filings, and nothing else: the withdrawn row's 900,000
    // is outside the range, and so is every denied or withdrawn row.
    expect(cell.wage_low_annual).toBe(120000);
    expect(cell.wage_high_annual).toBe(140000);
    expect(cell.wage_high_annual).toBeLessThan(Number(WITHDRAWN_WAGE));
  });

  it("a filing made by the hour is held under its own name, never multiplied into a year", async () => {
    // THE CONVERSION THIS LOADER REFUSES. An hourly figure times an assumed
    // 2,080-hour year is not a reading of the file, it is a schedule nobody
    // filed -- the same rule the structured salary parser already states for
    // the identical arithmetic. Measured over the matched population: 13,185
    // yearly filings against 1,045 that are not, so the refusal costs 7.3% of
    // the rows and buys a cell that means what the copy says.
    const L = await loadReal();
    const { rows, counts } = await runLoader(L, await writeFixture(ROWS));
    expect(counts.heldNonAnnualUnit, "the hourly filing was not counted as held").toBe(1);
    // Held is its OWN counter: an hourly row is not a row with no readable
    // wage, and folding it into that one would hide the size of the refusal.
    expect(counts.heldNoWage).toBe(0);
    expect(rows[0].wage_high_annual).not.toBe(HOURLY_HIGH_IF_CONVERTED);
    expect(rows[0].filings_n, "the held row must not be counted behind the cell either").toBe(3);
  });

  it("the unit test is an equality against the yearly spellings, in code", async () => {
    const L = await loadReal();
    expect(L.isAnnualUnit("Year")).toBe(true);
    expect(L.isAnnualUnit("yr")).toBe(true);
    for (const u of ["Hour", "Week", "Bi-Weekly", "Month", "Day", "", null, undefined]) {
      expect(L.isAnnualUnit(u), `${String(u)} must not read as a yearly filing`).toBe(false);
    }
    // ...and the wage reader answers null for every one of them rather than a
    // multiple, so there is no table of multipliers to reach for.
    expect(L.filedAnnualWage(70, "Hour")).toBeNull();
    expect(L.filedAnnualWage(120000, "Year")).toBe(120000);
  });

  it("counts the refused prefix rather than dropping it silently", async () => {
    const L = await loadReal();
    const { counts } = await runLoader(L, await writeFixture(ROWS));
    // One row begins with the certified word and is not it; the plain withdrawn
    // and denied rows do not, so they are other-status but not prefix hits.
    expect(counts.certifiedWithdrawnPrefix).toBe(1);
    expect(counts.notCertified).toBe(3);
  });

  it("the equality lives in code, not in a comment", async () => {
    // THE STRIPPER IS THE SHARED ONE, and that is the fix rather than a tidy-
    // up: the local copy here cut only a comment that STARTS a line, so
    // `return status.startsWith(CERTIFIED); // was: status === CERTIFIED`
    // satisfied the positive half of this very assertion -- the exact trap
    // this file's own docblock says it exists to avoid.
    const code = codeOf(readFileSync(LOADER, "utf8"));
    expect(code).toMatch(/status\s*===\s*CERTIFIED/);
    // A prefix test on the status must appear nowhere in the code EXCEPT the
    // counter that exists to report refusals, which is identified by the name
    // it increments.
    const prefixUses = [...code.matchAll(/startsWith\(CERTIFIED\)/g)].length;
    const counted = [...code.matchAll(/certifiedWithdrawnPrefix \+= 1/g)].length;
    expect(prefixUses).toBe(1);
    expect(counted).toBe(1);
  });

  it("reads the same cells from a shared-string sheet, across chunk boundaries, past a page-break element", async () => {
    // The real 250 MB file stores its text in a shared-string table and its
    // sheet XML inflates to about 1.6 GB, so the reader must survive both the
    // indirection and a stream delivered in pieces. Six thousand padding rows
    // make the inflated XML large enough to arrive as many chunks.
    const L = await loadReal();
    const file = await writeFixture(ROWS, { strings: "shared", padRows: 6000 });
    const { rows, counts } = await runLoader(L, file);
    expect(counts.dataRows).toBe(ROWS.length + 6000);
    expect(counts.certified).toBe(4);
    expect(rows).toHaveLength(1);
    expect(rows[0].filings_n).toBe(3);
    expect(rows[0].wage_low_annual).toBe(120000);
    expect(rows[0].wage_high_annual).toBe(140000);
  });

  it("teeth: a copy whose comparison is a prefix test leaks the withdrawn wage", async () => {
    const L = await loadMutant([
      "return status === CERTIFIED;",
      'return typeof status === "string" && status.startsWith(CERTIFIED);',
    ]);
    const { rows, counts } = await runLoader(L, await writeFixture(ROWS));
    expect(counts.certified, "the mutant admits the withdrawn row too").toBe(5);
    expect(rows).toHaveLength(1);
    expect(rows[0].filings_n).toBe(4);
    expect(rows[0].wage_high_annual).toBe(Number(WITHDRAWN_WAGE));
  });

  it("teeth: a copy that multiplies a non-yearly unit leaks a number the file never stated", async () => {
    // The loader as it was first written: a table of multipliers, and no
    // held-counter. The hourly row's ceiling then reaches the cell as 70 x
    // 2,080 -- a figure that appears nowhere in the disclosure file -- under
    // copy that says the employer filed it.
    const L = await loadMutant(
      [
        "    if (!isAnnualUnit(unit)) { counts.heldNonAnnualUnit += 1; continue; }\n",
        "",
      ],
      [
        "  if (!isAnnualUnit(unit)) return null;\n  const n = typeof amount === \"number\" ? amount : Number(String(amount ?? \"\").replace(/[$,\\s]/g, \"\"));",
        "  const per = { year: 1, yr: 1, hour: 2080, week: 52, month: 12, \"bi-weekly\": 26 }[String(unit ?? \"\").trim().toLowerCase().replace(/[\\s_]+/g, \"-\")];\n  if (per === undefined) return null;\n  const n = per * (typeof amount === \"number\" ? amount : Number(String(amount ?? \"\").replace(/[$,\\s]/g, \"\")));",
      ],
    );
    const { rows, counts } = await runLoader(L, await writeFixture(ROWS));
    expect(counts.matchedRows, "the mutant keeps the hourly filing").toBe(4);
    expect(rows[0].filings_n).toBe(4);
    expect(rows[0].wage_high_annual, "the mutation did not apply -- RE-ANCHOR this tooth")
      .toBe(HOURLY_HIGH_IF_CONVERTED);
  });
});
