// California EDD. Big Local News' raw ca.csv keeps the Processed Date the
// processed file drops and the verbatim Layoff/Closure cell (the processed
// flag is None, not False, on every layoff row). Header verified against
// the saved bln-raw-ca.csv; the state's own warn_report1.xlsx carries the
// same nine fields under longer names and is read only as a parity check.
import type { StateMap } from "./types.ts";

export const CA: StateMap = {
  state: "CA",
  sourceName: "California EDD",
  sourceUrl: "https://edd.ca.gov/en/Jobs_and_Training/Layoff_Services_WARN",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/ca.csv",
  visibleBasis: "state_processed",
  columns: {
    filer: ["company"],
    noticeDate: ["notice_date"],
    visible: ["received_date"],
    effective: ["effective_date"],
    workers: ["num_employees"],
    kind: ["layoff_or_closure"],
    site: ["address"],
    city: ["city"],
    county: ["county"],
  },
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-ca.csv (2026-09-18)",
};
