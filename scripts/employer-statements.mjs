// WHAT A POSTING'S EMPLOYER STATES, PUT INTO THE ROW THE PAGE ALREADY READS
// (SEO/GEO audit 2026-11-07, B06, SD-04, SD-05, F05).
//
// The bake reads each posting at its employer (scripts/employer-reads.mjs) and
// the answer carries what the employer's own system states that the board's
// stored row does not: an end date, a time type, a fully remote posting, the
// original posting date, a structured address and the country it files the
// posting under. applyEmployerStatements puts those into the PostingRow fields
// the page already reads (employerValidThrough, employmentType,
// workMode/remote/workModeSource, postedAt, location, employerCountry), so the
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

/**
 * THE META A CLOSED POSTING'S PAGE CARRIES (B01): content "employer" on the
 * noindex page the bake writes when the employer's own system answered that
 * it no longer serves the posting. The board still serves its stored row, so
 * the posting page reads this from its head and shows the posting as gone
 * rather than rendering it live over the bake's "no longer listed" page.
 */
export const POSTING_CLOSED_META = "x-rb-posting-closed";

/** "employer" when a head's closure meta says the employer closed the posting, otherwise null. */
export const postingClosedOf = (v) => (v === "employer" ? "employer" : null);

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
  // A two-letter code, never a name: the page compares it with the row's.
  if (typeof v.country === "string" && /^[A-Z]{2}$/.test(v.country.trim())) out.country = v.country.trim();
  return Object.keys(out).length ? out : null;
}

/**
 * WHAT A LIVE LEDGER ENTRY CARRIES TO THE NEXT BAKE (SEO audit 2026-11-18,
 * STRUCTURED-M1): the employer's stated end date, its time type and a fully
 * remote flag, or null. The ledger kept none of them, so a later bake whose
 * read failed served validThrough at datePosted + 30 and no employmentType:
 * Marriott 26110535's Oracle end date is 2026-11-19T05:51Z, the 11-15 bake
 * served validThrough 11-18, and the 11-18 bake, its read unknown, 12-15.
 */
export function carriedStatementsOf(stated) {
  const s = employerStatedOf(stated);
  if (!s) return null;
  const out = {};
  if (s.employerValidThrough) out.employerValidThrough = s.employerValidThrough;
  if (s.employmentType) out.employmentType = s.employmentType;
  if (s.remote === true) out.remote = true;
  return Object.keys(out).length ? out : null;
}

/**
 * TODAY'S STATEMENTS WITH WHAT AN EARLIER READ STATED (STRUCTURED-M1).
 * `fresh` is this bake's read, `carried` the ledger entry's statements and
 * `read` this bake's answer ("open", "closed" or "unknown"). The end date is
 * today's when today's read states one, earlier or later, and the carried one
 * otherwise: validThrough never moves past an end date the employer stated
 * unless a fresh read states a later one. When today's read did not answer,
 * the carried time type and remote flag stand too; when it did, today's
 * answer is the employer's word on them. Returns statements in
 * employerStatedOf's shape, or null.
 */
