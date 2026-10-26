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

import { employerName, possessive } from "../../lib/company-display";

// The bake's own name gate and its rule for which rows get a page, read here
// so the job markup the app writes is the markup the bake writes (see
// postingMarkupGate below). Both modules are plain JavaScript with no imports
// of their own, which is how plain node runs them for the bake.
import { bakeEmployerName, type BakeEmployerName } from "../../../scripts/prerender-names.mjs";
import { postingRowEligible } from "../../../scripts/prerender-posting-rule.mjs";
import { isCodeShapedName } from "../../lib/company-display";

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

/**
 * THE EMPLOYER, BY THE NAME IT USES. The board stores some Workday tenants by
 * their system code ("Ms" for Morgan Stanley, "Rmit"), and every place a page
 * names the employer (title, meta description, hiringOrganization) used to
 * print that code straight into Google for Jobs (SEO report 2026-10-08, F1:
 * 292 of 399 posting pages). One function names it for every reader.
 */
export function postingEmployer(job: Pick<PostingRow, "id" | "token" | "company">): string {
  const token = job.token ?? postingPathParts(job.id)?.token ?? null;
  return employerName(token, job.company);
}

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
  /**
   * WHERE THE WORK MODE CAME FROM. "vendor" only when the hiring system's own
   * structured remote field said it (Workday remoteType, the Greenhouse, Lever
   * and SmartRecruiters remote fields); anything else, or nothing, means the
   * board read it off a location label. Not carried by the board yet (SEO-003
   * hand-off to job-board/normalize.ts): until it is, no row is "vendor".
   */
  workModeSource?: string | null;
  /**
   * THE EMPLOYER'S OWN END DATE for the posting, when its system states one
   * (Workday jobPostingInfo.endDate). Not carried by the board yet (SEO-004
   * hand-off); when it is, the markup's expiry never runs past it.
   */
  employerValidThrough?: string | null;
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

/**
 * The description's text: decoded, with the lines that are only the word
 * "undefined" taken out. The board's Workday description assembly writes that
 * word where a section it joins is missing ("...processes.\nundefined\nThis
 * role..." on zeissgroup 1054265 and nike R-94383), and it reached the visible
 * page and the markup's description. It is no part of the employer's text.
 */
export function jdText(description: string): string {
  return decodeJdEntities(description).replace(/^[ \t]*undefined[ \t]*(?:\r?\n|$)/gm, "");
}

/** The description as display paragraphs: decoded, blank-line split, empties dropped. */
export function jdParagraphs(description: string): string[] {
  return jdText(description)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+\n/g, "\n").trim())
    .filter((p) => p.length > 0);
}

/**
 * THE LANGUAGE A DESCRIPTION IS WRITTEN IN, or null when the text does not say
 * clearly (SEO-034). Every one of 500 baked posting pages was lang="en",
 * including Spanish and German postings. The board carries no language for a
 * posting and no tenant locale, so this reads the employer's own words: each
 * language's commonest function words, counted over the whole description
 * (a bilingual posting with an English intro is judged on all of it). It
 * answers only when one language leads the next by at least two to one with
 * enough hits to mean it; a mixed or short text answers null and the page
 * keeps the site's language rather than a guess.
 */
const LANG_MARKERS: Record<string, string[]> = {
  en: ["the", "and", "with", "you", "our", "will", "your", "this", "that", "are", "for", "have", "from", "we"],
  es: ["el", "los", "las", "para", "con", "por", "una", "del", "nuestro", "nuestra", "experiencia", "que", "y", "trabajo"],
  fr: ["les", "des", "et", "pour", "avec", "une", "vous", "nous", "du", "est", "dans", "sur", "au", "votre"],
  de: ["der", "die", "das", "und", "mit", "für", "ist", "wir", "sie", "ein", "eine", "von", "zu", "den", "bei", "oder"],
  pt: ["os", "com", "uma", "do", "da", "dos", "das", "você", "na", "no", "em", "não", "seu", "sua"],
  nl: ["het", "een", "en", "van", "voor", "met", "je", "wij", "zijn", "op", "te", "ons", "als", "bij"],
  it: ["il", "di", "per", "con", "una", "che", "della", "nel", "sono", "gli", "nostro", "nostra"],
};
export function postingLanguage(description: string | null | undefined): string | null {
  const text = jdText(String(description ?? ""));
  // CHINESE, JAPANESE AND KOREAN ARE READ BY SCRIPT, not by function words: an
  // all-Chinese Abbott posting (31140324) was served lang="en" because no word
  // list here could see it. Kana marks Japanese, Hangul Korean, Han alone
  // Chinese; the script has to be most of the letters to answer at all.
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const kana = text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const hangul = text.match(/\p{Script=Hangul}/gu)?.length ?? 0;
  if (letters >= 60 && han + kana + hangul >= letters * 0.5) {
    if (hangul >= (han + kana) ) return "ko";
    if (kana >= (han + kana) * 0.1) return "ja";
    return "zh";
  }
  const words = text.toLowerCase().match(/[\p{L}]+/gu)?.slice(0, 3000) ?? [];
  if (words.length < 40) return null;
  const sets = Object.entries(LANG_MARKERS).map(([lang, ws]) => [lang, new Set(ws)] as const);
  const score = sets.map(([lang, set]) => [lang, words.filter((w) => set.has(w)).length] as const).sort((a, b) => b[1] - a[1]);
  const [top, second] = score;
  if (!top || top[1] < 12) return null;
  if (second && top[1] < second[1] * 2) return null;
  return top[0];
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
    .map((v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().toLowerCase() : ""))
    .join("|");
}

