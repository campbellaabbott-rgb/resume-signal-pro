// Texas, read directly from the Workforce Commission's yearly xlsx because
// Big Local News' Texas extract has failed on every run since at least
// 2026-08-06 (their raw tx.csv stops at 2026-07-06; the xlsx carried a
// 2026-09-15 notice on the day this was written). The file refreshes about
// weekly; a Last-Modified that matches the stored one is not re-read. The
// current year's file is read every night and the previous year's once
// (its rows inside the 365-day window), so a January run is not blind.
//
// TWC content is non-commercial by its policy page: the rows are cited to
// TWC as the source and stored as fields; the file itself is never
// republished and no PDF is fetched.

import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import type { Http } from "./http.ts";
import type { Table } from "./warn.ts";
import { TX } from "./warn-maps/tx.ts";

export function twcXlsxUrl(year: number): string {
  return `https://www.twc.texas.gov/sites/default/files/oei/docs/warn-act-listings-${year}-twc.xlsx`;
}

/** The first sheet of a TWC workbook as a header-keyed table; dates become ISO strings. */
export function tableFromTwcXlsx(bytes: Uint8Array): Table {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { header: [], rows: [] };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  return tableFromGrid(grid);
}

/** A grid (header row first) to a table, rendering Dates as ISO and numbers as digits. */
export function tableFromGrid(grid: unknown[][]): Table {
  if (grid.length === 0) return { header: [], rows: [] };
  const header = grid[0].map((h) => String(h ?? "").replace(/\s+/g, " ").trim());
  const rows: Record<string, string>[] = [];
  for (const line of grid.slice(1)) {
    const o: Record<string, string> = {};
    let any = false;
    header.forEach((h, i) => {
      if (h === "") return;
      const v = line[i];
      const s = cellText(v);
      if (s !== "") any = true;
      o[h] = s;
    });
    if (any) rows.push(o);
  }
  return { header, rows };
}

export function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
    // A cell parsed with cellDates is local midnight; an hour or more past
    // it means the sheet stored a real time and the day is still the day.
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}

export interface TwcFetch {
  status: number;
  lastModified: string | null;
  changed: boolean;
  table: Table | null;
}

/** GET one year's file; a Last-Modified equal to the stored one is not re-read. */
export async function fetchTwcYear(http: Http, year: number, knownLastModified: string | null): Promise<TwcFetch> {
  const url = twcXlsxUrl(year);
  const head = await http.head(url);
  const lm = head.headers.get("last-modified");
  if (head.status === 200 && lm && knownLastModified && lm === knownLastModified) {
    return { status: 304, lastModified: lm, changed: false, table: null };
  }
  if (head.status !== 200 && head.status !== 405) return { status: head.status, lastModified: lm, changed: false, table: null };
  const r = await http.request(url);
  if (r.status !== 200) return { status: r.status, lastModified: r.headers.get("last-modified"), changed: false, table: null };
  return { status: 200, lastModified: r.headers.get("last-modified") ?? lm, changed: true, table: tableFromTwcXlsx(r.body) };
}

export { TX };
