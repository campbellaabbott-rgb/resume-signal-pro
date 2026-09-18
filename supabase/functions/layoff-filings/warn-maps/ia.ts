// Iowa Workforce Development. No copy of Big Local News' raw ia.csv was saved in the
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

export const IA: StateMap = {
  state: "IA",
  sourceName: "Iowa Workforce Development",
  sourceUrl: "https://workforce.iowa.gov/employers/business-resources/warn",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/ia.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["Company", "Company Name", "Employer", "Employer Name"],
    noticeDate: ["Notice Date", "Date of Notice", "WARN Notice Date"],
    visible: ["Date Received", "Received Date"],
    effective: ["Layoff Date", "Effective Date", "Date of Layoff"],
    workers: ["Number of Employees Affected", "Employees Affected", "# of Employees", "Number Affected"],
    kind: ["Type", "Layoff/Closure", "Closure/Layoff", "Type of Layoff"],
    city: ["City", "Location"],
    county: ["County"],
  },
  verifiedAgainstSample: false,
};
