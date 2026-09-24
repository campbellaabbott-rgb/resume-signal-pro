/**
 * ONE POSTING, ONE URL — the pure half, shared by the React page and the bake.
 *
 * A posting had no address. The board renders it in a dialog over the list, so
 * the only thing that ever identified it was a query parameter on the list URL,
 * and a query parameter is not a page: measured 2026-09-23 under a Googlebot
 * user-agent, /jobs?job=<any id> returned the SAME 12,377 bytes as /jobs, MD5
 * identical, with a canonical naming /jobs and no JobPosting markup in the
 * served bytes. A nonexistent id returned those same bytes too.
 *
 * Everything a posting page needs to be TRUE lives here, in one module, so the
 * static file the bake writes and the page React renders over it cannot drift:
 * the URL, the head copy, the structured data and the honesty gates on all of
 * it. scripts/prerender-seo.mjs imports this module through its esbuild data
 * entry; src/pages/JobPosting.tsx imports it directly.
 */

/**
 * THE BOARD'S OWN SERVING WINDOW, MIRRORED — and the mirror is the point.
 *
 * The number is declared in supabase/functions/job-board/index.ts (a Deno
 * runtime this bundle cannot import) and it is what makes the expiry date on
 * every posting page true: the board hard-drops a dated posting once it passes
 * that many days, so the URL genuinely stops serving the posting then. A copy
 * of a constant in another runtime is the exact shape that goes false in
 * silence, so a test reads that file and fails when the two disagree.
 */
export const BOARD_FRESH_WINDOW_DAYS = 30;

/** The path prefix every posting page lives under. */
export const POSTING_PATH_PREFIX = "/jobs/posting";

/**
 * THE ONE SLOT THE JOB MARKUP LIVES IN, spelled once for both runtimes.
 *
 * The bake writes a JobPosting block into the static head; the React page
 * takes that same element over on hydration so a live posting is never
 * described twice and a posting that went stale since the bake has its markup
 * REMOVED rather than left standing beside a "no longer live" heading. The id
 * was declared only on the React side at first, and the bake wrote its block
 * with no id at all — so the takeover matched nothing, every live page ended
 * up with two JobPosting entities, and every retracted one kept the baked
 * entity while the page said the posting was gone. Both sides read this.
 */
export const POSTING_LD_TAG_ID = "posting-jsonld";

/**
 * A posting row as the board's list and detail actions return it. Only the
 * fields a page renders or reasons about are named; the board returns more.
 */
export interface PostingRow {
  id: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  country?: string | null;
  workMode?: string | null;
  remote?: boolean | null;
  employmentType?: string | null;
  category?: string | null;
  token?: string | null;
  source?: string | null;
  postedAt?: string | null;
  missingSince?: string | null;
  applyUrl?: string | null;
  salary?: string | null;
  salaryMinAnnual?: number | null;
  salaryMaxAnnual?: number | null;
  salaryPeriod?: string | null;
  salaryCurrency?: string | null;
  recheckedAt?: string | null;
  /**
   * The board's own staffing-agency flag, NOT NULL on every row and carried by
   * both the list and the detail exits. It is read here because a posting page
   * makes a categorical claim beside the employer's name — "never an
   * aggregator, never a repost" — and for an agency row that claim is false and
   * `hiringOrganization` names the agency rather than the employer.
   */
  agency?: boolean | null;
}

/**
 * THE URL IS THREE SEGMENTS, NOT ONE ENCODED ONE, AND THAT IS A MEASURED CHOICE.
 *
 * A board id is `<source>:<token>:<requisition>` — measured over 25,108 live
 * ids from the board's own posting sitemap, every one had exactly two colons
 * and drew only from letters, digits and ._~@=+- besides. So the id maps
 * losslessly onto three path segments and needs no escaping at all.
 *
 * The alternative — one segment carrying the colons, escaped or raw — puts a
 * character class this host has never served into a path, and that is precisely
 * how 25 of 485 company URLs shipped dead: the host read a dot in the last
 * segment as a file extension and returned a 9-byte 404 to crawlers AND to
 * humans (see the publicHref note in scripts/prerender-seo.mjs). Slashes and
 * tildes are already proven on /jobs/company/<token>. This uses only those.
 */
