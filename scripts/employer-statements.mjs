// WHAT A POSTING'S EMPLOYER STATES, PUT INTO THE ROW THE PAGE ALREADY READS
// (SEO/GEO audit 2026-11-07, B06, SD-04, SD-05, F05).
//
// The bake reads each posting at its employer (scripts/employer-reads.mjs) and
// the answer carries what the employer's own system states that the board's
// stored row does not: an end date, a time type, a fully remote posting, the
// original posting date and a structured address. applyEmployerStatements puts
// those into the PostingRow fields the page already reads (employerValidThrough,
// employmentType, workMode/remote/workModeSource, postedAt, location), so the
// page's visible lines and its JobPosting both say them.
//
// THE BAKED PAGE HANDS THEM ON. React re-reads the posting from the board on
// hydration, and the board's row does not have them: the page used to rewrite
// the head and its own lines from that row, so a crawler that renders read
// what the bake had corrected put back. The bake writes the statements it
// applied into the head (a meta named EMPLOYER_STATED_META), and the posting
// page applies the same statements with this same function to the row the
// board returns.
//
// Plain JavaScript with no imports, so plain node runs it in the bake and the
// app bundles it (src/components/jobs/posting-page.ts), as with
// prerender-names.mjs.

/** The meta the bake writes the applied statements into, on a live posting page. */
export const EMPLOYER_STATED_META = "x-rb-employer-stated";

const day = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : null);
const text = (v, max = 80) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

/**
 * THE STATEMENTS, CHECKED FIELD BY FIELD, or null when none survives. The
 * bake writes only this, and the page reads only this back from its head, so a
 * head that carries anything else (an older bake's, an edited file's) can put
 * no other field into the row.
 */
export function employerStatedOf(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = {};
  const end = day(v.employerValidThrough);
  if (end) out.employerValidThrough = end;
  const et = text(v.employmentType, 40);
  if (et) out.employmentType = et;
  if (v.remote === true) out.remote = true;
  // THE DATE AS THE EMPLOYER WROTE IT, offset and all: the page prints its
  // first ten characters, and "2026-08-12T22:31:03-05:00" is the 12th where
  // the employer is, though it is the 13th in UTC.
  if (typeof v.postedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.postedAt.trim()) && v.postedAt.trim().length <= 40 && Number.isFinite(Date.parse(v.postedAt.trim()))) {
    out.postedAt = v.postedAt.trim();
  }
  const a = v.address;
  if (a && typeof a === "object" && !Array.isArray(a)) {
    const address = {};
    for (const k of ["addressLocality", "addressRegion", "postalCode", "addressCountry"]) {
      const s = text(a[k]);
      if (s) address[k] = s;
    }
    if (address.addressLocality) out.address = address;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * THE ROW WITH WHAT ITS EMPLOYER STATES, in the fields the page already reads.
 * Never lengthens anything: an end date only ever shortens the window, and a
 * posting date is taken only when it is EARLIER than the board's (a republish
 * timestamp is not when the employer posted the job: Paylocity 3011581 was fed
 * as 2026-10-31 and its own markup says 2026-08-12). `employmentTypeOf` is
 * posting-page's ldEmploymentType: a time type it cannot name is left out
 * rather than guessed. A stated address becomes the row's location ("Bellaire,
 * TX 77401") only where it names a town and a region in the row's own country:
 * Paylocity's LocationName is a site ("Lady Nomada Central Park"), and its own
 * JobPosting states the town.
 */
export function applyEmployerStatements(row, stated, { employmentTypeOf = () => undefined } = {}) {
  const s = employerStatedOf(stated);
  if (!row || !s) return row;
  const out = { ...row };
  if (s.employerValidThrough) {
    const prior = day(out.employerValidThrough);
    out.employerValidThrough = prior && prior < s.employerValidThrough ? prior : s.employerValidThrough;
  }
  if (s.employmentType && employmentTypeOf(s.employmentType)) out.employmentType = s.employmentType;
  if (s.remote === true) {
    out.workMode = "remote";
    out.remote = true;
    out.workModeSource = "vendor";
  }
  if (s.postedAt) {
    const board = typeof out.postedAt === "string" ? out.postedAt : null;
    if (!board || s.postedAt.slice(0, 10) < board.slice(0, 10)) out.postedAt = s.postedAt;
  }
  const a = s.address;
  if (a && a.addressLocality && a.addressRegion && String(a.addressCountry ?? "").toUpperCase() === String(out.country ?? "").toUpperCase()) {
    out.location = `${a.addressLocality}, ${a.addressRegion}${a.postalCode ? ` ${a.postalCode}` : ""}`;
  }
  return out;
}
