// Arizona DES. No copy of Big Local News' raw az.csv was saved in the
// research pass, so this map names the header spellings it is prepared to
// accept and nothing more: a file that resolves none of the filer or
// visible-date candidates is refused and its real header is written to
// layoff_feed_health.note for the owner to pin. The visible date must be
// the STATE'S stamp (received / posted); the employer's own notice date is
// never accepted in that slot, because the basis below would then label an
// employer date as the agency's -- a file whose only date is the notice
// date is refused with its header, and the owner decides between pinning a
// real stamp and an our_first_fetch basis.
import type { StateMap } from "./types.ts";

export const AZ: StateMap = {
  state: "AZ",
  sourceName: "Arizona DES",
  sourceUrl: "https://www.azjobconnection.gov/search/warn_lookups",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/az.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["Employer", "employer", "Company", "Company Name"],
    noticeDate: ["Notice Date", "notice_date"],
    visible: ["Date Received", "date_received", "Received Date"],
    effective: ["Layoff Date", "layoff_date", "Effective Date"],
    workers: ["Number of Employees Affected", "number_of_employees_affected", "Employees Affected"],
    kind: ["WARN Type", "warn_type", "Type"],
    city: ["City", "city"],
    county: ["County", "county"],
  },
  verifiedAgainstSample: false,
};
