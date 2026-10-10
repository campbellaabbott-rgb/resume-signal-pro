// Oregon HECC, through Big Local News' raw or.csv. Header pinned from the
// file itself (read 2026-10-10, 1,374 rows): WARN#, Company Name, Location,
// Layoff Date, Laid Off, Layoff Type, Received Date. Until then this map
// guessed at header spellings; "Laid Off" and "Layoff Type" were not among
// its candidates, so every Oregon notice was stored with workers NULL and the
// 50-worker bar hid all of them while the feed reported ok (S8-106: nine
// notices of 50 or more since 2026-07-10 lost, Medford Delivery 170 among
// them). Received Date is the state's stamp (the file carries no employer
// notice date).
//
// ONE NOTICE, SEVERAL LINES. Oregon splits a notice by layoff phase and by
// site: WARN# 9591 is five Tualatin lines (9 + 60 + 2 + 11 + 5 = 87 workers),
// while 9509 is six lines at five sites and 9556 is 105 in New York plus one
// Oregon remote worker. foldRows folds lines sharing a WARN# AND a Location:
// counts summed, the earliest layoff date, everything else from the first
// line. A line with no WARN# stays as it is.
//
// "Company - Site" (Amentum - Hillsboro, OR; PacificSource - Bend) matches on
// the part before the first dash; the stored filer stays verbatim. Many
// filers are a facility ("Medford Delivery Facility"): their counts are now
// read, but they match no board until a facility-to-employer alias exists.
import { readCount, readDate } from "../normalize.ts";
import type { StateMap } from "./types.ts";

export function foldOregonRows(rows: Record<string, string>[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const byWarn = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const id = (row["WARN#"] ?? "").trim();
    if (id === "") { out.push(row); continue; }
    const key = `${id}\u0000${(row["Location"] ?? "").trim().toLowerCase()}`;
    const hit = byWarn.get(key);
    if (!hit) {
      const first = { ...row };
      byWarn.set(key, first);
      out.push(first);
      continue;
    }
    const a = readCount(hit["Laid Off"]), b = readCount(row["Laid Off"]);
    if (a != null || b != null) hit["Laid Off"] = String((a ?? 0) + (b ?? 0));
    const da = readDate(hit["Layoff Date"]), db = readDate(row["Layoff Date"]);
    if (db != null && (da == null || db < da)) hit["Layoff Date"] = row["Layoff Date"];
  }
  return out;
}

export function oregonFilerCell(raw: string): { filerRaw: string; filerForNorm: string; siteFromCell: string | null } {
  const s = raw.replace(/\s+/g, " ").trim();
  const dash = /^(.*?\S)\s+[-\u2013\u2014]\s+(.+)$/.exec(s);
  if (dash) return { filerRaw: s, filerForNorm: dash[1].trim(), siteFromCell: dash[2].trim() };
  return { filerRaw: s, filerForNorm: s, siteFromCell: null };
}

export const OR: StateMap = {
  state: "OR",
  sourceName: "Oregon HECC",
  sourceUrl: "https://ccwd.hecc.oregon.gov/Layoff/WARN",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/or.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["Company Name"],
    visible: ["Received Date"],
    effective: ["Layoff Date"],
    workers: ["Laid Off"],
    kind: ["Layoff Type"],
    site: ["Location"],
  },
  foldRows: foldOregonRows,
  filerCell: oregonFilerCell,
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-or.csv (Big Local News raw or.csv, 2026-10-10)",
};