const SEGMENT = /^[A-Za-z0-9._~@=+-]+$/;

/** The three parts of a board id, or null when the id is not the three-part shape. */
export function postingPathParts(id: string): { source: string; token: string; key: string } | null {
  if (typeof id !== "string") return null;
  const parts = id.split(":");
  if (parts.length !== 3) return null;
  const [source, token, key] = parts;
  if (!SEGMENT.test(source) || !SEGMENT.test(token) || !SEGMENT.test(key)) return null;
  return { source, token, key };
}

/**
 * The page path for a posting, or null when its id cannot be a path.
 *
 * A last segment carrying a dot gets a trailing slash, because this host reads
 * the dot as a file extension and answers a bare 404 — to crawlers and to
 * people — instead of falling through to the app. The slash is put on HERE
 * rather than at each use site so that the route, the written file, the
 * canonical, the structured data's own url and the sitemap all carry one
 * spelling of the address.
 */
export function postingPagePath(id: string): string | null {
  const p = postingPathParts(id);
  if (!p) return null;
  const path = `${POSTING_PATH_PREFIX}/${p.source}/${p.token}/${p.key}`;
  return p.key.includes(".") ? `${path}/` : path;
}

/** The board id a three-segment route resolves to, or null when a segment is missing. */
export function postingIdFromParams(
  source?: string | null,
  token?: string | null,
  key?: string | null,
): string | null {
  if (!source || !token || !key) return null;
  const id = `${source}:${token}:${key}`;
  return postingPathParts(id) ? id : null;
}

/** The board id a posting page path names, or null when the path is not one. */
export function postingIdFromPath(path: string): string | null {
  if (typeof path !== "string") return null;
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  // jobs / posting / source / token / key
  if (parts.length !== 5) return null;
  if (`/${parts[0]}/${parts[1]}` !== POSTING_PATH_PREFIX) return null;
  return postingIdFromParams(parts[2], parts[3], parts[4]);
}

/**
 * Residual entities the ingest text-extraction missed. The stored description
 * is plain text (verified against the live detail action), so this decodes
 * rather than parses — nothing here may introduce markup.
 */
export function decodeJdEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#(\d+);/g, (_m, d) => {
      const code = parseInt(d, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/ /g, " ");
}

/** The description as display paragraphs: decoded, blank-line split, empties dropped. */
export function jdParagraphs(description: string): string[] {
  return decodeJdEntities(description)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+\n/g, "\n").trim())
    .filter((p) => p.length > 0);
}

/**
 * The identity a DUPLICATE shares. One requisition appears as N rows across a
 * tenant's career sites (measured ~23k duplicated rows on this board), and
 * Google's guidance for several copies of one posting under different URLs is
 * to canonicalise them. Nothing here can canonicalise across ids it never saw,
 * so the bake instead PICKS ONE per identity and gives the others no page at
 * all — a URL that does not exist cannot compete with itself.
 *
 * IT DOES NOT KEEP THE SERVED TITLES DISTINCT, and the first version of this
 * comment claimed it did. Identity is company|title|location; the page title
 * is then clamped to a SERP budget, and the clamp used to drop the location
 * first — so two rows with distinct identities collapsed onto one title. The
 * built tree shipped 15 posting URLs across 6 titles (five Target stores under
 * one "Guest Advocate (Cashier), General Merchandise, Inbound (Stoc…"), which
 * is what Search Console reports as "Duplicate without user-selected
 * canonical". Distinctness is postingPageTitle's job now, by construction, and
 * is asserted directly rather than inferred from this function.
 */
export function postingIdentity(job: PostingRow): string {
  return [job.company, job.title, job.location]
    .map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
    .join("|");
}

/** UTC calendar day of an ISO stamp. */
const day = (iso: string): string => iso.slice(0, 10);

