// Virginia Employment Commission. Big Local News' raw va.csv carries the
// employer's Notice Date and no received or posted stamp of the state's:
// header 'Company,Notice Date,Impact Date,Employees Affected,Location,
// Contact Person,Notice Type,Collective Bargaining Unit' (saved
// bln-raw-va.csv, 2026-11-15). So the notice date dates the event and our
// own first read of the notice is its public date, labelled as such
// (our_first_fetch): the employer's date is never printed as the agency's
// (S14X-036). The contact person is never read.
import type { StateMap } from "./types.ts";

export const VA: StateMap = {
  state: "VA",
  sourceName: "Virginia Employment Commission",
  sourceUrl: "https://www.vec.virginia.gov/warn-notices",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/va.csv",
  visibleBasis: "our_first_fetch",
  columns: {
    filer: ["Company"],
    noticeDate: ["Notice Date"],
    effective: ["Impact Date"],
    workers: ["Employees Affected"],
    kind: ["Notice Type"],
    site: ["Location"],
  },
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-va.csv (2026-11-15)",
};
