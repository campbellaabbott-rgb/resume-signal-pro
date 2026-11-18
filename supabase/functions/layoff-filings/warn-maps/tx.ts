// Texas Workforce Commission. One map serves two feeds: Big Local News'
// raw tx.csv (frozen at 2026-07-06 because their extract has failed since
// August) and the TWC yearly xlsx read directly (tx-xlsx.ts), which carries
// the same eight columns. JOB_SITE_NAME names the site in a parenthetical
// or after a dash on about one row in nine; the filer for matching is the
// part before it, the stored filer stays verbatim. Header verified against
// the saved bln-raw-tx.csv and tx-2026.xlsx.
import type { StateMap } from "./types.ts";
import { stripTrailingAmend } from "../normalize.ts";

/**
 * The amendment marker is stripped BEFORE the site is split off (S14X-151):
 * "Congo, LLC (Updated March 2026)" read its marker as the site, and
 * "Tyson Foods, Inc (Amarillo B-Shift Operations) Updated" a site of
 * "Amarillo B-Shift Operations Updated", so the update never shared its
 * original's (filer, site) group and both stayed active. filerRaw stays
 * verbatim; amendKind reads the marker from it.
 */
export function texasFilerCell(raw: string): { filerRaw: string; filerForNorm: string; siteFromCell: string | null } {
  const s = raw.replace(/\s+/g, " ").trim();
  const core = stripTrailingAmend(s) || s;
  const paren = /^(.*?)\s*\(([^)]*)\)\s*(.*)$/.exec(core);
  if (paren) {
    const site = [paren[2], paren[3]].filter((x) => x.trim() !== "").join(" ").trim();
    return { filerRaw: s, filerForNorm: paren[1].trim(), siteFromCell: site || null };
  }
  const dash = /^(.*\S)\s+[-\u2013\u2014]\s+(.+)$/.exec(core);
  if (dash) return { filerRaw: s, filerForNorm: dash[1].trim(), siteFromCell: dash[2].trim() };
  return { filerRaw: s, filerForNorm: core, siteFromCell: null };
}

export const TX: StateMap = {
  state: "TX",
  sourceName: "Texas Workforce Commission",
  sourceUrl: "https://www.twc.texas.gov/data-reports/warn-notice",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/tx.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["JOB_SITE_NAME"],
    noticeDate: ["NOTICE_DATE"],
    visible: ["WFDD_RECEIVED_DATE"],
    effective: ["LayOff_Date"],
    workers: ["TOTAL_LAYOFF_NUMBER"],
    city: ["CITY_NAME"],
    county: ["COUNTY_NAME"],
  },
  filerCell: texasFilerCell,
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-tx.csv + tx-2026.xlsx (2026-09-18)",
};