/**
 * datePosted, clamped to today. A date-only stamp from a vendor parses as a
 * future UTC midnight for western timezones and Google rejects a future
 * datePosted; an employer's "tomorrow" is, for every honest purpose, today.
 */
export function postingDatePosted(postedAt: string, now: Date = new Date()): string {
  const stated = day(postedAt);
  const today = now.toISOString().slice(0, 10);
  return stated > today ? today : stated;
}

/**
 * validThrough, honest against BOTH rules that end a posting here.
 *
 * It is not an employer's application deadline — we do not know one and must
 * not invent one. It is the date THIS URL stops serving the posting, which is
 * what the property means for the page it sits on:
 *   - the board's serving window closes at posted_at + BOARD_FRESH_WINDOW_DAYS;
 *   - a posting the employer's own feed stopped serving is stamped gone, and
 *     from that day it is not live at all, so the window ends there instead.
 * Computed from the RAW stated date, never the clamped one, so an already-old
 * posting gets a past date — which Google reads as expired, and it is.
 *
 * WHAT THE STATIC FILE CANNOT DO, said plainly so it is not mistaken for an
 * oversight. Between two bakes the file cannot retract: if the employer pulls
 * the job tomorrow, the bytes keep this date until the next publish. Three
 * things bound that and none of them is a promise this date makes:
 *   - the board stops serving the posting the moment its feed drops it, and
 *     JobPosting.tsx removes this markup on hydration for a posting that is
 *     gone (src/test/a-posting-that-is-gone-must-not-be-served-as-live.tsx);
 *   - every already-published posting URL is re-verified by id on every bake
 *     and dropped when the posting is dead, so a bake is a retraction pass —
 *     which it was NOT while the carry set was an intersection with the
 *     newest window and 395 of 397 URLs churned out per bake;
 *   - this date is an upper bound in the first place: the board hard-drops a
 *     dated posting at BOARD_FRESH_WINDOW_DAYS, so the URL genuinely stops
 *     serving it then.
 *
 * SHORTENING IT TO `bake + expected publish interval` WAS PROPOSED AND
 * REFUSED. There is no such interval to name: publishes here are manual and
 * no workflow in .github/workflows schedules one (the three cron entries are
 * the botwall sweep, board health and the apply worker). Writing a shorter
 * expiry would put a date on the page that neither the employer nor the board
 * ever stated, chosen from a cadence nobody measured — an invented figure in
 * markup, which is the one thing this module refuses everywhere else.
 */
export function postingValidThrough(job: PostingRow): string | null {
  if (!job.postedAt) return null;
  const capped = new Date(Date.parse(day(job.postedAt)) + BOARD_FRESH_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (!job.missingSince) return capped;
  const gone = day(job.missingSince);
  return gone < capped ? gone : capped;
}

/**
 * Is this posting live RIGHT NOW by the board's own two rules? A posting that
 * is gone must never be served as live, and Google does not allow an expired
 * posting to be marked up at all.
 */
export function isPostingLive(job: PostingRow, now: Date = new Date()): boolean {
  if (job.missingSince) return false;
  if (!job.postedAt) return false;
  const through = postingValidThrough(job);
  return !!through && through >= now.toISOString().slice(0, 10);
}

/**
 * A LOCALITY IS A TOWN. THE BOARD'S LOCATION COLUMN IS A SENTENCE.
 *
 * `addressLocality` was being handed the board's whole free-text location
 * string. Measured over the 399 pages this bake wrote: 211 of them (52.9%)
 * carried something that is not a locality — "1144 State Route 303,
 * Streetsboro, OH 44241-5266", "5100 Kings Plaza, Ste 2201, Brooklyn,NY
 * 11234-5208", "Aurora St Lukes Medical Center - 2900 W Oklahoma Ave" (9
 * pages, no town in the string at all), "United States-Florida-Melbourne".
 * Google's reference asks for `addressLocality`, `addressRegion`,
 * `postalCode` and `streetAddress` as separate properties; a street in the
 * locality slot is a locality Google cannot match, and it is untrue markup by
 * this module's own standard — the property says locality and the value is a
 * street.
 *
 * SO THE STRING IS DECOMPOSED, OR THE LOCALITY IS LEFT OUT. Two shapes are
 * recognised, and nothing else is guessed at:
 *
 *   COMMA FORM   `[street…], locality, REGION[ postal][, country name]`
 *                the ordinary postal order, which is what the ATS feeds
 *                emit when they emit an address at all.
 *   DASH FORM    `COUNTRY - REGION - locality`, Workday's own spelling
 *                ("USA - CO - Denver", "United States-Florida-Melbourne").
 *                Recognised ONLY by the subdivision token in the middle, so
 *                no country-name vocabulary is invented here to find it.
 *
 * Anything else yields `addressCountry` alone, plus `addressRegion` when a
 * subdivision is nonetheless unambiguous. That follows the same rule the rest
 * of this module follows: an absent fact is said to be absent, never filled in
 * with the nearest string to hand.
 */

/** Subdivisions are read only where they are unambiguous: the two countries whose codes we know. */
const US_STATE_CODES = new Set(
  ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY " +
    "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP").split(" "),
);

