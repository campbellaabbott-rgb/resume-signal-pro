// New York DOL. NY posts a notice roughly at its effective date (Date
// Posted − Date of WARN Notice median 61 days), so the posted stamp is the
// visible date and the notice date is the event date. The raw headers carry
// trailing spaces; the CSV reader collapses them. Header verified against
// the saved bln-raw-ny.csv.
import type { StateMap } from "./types.ts";

export const NY: StateMap = {
  state: "NY",
  sourceName: "New York DOL",
  sourceUrl: "https://dol.ny.gov/warn-notices",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/ny.csv",
  visibleBasis: "state_posted",
  columns: {
    filer: ["Business Legal Name"],
    noticeDate: ["Date of WARN Notice"],
    visible: ["Date Posted"],
    effective: ["Date Layoff/Closure Starts"],
    workers: ["Number of Affected Workers"],
    kind: ["Layoff or Closure?"],
    temporary: ["Permanent or Temporary Layoff?"],
    site: ["Impacted Site Address"],
    county: ["Impacted Site County"],
  },
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-ny.csv (2026-09-18)",
};
