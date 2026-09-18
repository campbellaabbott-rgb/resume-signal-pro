// Massachusetts EOLWD. Big Local News' scraper writes a fixed six-column
// header (RECEIVED, EMPLOYER, CITY/TOWN, REGION, DATE(S) OF LAYOFFS,
// # EMPLOYEES IMPACTED) mirrored from the state's weekly report; the
// header is taken from that scraper's source, the rows were NOT checked
// against a saved copy of the raw file. A file whose header differs is
// refused with the header it showed.
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
  verifiedAgainstSample: false,
};