/**
 * Spelled-out state names. Georgia is present here and absent from the board's
 * own table for a reason that does not apply on this side: there the string
 * arrives with no country and "Georgia" may be the country, here the country
 * has already been read off the row and this branch runs only when it is US.
 */
const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

const CA_PROVINCE_CODES = new Set("AB BC MB NB NL NS NT NU ON PE QC SK YT".split(" "));
const CA_PROVINCE_NAMES: Record<string, string> = {
  alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB",
  "newfoundland and labrador": "NL", "nova scotia": "NS", "northwest territories": "NT",
  nunavut: "NU", ontario: "ON", "prince edward island": "PE", quebec: "QC", québec: "QC",
  saskatchewan: "SK", yukon: "YT",
};

/** US ZIP or ZIP+4, and the Canadian postal code. */
const US_ZIP = /^\d{5}(?:-\d{4})?$/;
const CA_POSTAL = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

/** A segment that is an address line rather than a town. */
const STREETISH =
  /(?:^\d)|\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway|suite|ste|floor|fl|unit|rte|route|bldg|building|campus|center|centre|hospital|plaza|tower)\b\.?/i;

/**
 * Words that name no town, whatever column they arrive in. The work-mode words
 * are here because Workday writes them into the location string ("Remote - US",
 * "Hybrid - Chicago"), and a leading one changes what the rest of the string
 * is: "Remote - Poland" names a country, not a town in it.
 */
const NOT_A_TOWN = /^(?:remote|hybrid|onsite|on-site|office|various|multiple|flexible|anywhere|home|work from home|wfh|virtual|field|nationwide|n\/a|tbd)$/i;

/** A country written where a town should be. Three letters is the shortest town we will publish. */
const NOT_A_TOWN_BUT_A_COUNTRY = /^(?:usa|u\.?s\.?a?\.?|uk|u\.?k\.?|eu)$/i;

/** The subdivision code a segment names for this country, or null. */
function subdivisionOf(segment: string, country: string): string | null {
  const s = segment.trim();
  if (!s) return null;
  if (country === "US") {
    if (US_STATE_CODES.has(s.toUpperCase()) && s.length === 2) return s.toUpperCase();
    return US_STATE_NAMES[s.toLowerCase()] ?? null;
  }
  if (country === "CA") {
    if (CA_PROVINCE_CODES.has(s.toUpperCase()) && s.length === 2) return s.toUpperCase();
    return CA_PROVINCE_NAMES[s.toLowerCase()] ?? null;
  }
  return null;
}

