// Illinois DCEO / IWN. The raw file is the IEBS public export (34 columns)
// row-for-row. Initial Date Reported equals the notification date on every
// row (lag zero by construction) and is the visible stamp; the count is the
// revised figure when the state has one, else the expected one; Reason is
// the closure/layoff cell. Rows the state does not flag as a WARN notice
// (WARN Notice = False) are non-WARN layoff reports and are not kept.
// Header verified against the saved il-export.xlsx (the state's own file).
import type { StateMap } from "./types.ts";

export const IL: StateMap = {
  state: "IL",
  sourceName: "Illinois DCEO",
  sourceUrl: "https://dceo.illinois.gov/workforcedevelopment/warn.html",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/il.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["Location Name"],
    noticeDate: ["Notification Date(s)"],
    visible: ["Initial Date Reported"],
    workers: ["Revised Layoff", "Expected Layoff"],
    kind: ["Reason"],
    site: ["Location Address"],
    city: ["Location City"],
    county: ["County"],
  },
  keepRow: (row) => /^(true|yes|1)$/i.test(row["WARN Notice"] ?? "true"),
  verifiedAgainstSample: true,
  verifiedBy: "il-export.xlsx (2026-09-18)",
};