/**
 * THE SAME REQUISITION UNDER ONE EMPLOYER'S SEVERAL CAREER SITES. The identity
 * above compares the printed company name, and a UKG client publishes one
 * requisition under two sites with two names: on 2026-10-18 the same
 * "Quality (QA) Technician" (requisition 68926f4c-…) was live and indexable
 * twice, as "O'Neal Manufacturing Services" and "O'Neal Industries", the only
 * duplicate title among the sitemap's 1,368 URLs. The requisition key is the
 * employer's own identifier, so the same key under the same employer is one
 * posting whatever the site calls the company. The employer is the bake's
 * segment rule (scripts/prerender-pages.mjs bakeEmployerKey): the client on a
 * UKG token, the tenant on Workday and Oracle, the whole token otherwise.
 * Null when the id is not the three-part shape.
 */
export function postingRequisitionIdentity(job: Pick<PostingRow, "id">): string | null {
  const p = postingPathParts(job.id);
  if (!p) return null;
  const parts = p.token.split("~");
  const first = parts[0];
  const employer = (first === "recruiting" || first === "recruiting2") && parts.length >= 2
    ? `${first}~${parts[1]}`
    : first === "eu" ? p.token
      : parts.length >= 2 ? first
        : p.token;
  return `${p.source}:${employer}:${p.key}`.toLowerCase();
}

