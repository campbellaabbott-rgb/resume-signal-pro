// OD-CC (owner, 2026-11-17): new boards come from open registers and from
// employers' own sites. Host lists drawn from Common Crawl's indexes (its CDX
// API and its columnar files) are not used, and the Wayback Machine's CDX
// listing, the same kind of archive-derived host list, is refused with them.
//
// Every census script whose discovery reads one of those listings calls
// refuseArchiveListing() straight after its imports, so it stops before its
// first request. A guard test (no-census-script-reads-an-archive-listing)
// finds every script that names one of those hosts in its code and requires
// the call. Lifting the refusal takes a new recorded owner decision, not an
// environment variable.

export const OD_CC_DECIDED = "2026-11-17";
export const OD_CC_RULE =
  "new boards come from open registers and employers' own sites; Common Crawl host lists and the Wayback CDX listing are not used";
/** The exit status of a refused run: neither a success nor a crash. */
export const REFUSED_EXIT = 2;

/** Stops the calling script before it reads anything, naming the decision. */
export function refuseArchiveListing(script) {
  const name = String(script ?? "this script").replace(/^file:\/\/.*\//, "");
  process.stderr.write(
    `${name}: refused by owner decision OD-CC (${OD_CC_DECIDED}): ${OD_CC_RULE}. Nothing was read.\n`,
  );
  process.exit(REFUSED_EXIT);
}
