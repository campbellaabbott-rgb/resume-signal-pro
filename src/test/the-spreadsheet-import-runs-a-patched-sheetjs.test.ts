// @vitest-environment node
/**
 * THE SPREADSHEET IMPORT RUNS A PATCHED SHEETJS (RC-S13-066, S13-066).
 *
 * parse-spreadsheet read every uploaded workbook with SheetJS 0.18.5 from the
 * npm registry's last build, which predates the prototype-pollution fix
 * (CVE-2023-30533, fixed in 0.19.3) and the ReDoS fix (CVE-2024-22363, fixed
 * in 0.20.2). Later builds are published only on SheetJS's own CDN, which
 * Deno 2 does not import from by default, so the function now carries the
 * 0.20.3 ES module in its own folder (vendor/xlsx.mjs) with its source and
 * digest written beside it (vendor/SOURCE.md).
 *
 * Held here: index.ts imports no registry build of SheetJS (its import lines
 * are read with comments removed), it imports the vendored module, the
 * vendored module is the patched release and runs, and its bytes are the
 * bytes SOURCE.md names.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const FN = resolve(__dirname, "../../supabase/functions/parse-spreadsheet");
const INDEX = readFileSync(resolve(FN, "index.ts"), "utf8");
const VENDORED = resolve(FN, "vendor/xlsx.mjs");
const SOURCE_MD = resolve(FN, "vendor/SOURCE.md");

const importLines = codeOf(INDEX).split("\n").filter((l) => /^\s*import\b/.test(l));
const semver = (v: string) => v.split(".").map((n) => Number(n));
const atLeast = (v: string, min: string) => {
  const a = semver(v); const b = semver(min);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};

describe("the workbook parser parse-spreadsheet deploys", () => {
  it("is not the registry build: no import line names esm.sh xlsx or an xlsx version below the fixes", () => {
    expect(importLines.length).toBeGreaterThan(2);
    for (const l of importLines) {
      expect(l, l).not.toMatch(/esm\.sh\/xlsx/);
      expect(l, l).not.toMatch(/xlsx@0\.(1\d|[0-9])\./);
    }
  });

  it("is the module in the function's own vendor folder", () => {
    expect(importLines.some((l) => /from "\.\/vendor\/xlsx\.mjs"/.test(l)), importLines.join("\n")).toBe(true);
    expect(existsSync(VENDORED)).toBe(true);
  });

  it("is SheetJS 0.20.2 or later, and it reads a workbook it wrote", async () => {
    const XLSX = await import(/* @vite-ignore */ VENDORED) as {
      version: string;
      utils: { aoa_to_sheet(a: unknown[][]): unknown; book_new(): unknown; book_append_sheet(b: unknown, s: unknown, n: string): void; sheet_to_json(s: unknown, o: unknown): unknown[][] };
      write(b: unknown, o: unknown): Uint8Array;
      read(d: unknown, o: unknown): { SheetNames: string[]; Sheets: Record<string, unknown> };
    };
    expect(atLeast(XLSX.version, "0.20.2"), XLSX.version).toBe(true);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Title", "Company"], ["Ingénieur", "Acme"]]), "Jobs");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
    const back = XLSX.read(bytes, { type: "array", sheetRows: 10, cellFormula: false, cellHTML: false, cellStyles: false });
    expect(XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, defval: "", raw: false })).toEqual([["Title", "Company"], ["Ingénieur", "Acme"]]);
  });

  it("is byte for byte the file SOURCE.md names, by its sha256", () => {
    expect(existsSync(SOURCE_MD)).toBe(true);
    const md = readFileSync(SOURCE_MD, "utf8");
    const named = /sha256[^0-9a-f]*([0-9a-f]{64})/i.exec(md)?.[1];
    expect(named, "SOURCE.md names no sha256").toBeTruthy();
    expect(createHash("sha256").update(readFileSync(VENDORED)).digest("hex")).toBe(named);
    expect(md).toMatch(/https:\/\/cdn\.sheetjs\.com\/xlsx-0\.20\.\d+\/package\/xlsx\.mjs/);
    expect(md).toMatch(/Apache/);
  });
});