/** Is this segment a town name we are willing to publish as one? */
function isLocality(segment: string, country = ""): boolean {
  const s = segment.trim();
  if (s.length < 3 || s.length > 60) return false;
  if (NOT_A_TOWN.test(s) || NOT_A_TOWN_BUT_A_COUNTRY.test(s)) return false;
  // The row's own country code is not a town in it. A live remote posting
  // shipped addressLocality "US" from a location string that was just "US".
  if (country && s.toUpperCase() === country.toUpperCase()) return false;
  if (/\d/.test(s)) return false;
  if (/\s-\s|--/.test(s)) return false;
  return !STREETISH.test(s);
}

/**
 * The posting's place as separate postal properties, or null when the row
 * states no country (in which case it gets no markup at all upstream).
 */
export function postingPostalAddress(job: PostingRow): Record<string, unknown> | null {
  const country = (job.country ?? "").trim().toUpperCase();
  if (!country) return null;
  const address: Record<string, unknown> = { "@type": "PostalAddress", addressCountry: country };
  const raw = (job.location ?? "").trim();
  if (!raw) return address;

  const put = (region: string | null, locality: string | null, street: string | null, postal: string | null) => {
    if (region) address.addressRegion = region;
    if (locality) address.addressLocality = locality;
    if (street) address.streetAddress = street;
    if (postal) address.postalCode = postal;
    return address;
  };

  // DASH FORM first, and only when the string has no comma at all.
  //
  // THE VENDOR WRITES IT IN BOTH ORDERS, which is why the subdivision is
  // searched for rather than assumed to sit in the middle: "USA - CO - Denver"
  // is country, state, town and "US - Boston - MA" is country, town, state.
  // Both are live Workday strings in the same bake. The leading segment is
  // never read as the town, because it is the country in every observed form.
  if (!raw.includes(",")) {
    const parts = raw.split(/\s*[-–]\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      let at = -1;
      for (let i = 0; i < parts.length; i++) if (subdivisionOf(parts[i], country)) at = i;
      const region = at >= 0 ? subdivisionOf(parts[at], country) : null;
      let locality: string | null = null;
      // With no subdivision to anchor on, only the two-part form is read, and
      // only when the leading token is a place word rather than a work mode:
      // "Germany - Munich" names a town in Germany, "Remote - Poland" names a
      // country to work remotely from and no town at all.
      const readable = region !== null || (parts.length === 2 && !NOT_A_TOWN.test(parts[0]));
      if (readable) {
        for (let i = parts.length - 1; i >= 1; i--) {
          if (i === at) continue;
          if (isLocality(parts[i], country)) { locality = parts[i]; break; }
        }
      }
      if (region || locality) return put(region, locality, null, null);
      return address;
    }
    return isLocality(raw, country) ? put(null, raw, null, null) : address;
  }

  // COMMA FORM. Work from the end: postal code, then subdivision, then the
  // town immediately before it; whatever is left in front is the street, and
  // only when it reads like one.
  const segs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  let postal: string | null = null;
  let region: string | null = null;

  // "OH 44241-5266" and "NY 11234-5208" arrive as one segment.
  const last = segs[segs.length - 1] ?? "";
  const pair = /^([A-Za-z]{2}|[A-Za-z][A-Za-z ]+?)\s+(\d{5}(?:-\d{4})?|[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)$/.exec(last);
  if (pair && subdivisionOf(pair[1], country)) {
    region = subdivisionOf(pair[1], country);
    postal = pair[2];
    segs.pop();
  } else if (US_ZIP.test(last) || CA_POSTAL.test(last)) {
    postal = last;
    segs.pop();
  }

  if (!region) {
    // The subdivision is the LAST segment that names one, so a trailing
    // country name ("Remote, Arizona, United States of America") is skipped
    // over rather than mistaken for a town.
    for (let i = segs.length - 1; i >= 0; i--) {
      const code = subdivisionOf(segs[i], country);
      if (code) { region = code; segs.length = i; break; }
    }
  }

  let locality: string | null = null;
  if (region) {
    const candidate = segs[segs.length - 1] ?? "";
    if (isLocality(candidate, country)) { locality = candidate.trim(); segs.pop(); }
    else segs.length = 0; // a street or a facility name, not a town: say nothing
  } else {
    // No subdivision (every country but US and CA, and US strings that name
    // none). The first segment is the town when it reads like one.
    const candidate = segs[0] ?? "";
    if (isLocality(candidate, country)) locality = candidate.trim();
    return put(null, locality, null, postal);
  }

  const street = segs.join(", ").trim();
  return put(region, locality, street && STREETISH.test(street) ? street : null, postal);
}

/** schema.org's own enumeration. Anything outside it is ignored by Google, so it is never guessed. */
const LD_EMPLOYMENT_TYPE: Record<string, string> = {
  full_time: "FULL_TIME",
  "full-time": "FULL_TIME",
  fulltime: "FULL_TIME",
  part_time: "PART_TIME",
  "part-time": "PART_TIME",
  parttime: "PART_TIME",
  contract: "CONTRACTOR",
  contractor: "CONTRACTOR",
  temporary: "TEMPORARY",
  temp: "TEMPORARY",
  internship: "INTERN",
  intern: "INTERN",
  volunteer: "VOLUNTEER",
};

const LD_SALARY_UNIT: Record<string, string> = { year: "YEAR" };

/**
 * EVERY REQUIRED PROPERTY, OR NOTHING AT ALL.
 *
 * Google's reference lists the job title, the description, the posted date and
 * the hiring organisation as required; the location as required unless
 * applicant location requirements are given, and the location's own country as
 * mandatory within it; and the expiry date as required for a posting that has
 * one — every posting here has one, because the board's window closes on it.
 * A posting missing any of them produces no markup: invalid
 * structured data is worse than none, and inventing a place or a date to
 * satisfy the schema is off the table.
 *
 * It also refuses outright for a posting that is not live. Google's own
 * wording is that expired postings are not allowed and one of the sanctioned
 * ways to remove one is to take its structured data off the page; this is that.
 *
 * Nothing optional is guessed. A posting whose employer stated no pay gets no
 * pay property — never a zero, never a range we derived. Pay is emitted only
 * when the employer stated the PERIOD as well: the board hands us an annualised
 * figure, and an annualised number presented as the employer's own is exactly
 * the estimate the reference forbids, so only a stated yearly figure passes.
 */
export function postingJsonLd(
  job: PostingRow,
  description: string | null | undefined,
  opts: { site: string; now?: Date } = { site: "" },
): Record<string, unknown> | null {
  const now = opts.now ?? new Date();
  const path = postingPagePath(job.id);
  const desc = typeof description === "string" ? decodeJdEntities(description).trim() : "";
  const remote = job.workMode === "remote";
  if (!path) return null;
  if (!isPostingLive(job, now)) return null;
  if (!job.title || !job.company || !job.postedAt) return null;
  if (desc.length < 100) return null;
  // A place needs a country or it is not a place Google accepts; a fully
  // remote posting may state its applicant country instead.
  if (!job.country) return null;
  if (!remote && !job.location) return null;
  const validThrough = postingValidThrough(job);
  if (!validThrough) return null;

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    // THE WHOLE DESCRIPTION, BECAUSE THAT IS WHAT THE PROPERTY IS FOR. This was
    // cut at 4,000 characters, which fired on 300 of the 399 pages the bake
    // wrote — their visible text ran to a median 7,273 characters and a maximum
    // of 14,106, so three quarters of the pages carried markup that disagreed
    // with the page under it, cut mid-word. Google's reference asks for "a
    // complete representation of the job, including job responsibilities,
    // qualifications, skills, working hours, education requirements, and
    // experience requirements" — the requirements sit at the END of a job
    // description, so the cut was removing precisely the part it names. There
    // is no documented limit at 4,000 and the text is already bounded upstream:
    // the board stores at most STORED_DESC_CAP characters per posting.
    description: desc,
    datePosted: postingDatePosted(job.postedAt, now),
    // END OF THE DAY, NOT THE START OF IT. A date-only validThrough is read by
    // parsers as midnight at the BEGINNING of that day, so a posting served
    // through its last day shipped markup saying it had already expired while
    // the same file said it was live. The window closes when that day ends.
    validThrough: `${validThrough}T23:59:59+00:00`,
    hiringOrganization: { "@type": "Organization", name: job.company },
    url: `${opts.site}${path}`,
    // The application happens on the employer's own system, not here.
    directApply: false,
    // The third segment of a board id is the employer's ATS requisition key,
    // carried through unchanged — their identifier for the job, which is what
    // this property asks for.
    identifier: {
      "@type": "PropertyValue",
      name: job.company,
      value: postingPathParts(job.id)!.key,
    },
  };

  const address = postingPostalAddress(job);
  if (remote) {
    // A FULLY REMOTE POSTING IS DESCRIBED BY THE TELECOMMUTE PAIR, NOT BY A
    // PLACE. The physical jobLocation used to be emitted alongside them with
    // the literal word "Remote" in the locality slot ("Remote, Arizona, United
    // States of America" shipped on two of the five remote pages in this bake),
    // which is neither a place nor a telecommute signal, and contradicts the
    // two properties beside it. A remote posting keeps a place only when the
    // string genuinely decomposes to a town.
    ld.jobLocationType = "TELECOMMUTE";
    ld.applicantLocationRequirements = { "@type": "Country", name: job.country };
    if (address?.addressLocality) ld.jobLocation = { "@type": "Place", address };
  } else {
    if (!address) return null;
    ld.jobLocation = { "@type": "Place", address };
  }

  const empType = job.employmentType ? LD_EMPLOYMENT_TYPE[job.employmentType.toLowerCase()] : undefined;
  if (empType) ld.employmentType = empType;

  const unit = job.salaryPeriod ? LD_SALARY_UNIT[job.salaryPeriod.toLowerCase()] : undefined;
  const min = typeof job.salaryMinAnnual === "number" ? job.salaryMinAnnual : null;
  const max = typeof job.salaryMaxAnnual === "number" ? job.salaryMaxAnnual : null;
  if (unit && job.salaryCurrency && min !== null) {
    ld.baseSalary = {
      "@type": "MonetaryAmount",
      currency: job.salaryCurrency,
      value: {
        "@type": "QuantitativeValue",
        minValue: min,
        ...(max !== null && max >= min ? { maxValue: max } : {}),
        unitText: unit,
      },
    };
  }

  return ld;
}

