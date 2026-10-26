// Which posting rows may carry a page and job markup of their own: the bake's
// rule 1, in a module with no imports at all, so the app can run the very
// same function. src/components/jobs/posting-page.ts calls it inside
// postingJsonLd, which is what the React posting page and the board's detail
// pane write their job markup from; scripts/prerender-pages.mjs re-exports it
// for the bake (scripts/prerender-seo.mjs), whose other helpers there need
// node:crypto and so could never reach the browser bundle.
//
// `D` is the app's own modules (posting-page.ts and company-display.ts): the
// bake passes its esbuild bundle of them, posting-page.ts passes its own.

/**
 * Rule 1 of the posting rule: a row may get a page of its own only when it
 * carries everything the page must state, under its employer's own name (F1),
 * from the employer itself (a staffing agency's row is not: the page says the
 * posting came from the employer's own system and names the row's company as
 * the hiring organisation; nor is a row the USAJOBS listing site carries),
 * with a place, and still live. The description
 * gate needs the detail read and is applied after it.
 *
 * A row whose board names no hirer for it (D.postingEmployer answers "") gets
 * no page: its markup would have to name the board's publisher as the hiring
 * organisation.
 */
export const postingRowEligible = (j, D) => !!(j
  && typeof j.id === "string"
  && D.postingPagePath(j.id)
  && typeof j.title === "string" && j.title.trim()
  && typeof j.company === "string" && j.company.trim()
  && D.postingEmployer(j)
  && !D.isCodeShapedName(j.token ?? D.postingPathParts(j.id)?.token ?? null, D.postingEmployer(j))
  && j.agency !== true
  // USAJOBS is a listing site, not an employer: a page of its own would say
  // "Apply on <agency>'s own site" and "never an aggregator" of a row the
  // federal listing site carries.
  && j.source !== "usajobs" && (j.token ?? D.postingPathParts(j.id)?.token ?? null) !== "usajobs"
  && j.country
  && (j.workMode === "remote" || j.location)
  && D.isPostingLive(j));