/** A title or a name as one line: an employer's double space is not part of the job. */
export const postingText = (s: string | null | undefined): string => String(s ?? "").replace(/\s+/g, " ").trim();

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
export function postingValidThrough(job: PostingRow, now: Date = new Date()): string | null {
  if (!job.postedAt) return null;
  // FROM THE DAY datePosted STATES (postingDatePosted): an employer's
  // "tomorrow" is today there, and a window counted from the later day gave
  // three pages a 31-day span between their own two dates. A past date is
  // unchanged, so an already-old posting still gets a past date.
  const capped = new Date(Date.parse(postingDatePosted(job.postedAt, now)) + BOARD_FRESH_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // THE EMPLOYER'S OWN END DATE, WHEN ITS SYSTEM STATES ONE (SEO-004). Every
  // one of 500 baked pages carried posted + 30 days exactly, because the board
  // discarded Workday's jobPostingInfo.endDate; a page whose markup says the
  // posting runs past the day its employer closes it is a claim no one made.
  // Only ever shortens the window: the visible page keeps the employer's dates
  // as stated, and this is the day this URL stops serving the posting.
  const ends = [capped];
  if (job.missingSince) ends.push(day(job.missingSince));
  const stated = typeof job.employerValidThrough === "string" && /^\d{4}-\d{2}-\d{2}/.test(job.employerValidThrough)
    ? day(job.employerValidThrough)
    : null;
  if (stated) ends.push(stated);
  return ends.reduce((a, b) => (b < a ? b : a));
}

/**
 * Is this posting live RIGHT NOW by the board's own two rules? A posting that
 * is gone must never be served as live, and Google does not allow an expired
 * posting to be marked up at all.
 */
export function isPostingLive(job: PostingRow, now: Date = new Date()): boolean {
  if (job.missingSince) return false;
  if (!job.postedAt) return false;
  const through = postingValidThrough(job, now);
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

/**
 * A postal code written before its town, as most of Europe writes it: four or
 * five digits (DE, FR, IT, ES, CH, AT, BE, DK, NO), "12-345" (PL), "123 45"
 * (SE, CZ, SK), "1234 AB" (NL), "1234-567" (PT).
 */
const POSTAL_THEN_TOWN = /^(\d{4,5}|\d{2}-\d{3}|\d{3}\s\d{2}|\d{4}\s?[A-Z]{2}|\d{4}-\d{3})\s+(\D.*)$/;

/** US ZIP or ZIP+4, and the Canadian postal code. */
const US_ZIP = /^\d{5}(?:-\d{4})?$/;
const CA_POSTAL = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

/** A segment that is an address line rather than a town. */
const STREETISH =
  /(?:^\d)|\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway|suite|ste|floor|fl|unit|rte|route|bldg|building|campus|center|centre|hospital|plaza|tower)\b\.?/i;

/** A facility, not a town ("Shenzhen Office", "Las Vegas Service Center"): never the locality, never a street either. */
const FACILITY = /\b(?:office|headquarters?|hq|plant|warehouse|factory|depot)\b/i;

/**
 * Words that name no town, whatever column they arrive in. The work-mode words
 * are here because Workday writes them into the location string ("Remote - US",
 * "Hybrid - Chicago"), and a leading one changes what the rest of the string
 * is: "Remote - Poland" names a country, not a town in it.
 */
const NOT_A_TOWN = /^(?:remote|hybrid|onsite|on-site|office|various|multiple|flexible|anywhere|home|work from home|wfh|virtual|field|nationwide|n\/a|tbd)$/i;

/** A country written where a town should be. Three letters is the shortest town we will publish. */
const NOT_A_TOWN_BUT_A_COUNTRY = /^(?:usa|u\.?s\.?a?\.?|uk|u\.?k\.?|eu)$/i;

/**
 * A WORK-MODE WORD INSIDE A SEGMENT. Employers write the mode into the place
 * ("Germany - Bayern Remote", "Remote Worker France", "Utah | Hybrid"), and
 * every one of those strings reached addressLocality whole in the 2026-10-18
 * bake (SEO-003). A segment carrying one is not a town; what is left once it
 * is taken out may still be a place.
 */
const WORK_MODE_WORD = /\b(?:remote|hybrid|on-?site|telecommute|telework|work from home|wfh|home[- ]based|virtual)\b/i;
const WORK_MODE_WORDS = new RegExp(WORK_MODE_WORD.source, "gi");

/** Characters no town name carries: a site code path, a note in brackets, a list separator. */
const NOT_IN_A_TOWN = /[/_()|\\[\]]/;

/**
 * Country names, from the runtime's own region names (every two-letter code
 * the platform names), plus the spellings hiring systems use that it does not
 * ("United States of America", "UK", "Czech Republic"). Built once, on first
 * use. Withdrawn and pseudo codes are left out so a name maps to the code in
 * use ("Myanmar (Burma)" is MM, not the withdrawn BU).
 *
 * The runtime names a withdrawn code after the country that holds its
 * current code, so an A-Z walk that kept the first code met the old one
 * first for Vietnam, Zimbabwe and Vanuatu and filed every row there as
 * "another country" (SEO-035 withheld their markup). A code is kept only
 * when the runtime files it under itself (its canonical region is the same
 * code); the fixed list below also names every withdrawn code the runtime
 * still prints, for a runtime that does not canonicalise regions.
 */
const WITHDRAWN_REGIONS = new Set((
  // Withdrawn from ISO 3166-1, or never in it, though the runtime prints a name for them.
  "AN BU CS DD DY FX HV NH NT QU RH SU TP UK VD YD YU ZR " +
  // Groupings, pseudo codes and the unknown region.
  "EU EZ QO UN XA XB ZZ " +
  // Exceptionally reserved codes and the US minor outlying islands, which no hiring system files a row under.
  "UM AC CP CQ DG EA IC TA"
).split(" "));
/** The code the runtime files a region under, or the code itself when it cannot say. */
function canonicalRegion(code: string): string {
  try {
    return Intl.getCanonicalLocales(`und-${code}`)[0]?.split("-")[1] ?? code;
  } catch {
    return code;
  }
}
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "US", "u s": "US", "u s a": "US", us: "US", "united states of america": "US", america: "US",
  uk: "GB", "u k": "GB", "great britain": "GB", britain: "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  "czech republic": "CZ", russia: "RU", "russian federation": "RU", korea: "KR", "south korea": "KR", "republic of korea": "KR",
  "viet nam": "VN", turkey: "TR", turkiye: "TR", "türkiye": "TR", uae: "AE", "hong kong": "HK", "hong kong sar": "HK", macau: "MO", macao: "MO",
  "the netherlands": "NL", holland: "NL", "ivory coast": "CI", "cote d ivoire": "CI", "côte d ivoire": "CI", "mainland china": "CN",
  "peoples republic of china": "CN", "the philippines": "PH", "kingdom of saudi arabia": "SA", ksa: "SA", "the bahamas": "BS",
  "bosnia": "BA", "trinidad": "TT", "myanmar": "MM", burma: "MM", "eswatini": "SZ", swaziland: "SZ", "cabo verde": "CV",
  "taiwan roc": "TW", "republic of ireland": "IE", eire: "IE", "slovak republic": "SK", "deutschland": "DE", "españa": "ES", espana: "ES",
};
const countryKey = (s: string): string => s.toLowerCase().replace(/&/g, " and ").replace(/[.’'`,]/g, " ").replace(/\s+/g, " ").trim();
let COUNTRY_BY_NAME: Map<string, string> | null = null;
function countryTable(): Map<string, string> {
  if (COUNTRY_BY_NAME) return COUNTRY_BY_NAME;
  const m = new Map<string, string>();
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a < 91; a++) {
      for (let b = 65; b < 91; b++) {
        const code = String.fromCharCode(a, b);
        if (WITHDRAWN_REGIONS.has(code) || canonicalRegion(code) !== code) continue;
        let name: string | undefined;
        try { name = dn.of(code); } catch { name = undefined; }
        if (!name || name === code) continue;
        const k = countryKey(name);
        if (!m.has(k)) m.set(k, code);
        // "Hong Kong SAR China", "Myanmar (Burma)": the short form too.
        const short = countryKey(name.replace(/\s*\(.*\)\s*$/, "").replace(/\s+SAR\s+China$/i, ""));
        if (short && !m.has(short)) m.set(short, code);
      }
    }
  } catch { /* no Intl.DisplayNames: the aliases below still answer */ }
  for (const [k, v] of Object.entries(COUNTRY_ALIASES)) m.set(countryKey(k), v);
  COUNTRY_BY_NAME = m;
  return m;
}

/** Every country name the reader knows, with the code it reads it as (tests read the whole table). */
export function countryNameTable(): ReadonlyMap<string, string> {
  return countryTable();
}

/** The two-letter code a whole string names as a country, or null ("United States of America" -> "US"). */
export function countryCodeOfName(s: string | null | undefined): string | null {
  const k = countryKey(String(s ?? ""));
  if (k.length < 2) return null;
  return countryTable().get(k) ?? null;
}

