// Oregon HECC. No copy of Big Local News' raw or.csv was saved in the
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

export const OR: StateMap = {
  state: "OR",
  sourceName: "Oregon HECC",
  sourceUrl: "https://ccwd.hecc.oregon.gov/Layoff/WARN",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/or.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["Company Name", "Company", "Employer"],
    noticeDate: ["Notice Date", "Date of Notice"],
    visible: ["Date Received", "Received Date"],
    effective: ["Layoff Date", "Effective Date"],
    workers: ["Number of Employees", "Employees Affected", "# of Employees"],
    kind: ["Layoff/Closure", "Closure/Layoff", "Type", "Notice Type"],
    site: ["Location", "Address"],
    city: ["City"],
    county: ["County"],
  },
  verifiedAgainstSample: false,
};