/** SERP title budget: long ATS titles overflow and truncate mid-claim. */
const TITLE_BUDGET = 68;
/** Below this the job title stops being recognisable, so a shorter tail is used instead. */
const TITLE_MIN_ROOM = 24;
const TITLE_SEP = " — ";

/** `s`, cut at a word boundary to `n` characters with an ellipsis if it had to be cut. */
function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1).replace(/\s+\S*$/, "");
  return `${cut.length >= 8 ? cut : s.slice(0, n - 1)}…`;
}

/**
 * THE PAGE <title>, AND IT HAS TO BE DIFFERENT FROM EVERY OTHER PAGE'S.
 *
 * This used to drop the place first and then the employer to make the budget
 * fit, which for long ATS titles erased the only token distinguishing two
 * different jobs. The built tree shipped 15 posting URLs across 6 titles — five
 * Target stores all reading "Guest Advocate (Cashier), General Merchandise,
 * Inbound (Stoc…" while their own markup gave addresses in Long Beach CA and
 * Auburn AL, and two Fresenius nursing roles in Newark NJ and Tulsa OK sharing
 * "Outpatient Licensed Practical Nurse - LPN LVN". Search Console reports that
 * as "Duplicate without user-selected canonical", which is the thing this whole
 * page family exists to stop.
 *
 * THE RULE, IN TWO HALVES, AND EACH HALF IS DISTINCT FOR ITS OWN REASON.
 *
 * 1. WHILE THE WHOLE JOB TITLE FITS, it keeps the most informative tail that
 *    fits beside it: the employer and the place, else the place, else the
 *    employer. With the whole title present, two pages sharing a rendered
 *    title share company, title and place — which is one posting identity, and
 *    the bake gives one page per identity.
 * 2. ONCE THE TITLE HAS TO BE CUT, the tail becomes the employer's own
 *    requisition key. A cut title beside a shared place is not distinguishable
 *    — two Ferring postings in this bake, "Packaging & Visual Inspection
 *    Operator II – 2nd Shift" and "…Operator II", are different jobs whose
 *    titles differ only past the cut, and both sat at the same Parsippany
 *    address. The key is unique per URL by construction, so no group of cut
 *    titles can collapse. The employer rides in front of it where it fits,
 *    because "Target R0000474088" reads better than a bare requisition number
 *    and narrows the one case the key alone does not cover: two vendors' ids
 *    whose last segment happens to match.
 *
 * The place is what is lost in half 2, and that is the trade taken knowingly:
 * the meta description still carries it, and a SERP line that names the place
 * of a job you cannot tell from four others is worth less than one you can.
 */