/**
 * Territories and the country that governs each. A board files a territory's
 * rows under either code, so either way round names one place: "San Juan,
 * Puerto Rico" on a US row, "Charlotte Amalie, Virgin Islands, U.S." on a VI
 * row, "Kowloon, China" on an HK row, "Fort-de-France, Martinique" on an FR row.
 */
const GOVERNED_BY: Readonly<Record<string, string>> = {
  PR: "US", GU: "US", VI: "US", AS: "US", MP: "US", UM: "US",
  HK: "CN", MO: "CN",
  GP: "FR", MQ: "FR", GF: "FR", RE: "FR", YT: "FR", NC: "FR", PF: "FR", PM: "FR", WF: "FR", BL: "FR", MF: "FR", TF: "FR",
  JE: "GB", GG: "GB", IM: "GB", GI: "GB", BM: "GB", KY: "GB", VG: "GB", AI: "GB", MS: "GB", TC: "GB", FK: "GB", SH: "GB", IO: "GB", PN: "GB", GS: "GB",
  AW: "NL", CW: "NL", SX: "NL", BQ: "NL",
  GL: "DK", FO: "DK", SJ: "NO", BV: "NO", AX: "FI",
  CX: "AU", CC: "AU", NF: "AU", HM: "AU", CK: "NZ", NU: "NZ", TK: "NZ",
};
const sameJurisdiction = (a: string, b: string): boolean => a === b || GOVERNED_BY[a] === b || GOVERNED_BY[b] === a;

/**
 * The marks that separate one place from the next inside a location string:
 * "Munich, Germany; London, United Kingdom", "Remote USA · Berlin, Germany",
 * "Remote • UK, France", "London, UK or Zurich, Switzerland". The lower-case
 * word only: "OR" is Oregon.
 */
const PLACE_LIST = /;|·|•|\s\|\s|\s+or\s+/;

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

/** Punctuation at either end of a word or segment: "USA-" is "USA" once the joined "REMOTE" is out. */
const trimEdges = (s: string): string => s.replace(/^[\s\-–_/,.:]+|[\s\-–_/,.:]+$/g, "");

/**
 * The words that may stand beside a country's name in a real town's name:
 * "Panama City", "Mexico City", "Jersey City", "West Jordan", "South
 * Holland". Anything else beside it ("Movie Park Germany", "Remote Worker
 * France") is a facility or a label with the country written on the end.
 */
const TOWN_WORD_BESIDE_A_COUNTRY = /^(?:city|town|west|east|north|south|new|port|fort|lake|mount|mt|saint|st)$/i;

/** Does this phrase carry a country's whole name as one or more of its words? */
function namesACountryInside(s: string): boolean {
  const words = s.split(/\s+/).map(trimEdges).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 4 && i + n <= words.length; n++) {
      if (!countryCodeOfName(words.slice(i, i + n).join(" "))) continue;
      const rest = [...words.slice(0, i), ...words.slice(i + n)];
      if (rest.length === 1 && TOWN_WORD_BESIDE_A_COUNTRY.test(rest[0])) continue;
      return true;
    }
  }
  return false;
}

/**
 * WHY A STRING IS NOT A TOWN WE WOULD PUBLISH, or null when nothing says so.
 * The producer (isLocality) and the bake's markup guard read the same rules:
 * a site code, a bracket or a list separator, the word "only", a work-mode
 * word, punctuation at either end ("USA-" from "USA-REMOTE"), or a country's
 * name inside it ("Movie Park Germany").
 */
export function localityProblem(locality: string): string | null {
  const s = String(locality ?? "").trim();
  if (NOT_IN_A_TOWN.test(s)) return "a site code, a bracket or a list separator";
  if (/\bonly\b/i.test(s)) return "the word only";
  if (WORK_MODE_WORD.test(s)) return "a work-mode word";
  if (trimEdges(s) !== s) return "punctuation at one end";
  if (namesACountryInside(s)) return "a country's name";
  return null;
}

/** Is this segment a town name we are willing to publish as one? */
function isLocality(segment: string, country = "", employer = ""): boolean {
  const s = segment.trim();
  if (s.length < 3 || s.length > 60) return false;
  if (NOT_A_TOWN.test(s) || NOT_A_TOWN_BUT_A_COUNTRY.test(s)) return false;
  // The row's own country code is not a town in it. A live remote posting
  // shipped addressLocality "US" from a location string that was just "US".
  if (country && s.toUpperCase() === country.toUpperCase()) return false;
  if (/\d/.test(s)) return false;
  if (/\s-\s|--/.test(s)) return false;
  // THE 2026-10-18 BAKE'S ELEVEN (SEO-003): "Bangalore ONLY)", "Utah | Hybrid",
  // "FXE_APAC/VNM/VNHANHQ/Hanoi Rep Office", "Remote Worker France",
  // "PARSIPPANY (NJPAR)", "Houston (Corporate Office)", "Ottawa (Kanata)",
  // "Bayern Remote" and "Poland" all went into the town slot. A site code, a
  // note in brackets, a list separator, the word "only", a work-mode word, a
  // country's name or the employer's own name is not a town: the locality is
  // left out and the region and the country stand.
  // THE ROUND'S OWN BAKE (2026-10-24) still shipped two: "USA-" from
  // "USA-REMOTE" and "Movie Park Germany". Punctuation at an end and a
  // country's name anywhere inside are refused with the rest (localityProblem).
  if (localityProblem(s)) return false;
  if (FACILITY.test(s)) return false;
  if (countryCodeOfName(s)) return false;
  const emp = employer.trim().toLowerCase();
  if (emp.length >= 3 && s.toLowerCase().includes(emp)) return false;
  return !STREETISH.test(s);
}

