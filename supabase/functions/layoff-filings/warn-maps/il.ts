// Illinois DCEO / IWN. The raw file is the IEBS public export (34 columns)
// row-for-row. Initial Date Reported is the visible stamp (it equals the
// earliest notification date on 74 of the 132 multi-date rows of 2026-10-08;
// the cell lists re-notifications newest first, see noticeDateCell); the count is the
// revised figure when the state has one, else the expected one; Reason is
// the closure/layoff cell. Rows the state does not flag as a WARN notice
// (WARN Notice = False) are non-WARN layoff reports and are not kept.
// Header verified against the saved il-export.xlsx (the state's own file).
import { earliestDateIn } from "../normalize.ts";
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
  // "8/10/2026, 5/1/2026": newest first, so the notice is the EARLIEST date
  // (S8-025). Keyed on it, an appended re-notification no longer mints a
  // second active filing for the same notice.
  noticeDateCell: (cell) => earliestDateIn(cell),
  keepRow: (row) => /^(true|yes|1)$/i.test(row["WARN Notice"] ?? "true"),
  verifiedAgainstSample: true,
  verifiedBy: "il-export.xlsx (2026-09-18)",
};