export function postingPageTitle(job: PostingRow): string {
  const title = (job.title ?? "").trim();
  const company = (job.company ?? "").trim();
  const place = (job.location ?? "").trim();
  const key = postingPathParts(job.id)?.key ?? "";
  for (const tail of [place && company ? `${company}, ${place}` : "", place, company]) {
    if (!tail) continue;
    if (title.length + TITLE_SEP.length + tail.length <= TITLE_BUDGET) return `${title}${TITLE_SEP}${tail}`;
  }
  if (!key) return clip(title, TITLE_BUDGET);
  for (const tail of [company ? `${company} ${key}` : "", key]) {
    if (!tail) continue;
    const room = TITLE_BUDGET - tail.length - TITLE_SEP.length;
    if (room >= TITLE_MIN_ROOM) return `${clip(title, room)}${TITLE_SEP}${tail}`;
  }
  // A requisition key long enough to leave no readable title at all. It still
  // goes on, at the cost of a few characters over the budget: an overlong
  // title costs a truncated SERP line, two identical titles cost the page its
  // own identity.
  return `${clip(title, TITLE_MIN_ROOM)}${TITLE_SEP}${key}`;
}

/** A search result's snippet is cut at about this length. */
const DESCRIPTION_BUDGET = 160;

/**
 * The length of the string AS SERVED. The bake puts this in an HTML attribute
 * through its own escaper, so an employer name carrying `&` or a `"` is longer
 * in the file than in memory — one page in the last bake shipped a 161-
 * character meta description while this function believed it had written 160.
 * The budget is measured on the bytes a crawler reads, not on the ones we hold.
 */
