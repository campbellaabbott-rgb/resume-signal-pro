// Virginia Employment Commission. No copy of Big Local News' raw va.csv was saved in the
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

export const VA: StateMap = {
  state: "VA",
  sourceName: "Virginia Employment Commission",
  sourceUrl: "https://www.vec.virginia.gov/warn-notices",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/va.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["Company", "Company Name", "Employer"],
    noticeDate: ["Notice Date", "Date of Notice"],
    visible: ["Date Received", "Received Date"],
    effective: ["Impact Date", "Effective Date", "Layoff Date"],
    workers: ["Employees Affected", "Number Affected", "Total Employees Affected", "# Affected"],
    kind: ["Type", "Closure/Layoff", "Layoff/Closure"],
    site: ["Location", "Address"],
    city: ["City"],
    county: ["County"],
  },
  verifiedAgainstSample: false,
};