export function withCarriedStatements(fresh, carried, read) {
  const f = employerStatedOf(fresh);
  const c = carriedStatementsOf(carried);
  if (!c) return f;
  const out = { ...(f ?? {}) };
  if (!out.employerValidThrough && c.employerValidThrough) out.employerValidThrough = c.employerValidThrough;
  if (read !== "open") {
    if (!out.employmentType && c.employmentType) out.employmentType = c.employmentType;
    if (out.remote !== true && c.remote === true) out.remote = true;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * THE EARLIER OF TWO CARRIED STATEMENTS (SEO audit 2026-11-18, STRUCTURED-B2):
 * the daily check's (`check`, the fresher) and the live ledger's (`ledger`).
 * The end date is the earlier of the two, so validThrough never moves later
 * on a carry; the time type and the remote flag are the check's where it
 * states them, else the ledger's. Returns carriedStatementsOf's shape, or null.
 */
export function earlierCarried(check, ledger) {
  const a = carriedStatementsOf(check);
  const b = carriedStatementsOf(ledger);
  if (!a) return b;
  if (!b) return a;
  const out = { ...b, ...a };
  if (a.employerValidThrough && b.employerValidThrough) out.employerValidThrough = a.employerValidThrough < b.employerValidThrough ? a.employerValidThrough : b.employerValidThrough;
  return out;
}

/**
 * WHAT THE DAILY CHECK READ AT EACH PAGE'S EMPLOYER, FOR THE NEXT BAKE (SEO
 * audit 2026-11-18, STRUCTURED-B2 and the owner's unread-Workday rule). The
 * bake's own Workday read answered 39 of 297 pages on 2026-11-18 while the
 * daily check, from GitHub's network, answered 285 of 289: the check's
 * answers never reached the bake, so a Workday page whose bake read failed
 * served validThrough at datePosted + 30 (AstraZeneca R-243632: 12-06 against
 * its employer's 11-20) and no employment type.
 *
 * scripts/seo-seed/employer-stated.txt carries them, one page a line:
 *   <path> <read at, YYYY-MM-DDTHH:MMZ> <open|unknown> <statements as JSON, or ->
 * The check writes the whole file from its newest measuring run, into the
 * pull request it proposes (posting-closure.yml); a person merges it. Pages it
 * found closed go to closed-at-employer.txt instead.
 */
export const STATED_LIST_MAX_AGE_DAYS = 14;
/** A daily check's "open" counts for the unread-Workday rule for this long after its read. */
export const OPEN_READ_FRESH_HOURS = 36;

/** One line of employer-stated.txt. `at` is an ISO instant (cut to the minute), `state` "open" or "unknown". */
export function employerStatedLine(path, at, state, stated) {
  const s = employerStatedOf(stated);
  const when = `${String(at ?? "").slice(0, 16)}Z`;
  return `${path} ${when} ${state === "open" ? "open" : "unknown"} ${s ? JSON.stringify(s) : "-"}`;
}

/**
 * employer-stated.txt as a Map of path to { at (epoch ms), state, stated }.
 * A line older than STATED_LIST_MAX_AGE_DAYS before `nowMs`, dated after it,
 * or malformed is left out; "#" starts a comment.
 */
export function employerStatedList(text, nowMs, { maxAgeDays = STATED_LIST_MAX_AGE_DAYS } = {}) {
  const out = new Map();
  if (!Number.isFinite(nowMs)) return out;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\/jobs\/posting\/\S+)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)\s+(open|unknown)\s+(.+)$/.exec(line);
    if (!m) continue;
    const at = Date.parse(m[2].replace("Z", ":00Z"));
    if (!Number.isFinite(at) || at > nowMs || nowMs - at > maxAgeDays * 86_400_000) continue;
    let stated = null;
    if (m[4] !== "-") {
      try { stated = employerStatedOf(JSON.parse(m[4])); } catch { stated = null; }
    }
    out.set(m[1], { at, state: m[3], stated });
  }
  return out;
}

/** Whether a check entry read the page as open within `hours` before `nowMs`. */
export const checkReadOpenWithin = (entry, nowMs, hours = OPEN_READ_FRESH_HOURS) =>
  !!entry && entry.state === "open" && Number.isFinite(entry.at) && nowMs - entry.at <= hours * 3_600_000 && entry.at <= nowMs;

/**
 * WHETHER THE CHECK'S FILE IS FRESH ENOUGH TO WITHHOLD BY (review of
 * 2026-11-21; the owner's condition on the unread-Workday rule). The file
 * keeps a line for STATED_LIST_MAX_AGE_DAYS, but an "open" in it counts for
 * only OPEN_READ_FRESH_HOURS. The daily pull request is merged by a person and
 * a publish can come days later: a file read on the 20th at 00:44 and baked on
 * the 21st at 18:00 clears no page, and the rule would withhold JobPosting
 * from every Workday page whose own bake read failed (the bake read 39 of 297
 * on 2026-11-18, so about half of all posting pages), where the owner said
 * yes to a handful. `reads` is employerStatedList's Map; returns the newest
 * line's instant (epoch ms, or null when there is none) and `fresh`, true
 * only when that line was read within `hours` before `nowMs`.
 */
export function checkReadsFreshness(reads, nowMs, hours = OPEN_READ_FRESH_HOURS) {
  let newest = null;
  if (reads && typeof reads.values === "function") {
    for (const e of reads.values()) if (e && Number.isFinite(e.at) && (newest === null || e.at > newest)) newest = e.at;
  }
  const fresh = newest !== null && Number.isFinite(nowMs) && newest <= nowMs && nowMs - newest <= hours * 3_600_000;
  return { newest, fresh };
}

/** Whether statements put the employer's own end date before `today` (YYYY-MM-DD): the posting is past it. */
export const statedEndPassed = (stated, today) => {
  const end = employerStatedOf(stated)?.employerValidThrough;
  return !!end && typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) && end < today;
};

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
  // THE EMPLOYER'S COUNTRY IS KEPT BESIDE THE ROW'S, NEVER WRITTEN OVER IT
  // (F08). The row's location was read under the row's country, so swapping
  // the country alone would hang a town of one country on another; the page
  // withholds the markup when the two disagree (posting-page.ts
  // postingCountryMismatch), as it does for a location naming another country.
  if (s.country) out.employerCountry = s.country;
  return out;
}