/** A segment with its work-mode words and bracket and list marks taken out ("Utah | Hybrid" -> "Utah"). */
const placeOfSegment = (segment: string): string => trimEdges(segment
  .replace(WORK_MODE_WORDS, " ")
  .replace(/[|()[\]]/g, " ")
  .replace(/\s+/g, " ")
  .trim());

/** Words that are neither a work mode nor a place: what is left of "Remote Worker France" once both are out. */
const PLACE_NOISE = new Set("worker workers based anywhere any location locations from in the of only nationwide countrywide country wide home office field various multiple flexible tbd n/a and or within".split(" "));

/**
 * WHETHER A REMOTE ROW'S LOCATION NAMES A PLACE BELOW ITS COUNTRY. "Remote -
 * US", "United States (Remote)", "Remote Worker France" and an empty location
 * name none; "Germany - Bayern Remote", "Remote, Arizona" and "Chicago" name
 * one. Hyphenated towns split into words that still name one.
 */
export function remoteLocationNamesAPlace(job: Pick<PostingRow, "location" | "country">): boolean {
  const raw = String(job.location ?? "");
  const own = String(job.country ?? "").trim().toUpperCase();
  for (const piece of raw.split(/[,;|/()[\]]+|\s[-–]\s|\s-|-\s/)) {
    let rest = placeOfSegment(piece);
    if (!rest) continue;
    if (own && rest.toUpperCase() === own) continue;
    if (countryCodeOfName(rest)) continue;
    // A country named inside a longer phrase ("Worker France") comes out too.
    // Each word without the punctuation that joined it to a work mode
    // ("USA-REMOTE" leaves "USA-", which is the country, not a place in it).
    const words = rest.split(" ").map(trimEdges).filter((w) => w && !PLACE_NOISE.has(w.toLowerCase()));
    rest = words.join(" ");
    if (!rest) continue;
    if (countryCodeOfName(rest) || (own && rest.toUpperCase() === own)) continue;
    const kept = words.filter((w) => !countryCodeOfName(w) && !(own && w.toUpperCase() === own));
    if (kept.join("").replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 2) return true;
  }
  return false;
}

/**
 * WHY A ROW MAY BE MARKED UP AS WORKED FROM ANYWHERE, or null when it may not.
 *
 *   "vendor"     the hiring system's own structured remote field said so;
 *   "place-free" the board says remote and the location names no place below
 *                the country ("Remote - US"), so remote is all the row states.
 *
 * THE INTERIM ASYMMETRIC RULE (SEO-003). The board sets workMode "remote" from
 * a location label, and Dyson's in-store sales jobs in Bavaria are labelled
 * "Germany - Bayern Remote": four of them shipped TELECOMMUTE. Until the board
 * carries workModeSource, a remote row whose location names a region or a town
 * is marked up as that place, never as TELECOMMUTE. Wrong in that direction a
 * remote job reads as located where its employer said; wrong in the other, a
 * shop-floor job reads as work from anywhere.
 */
export function postingRemoteBasis(job: PostingRow): "vendor" | "place-free" | null {
  if (job.workMode !== "remote") return null;
  if (job.workModeSource === "vendor") return "vendor";
  return remoteLocationNamesAPlace(job) ? null : "place-free";
}

/**
 * A LOCATION THAT PLACES THE JOB IN ANOTHER COUNTRY (SEO-035). The board's
 * country reader files "City, LA, Nigeria" and "City, GA, Ghana" as US by the
 * state code, and USAJOBS files "Ramstein, Germany" as US; markup built on
 * that row puts a Nigerian job in Louisiana. The row's country is not trusted,
 * and the page carries no job markup, when a place in the location is written
 * town first and ends in another country's whole name.
 *
 * WHAT IS NOT ANOTHER COUNTRY, each one a live row this rule once withheld:
 *   - the location names the row's own country anywhere, or one of its
 *     states or provinces at the end of a place, as one of several places or
 *     at the front ("USA - New York - Malta", "Hong Kong, China" on an HK row,
 *     "Munich, Germany; London, United Kingdom" on a GB row, "Toronto,
 *     Canada; Denver, Colorado" on a US row);
 *   - the place opens with the two-letter code of one of the row's own
 *     states or provinces, so it is written state first and its last segment
 *     is the town ("MI - Holland", "NY - Jamaica", "PA - Lebanon"). A code is
 *     never a town; a full name can be one ("New Brunswick - NJ - US" is a
 *     town in New Jersey, on a CA row), so only the code says the order;
 *   - a place of two segments opens with the employer's own name, which is
 *     a site label, so the other segment is its town ("ENTEK - Lebanon");
 *   - the named country governs the row's territory or the other way round
 *     ("Kowloon, China" on HK, "Virgin Islands, U.S." on VI).
 * Without a list of every town, "Biloxi, MS, Algeria" (a vendor's default
 * country after a Mississippi town) reads the same as "Lagos, LA, Nigeria"
 * and is still withheld; docs/seo-round/README.md counts these.
 */