function servedLength(s: string): number {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").length;
}

/**
 * The meta description. It states only what the posting itself states — the
 * employer, the place, and the pay ONLY in the employer's own verbatim words.
 *
 * IT IS BUILT UP TO THE BUDGET, NOT WRITTEN AND THEN CUT. The bake clamps
 * anything over the budget at a word boundary and appends an ellipsis; written
 * as one long sentence, 189 of 397 posting pages shipped a snippet that trailed
 * off mid-clause, which is how a page's most-read line ends up saying half of
 * something. So the opening clause always fits and each later clause is added
 * only if the whole thing still does.
 */
export function postingPageDescription(job: PostingRow): string {
  const title = (job.title ?? "").trim();
  const company = (job.company ?? "").trim();
  const place = (job.location ?? "").trim();
  let out = place ? `${title} at ${company}, ${place}.` : `${title} at ${company}.`;
  if (servedLength(out) > DESCRIPTION_BUDGET) out = `${title} at ${company}.`;
  if (servedLength(out) > DESCRIPTION_BUDGET) out = `${title}.`;
  const add = (clause: string) => {
    if (servedLength(out + clause) <= DESCRIPTION_BUDGET) out += clause;
  };
  if (job.salary) add(` Pay as stated by the employer: ${String(job.salary).trim()}.`);
  add(` Straight from ${company}'s own job board.`);
  add(" Check your resume against it before you apply.");
  return out;
}
