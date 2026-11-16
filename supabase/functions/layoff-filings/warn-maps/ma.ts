// Massachusetts EOLWD. Big Local News' scraper writes a fixed six-column
// header (RECEIVED, EMPLOYER, CITY/TOWN, REGION, DATE(S) OF LAYOFFS,
// # EMPLOYEES IMPACTED) mirrored from the state's weekly report, verified
// against the saved bln-raw-ma.csv (2026-11-15). A file whose header differs
// is refused with the header it showed, and the night's read fails.
import type { StateMap } from "./types.ts";

export const MA: StateMap = {
  state: "MA",
  sourceName: "Massachusetts EOLWD",
  sourceUrl: "https://www.mass.gov/info-details/worker-adjustment-and-retraining-notification-act-warn-layoff-and-closure-updates",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/ma.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["EMPLOYER"],
    visible: ["RECEIVED"],
    effective: ["DATE(S) OF LAYOFFS"],
    workers: ["# EMPLOYEES IMPACTED"],
    city: ["CITY/TOWN"],
    county: ["REGION"],
  },
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-ma.csv (2026-11-15)",
};