export function postingCountryMismatch(job: Pick<PostingRow, "location" | "country"> & Partial<Pick<PostingRow, "company">>): boolean {
  const own = String(job.country ?? "").trim().toUpperCase();
  if (!own) return false;
  const places = String(job.location ?? "").split(PLACE_LIST)
    .map((p) => p.split(/,|\s[-–]\s/).map((s) => placeOfSegment(s)).filter(Boolean))
    .filter((segs) => segs.length > 0);
  const isOwn = (s: string): boolean => {
    const code = countryCodeOfName(s);
    return s.toUpperCase() === own || (code !== null && sameJurisdiction(own, code));
  };
  // "United States and Ontario, Canada": each side of an "and" is read too.
  const namesOwn = (s: string): boolean => isOwn(s) || s.split(/\s+(?:and|&)\s+/i).some((part) => part !== s && isOwn(part.trim()));
  if (places.some((segs) => segs.some(namesOwn) || !!subdivisionOf(segs[segs.length - 1], own))) return false;
  const employer = String(job.company ?? "").trim().toLowerCase();
  for (const segs of places) {
    if (segs.length < 2) continue;
    if (/^[A-Za-z]{2}$/.test(segs[0]) && subdivisionOf(segs[0], own)) continue;
    if (segs.length === 2 && employer.length >= 3 && segs[0].toLowerCase().includes(employer)) continue;
    const code = countryCodeOfName(segs[segs.length - 1]);
    if (code && !sameJurisdiction(own, code)) return true;
  }
  return false;
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
  // The employer's own name is never its town (SEO-003): read once, compared
  // inside isLocality.
  const employer = job.company ? postingEmployer(job) : "";
  const town = (seg: string) => isLocality(seg, country, employer);
  // A subdivision read through a work-mode word or a bracket ("Utah | Hybrid").
  const sub = (seg: string) => subdivisionOf(seg, country) ?? subdivisionOf(placeOfSegment(seg), country);

  const put = (region: string | null, locality: string | null, street: string | null, postal: string | null) => {
    if (region) address.addressRegion = region;
    if (locality) address.addressLocality = locality;
    if (street) address.streetAddress = street;
    if (postal) address.postalCode = postal;
    return address;
  };

  // "<PLACE> Remote": THE WORK-MODE WORD COMES OUT AND THE PLACE STAYS (SEO-003).
  // "Germany - Bayern Remote" names Bavaria, a region, and not a town in it;
  // which of the two a bare name is cannot be told outside the two countries
  // whose subdivisions are listed here, so it is given as the region, the less
  // specific claim. In the US and Canada a listed subdivision is the region
  // and anything else that reads as a town is the town.
  const remoteLabel = (seg: string): { region: string | null; locality: string | null } | null => {
    if (!WORK_MODE_WORD.test(seg)) return null;
    const words = placeOfSegment(seg).split(" ").map(trimEdges)
      .filter((w) => w && !PLACE_NOISE.has(w.toLowerCase()) && !countryCodeOfName(w) && w.toUpperCase() !== country);
    const rest = words.join(" ");
    if (!rest || countryCodeOfName(rest) || rest.length < 3 || rest.length > 40 || /\d/.test(rest) || NOT_IN_A_TOWN.test(rest) || /\bonly\b/i.test(rest)) return null;
    const code = subdivisionOf(rest, country);
    if (code) return { region: code, locality: null };
    if (country === "US" || country === "CA") return town(rest) ? { region: null, locality: rest } : null;
    return { region: rest, locality: null };
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
      for (let i = 0; i < parts.length; i++) if (sub(parts[i])) at = i;
      const region = at >= 0 ? sub(parts[at]) : null;
      let locality: string | null = null;
      // With no subdivision to anchor on, only the two-part form is read, and
      // only when the leading token is a place word rather than a work mode:
      // "Germany - Munich" names a town in Germany, "Remote - Poland" names a
      // country to work remotely from and no town at all.
      const readable = region !== null || (parts.length === 2 && !NOT_A_TOWN.test(parts[0]));
      if (readable) {
        for (let i = parts.length - 1; i >= 1; i--) {
          if (i === at) continue;
          if (town(parts[i])) { locality = parts[i]; break; }
        }
      }
      if (region || locality) return put(region, locality, null, null);
      // The label is read off the SPACED dashes only, so a hyphenated region
      // stays whole ("Germany - Rheinland-Pfalz Remote" is Rheinland-Pfalz).
      const spaced = raw.split(/\s+[-–]\s+/).map((p) => p.trim()).filter(Boolean);
      for (const list of [spaced, parts]) {
        for (let i = list.length - 1; i >= 0; i--) {
          const r = remoteLabel(list[i]);
          if (r) return put(r.region, r.locality, null, null);
        }
      }
      return address;
    }
    // A lone subdivision is the region, never the town: "Utah | Hybrid" is UT.
    const sole = sub(raw);
    if (sole) return put(sole, null, null, null);
    if (town(raw)) return put(null, raw, null, null);
    const r = remoteLabel(raw);
    return r ? put(r.region, r.locality, null, null) : address;
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
      const code = sub(segs[i]);
      if (code) { region = code; segs.length = i; break; }
    }
  }

  let locality: string | null = null;
  if (region) {
    const candidate = segs[segs.length - 1] ?? "";
    if (town(candidate)) { locality = candidate.trim(); segs.pop(); }
    else segs.length = 0; // a street or a facility name, not a town: say nothing
  } else {
    // No subdivision (every country but US and CA, and US strings that name
    // none). A "<postal code> <town>" segment names the town outright, the
    // way European addresses write it ("46244 Bottrop-Kirchhellen": the
    // first segment there, "Movie Park Germany", is the park). Otherwise the
    // first segment is the town when it reads like one.
    if (!postal) {
      for (const seg of segs) {
        const m = POSTAL_THEN_TOWN.exec(seg);
        if (m && town(m[2])) return put(null, m[2].trim(), null, m[1]);
      }
    }
    const candidate = segs[0] ?? "";
    if (town(candidate)) locality = candidate.trim();
    else {
      const r = remoteLabel(candidate);
      if (r) return put(r.region, r.locality, null, postal);
    }
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
  // Workday's timeType and several vendors' own words, with a space (SEO-016).
  "full time": "FULL_TIME",
  "part time": "PART_TIME",
  "per diem": "PER_DIEM",
  per_diem: "PER_DIEM",
};

