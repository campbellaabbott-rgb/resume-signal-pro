/**
 * THE SCAN PAGE FORMATS NUMBERS AND DATES IN THE READER'S LANGUAGE (S14X-255).
 *
 * Ten calls on the scanner page formatted a number or a date with no locale
 * (or an undefined one), so they followed the browser, not the page: a
 * Spanish reader on an en-US browser got "1,234" and "11/15/2026" inside
 * Spanish sentences. Each now passes the page's language. A source scan of
 * the four files: no call to a toLocale method with empty parentheses or an
 * undefined first argument.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const FILES = [
  "src/components/FreeKeywordResults.tsx",
  "src/components/Hero.tsx",
  "src/components/ResumeUploader.tsx",
  "src/components/ReportInsightCards.tsx",
];
const LOCALE_LESS = /\.toLocale(?:String|DateString|TimeString)\(\s*(?:\)|undefined\b)/g;

describe("the scanner page's number and date formatting", () => {
  for (const f of FILES) {
    it(`${f} names a locale in every call`, () => {
      const src = readFileSync(resolve(ROOT, f), "utf8");
      const lines = src.split("\n").flatMap((l, i) => (l.match(LOCALE_LESS) ? [`${i + 1}: ${l.trim()}`] : []));
      expect(lines, "calls that follow the browser's locale").toEqual([]);
    });
  }
});
