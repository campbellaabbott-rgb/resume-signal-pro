// Florida DEO (REACT). One map serves Big Local News' raw fl.csv (ends
// 2026-08-13; their extract has failed since August) and the REACT listing
// read directly (fl-html.ts). Every company cell carries the street address
// after the name; the address lines start at the first line that begins
// with a number or a PO box, and the name is what comes before. Layoff Date
// is a "start thru end" pair; the first date is the effective date and the
// pair is kept verbatim. Header verified against the saved bln-raw-fl.csv
// and fl-2026.html.
import type { StateMap } from "./types.ts";

export function floridaCompanyCell(raw: string): { filerRaw: string; filerForNorm: string; siteFromCell: string | null } {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l !== "");
  let cut = lines.findIndex((l, i) => i > 0 && /^(\d|p\.?o\.? ?box|one |two )/i.test(l));
  if (cut === -1) cut = Math.min(lines.length, 1);
  const name = lines.slice(0, cut).join(" ").trim();
  const site = lines.slice(cut).join(", ").trim();
  return { filerRaw: name || raw.trim(), filerForNorm: name || raw.trim(), siteFromCell: site || null };
}

export const FL: StateMap = {
  state: "FL",
  sourceName: "Florida DEO",
  sourceUrl: "https://reactwarn.floridajobs.org/WarnList/Records",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/fl.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["Company Name"],
    visible: ["State Notification Date"],
    effective: ["Layoff Date"],
    workers: ["Employees Affected"],
  },
  filerCell: floridaCompanyCell,
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-fl.csv + fl-2026.html (2026-09-18)",
};
