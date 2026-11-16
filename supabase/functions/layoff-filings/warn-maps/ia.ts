// Iowa Workforce Development. Big Local News' raw ia.csv carries the
// employer's Notice Date and no received or posted stamp of the state's:
// header 'Company,Address ,City,County,St,ZIP,Notice Type,Emp #,Notice
// Date,Layoff Date,Local Workforce Area,Industry' plus some 150 empty
// columns (saved bln-raw-ia.csv, 2026-11-15, the empty columns trimmed). So
// the notice date dates the event and our own first read of the notice is
// its public date, labelled as such (our_first_fetch): the employer's date
// is never printed as the agency's (S14X-036). The count is 'Emp #'.
import type { StateMap } from "./types.ts";

export const IA: StateMap = {
  state: "IA",
  sourceName: "Iowa Workforce Development",
  sourceUrl: "https://workforce.iowa.gov/employers/business-resources/warn",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/ia.csv",
  visibleBasis: "our_first_fetch",
  columns: {
    filer: ["Company"],
    noticeDate: ["Notice Date"],
    effective: ["Layoff Date"],
    workers: ["Emp #"],
    kind: ["Notice Type"],
    site: ["Address"],
    city: ["City"],
    county: ["County"],
  },
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-ia.csv (2026-11-15)",
};
