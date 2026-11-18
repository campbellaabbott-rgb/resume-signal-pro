// Arizona DES. Big Local News' raw az.csv carries the employer's notice_date
// ("Feb 26, 2026") and no received or posted stamp of the state's: header
// 'employer,notice_date,number_of_employees_affected,warn_type,city,zip,
// lwib_area,address,record_number,detail_page_url' (saved bln-raw-az.csv,
// 2026-11-15). So the notice date dates the event and our own first read of
// the notice is its public date, labelled as such (our_first_fetch): the
// employer's date is never printed as the agency's (S14X-036). The state
// lists notices that are not WARN notices beside them (warn_type
// 'Non-WARN'); those are not kept.
import type { StateMap } from "./types.ts";

export const AZ: StateMap = {
  state: "AZ",
  sourceName: "Arizona DES",
  sourceUrl: "https://www.azjobconnection.gov/search/warn_lookups",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/az.csv",
  visibleBasis: "our_first_fetch",
  columns: {
    filer: ["employer"],
    noticeDate: ["notice_date"],
    workers: ["number_of_employees_affected"],
    kind: ["warn_type"],
    site: ["address"],
    city: ["city"],
  },
  keepRow: (row) => (row["warn_type"] ?? "").trim().toLowerCase() !== "non-warn",
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-az.csv (2026-11-15)",
};
