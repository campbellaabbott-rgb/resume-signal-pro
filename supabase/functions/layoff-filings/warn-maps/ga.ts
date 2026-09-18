// Georgia TCSG. Big Local News reads each notice's detail page and keys
// the raw row by the page's own field labels (Company Name, County, Type of
// Layoff or Closure, First Date of Separation, First Location Address,
// Number of Employees Affected). The detail page shows no received or
// posted stamp; the listing's "Date created" is the only candidate and its
// presence in the raw file was NOT verified against a saved copy. Until it
// is, a file without a visible-date column is refused, never dated by us.
import type { StateMap } from "./types.ts";

export const GA: StateMap = {
  state: "GA",
  sourceName: "Georgia TCSG",
  sourceUrl: "https://www.tcsg.edu/warn-public-view/",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/ga.csv",
  visibleBasis: "state_posted",
  columns: {
    filer: ["Company Name"],
    visible: ["Date created", "Date Created", "Date Received", "Received Date"],
    effective: ["First Date of Separation"],
    workers: ["Number of Employees Affected", "Total Number of Affected Employees"],
    kind: ["Type of Layoff or Closure"],
    site: ["First Location Address", "Company Address"],
    county: ["County"],
  },
  verifiedAgainstSample: false,
};