/** The schema type for a stated employment type, read case- and spacing-blind, or undefined. */
export const ldEmploymentType = (stated: string | null | undefined): string | undefined =>
  stated ? LD_EMPLOYMENT_TYPE[String(stated).toLowerCase().replace(/\s+/g, " ").trim()] : undefined;

/** The shortest description, in display paragraphs, a posting page is written for. */
export const POSTING_MIN_DESCRIPTION = 100;

/** True when the employer's description is long enough to carry a page (the bake's rule). */
export function postingDescribedEnough(description: string | null | undefined): boolean {
  return typeof description === "string" && jdParagraphs(description).join("\n").length >= POSTING_MIN_DESCRIPTION;
}

/**
 * THE NAME A POSTING'S PAGE PRINTS, AND WHETHER IT MAY PRINT ONE (SEO-006).
 *
 * The bake's name gate (scripts/prerender-names.mjs) run on the employer as
 * the app names it (postingEmployer's name: the override, then the stored
 * name): a trailing career-site label comes off ("Chubb External" is Chubb),
 * and a name that cannot be anyone's (logo or file-name text, a careers
 * subdomain, a bare generic word, a tenant code) comes back with a reason.
 * The bake asks this for every posting, and so does postingJsonLd.
 */
export function postingNameVerdict(job: Pick<PostingRow, "id" | "token" | "company">): BakeEmployerName {
  const token = job.token ?? postingPathParts(job.id)?.token ?? null;
  return bakeEmployerName(token, job.company, { boardName: employerName, isCodeShapedName });
}

/**
 * WHETHER THE BAKE WOULD WRITE JOB MARKUP FOR THIS ROW, AND UNDER WHICH NAME.
 *
 * The React posting page wrote postingJsonLd after hydration with none of the
 * bake's gates in front of it, so a page whose static file withheld the
 * markup (a refused name, owner decision D7) carried a JobPosting naming
 * that name once a crawler that renders had run the app (the trusted-pages
 * round, 2026-10-25). The bake applied three rules the app did not: rule 1
 * (postingRowEligible: no staffing agency, no USAJOBS row, no tenant code, a
 * place, a hirer the board names, still live), the description length, and
 * the name gate. They are applied here, and postingJsonLd applies them first,
 * so no caller can write markup the bake would not.
 *
 * Returns the row as the markup names it (the employer's name repaired), or
 * null when the bake would write none. `ignoreNameGate` lets the bake ask
 * whether the name is the ONLY thing in the way (a carried page then keeps
 * its page with no markup, D7); it skips the name rules (the gate and the
 * tenant-code clause of rule 1) and is never used to emit markup.
 */
export function postingMarkupGate(
  job: PostingRow,
  description: string | null | undefined,
  opts: { now?: Date; ignoreNameGate?: boolean } = {},
): PostingRow | null {
  const now = opts.now ?? new Date();
  const rule = {
    postingPagePath,
    postingPathParts,
    postingEmployer,
    isCodeShapedName: opts.ignoreNameGate ? () => false : isCodeShapedName,
    isPostingLive: (j: PostingRow) => isPostingLive(j, now),
  };
  if (!postingRowEligible(job, rule)) return null;
  if (!postingDescribedEnough(description)) return null;
  const named = postingNameVerdict(job);
  if (named.reason && !opts.ignoreNameGate) return null;
  return named.repaired ? { ...job, company: named.name } : job;
}

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
 * Nothing optional is guessed, and PAY IS NEVER IN THE MARKUP (owner decision,
 * growth decision 1, SEO-016): Google's reference says only the employer may
 * provide baseSalary, and the board's figure is our reading of the employer's
 * text, annualised. The employer's own words stay on the visible page.
 */
