// Ohio JFS. The state's CSV (two junk lines, then the header) carries a
// Date Received, a PDF link per notice and the verbatim Layoff/Closure cell;
// Big Local News' raw oh.csv is that file re-written with its header
// unchanged (plus a Notice ID from their historical file). Filer strings
// carry "UPDATE 2 …" and "… - Rescinded" affixes, folded by normalize.ts.
// Header verified against the saved oh-2026.csv (the state's own file).
import type { StateMap } from "./types.ts";

export const OH: StateMap = {
  state: "OH",
  sourceName: "Ohio JFS",
  sourceUrl: "https://jfs.ohio.gov/job-workforce-services/job-programs-and-services/submit-a-warn-notice/current-public-notices-of-layoffs-and-closures",
  blnRawUrl: "https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/oh.csv",
  visibleBasis: "state_received",
  columns: {
    filer: ["Company"],
    visible: ["Date Received"],
    effective: ["Layoff Date(s)"],
    workers: ["Potential Number Affected"],
    kind: ["Layoff/Closure"],
    site: ["City/County"],
    pdf: ["URL"],
  },
  verifiedAgainstSample: true,
  verifiedBy: "oh-2026.csv (2026-09-18)",
};
