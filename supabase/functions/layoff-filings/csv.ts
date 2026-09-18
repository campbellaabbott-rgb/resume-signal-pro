// A small RFC 4180 reader for the state files. Quoted fields may span lines
// (Florida's company cell carries its street address on three lines), a
// doubled quote inside quotes is a literal quote, and NUL bytes are dropped
// before parsing — Big Local News' integrated file carries 87,094 of them
// and a NUL is also the byte that makes grep skip a file in silence.

export function parseCsv(text: string): string[][] {
  const s = text.replace(/\0/g, "").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Header-keyed rows; header names are trimmed and inner whitespace collapsed. */
export function csvObjects(text: string): { header: string[]; rows: Record<string, string>[] } {
  const all = parseCsv(text).filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
  if (all.length === 0) return { header: [], rows: [] };
  const header = all[0].map(normHeader);
  const rows = all.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { if (h !== "") o[h] = (r[i] ?? "").trim(); });
    return o;
  });
  return { header, rows };
}

export function normHeader(h: string): string {
  return h.replace(/\0/g, "").replace(/\s+/g, " ").trim();
}
