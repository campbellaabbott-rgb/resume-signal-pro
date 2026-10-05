/**
 * CSV ROWS AND HEADER MATCHING FOR THE JOB-LIST IMPORT (register L5-09).
 *
 * Two defects lived here:
 *   - the content was split on raw newlines BEFORE quotes were read, so a
 *     quoted cell spanning lines (RFC 4180; every Google Sheets export of a
 *     multi-line job description) was cut at its first newline and each later
 *     line became a fake job;
 *   - an empty header cell matched every column name, because
 *     `'title'.includes('')` is true, so a pandas export with an unnamed index
 *     column mapped title, company, description and url all to column 0.
 *
 * Plain TypeScript with no imports, so the Node test suite runs it directly.
 */

/** RFC 4180 rows: quotes may hold commas, newlines and doubled quotes. Blank rows are dropped. */
export function parseCSV(content: string): string[][] {
  const text = content.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => { row.push(field.trim()); field = ""; };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else field += ch;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * The first column whose header matches one of the names, in name order. A
 * header contains the name ("Job Title" for "title"), or a header of three or
 * more characters is contained in it ("desc" in "description"). An empty
 * header never matches.
 */
export function findColumnIndex(headers: string[], possibleNames: string[]): number {
  const normalized = headers.map((h) => String(h ?? "").toLowerCase().trim());
  for (const raw of possibleNames) {
    const name = raw.toLowerCase();
    const index = normalized.findIndex((h) => h !== "" && (h.includes(name) || (h.length >= 3 && name.includes(h))));
    if (index !== -1) return index;
  }
  return -1;
}
