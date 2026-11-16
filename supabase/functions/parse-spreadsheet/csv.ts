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
 * A CSV FILE'S BYTES AS TEXT (M-S14-123). Excel's "CSV" on Windows writes
 * windows-1252 and its "Unicode Text" writes UTF-16 with a byte-order mark;
 * reading every upload as UTF-8 turned "Ingénieur" into "Ing�nieur". A
 * UTF-16 mark is honoured and a UTF-8 one dropped; bytes that are not valid
 * UTF-8 are windows-1252. Valid UTF-8 reads exactly as before.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

/**
 * THE CSV EXPORT OF A GOOGLE SHEETS LINK (C-S14-134). The tab a link names
 * (#gid= or ?gid=) is the tab exported, and a "Publish to the web" link
 * (/spreadsheets/d/e/<id>/...) reads its published copy: taking its "e" as
 * the sheet id asked for a sheet that does not exist. Always a
 * docs.google.com URL; null when the link names no sheet.
 */
export function sheetsExportUrl(link: string): string | null {
  const gid = /[#?&]gid=(\d+)/.exec(link)?.[1];
  const tab = gid ? `&gid=${gid}` : "";
  const published = /\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/.exec(link)?.[1];
  if (published) return `https://docs.google.com/spreadsheets/d/e/${published}/pub?output=csv${tab}`;
  const id = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(link)?.[1];
  return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${tab}` : null;
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