export function postingJsonLd(
  row: PostingRow,
  description: string | null | undefined,
  // `ignoreCountryMismatch` lets the bake ask whether the country is the ONLY
  // thing in the way (a carried page then keeps its page with no markup, D7);
  // `ignoreNameGate` asks the same of the name (postingMarkupGate). Neither is
  // ever used to emit markup.
  opts: { site: string; now?: Date; ignoreCountryMismatch?: boolean; ignoreNameGate?: boolean } = { site: "" },
): Record<string, unknown> | null {
  const now = opts.now ?? new Date();
  // THE BAKE'S RULES COME FIRST, FOR EVERY CALLER: the bake, the React posting
  // page and the board's detail pane all write what this returns, so a row the
  // bake would give no markup gets none anywhere, and a repaired name is the
  // one every caller's markup names.
  const job = postingMarkupGate(row, description, { now, ignoreNameGate: opts.ignoreNameGate });
  if (!job) return null;
  const path = postingPagePath(job.id);
  const desc = typeof description === "string" ? jdText(description).trim() : "";
  // TELECOMMUTE ONLY ON THE HIRING SYSTEM'S OWN REMOTE FIELD (SEO-003's rule).
  // A place-free remote label ("Remote - US", "China - Remote") is marked up
  // as its country: the round's bake shipped TELECOMMUTE on a medical
  // representative whose description asks for twelve hospital visits a day,
  // and a label cannot tell that job from a home-based one. The board carries
  // no vendor flag yet (the wave-4 hand-off), so until it does no page says
  // TELECOMMUTE.
  const remoteBasis = postingRemoteBasis(job);
  const telecommute = remoteBasis === "vendor";
  if (!path) return null;
  if (!isPostingLive(job, now)) return null;
  if (!job.title || !job.company || !job.postedAt) return null;
  if (desc.length < 100) return null;
  // A place needs a country or it is not a place Google accepts; a fully
  // remote posting may state its applicant country instead.
  if (!job.country) return null;
  if (!remoteBasis && !job.location) return null;
  // A row whose location ends in another country's name has a country we
  // cannot stand behind (SEO-035): no markup, and the bake gives the URL no
  // live page.
  if (!opts.ignoreCountryMismatch && postingCountryMismatch(job)) return null;
  const validThrough = postingValidThrough(job, now);
  if (!validThrough) return null;
  const employer = postingEmployer(job);

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: postingText(job.title),
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
    hiringOrganization: { "@type": "Organization", name: employer },
    url: `${opts.site}${path}`,
    // The application happens on the employer's own system, not here.
    directApply: false,
    // The third segment of a board id is the employer's ATS requisition key,
    // carried through unchanged — their identifier for the job, which is what
    // this property asks for.
    identifier: {
      "@type": "PropertyValue",
      name: employer,
      value: postingPathParts(job.id)!.key,
    },
  };

  const address = postingPostalAddress(job);
  if (telecommute) {
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
    // A place-free remote row names no place below its country, so its
    // address is the country and nothing narrower.
    if (remoteBasis === "place-free") {
      delete address.addressLocality;
      delete address.streetAddress;
      delete address.postalCode;
    }
    ld.jobLocation = { "@type": "Place", address };
  }

  const empType = ldEmploymentType(job.employmentType);
  if (empType) ld.employmentType = empType;

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
  // One line: "Quality  (QA) Technician" shipped its employer's double space
  // into two identical sitemap titles (OBS-1).
  const title = postingText(job.title);
  const company = job.company ? postingEmployer(job) : "";
  const place = postingText(job.location);
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

/**
 * THE TITLE, DIFFERENT FROM EVERY TITLE THE BAKE HAS ALREADY GIVEN A POSTING.
 *
 * postingPageTitle's first half keeps the place and drops the employer when
 * both do not fit beside a whole job title, so two employers' identical
 * titles in one city ("Registered Nurse - ICU Night Shift — Boston, MA")
 * render one title for two different jobs, and a sitemap carrying both is
 * the duplicate Search Console reports. The bake passes the titles it has
 * already written; a taken title gets the employer's requisition key as its
 * tail (with the employer in front where it fits), and in the last resort
 * the key in brackets, which is unique per URL by construction.
 */
export function postingPageTitleAvoiding(job: PostingRow, taken: ReadonlySet<string>): string {
  const first = postingPageTitle(job);
  if (!taken.has(first)) return first;
  const title = postingText(job.title);
  const company = job.company ? postingEmployer(job) : "";
  const key = postingPathParts(job.id)?.key ?? "";
  if (!key) return first;
  for (const tail of [company ? `${company} ${key}` : "", key]) {
    if (!tail) continue;
    const room = TITLE_BUDGET - tail.length - TITLE_SEP.length;
    if (room < TITLE_MIN_ROOM) continue;
    const candidate = `${clip(title, room)}${TITLE_SEP}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${first} (${key})`;
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
  const title = postingText(job.title);
  const company = job.company ? postingEmployer(job) : "";
  const place = postingText(job.location);
  // NO NAME, NO "at ,": a page whose employer name the bake will not print
  // (logo text kept under D7) says "the employer" instead.
  const at = company ? ` at ${company}` : "";
  let out = place ? `${title}${at}, ${place}.` : `${title}${at}.`;
  if (servedLength(out) > DESCRIPTION_BUDGET) out = `${title}${at}.`;
  if (servedLength(out) > DESCRIPTION_BUDGET) out = `${title}.`;
  const add = (clause: string) => {
    if (servedLength(out + clause) <= DESCRIPTION_BUDGET) out += clause;
  };
  if (job.salary) add(` Pay as stated by the employer: ${String(job.salary).trim()}.`);
  add(` Straight from ${company ? possessive(company) : "the employer's"} own job board.`);
  add(" Check your resume against it before you apply.");
  return out;
}
