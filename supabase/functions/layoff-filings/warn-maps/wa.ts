// Washington ESD. The state publishes a Received Date and no employer
// notice date; Big Local News' processed file slots the Layoff Start Date
// into notice_date (the 2026-12-31 "latest notice" defect), so the raw
// file is read and the received stamp is the visible date. Header verified
// against the saved bln-raw-wa.csv.
import type { StateMap } from "./types.ts";

export const WA: StateMap = {
  state: "WA",
  sourceName: "Washington ESD",
  sourceUrl: "https://esd.wa.gov/about-employees/WARN",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/wa.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["Company"],
    visible: ["Received Date"],
    effective: ["Layoff Start Date"],
    workers: ["# of Workers"],
    kind: ["Closure Layoff"],
    temporary: ["Type of Layoff"],
    site: ["Location"],
    pdf: ["Notice"],
  },
  verifiedAgainstSample: true,
  verifiedBy: "bln-raw-wa.csv (2026-09-18)",
};
