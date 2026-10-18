// THE STAFFING-AGENCY BOARDS, READ FROM THE CATALOGUE FOR THE BAKE.
//
// The SPA labels a staffing agency's board (AgencyBanner: "This is a staffing
// agency's board. Roles here are usually for its clients.") from the rows'
// `agency` flag, and /companies says agency boards are labelled on their
// pages. The bake wrote them as plain employer pages ("Open roles at Surge
// Staffing ... pulled straight from Surge Staffing's own hiring system", "The
// fields Surge Staffing is hiring in", an Organization as the employer) while
// /jobs/company/surge sat indexable in the live sitemap (2026-10-18 review).
//
// The flag lives on the catalogue entry, which the bake does not bundle (the
// job board's catalogue is megabytes). Every agency entry is written in the
// object form, `{ name: "...", source: "...", token: "...", agency: true }`
// (the packed form has no flag field), so a scan of the file's text finds
// them; src/test/pd-bake-an-agency-board-and-usajobs-are-baked-as-what-they-are
// holds this reader against the shared catalogue reader
// (src/test/helpers/catalog.ts) over the whole catalogue.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The catalogue file, relative to the repo root. */
export const CATALOGUE_PATH = "supabase/functions/job-board/sources.ts";

/** Every token the catalogue flags as a staffing agency's board, from the catalogue's text. Pure. */
export function agencyTokensOf(sourceText) {
  const out = new Set();
  const re = /\{\s*name:\s*"(?:[^"\\]|\\.)*",\s*source:\s*"[^"]+",\s*token:\s*"([^"]+)"([^{}]*)\}/g;
  for (const m of String(sourceText ?? "").matchAll(re)) if (/\bagency:\s*true\b/.test(m[2])) out.add(m[1]);
  return out;
}

/** The agency tokens of the catalogue under `root`, or an empty set (logged) when it cannot be read. */
export function readAgencyTokens(root, log = console.warn) {
  try {
    return agencyTokensOf(readFileSync(join(root, CATALOGUE_PATH), "utf8"));
  } catch (e) {
    log(`[prerender-seo] agency boards: the catalogue could not be read (${e?.message || e}); no company page is labelled an agency's this bake`);
    return new Set();
  }
}
