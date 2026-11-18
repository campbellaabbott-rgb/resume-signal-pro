// Maryland Department of Labor. Big Local News' raw md.csv carries the
// employer's Notice Date and no received or posted stamp of the state's:
// header 'Notice Date,NAICS Code,Company,Location,Local Area,Total
// Employees,Effective Date,Type' (saved bln-raw-md.csv, 2026-11-15). So the
// notice date dates the event and our own first read of the notice is its
// public date, labelled as such (our_first_fetch): the employer's date is
// never printed as the agency's (S14X-036). Type is a code ('1', '2') on
// most rows and words on the rest; a code reads as an unknown kind.
import type { StateMap } from "./types.ts";

export const MD: StateMap = {
  state: "MD",
  sourceName: "Maryland Department of Labor",
  sourceUrl: "https://www.dllr.state.md.us/employment/warn.shtml",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/md.csv",
  visibleBasis: "our_first_fetch",
  columns: {
    filer: ["Company"],
    noticeDate: ["Notice Date"],
    effective: ["Effective Date"],
    workers: ["Total Employees"],
    kind: ["Type"],
    site: ["Location"],
  },
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-md.csv (2026-11-15)",
};
