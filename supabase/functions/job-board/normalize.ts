// Pure normalization + filtering for the job board. No Deno APIs — this
// module is unit-tested by vitest against REAL payload fixtures captured
// from each ATS's public API (src/test/job-board.test.ts).

import type { JobSourceKind } from "./sources.ts";
import { categorize, type JobCategory } from "./categories.ts";

export interface JobPosting {
  /** `${source}:${token}:${externalId}` — stable across refreshes. */
  id: string;
  source: JobSourceKind;
  /** Board token — needed for the detail lookup. */
  token: string;
  company: string;
  title: string;
  location: string;
  /** True only when workMode is definitively "remote" (kept for filters/stats). */
  remote: boolean;
  /** Definitive work mode: vendor structured field first, explicit title/location
      text second, null when the posting doesn't say — and the UI shows nothing. */
  workMode: "remote" | "hybrid" | "onsite" | null;
  department: string | null;
  /** ISO date, null when the ATS doesn't expose one in the list payload. */
  postedAt: string | null;
  /** Deterministic field bucket (department-first, title fallback). */
  category: JobCategory;
  /** Freeform salary summary when the feed provides one; null otherwise. */
  salary: string | null;
  /** ISO-3166 alpha-2 when the FEED states it structurally (Rippling does);
      absent → ingest falls back to detectCountry(location). */
  country?: string | null;
  /** The company's own posting/application page — where Apply goes. */
  applyUrl: string;
  /** Employment type from the vendor's STRUCTURED field only — never inferred
      from text. Same trinary-or-nothing contract as workMode: a value only
      when the feed states one, null otherwise, and the UI shows nothing on
      null. Nine vendors carried it in the list payloads the ingest already
      fetches when measured live 2026-08-28; adp joined 2026-08-31 (its
      client-authored work-level labels, pre-cleaned of pay-basis words before
      the shared mapper); the rest stay null. */
  employmentType?: EmploymentType | null;
}

export type EmploymentType = "full_time" | "part_time" | "contract" | "temporary" | "internship";

/**
 * One mapper for nine vendors' vocabularies. STRUCTURED FIELDS ONLY — the
 * input is a vendor enum/label ("FullTime", "Full-time", "permanent",
 * "fixed_term", "Intern"), never posting prose, so a miss returns null rather
 * than guessing. Vocabulary measured live per vendor before each entry:
 * ashby FullTime/PartTime/Intern/Contract/Temporary; lever commitment
 * "Full-time"/"Part-time"/"Internship"/"Contract"/"Permanent"; workable
 * "Full-time" style; smartrecruiters typeOfEmployment id "permanent"/
 * "contract"/... with a display label; recruitee employment_type_code
 * fulltime/parttime/internship/temporary; personio <schedule> full-or-part-time
 * variants; pinpoint/icims free-ish labels already threaded for salary logic.
 */
export function normalizeEmploymentType(raw: unknown): EmploymentType | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!v) return null;
  if (/^(fulltime|permanent|regular|cdi|festanstellung|fullorparttime)$/.test(v)) return "full_time";
  if (/^(parttime|minijob|casual)$/.test(v)) return "part_time";
  if (/^(contract|contractor|fixedterm|cdd|freelance|b2b)$/.test(v)) return "contract";
  if (/^(temporary|temp|seasonal|interim)$/.test(v)) return "temporary";
  if (/^(intern|internship|trainee|apprentice|apprenticeship|workingstudent|werkstudent)$/.test(v)) return "internship";
  return null;
}

// Feeds are official vendor APIs, but a posting URL still passes through us
// into an <a href> — http gets upgraded to https (One Medical ships http://
// apply URLs), anything that isn't http(s) becomes "" and the posting drops.
const safeUrl = (u: unknown): string => {
  if (typeof u !== "string") return "";
  if (/^https:\/\//i.test(u)) return u;
  if (/^http:\/\//i.test(u)) return "https://" + u.slice(7);
  return "";
};

// Oldest posted_at we'll trust from a feed. Beyond this it's almost certainly
// bad data (some feeds return epoch-ish or decade-old timestamps — e.g. a
// Palantir role dated 2009) or an evergreen pipeline req that shouldn't wear a
// stale date. Kept here so ingestion and any date-hygiene share one bound.
// Garbage-date floor: only dates before this are feed junk (epoch zeros,
// mis-parsed typos, the live 2009 Palantir date — Lever didn't exist yet).
// A REAL old date — a 3.5-year-old evergreen Lever req — must SURVIVE
// sanitization so the freshness cap can drop the posting. The previous
// ~3-year "absurdly old → null" rule laundered exactly those evergreens into
// undated-KEPT postings (live incident: a 1,295-day-old req served on a board
// that promises nothing older than 30 days; 42% of Lever rows were undated
// this way). 2010 predates every ATS we ingest, so anything earlier cannot be
// a real posting date.
export const POSTED_AT_GARBAGE_FLOOR_MS = Date.parse("2010-01-01T00:00:00Z");

// A posted_at is trustworthy only if it parses and sits in a sane window: not
// in the future (small clock-skew grace) and not pre-2000 junk. Garbage dates
// collapse to null — so effective_posted falls back to first-seen for sorting
// and the card shows no date instead of "posted 6000 days ago". Real-but-old
// dates pass through untouched: the ingestion freshness cap is what drops
// those postings, and nulling them would keep the posting alive undated.
export function sanePostedAt(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso || typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (t > now + 2 * 86_400_000) return null;      // future beyond clock-skew grace
  // Inside the grace window, CLAMP to now rather than storing a future date.
  // The grace exists because vendors emit date-only values that parse as UTC
  // midnight from boards several hours ahead (AU/Asia Workday) — that is skew,
  // and the honest reading of skew is "posted now", not "posted tomorrow".
  // Storing the future value had two visible consequences: default sort is
  // effective_posted DESC so all 23 such rows occupied the entire top of the
  // board, and daysAgo() in Jobs.tsx returns null for a negative age, so those
  // cards rendered with no posted-age label at all. Measured 2026-07-28: 19
  // Workday rows stamped 2026-07-29T00:00:00Z plus 4 Personio rows 1-57 min
  // ahead. Nothing is invented here — a posting cannot have been posted later
  // than the moment we read it.
  if (t > now) return new Date(now).toISOString();
  if (t < POSTED_AT_GARBAGE_FLOOR_MS) return null; // epoch-zero / typo junk
  return iso;
}

// Closure "superseded" detection compares a vanished posting's title against
// the board's still-live titles — but companies decorate reposts with req-id
// noise ("Behavior Technician (R-48213)", "Nurse - #10422"), so exact-string
// matching under-detects relisting churn and inflates fill-rate stats. Strip
// only id-shaped noise: bracketed segments containing digits and trailing
// req/id numbers. NEVER strip words (a Senior Engineer closing while Engineer
// stays live is not automatically a repost).
export function normalizeCloseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[([{][^)\]}]*\d[^)\]}]*[)\]}]/g, " ")          // (R-48213), [Req 10422]
    .replace(/\s*[-–—#·|]\s*(?:req|job|id|jr)?[\s#:-]*\d{3,}\s*$/i, " ") // trailing "- 10422" / "#10422"
    .replace(/\s+/g, " ")
    .trim();
}

// Convert a feed's raw date value (epoch number, ISO/date string, whatever the
// vendor sends) to an ISO string — WITHOUT throwing. `new Date(x).toISOString()`
// raises a RangeError on an invalid date, and a normalizer that throws fails its
// ENTIRE board upstream (fetchBoard swallows it → the board silently stops
// ingesting, the same class as a fetch timeout). A non-empty garbage date string
// is exactly the input that trips this. Bad or absent values collapse to null;
// window-sanity (future/too-old) stays a separate concern for sanePostedAt.
export function safeIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Freshness-cap decision: a posting is dropped on age ONLY when it carries a
// trustworthy date older than the cutoff. A null (undated or garbage-dated,
// per sanePostedAt) posting is never dropped on age — we can't prove it's old,
// and the vast majority of feeds do date their postings anyway.
export function isDatedBefore(sanitizedPostedAt: string | null, cutoffMs: number): boolean {
  return sanitizedPostedAt !== null && Date.parse(sanitizedPostedAt) < cutoffMs;
}

// Greenhouse escapes the HTML it returns (&lt;p&gt;…) — and entities INSIDE
// that HTML arrive double-escaped (&amp;nbsp;), so unescape must run twice:
// once to recover the markup, once to recover the text's own entities.
// Two passes are a no-op on plain text.
const unescapeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    // Numeric entities — audit 2026-07-25: workday descriptions shipped raw
    // &#160;/&#8217; to users because only the named set was decoded. NUL and
    // out-of-range code points become spaces (a NUL here would make the row
    // grep-invisible and break downstream matching).
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const c = parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; })
    .replace(/&#(\d+);/g, (_, d) => { const c = parseInt(d, 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; })
    .replace(/&nbsp;/g, " ")
    // Named entities — audit 2026-08-24: greenhouse's pay-transparency
    // footer ships "&mdash;" and the numeric-only decoder left it literal in
    // stored text, where it both rendered as garbage to readers AND broke
    // salary mining (the range separator never matched: 17/200 sampled rows
    // carried an entity-encoded pay block, all unparseable).
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&(rsquo|apos);/gi, "'")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rdquo;/gi, "\u201d")
    .replace(/&ldquo;/gi, "\u201c")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&(bull|middot);/gi, "\u00b7")
    .replace(/&amp;/g, "&"); // last, so &amp;lt; needs the second pass, not this one

export function htmlToText(html: string): string {
  const unescaped = unescapeEntities(unescapeEntities(html));
  return unescaped
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

// THE MISSING NEGATION ARM (measured live 2026-09-09 against deployed .67).
//
// In "NON-REMOTE" the hyphen is a word boundary, so the bare \bremote\b below
// matched and the board stored the exact inverse of what the employer wrote.
// Two live rows returned under workMode=remote:
//   "Application Analyst II-Full Time- Days - Cupid/Radiant- NON-REMOTE" (workday)
//   "RN (PRN - Not Remote)"                                             (icims)
// This is the SECOND time this board has shipped that inversion — see
// migration 20260817210000 and the index.ts remoteType classifier, whose rule
// is "a classifier built from substrings must answer the NEGATIONS before the
// POSITIVES". That rule lived in one classifier; this one never got it.
//
// The repair is to REMOVE the negated phrase from the string before the
// positive ladder runs, rather than to return a mode from the negation.
// Removal, not an early return, is what keeps the rest of the string readable:
//   "On-site (not remote)"  -> "On-site ()"   -> onsite
//   "Hybrid, non-remote"    -> "Hybrid, "     -> hybrid
//   "Analyst - NON-REMOTE"  -> "Analyst - "   -> null
// The bare case is NULL and not "onsite" on purpose: we know it is not remote,
// we do NOT know whether it is hybrid or onsite, and this file's rule is that
// null means the posting doesn't say and the board shows nothing rather than a
// guess. (index.ts's classifier reads a vendor's structured remoteType ENUM,
// where "Non-Remote Posting" IS Workday's own onsite label, so it may answer
// onsite there. Free text in a title states less, so it resolves to less.)
//
// COVERAGE, stated honestly. The English arms are backed by observed strings
// (the two titles above, plus "Non-Remote Posting"/"Not Remote"/"No Remote"
// from the 2026-08-17 incident). The DE/FR/ES/PT/NL arms are the standard
// negations of the tokens P_REMOTE already carries; they are NOT backed by
// observed feed strings, so they are written narrowly (adjacent negator +
// token only) and no language is covered beyond the five P_REMOTE already
// names. Nothing here invents a token P_REMOTE does not match.
const P_NEGATED_REMOTE = new RegExp(
  [
    // EN — "non-remote", "non remote", "nonremote", "not remote", "no remote"
    "\\b(?:non|not|no)[-\\s]?remote\\b",
    // EN — "not a remote role", "not fully remote", "not eligible for remote"
    "\\bnot\\s+(?:a\\s+|an\\s+|fully\\s+)?remote\\b",
    "\\bnot\\s+(?:eligible|available|open|considered)\\s+(?:for|to)\\s+remote\\b",
    // EN — a FIELD-VALUE negation: "Remote: No", "Remote — None", "Remote(No)".
    //
    // THE NEGATOR MUST END THE SEGMENT, and that lookahead is the whole point
    // of this arm's shape. Written without it — `remote\s*[:=–—-]\s*(?:no|
    // none|not)\b` — a hyphen or dash is read as a field separator, but in a
    // job TITLE those characters separate SEGMENTS, so the arm fired on the
    // extremely common genuinely-remote shapes and deleted the only remote
    // token in them:
    //   "Registered Nurse - Remote - No Weekends"          -> null (was remote)
    //   "Data Entry Clerk - Remote - No Experience Required"-> null
    //   "Data Analyst — Remote — No sponsorship"           -> null
    //   "Remote: No Cold Calling Sales Rep"                -> null
    // That is the mirror image of the incident this file exists to fix: a
    // remote role deleted from the Remote filter instead of a non-remote role
    // added to it, and the repair migration would have rewritten those rows
    // irreversibly. "no experience" in particular is part of this board's own
    // vocabulary — index.ts's INTENT_FILTERS carries a rule for it.
    // Requiring end-of-string or a delimiter after the negator keeps the real
    // field-value form and refuses the segment form. "not" is dropped here
    // entirely: it is already carried by the \bnot\s+…remote\b arms above, and
    // the "Remote - Not Available" shape is the trailing-negator arm below.
    "\\bremote\\s*[:=(–—-]\\s*(?:no|none)\\s*(?=$|[).|,;·/])",
    // EN — a TRAILING negator: "Work from home not available", "Remote Not
    // Available", "Remote - unavailable". Adjacency is required (the negator
    // follows the token directly), so "Remote Support Engineer - not available
    // for sponsorship" is untouched and stays remote.
    "\\b(?:remote|wfh|work\\s+from\\s+home|home\\s?office)\\s*[:=–—-]?\\s*(?:not\\s+(?:available|offered|permitted|an\\s+option)|unavailable)\\b",
    // EN — the other tokens P_REMOTE carries
    "\\b(?:non|not|no)[-\\s]?(?:wfh|work\\s+from\\s+home|home\\s?office)\\b",
    "\\bno\\s+remote\\s+(?:work|option|options|opportunit(?:y|ies))\\b",
    // DE — "kein/keine/nicht Home Office" (home office is P_REMOTE's DE token)
    "\\b(?:keine|kein|nicht)\\s+(?:im\\s+)?home\\s?office\\b",
    // FR — "non-télétravail", "pas de télétravail", "sans télétravail",
    //      "aucun télétravail", "télétravail : non"
    "\\b(?:non|sans|aucun)[-\\s]?t[ée]l[ée]travail\\b",
    "\\bpas\\s+de\\s+t[ée]l[ée]travail\\b",
    // Same segment-vs-field hazard as the EN field-value arm above, same fix.
    "\\bt[ée]l[ée]travail\\s*[:=(–—-]\\s*non\\s*(?=$|[).|,;·/])",
    // ES/PT — "no remoto", "não remoto", "sin/no teletrabajo"
    "\\b(?:no|n[ãa]o)[-\\s]?remoto\\b",
    "\\b(?:sin|no)\\s+teletrabajo\\b",
    // NL — "geen/niet thuiswerken"
    "\\b(?:geen|niet)\\s+thuiswerken\\b",
  ].join("|"),
  "gi",
);

/**
 * The negated-remote phrase set as a SOURCE STRING, so index.ts's read-side
 * INTENT_FILTERS can build its own non-global RegExp from the one definition
 * instead of spelling the phrases a second time. There is one "negated remote"
 * in this codebase and this is it: the writer (detectWorkMode), the reader
 * (the query-intent lift) and the repair migration all quote it.
 */
export const NEGATED_REMOTE_SOURCE = P_NEGATED_REMOTE.source;

/** Remove every negated-remote phrase, so the positive ladder never sees the
 *  remote token that a negation owns. Exported for the vendor label path and
 *  for the guards. */
export function stripNegatedRemote(s: string): string {
  return s.replace(P_NEGATED_REMOTE, " ");
}

// Trinary work-mode detection from explicit title/location text (clear words
// only; descriptions are never inferred from). Negations are stripped FIRST.
// Hybrid then outranks remote ("Hybrid remote" is hybrid); onsite needs the
// explicit phrase. null = the posting doesn't say, and the board shows nothing
// rather than a guess. Multilingual: the board carries DE/FR/ES/NL/PT postings.
const P_HYBRID = /\bhybrid\b|\bhybride\b|\bh[íi]brido?\b/i;
const P_REMOTE = /\bremote\b|\bwork from home\b|\bwfh\b|\bt[ée]l[ée]travail\b|\bhome\s?office\b|\bremoto\b|\bthuiswerken\b|\bteletrabajo\b/i;
const P_ONSITE = /\bon-?site\b|\bin-?office\b|\bvor ort\b|\bpresencial\b|\bsur site\b/i;
export function detectWorkMode(...parts: Array<string | null | undefined>): "remote" | "hybrid" | "onsite" | null {
  const joined = parts.filter(Boolean).join(" · ");
  if (!joined) return null;
  const s = stripNegatedRemote(joined);
  if (P_HYBRID.test(s)) return "hybrid";
  if (P_REMOTE.test(s)) return "remote";
  if (P_ONSITE.test(s)) return "onsite";
  return null;
}

/**
 * THE ONE reader of a vendor's own workplace/location-type LABEL.
 *
 * Vendor arms used to re-implement this with `label.includes("remote")`
 * ladders of their own, which reproduced both defects at once: no negation
 * (iCIMS location_type "Non-Remote" read as remote) and remote tested BEFORE
 * hybrid, inverting the deliberate order above ("Hybrid Remote" is hybrid).
 * Every vendor arm now calls this or detectWorkMode; nothing re-implements.
 *
 * Order: the vendor's exact enum wins (ORA_REMOTE, ON_SITE, …), then the same
 * text detector every other field gets, then the one word that is a clear
 * statement in a workplace-type FIELD but a guess in a job title — "office".
 * ("Office Manager" must not become onsite; location_type "Office" must.)
 */
export function statedWorkMode(label: string | null | undefined): "remote" | "hybrid" | "onsite" | null {
  if (typeof label !== "string" || !label.trim()) return null;
  const enumMode = vendorWorkMode(label);
  if (enumMode) return enumMode;
  const detected = detectWorkMode(label);
  if (detected) return detected;
  return /\boffice\b/i.test(stripNegatedRemote(label)) ? "onsite" : null;
}

/**
 * THE ONE way a vendor arm combines its own workplace LABEL with free text.
 *
 * `statedWorkMode(label) ?? detectWorkMode(...)` looked right and was not: for
 * a label that NEGATES remote ("Non-Remote", iCIMS's own location_type value)
 * statedWorkMode answers null, null is indistinguishable from "the vendor said
 * nothing", and the `??` then handed the decision to the title — so a vendor
 * explicitly stating not-remote was overridden by the word "remote" in the
 * title. Measured on the real functions before this change:
 *   normalizeIcims(location_type "Non-Remote", title "Remote Patient
 *     Monitoring RN")                      -> workMode "remote", remote true
 *   normalizeLever(workplaceType "Non-Remote", text "Remote Support Engineer")
 *                                          -> workMode "remote", remote true
 * "Remote Patient Monitoring" is a real iCIMS-heavy clinical title family, and
 * iCIMS is the vendor whose location_type genuinely carries "Non-Remote".
 *
 * The rule: free text may NARROW a negated label (a title saying hybrid or
 * onsite tells us which of the two it is), but it can never ANSWER "remote"
 * over the employer's own negation. It resolves to null instead — this file's
 * documented value for "we know what it is not, not what it is".
 */
export function workModeFrom(
  label: string | null | undefined,
  ...parts: Array<string | null | undefined>
): "remote" | "hybrid" | "onsite" | null {
  const stated = statedWorkMode(label);
  if (stated) return stated;
  const detected = detectWorkMode(...parts);
  if (typeof label === "string" && stripNegatedRemote(label) !== label) {
    return detected === "remote" ? null : detected;
  }
  return detected;
}
// A Map, not an object literal — the third instance of this hazard in this
// codebase (see NAME_FIXES in company-display.ts and CATEGORY_ACCENT in
// category-accent.ts). `VENDOR_MODE[v]` reaches Object.prototype, so a vendor
// sending WorkplaceTypeCode "constructor" or "toString" would return a
// FUNCTION, and `?? null` does not catch it because a function is not nullish.
// Record<string,...> describes inherited keys as valid values, so TypeScript
// cannot see it.
//
// The ORA_* codes are Oracle Recruiting Cloud's own vocabulary. Measured
// 2026-07-29: where a vendor STATES a work mode we disagreed 72.3% of the time
// (598 of 915 stored NULL, 64 stored wrong) — and Oracle was a large share of
// that, because `ORA_REMOTE`.toLowerCase() is `ora_remote`, which matched
// nothing here and fell through to null. 14,678 oracle postings, ~33% of which
// carry a stated code.
const VENDOR_MODE = new Map<string, "remote" | "hybrid" | "onsite">([
  ["remote", "remote"], ["hybrid", "hybrid"], ["onsite", "onsite"], ["on_site", "onsite"],
  // Oracle Recruiting Cloud
  ["ora_remote", "remote"], ["ora_hybrid", "hybrid"], ["ora_onsite", "onsite"],
  ["ora_on_site", "onsite"], ["ora_office", "onsite"],
  // Other spellings seen in vendor payloads
  ["fully_remote", "remote"], ["remote_working", "remote"], ["work_from_home", "remote"],
  ["telecommute", "remote"], ["in_office", "onsite"], ["in_person", "onsite"],
  ["office", "onsite"], ["flexible", "hybrid"], ["partially_remote", "hybrid"],
]);
/** Map a vendor's workplace enum (any casing, ON_SITE variants) to our trinary. */
export function vendorWorkMode(v: string | null | undefined): "remote" | "hybrid" | "onsite" | null {
  if (typeof v !== "string") return null;
  return VENDOR_MODE.get(v.toLowerCase().replace(/[\s-]+/g, "_")) ?? null;
}

// Country from free-text location — deterministic and CONSERVATIVE: an explicit
// country name, a comma-prefixed US state / Canadian province code, or a full
// state/province name. No city geocoding, no guessing: a location we can't
// place stays NULL and is simply excluded from the country filter (disclosed),
// because "London" could be Ontario and "Georgia" could be Tbilisi.
const COUNTRY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:united states|u\.?s\.?a\.?|estados unidos)\b/i, "US"],
  // "wales" is guarded against NEW SOUTH WALES, which is in Australia. The GB
  // pattern sits at index 1 and the AU pattern at index 7, so on "Sydney, New
  // South Wales, Australia" the word Wales won the race and the row shipped as
  // United Kingdom. Measured live 2026-08-25: 25 of 25 rows returned for
  // location="New South Wales" carried country GB. Plain "South Wales" IS
  // Welsh, so only the "new south" prefix is excluded — same shape as the
  // (?<!new ) guard on Mexico below.
  [/\b(?:united kingdom|england|scotland|(?<!new south )wales|northern ireland)\b|\bUK\b/i, "GB"],
  [/\b(?:germany|deutschland)\b/i, "DE"],
  [/\bcanada\b/i, "CA"],
  [/\bfrance\b/i, "FR"],
  [/\b(?:netherlands|nederland)\b/i, "NL"],
  [/\bindia\b/i, "IN"],
  [/\b(?:australia|new south wales)\b/i, "AU"],
  [/\b(?:poland|polska)\b/i, "PL"],
  [/\b(?:spain|españa)\b/i, "ES"],
  // (?<!new ): "Albuquerque, New Mexico" is a US state, not the country —
  // measured 2026-08-24: 251 of 599 servable "new mexico" locations carried
  // country=MX, including rows with an explicit "US," prefix, poisoning the
  // country filter in both directions. "Mexico City"/"México" still match.
  [/\b(?<!new )(?:mexico|méxico)\b/i, "MX"],
  [/\b(?:brazil|brasil)\b/i, "BR"],
  [/\bphilippines\b/i, "PH"],
  [/\b(?:sweden|sverige)\b/i, "SE"],
  [/\b(?:denmark|danmark)\b/i, "DK"],
  [/\b(?:norway|norge)\b/i, "NO"],
  [/\b(?:switzerland|schweiz|suisse)\b/i, "CH"],
  [/\b(?:austria|österreich)\b/i, "AT"],
  [/\bireland\b/i, "IE"],
  [/\b(?:belgium|belgië|belgique)\b/i, "BE"],
  [/\bportugal\b/i, "PT"],
  [/\b(?:italy|italia)\b/i, "IT"],
  [/\bjapan\b/i, "JP"],
  [/\bsingapore\b/i, "SG"],
  [/\bnew zealand\b/i, "NZ"],
  [/\bczech(?:ia)?\b/i, "CZ"],
  [/\bromania\b/i, "RO"],
  [/\bhungary\b/i, "HU"],
  [/\b(?:finland|suomi)\b/i, "FI"],
  [/\bgreece\b/i, "GR"],
  [/\bisrael\b/i, "IL"],
  [/\b(?:united arab emirates|uae|dubai|abu dhabi)\b/i, "AE"],
  [/\bsaudi arabia\b/i, "SA"],
  [/\bsouth africa\b/i, "ZA"],
  [/\bargentina\b/i, "AR"],
  [/\bcolombia\b/i, "CO"],
  [/\bchile\b/i, "CL"],
  [/\bperu\b/i, "PE"],
  [/\bviet\s?nam\b/i, "VN"],
  [/\bindonesia\b/i, "ID"],
  [/\bmalaysia\b/i, "MY"],
  [/\bthailand\b/i, "TH"],
  [/\b(?:south korea|korea)\b/i, "KR"],
  [/\b(?:turkey|türkiye)\b/i, "TR"],
  [/\bukraine\b/i, "UA"],
  [/\bcosta rica\b/i, "CR"],
  // THIRTEEN COUNTRIES WHOSE OWN NAME DID NOT RESOLVE TO THEM.
  // Found by sampling 5,000 postings that carry location text and no parsed
  // country: 38 of them name a country outright and were still filed as
  // unplaceable — "China", "Pakistan", "Ecuador". Roughly 1,280 postings
  // board-wide. Not inference and not a guess; the text says where it is.
  [/\bchina\b/i, "CN"],
  [/\bpakistan\b/i, "PK"],
  [/\btaiwan\b/i, "TW"],
  [/\bbulgaria\b/i, "BG"],
  [/\bcroatia\b/i, "HR"],
  [/\bslovakia\b/i, "SK"],
  [/\bserbia\b/i, "RS"],
  [/\bslovenia\b/i, "SI"],
  [/\begypt\b/i, "EG"],
  [/\bmorocco\b/i, "MA"],
  [/\btunisia\b/i, "TN"],
  [/\bkenya\b/i, "KE"],
  [/\becuador\b/i, "EC"],
  [/\buruguay\b/i, "UY"],
];
// Comma-prefixed uppercase state/province codes only — "Austin, TX" yes,
// stray "in" or "or" inside words no.
const P_US_STATE_CODE = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?![A-Za-z])/;
const P_CA_PROV_CODE = /,\s*(ON|QC|BC|AB|MB|SK|NS|NB|PE|NL|YT|NT|NU)(?![A-Za-z])/;
// SOME FEEDS PUT THE STATE FIRST: "AR Hot Springs", "NC - Raleigh". The
// comma-prefixed pattern above cannot see those, and they are the largest
// recoverable class in the unplaced set — 146 of 5,000 sampled, roughly 4,900
// postings board-wide.
//
// THE CODE LIST IS DELIBERATELY SHORTER THAN FIFTY. A leading two-letter token
// is far weaker evidence than a trailing one: "OR Tambo" is an airport in
// Johannesburg, "IN" and "ME" and "OK" and "HI" are English words, "DE" and
// "LA" and "MA" open place names in other languages. Only codes that are not
// words in English or common romance/germanic prefixes are listed, so a miss
// here leaves a posting unplaced — which is the board's stated behaviour — and
// never places it wrongly. GA is absent for the same reason it is absent from
// the state-NAME pattern: Georgia is also a country.
const P_US_STATE_CODE_LEADING =
  /^(AK|AR|AZ|CT|FL|IA|KS|KY|MN|NC|ND|NH|NJ|NM|NV|NY|RI|SD|TN|TX|UT|VT|WI|WV|WY|IL|MO)\s*[-–—]?\s+[A-Za-z]/;
const P_US_STATE_NAME = /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;
const P_CA_PROV_NAME = /\b(?:ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland)\b/i;

// City→country fallback for locations with no country/state qualifier at all
// ("Kuala Lumpur", "Pune, Maharashtra", bare "London"). Runs LAST, after every
// country pattern and US-state/CA-province check — which is what makes the
// ambiguous names safe: North American feeds essentially always qualify their
// cities ("Melbourne, FL", "London, ON", "Dublin, OH"), so those resolve via
// state/province BEFORE this table is consulted, and a bare segment is the
// non-NA reading. Matching is exact-SEGMENT equality (split on commas etc.),
// never substring — "Santiago de Compostela" does not match "santiago".
// Bump COUNTRY_MAP_VERSION when this table changes; the backfill-country
// sweep re-runs stored null-country rows against the current table.
export const COUNTRY_MAP_VERSION = 5;
const CITY_COUNTRY = new Map<string, string>([
  ["aarhus", "DK"],
  ["aberdeen", "GB"],
  ["abu dhabi", "AE"],
  ["abuja", "NG"],
  ["adelaide", "AU"],
  ["ahmedabad", "IN"],
  ["al khobar", "SA"],
  ["albuquerque", "US"],
  ["alexandria", "EG"],
  ["amsterdam", "NL"],
  ["ankara", "TR"],
  ["antwerp", "BE"],
  ["antwerpen", "BE"],
  ["atlanta", "US"],
  ["auckland", "NZ"],
  ["austin", "US"],
  ["baltimore", "US"],
  ["bandung", "ID"],
  ["bangalore", "IN"],
  ["bangkok", "TH"],
  ["barcelona", "ES"],
  ["barranquilla", "CO"],
  ["basel", "CH"],
  ["beijing", "CN"],
  ["belfast", "GB"],
  ["belo horizonte", "BR"],
  ["bengaluru", "IN"],
  ["bergen", "NO"],
  ["berlin", "DE"],
  ["bern", "CH"],
  ["bilbao", "ES"],
  ["bogota", "CO"],
  ["boise", "US"],
  ["bologna", "IT"],
  ["bordeaux", "FR"],
  ["boston", "US"],
  ["braga", "PT"],
  ["brasilia", "BR"],
  ["bremen", "DE"],
  ["brighton", "GB"],
  ["brisbane", "AU"],
  ["bristol", "GB"],
  ["brno", "CZ"],
  ["brooklyn", "US"],
  ["brussels", "BE"],
  ["bruxelles", "BE"],
  ["buenos aires", "AR"],
  ["buffalo", "US"],
  ["busan", "KR"],
  ["cairo", "EG"],
  ["calgary", "CA"],
  ["cali", "CO"],
  ["cambridge", "GB"],
  ["campinas", "BR"],
  ["canberra", "AU"],
  ["cape town", "ZA"],
  ["cardiff", "GB"],
  ["cdmx", "MX"],
  ["cebu", "PH"],
  ["cebu city", "PH"],
  ["chandigarh", "IN"],
  ["charlotte", "US"],
  ["chengdu", "CN"],
  ["chennai", "IN"],
  ["chiang mai", "TH"],
  ["chicago", "US"],
  ["christchurch", "NZ"],
  ["cincinnati", "US"],
  ["ciudad de mexico", "MX"],
  ["cleveland", "US"],
  ["coimbatore", "IN"],
  ["cologne", "DE"],
  ["columbus", "US"],
  ["copenhagen", "DK"],
  ["cork", "IE"],
  ["coventry", "GB"],
  ["curitiba", "BR"],
  ["cyberjaya", "MY"],
  ["da nang", "VN"],
  ["dallas", "US"],
  ["dammam", "SA"],
  ["delhi", "IN"],
  ["den haag", "NL"],
  ["denver", "US"],
  ["des moines", "US"],
  ["detroit", "US"],
  ["doha", "QA"],
  ["dortmund", "DE"],
  ["dresden", "DE"],
  ["dubai", "AE"],
  ["dublin", "IE"],
  ["duesseldorf", "DE"],
  ["durban", "ZA"],
  ["dusseldorf", "DE"],
  ["edinburgh", "GB"],
  ["edmonton", "CA"],
  ["eindhoven", "NL"],
  ["el paso", "US"],
  ["espoo", "FI"],
  ["essen", "DE"],
  ["firenze", "IT"],
  ["florence", "IT"],
  ["fort worth", "US"],
  ["fortaleza", "BR"],
  ["frankfurt", "DE"],
  ["fukuoka", "JP"],
  ["galway", "IE"],
  ["gdansk", "PL"],
  ["geneva", "CH"],
  ["geneve", "CH"],
  ["gent", "BE"],
  ["ghent", "BE"],
  ["glasgow", "GB"],
  ["gold coast", "AU"],
  ["goteborg", "SE"],
  ["gothenburg", "SE"],
  ["graz", "AT"],
  ["grenoble", "FR"],
  ["guadalajara", "MX"],
  ["guangzhou", "CN"],
  ["gurgaon", "IN"],
  ["gurugram", "IN"],
  ["haifa", "IL"],
  ["hamburg", "DE"],
  ["hangzhou", "CN"],
  ["hannover", "DE"],
  ["hanoi", "VN"],
  ["helsinki", "FI"],
  ["heredia", "CR"],
  ["herzliya", "IL"],
  ["ho chi minh city", "VN"],
  ["hong kong", "HK"],
  ["honolulu", "US"],
  ["houston", "US"],
  ["hsinchu", "TW"],
  ["hyderabad", "IN"],
  ["incheon", "KR"],
  ["indianapolis", "US"],
  ["indore", "IN"],
  ["istanbul", "TR"],
  ["izmir", "TR"],
  ["jaipur", "IN"],
  ["jakarta", "ID"],
  ["jeddah", "SA"],
  ["jersey city", "US"],
  ["jerusalem", "IL"],
  ["johannesburg", "ZA"],
  ["johor bahru", "MY"],
  ["kansas city", "US"],
  ["kaohsiung", "TW"],
  ["karlsruhe", "DE"],
  ["katowice", "PL"],
  ["kobenhavn", "DK"],
  ["kochi", "IN"],
  ["koeln", "DE"],
  ["kolkata", "IN"],
  ["krakow", "PL"],
  ["kuala lumpur", "MY"],
  ["kuwait city", "KW"],
  ["kyoto", "JP"],
  ["lagos", "NG"],
  ["las vegas", "US"],
  ["lausanne", "CH"],
  ["leeds", "GB"],
  ["leicester", "GB"],
  ["leipzig", "DE"],
  ["lille", "FR"],
  ["lima", "PE"],
  ["limerick", "IE"],
  ["linz", "AT"],
  ["lisboa", "PT"],
  ["lisbon", "PT"],
  ["liverpool", "GB"],
  ["lodz", "PL"],
  ["london", "GB"],
  ["los angeles", "US"],
  ["louisville", "US"],
  ["lucknow", "IN"],
  ["lyon", "FR"],
  ["madrid", "ES"],
  ["makati", "PH"],
  ["malaga", "ES"],
  ["malmo", "SE"],
  ["manama", "BH"],
  ["manchester", "GB"],
  ["manila", "PH"],
  ["mannheim", "DE"],
  ["marseille", "FR"],
  ["medellin", "CO"],
  ["melbourne", "AU"],
  ["memphis", "US"],
  ["mexico city", "MX"],
  ["miami", "US"],
  ["milan", "IT"],
  ["milano", "IT"],
  ["milton keynes", "GB"],
  ["milwaukee", "US"],
  ["minneapolis", "US"],
  ["mississauga", "CA"],
  ["monterrey", "MX"],
  ["montevideo", "UY"],
  ["montpellier", "FR"],
  ["montreal", "CA"],
  ["muenchen", "DE"],
  ["mumbai", "IN"],
  ["munich", "DE"],
  ["muscat", "OM"],
  ["mysuru", "IN"],
  ["nagoya", "JP"],
  ["nagpur", "IN"],
  ["nairobi", "KE"],
  ["nanjing", "CN"],
  ["nantes", "FR"],
  ["naples", "IT"],
  ["napoli", "IT"],
  ["nashville", "US"],
  ["new delhi", "IN"],
  ["new york", "US"],
  ["new york city", "US"],
  ["newark", "US"],
  ["nice", "FR"],
  ["noida", "IN"],
  ["nottingham", "GB"],
  ["nuernberg", "DE"],
  ["nuremberg", "DE"],
  ["nyc", "US"],
  ["oklahoma city", "US"],
  ["omaha", "US"],
  ["orlando", "US"],
  ["osaka", "JP"],
  ["oslo", "NO"],
  ["ottawa", "CA"],
  ["oxford", "GB"],
  ["paris", "FR"],
  ["pasig", "PH"],
  ["penang", "MY"],
  ["perth", "AU"],
  ["petaling jaya", "MY"],
  ["philadelphia", "US"],
  ["phoenix", "US"],
  ["pittsburgh", "US"],
  ["portland", "US"],
  ["porto", "PT"],
  ["porto alegre", "BR"],
  ["poznan", "PL"],
  ["prague", "CZ"],
  ["praha", "CZ"],
  ["pretoria", "ZA"],
  ["pune", "IN"],
  ["queretaro", "MX"],
  ["quezon city", "PH"],
  ["raleigh", "US"],
  ["reading", "GB"],
  ["recife", "BR"],
  ["rennes", "FR"],
  ["rio de janeiro", "BR"],
  ["riyadh", "SA"],
  ["roma", "IT"],
  ["rome", "IT"],
  ["rosario", "AR"],
  ["rotterdam", "NL"],
  ["sacramento", "US"],
  ["saint louis", "US"],
  ["salt lake city", "US"],
  ["salzburg", "AT"],
  ["san antonio", "US"],
  ["san diego", "US"],
  ["san francisco", "US"],
  ["sandton", "ZA"],
  ["santiago", "CL"],
  ["sao paulo", "BR"],
  ["seattle", "US"],
  ["seoul", "KR"],
  ["sevilla", "ES"],
  ["seville", "ES"],
  ["shanghai", "CN"],
  ["sharjah", "AE"],
  ["sheffield", "GB"],
  ["shenzhen", "CN"],
  ["singapore", "SG"],
  ["southampton", "GB"],
  ["st. louis", "US"],
  ["stavanger", "NO"],
  ["stockholm", "SE"],
  ["strasbourg", "FR"],
  ["stuttgart", "DE"],
  ["surabaya", "ID"],
  ["suzhou", "CN"],
  ["sydney", "AU"],
  ["taguig", "PH"],
  ["taichung", "TW"],
  ["taipei", "TW"],
  ["tampa", "US"],
  ["tampere", "FI"],
  ["tel aviv", "IL"],
  ["the hague", "NL"],
  ["thiruvananthapuram", "IN"],
  ["tianjin", "CN"],
  ["tijuana", "MX"],
  ["tokyo", "JP"],
  ["torino", "IT"],
  ["toronto", "CA"],
  ["toulouse", "FR"],
  ["trondheim", "NO"],
  ["tucson", "US"],
  ["turin", "IT"],
  ["utrecht", "NL"],
  ["vadodara", "IN"],
  ["vancouver", "CA"],
  ["vienna", "AT"],
  ["warsaw", "PL"],
  ["warszawa", "PL"],
  ["washington dc", "US"],
  ["wellington", "NZ"],
  ["wien", "AT"],
  ["winnipeg", "CA"],
  ["wroclaw", "PL"],
  ["wuhan", "CN"],
  ["yokohama", "JP"],
  ["zaragoza", "ES"],
  ["zuerich", "CH"],
  ["zurich", "CH"],
]);

/** Country from a bare city segment; exact segment match only, else null. */
export function cityCountry(location: string): string | null {
  for (const seg of location.toLowerCase().split(/[,;·|/]+/)) {
    const t = seg.trim().replace(/\s+/g, " ");
    const hit = CITY_COUNTRY.get(t);
    if (hit) return hit;
  }
  return null;
}

export function detectCountry(location: string | null | undefined): string | null {
  if (!location) return null;
  const s = String(location).slice(0, 300);
  for (const [re, code] of COUNTRY_PATTERNS) if (re.test(s)) return code;
  if (P_US_STATE_CODE.test(s) || P_US_STATE_NAME.test(s) || P_US_STATE_CODE_LEADING.test(s)) return "US";
  if (P_CA_PROV_CODE.test(s) || P_CA_PROV_NAME.test(s)) return "CA";
  if (/\bUS\b/.test(s)) return "US"; // "Remote - US", "US Remote" — after state codes so ", USA" paths won
  return cityCountry(s);
}

// ── THE SUBDIVISION WE ALREADY PARSED AND THREW AWAY ────────────────────────
//
// detectCountry above runs P_US_STATE_CODE, P_US_STATE_NAME,
// P_US_STATE_CODE_LEADING, P_CA_PROV_CODE and P_CA_PROV_NAME on every posting
// the ingest touches — and then answers "US" or "CA" and DISCARDS which state
// or province it just identified. The work is done; only the result is
// dropped.
//
// WHY THAT MATTERS MORE THAN IT SOUNDS. Pay-disclosure law is state-level, not
// national: Colorado, California, New York, Washington, Illinois, Hawaii,
// Maryland, Minnesota, New Jersey and Vermont each require a salary range on a
// posting; most states require nothing. With only a country column, "does this
// employer disclose pay where it is required to?" cannot be asked at all — the
// board can score a company at country granularity and no finer. The same is
// true of every geographic cut of the fill, churn and ghost numbers.
//
// AND IT IS ONLY RECOVERABLE WHILE THE ROW IS LIVE. The parse runs on the
// location string in the feed payload; once a posting closes, its row is
// deleted and the string goes with it. A subdivision not stamped today is not
// stamped ever.
//
// The country behaviour above is untouched, byte for byte: this is a second,
// additive read of the same string.

/** Bump when the vocabularies or the resolution order below change, exactly as
 *  COUNTRY_MAP_VERSION does for the country table — a stored region_code is
 *  only interpretable against the version of the rules that produced it. */
export const REGION_MAP_VERSION = 1;

// The SAME 49 names P_US_STATE_NAME carries, as a map so the match can be
// turned into a code. Georgia is absent here for the reason it is absent
// there: it is also a country, and a name match would place an Atlanta-less
// "Georgia" in the United States. A miss leaves the posting's region null,
// which is the board's stated behaviour for anything it cannot place; it never
// places one wrongly.
const US_STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", hawaii: "HI",
  idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

const CA_PROV_NAME_TO_CODE: Record<string, string> = {
  ontario: "ON", quebec: "QC", "british columbia": "BC", alberta: "AB",
  manitoba: "MB", saskatchewan: "SK", "nova scotia": "NS",
  "new brunswick": "NB", newfoundland: "NL",
};

/** Longest name first so "west virginia" cannot be shadowed by "virginia" and
 *  "british columbia" cannot be shadowed by a shorter neighbour, whatever the
 *  object literal's order happens to be. Built once at module load. */
const namePattern = (names: string[]) =>
  new RegExp(`\\b(${[...names].sort((a, b) => b.length - a.length).join("|")})\\b`, "i");
const P_US_STATE_NAME_CAP = namePattern(Object.keys(US_STATE_NAME_TO_CODE));
const P_CA_PROV_NAME_CAP = namePattern(Object.keys(CA_PROV_NAME_TO_CODE));

/**
 * The US state or Canadian province as an ISO 3166-2 subdivision code —
 * "US-TX", "CA-ON" — or null when the string does not name one.
 *
 * TAKES THE ALREADY-RESOLVED COUNTRY, and only ever answers inside it. A
 * region is a claim about where a job is, and the country is the stronger,
 * already-adjudicated half of that claim; re-deriving it here would be a
 * second implementation free to disagree with the first. Any country but US or
 * CA returns null — the parse simply has no vocabulary for it.
 *
 * WHY THE CODE CARRIES ITS COUNTRY PREFIX. A bare "CA" is California to the US
 * table and Canada to the country table, and "NL" is Newfoundland here and the
 * Netherlands there. Storing "US-CA" makes the stored value unambiguous
 * without a join, which is the whole point of writing it down.
 *
 * RESOLUTION ORDER, strongest evidence first, mirroring what the patterns' own
 * comments say about their reliability:
 *   1. the comma-prefixed code — "Austin, TX" — the most certain form;
 *   2. the spelled-out name — "Austin, Texas";
 *   3. the LEADING bare code — "TX Austin" — deliberately the weakest and
 *      last, from a deliberately short code list.
 *
 * THE ONE COLLISION IT REFUSES TO GUESS AT. ", CA" is California in a US
 * string and Canada in a Canadian one, and detectCountry resolves "Toronto,
 * ON, CA" to US via exactly that token. When a US-branch match lands on CA and
 * the same string also names a Canadian province, this returns null rather
 * than filing a Toronto posting in California. Null is recoverable; a wrong
 * subdivision, written into a longitudinal series, is not.
 */
export function detectRegion(
  location: string | null | undefined,
  country: string | null | undefined,
): string | null {
  if (!location) return null;
  const cc = String(country ?? "").toUpperCase();
  if (cc !== "US" && cc !== "CA") return null;
  // The same 300-char window detectCountry reads, so the two can never
  // disagree about which part of a long location string they looked at.
  const s = String(location).slice(0, 300);

  if (cc === "CA") {
    const code = P_CA_PROV_CODE.exec(s);
    if (code?.[1]) return `CA-${code[1]}`;
    const name = P_CA_PROV_NAME_CAP.exec(s);
    const mapped = name?.[1] ? CA_PROV_NAME_TO_CODE[name[1].toLowerCase()] : undefined;
    return mapped ? `CA-${mapped}` : null;
  }

  const code = P_US_STATE_CODE.exec(s);
  if (code?.[1]) {
    // California, or a Canadian address detectCountry mis-filed? Do not guess.
    if (code[1] === "CA" && (P_CA_PROV_CODE.test(s) || P_CA_PROV_NAME_CAP.test(s))) return null;
    return `US-${code[1]}`;
  }
  const name = P_US_STATE_NAME_CAP.exec(s);
  const mapped = name?.[1] ? US_STATE_NAME_TO_CODE[name[1].toLowerCase()] : undefined;
  if (mapped) return `US-${mapped}`;
  const leading = P_US_STATE_CODE_LEADING.exec(s);
  if (leading?.[1]) return `US-${leading[1]}`;
  return null;
}

/**
 * Country and subdivision from one location string, in one call.
 *
 * The ingest resolves country as `j.country ?? detectCountry(j.location)` —
 * the feed's structural field when it has one, the parse otherwise — so the
 * `stated` argument exists to let a caller hand in the vendor's own country
 * and still get a region parsed out of the free text beneath it.
 */
export function detectPlace(
  location: string | null | undefined,
  stated?: string | null,
): { country: string | null; region: string | null } {
  const country = (stated ?? null) || detectCountry(location);
  return { country, region: detectRegion(location, country) };
}

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
  departments?: Array<{ name?: string }>;
}

// A PLACE NAME IS NOT A LATITUDE. Some Greenhouse employers append the
// geocode to the location string, and the board rendered it verbatim:
// "Waipahu, HI 96797 | 21.396369637 | -158.01142287". Measured 2026-08-24:
// 398 of 1,000 sampled pipe-bearing locations carry this suffix, every one of
// them Greenhouse.
//
// The pattern is narrow ON PURPOSE. A pipe in a location is usually REAL —
// "Latin & South America | Remote", "3 Locations   |   PT-Orlando" — so only
// a trailing run of decimal numbers is removed, never the separator itself.
const COORD_SUFFIX = /\s*\|\s*-?\d{1,3}\.\d{3,}(?:\s*\|\s*-?\d{1,3}\.\d{3,})?\s*$/;
export function stripCoordinateSuffix(location: string): string {
  return location.replace(COORD_SUFFIX, "").trim();
}

// Greenhouse and Lever both run separate EU infrastructure with its own API
// and hosted-page hosts, and a tenant lives on exactly one side — the US host
// answers 404 for an EU tenant, verified live 2026-08-31 (asobostudio). EU
// boards carry a compound-token prefix (same pattern as workday's
// tenant~dc~site); everything downstream — posting ids, the catalog, the
// closure log — keeps the FULL prefixed token as the board's identity, and
// only these two helpers ever strip it, at the moment a hostname is derived.
// They live here rather than in index.ts so the fetch paths, the tests, and
// the census tooling's live probes all derive hosts from the same functions.
export function greenhouseApi(token: string): { host: string; token: string } {
  return token.startsWith("eu~")
    ? { host: "boards.eu.greenhouse.io", token: token.slice(3) }
    : { host: "boards-api.greenhouse.io", token };
}

export function leverApi(token: string): { host: string; token: string } {
  return token.startsWith("eu~")
    ? { host: "api.eu.lever.co", token: token.slice(3) }
    : { host: "api.lever.co", token };
}

export function normalizeGreenhouse(raw: { jobs?: GreenhouseJob[] }, company: string, token: string): JobPosting[] {
  // AN APPLY LINK SHARED BY FIVE TITLES IS A BOARD INDEX, NOT A JOB.
  //
  // absolute_url is employer-configured, and some employers point every
  // posting at their careers landing page. Measured 2026-08-23: 270 URLs on
  // the board were shared by >=5 distinct titles, carrying 11,202 postings —
  // BAYADA alone hung 1,601 postings (944 titles) off jobs.bayada.com/en/jobs.
  // The button looks fine and lands the reader on a search page.
  //
  // The per-job page is reconstructible from data already in hand:
  // job-boards.greenhouse.io/{token}/jobs/{id}, verified HTTP 200 against a
  // live posting. The whole board arrives in one payload, so counting distinct
  // titles per URL is free. Five is the audit's measured threshold — a real
  // per-job URL is never legitimately shared by five different titles, while
  // two or three can be one reposted role.
  const titlesPerUrl = new Map<string, Set<string>>();
  for (const j of raw.jobs ?? []) {
    const u = j.absolute_url ?? "";
    if (!u) continue;
    if (!titlesPerUrl.has(u)) titlesPerUrl.set(u, new Set());
    titlesPerUrl.get(u)!.add(j.title ?? "");
  }
  // The reconstructed per-job page must sit on the SAME side of the Atlantic
  // as the board: an EU tenant's pages are only served by the EU hosted-pages
  // host, and the path wants the bare tenant slug, not the routing prefix.
  const euBoard = token.startsWith("eu~");
  const pageHost = euBoard ? "job-boards.eu.greenhouse.io" : "job-boards.greenhouse.io";
  const pageToken = euBoard ? token.slice(3) : token;
  return (raw.jobs ?? []).map((j) => {
    const location = stripCoordinateSuffix(j.location?.name ?? "");
    const indexUrl = (titlesPerUrl.get(j.absolute_url ?? "")?.size ?? 0) >= 5;
    const workMode = detectWorkMode(location, j.title);
    return {
      id: `greenhouse:${token}:${j.id}`,
      source: "greenhouse" as const,
      token,
      company,
      title: j.title ?? "",
      location,
      workMode,
      remote: workMode === "remote",
      department: j.departments?.[0]?.name ?? null,
      // first_published only — updated_at re-stamps on any edit, so using it
      // as a posting date silently biases every age stat young. Undated is
      // honest; mis-dated is not.
      postedAt: j.first_published ?? null,
      category: categorize(j.title ?? "", j.departments?.[0]?.name),
      salary: null,
      applyUrl: safeUrl(indexUrl ? `https://${pageHost}/${pageToken}/jobs/${j.id}` : j.absolute_url),
    };
  }).filter((j) => j.applyUrl !== "");
}

interface LeverJob {
  // categories.commitment carries employment type ("Full-time", "Permanent",
  // "Internship") — proven by the captured fixture and live probes.
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number; // epoch ms
  workplaceType?: string;
  categories?: { location?: string; team?: string; allLocations?: string[]; commitment?: string };
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  descriptionPlain?: string;
  descriptionBodyPlain?: string;
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$" };
const fmtAmount = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function leverSalary(r?: { min?: number; max?: number; currency?: string; interval?: string }): string | null {
  if (!r || (!r.min && !r.max)) return null;
  const sym = CURRENCY_SYMBOL[r.currency ?? ""] ?? (r.currency ? `${r.currency} ` : "");
  const range = [r.min, r.max].filter((n): n is number => typeof n === "number" && n > 0).map(fmtAmount).join("–");
  if (!range) return null;
  const interval = r.interval ? `/${r.interval.replace(/-time|ly$/i, (m) => (m.toLowerCase() === "ly" ? "" : m))}` : "";
  return `${sym}${range}${interval ? interval.toLowerCase() : ""}`;
}

export function normalizeLever(raw: LeverJob[], company: string, token: string): JobPosting[] {
  return (Array.isArray(raw) ? raw : []).map((j) => {
    const location = j.categories?.allLocations?.join(" · ") || j.categories?.location || "";
    const workMode = workModeFrom(j.workplaceType, location, j.text);
    return {
      id: `lever:${token}:${j.id}`,
      source: "lever" as const,
      token,
      company,
      title: j.text ?? "",
      location,
      workMode,
      remote: workMode === "remote",
      department: j.categories?.team ?? null,
      postedAt: safeIso(j.createdAt),
      category: categorize(j.text ?? "", j.categories?.team),
      salary: leverSalary(j.salaryRange),
      employmentType: normalizeEmploymentType(j.categories?.commitment),
      applyUrl: safeUrl(j.hostedUrl ?? j.applyUrl),
    };
  }).filter((j) => j.applyUrl !== "");
}

interface AshbyJob {
  id: string;
  title: string;
  compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
  location?: string;
  secondaryLocations?: Array<{ location?: string } | string>;
  department?: string;
  team?: string;
  isRemote?: boolean;
  workplaceType?: string;
  employmentType?: string; // "Remote" | "Hybrid" | "Onsite"
  isListed?: boolean;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
}

export function normalizeAshby(raw: { jobs?: AshbyJob[] }, company: string, token: string): JobPosting[] {
  return (raw.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const location = j.location ?? "";
      // isRemote is Ashby's own boolean, so it outranks free text — but not a
      // workplaceType that NEGATES remote, which workModeFrom already refuses
      // to let text override. A vendor contradicting itself resolves to null.
      const workMode = statedWorkMode(j.workplaceType)
        ?? (j.isRemote === true && stripNegatedRemote(String(j.workplaceType ?? "")) === String(j.workplaceType ?? "")
              ? "remote" as const
              : workModeFrom(j.workplaceType, location, j.title));
      return {
        id: `ashby:${token}:${j.id}`,
        source: "ashby" as const,
        token,
        company,
        title: j.title ?? "",
        location,
        workMode,
        remote: workMode === "remote",
        department: j.department ?? j.team ?? null,
        postedAt: j.publishedAt ?? null,
        category: categorize(j.title ?? "", j.department ?? j.team),
        salary: j.compensation?.compensationTierSummary ?? j.compensation?.scrapeableCompensationSalarySummary ?? null,
        employmentType: normalizeEmploymentType(j.employmentType),
        applyUrl: safeUrl(j.jobUrl ?? j.applyUrl),
      };
    })
    .filter((j) => j.applyUrl !== "");
}

interface SmartRecruitersPosting {
  id: string | number;
  name: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  function?: { label?: string };
  department?: { label?: string };
  typeOfEmployment?: { id?: string; label?: string };
}

export function normalizeSmartRecruiters(raw: { content?: SmartRecruitersPosting[] }, company: string, token: string): JobPosting[] {
  return (raw.content ?? [])
    .map((p) => {
      const location =
        p.location?.fullLocation ||
        [p.location?.city, p.location?.region, p.location?.country?.toUpperCase()].filter(Boolean).join(", ");
      const department = p.function?.label ?? p.department?.label ?? null;
      // HYBRID BEFORE REMOTE. SmartRecruiters sets both flags on a hybrid
      // posting that also allows remote days; remote-first read those as fully
      // remote, inverting detectWorkMode's own documented order ("Hybrid
      // remote" is hybrid). Same correction applied to recruitee and rippling.
      const workMode = p.location?.hybrid === true ? "hybrid" as const
        : p.location?.remote === true ? "remote" as const
        : detectWorkMode(location, p.name);
      return {
        id: `smartrecruiters:${token}:${p.id}`,
        source: "smartrecruiters" as const,
        token,
        company,
        title: p.name ?? "",
        location,
        workMode,
        remote: workMode === "remote",
        department,
        postedAt: p.releasedDate ?? null,
        category: categorize(p.name ?? "", department),
        salary: null,
        // id first ("permanent"/"contract" enums), display label second.
        employmentType: normalizeEmploymentType(p.typeOfEmployment?.id) ?? normalizeEmploymentType(p.typeOfEmployment?.label),
        // The public posting page is deterministic from company identifier + id.
        applyUrl: safeUrl(`https://jobs.smartrecruiters.com/${token}/${p.id}`),
      };
    })
    .filter((j) => j.applyUrl !== "");
}

interface WorkableJob {
  title: string;
  shortcode: string;
  telecommuting?: boolean;
  department?: string | null;
  url?: string;
  published_on?: string;
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
  employment_type?: string;
}

export function normalizeWorkable(raw: { jobs?: WorkableJob[] }, company: string, token: string): JobPosting[] {
  return (raw.jobs ?? [])
    .map((j) => {
      const location = [j.city, j.state, j.country].filter(Boolean).join(", ");
      const posted = j.published_on ?? j.created_at;
      const workMode = j.telecommuting === true ? "remote" as const : detectWorkMode(location, j.title);
      return {
        id: `workable:${token}:${j.shortcode}`,
        source: "workable" as const,
        token,
        company,
        title: j.title ?? "",
        location,
        workMode,
        remote: workMode === "remote",
        department: j.department ?? null,
        postedAt: safeIso(posted),
        category: categorize(j.title ?? "", j.department),
        salary: null,
        employmentType: normalizeEmploymentType(j.employment_type),
        applyUrl: safeUrl(j.url ?? `https://apply.workable.com/j/${j.shortcode}`),
      };
    })
    .filter((j) => j.applyUrl !== "");
}

interface BambooJob {
  id: string | number;
  jobOpeningName: string;
  departmentLabel?: string | null;
  isRemote?: boolean | null;
  location?: { city?: string | null; state?: string | null };
  atsLocation?: { country?: string | null; state?: string | null; province?: string | null; city?: string | null };
}

export function normalizeBambooHR(raw: { result?: BambooJob[] }, company: string, token: string): JobPosting[] {
  return (raw.result ?? [])
    .map((j) => {
      const location = [
        j.atsLocation?.city ?? j.location?.city,
        j.atsLocation?.state ?? j.atsLocation?.province ?? j.location?.state,
        j.atsLocation?.country,
      ].filter(Boolean).join(", ");
      const workMode = j.isRemote === true ? "remote" as const : detectWorkMode(location, j.jobOpeningName);
      return {
        id: `bamboohr:${token}:${j.id}`,
        source: "bamboohr" as const,
        token,
        company,
        title: j.jobOpeningName ?? "",
        location,
        workMode,
        remote: workMode === "remote",
        department: j.departmentLabel ?? null,
        postedAt: null, // the list feed carries no dates
        category: categorize(j.jobOpeningName ?? "", j.departmentLabel),
        salary: null,
        applyUrl: safeUrl(`https://${token}.bamboohr.com/careers/${j.id}`),
      };
    })
    .filter((j) => j.applyUrl !== "");
}

// ── Rung-3 vendors ──────────────────────────────────────────────────────────
// Two of these feeds are XML (Personio's official feed, Teamtailor's RSS), so a
// pair of tiny CDATA-aware helpers stands in for a parser dependency. They only
// need to handle the well-formed, machine-generated feeds these vendors emit.

/** All <tag>…</tag> block contents in document order. */
export function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** First <tag> value inside a block, CDATA unwrapped, trimmed; null if absent. */
export function xmlValue(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  const v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  return v || null;
}

interface RecruiteeOffer {
  id: string | number;
  slug?: string | null;
  title?: string | null;
  department?: string | null;
  city?: string | null;
  country?: string | null;
  location?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  on_site?: boolean | null;
  careers_url?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  employment_type_code?: string | null;
  salary?: { min?: string | number | null; max?: string | number | null; type?: string | null; currency?: string | null } | null;
}

export function normalizeRecruitee(raw: { offers?: RecruiteeOffer[] }, company: string, token: string): JobPosting[] {
  return (raw.offers ?? [])
    .map((o) => {
      const location = o.location || [o.city, o.country].filter(Boolean).join(", ");
      const sal = o.salary;
      const salary = sal && sal.min && sal.max
        ? `${sal.currency ? sal.currency + " " : ""}${sal.min} - ${sal.max}${sal.type ? ` ${sal.type}` : ""}`.trim()
        : null;
      // Hybrid first — see the SmartRecruiters note; Recruitee exposes all
      // three booleans and a hybrid offer commonly sets `remote` too.
      const workMode = o.hybrid === true ? "hybrid" as const
        : o.remote === true ? "remote" as const
        : o.on_site === true ? "onsite" as const
        : detectWorkMode(location, o.title);
      return {
        id: `recruitee:${token}:${o.id}`,
        source: "recruitee" as const,
        token,
        company,
        title: o.title ?? "",
        location,
        workMode,
        remote: workMode === "remote",
        department: o.department ?? null,
        postedAt: safeIso(o.published_at ?? o.created_at),
        category: categorize(o.title ?? "", o.department),
        salary,
        // THE CANONICAL HOST, NOT THE EMPLOYER'S VANITY DOMAIN. careers_url is
        // a hostname the employer once configured and can abandon — measured
        // 2026-08-23: 47 vanity hosts NXDOMAIN and 11 more fail TLS, stranding
        // 233 servable postings behind an Apply button that cannot load (one
        // was not even a valid hostname: careers.ferillis, no TLD). The
        // canonical {token}.recruitee.com/o/{slug} — which sat here as the
        // FALLBACK — answered HTTP 200 for all 233 of them. The vendor
        // guarantees the canonical; the vanity host is cosmetics that rots.
        employmentType: normalizeEmploymentType(o.employment_type_code),
        applyUrl: safeUrl(o.slug ? `https://${token}.recruitee.com/o/${o.slug}` : (o.careers_url ?? "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "");
}

/** Personio's official XML feed ({token}.jobs.personio.de/xml). `host` is the
 *  feed host that answered (.de or .com) so Apply lands on the right domain. */
export function normalizePersonio(xml: string, company: string, token: string, host: string): JobPosting[] {
  return xmlBlocks(xml, "position")
    .map((block) => {
      const id = xmlValue(block, "id") ?? "";
      const title = xmlValue(block, "name") ?? "";
      const office = xmlValue(block, "office") ?? "";
      const department = xmlValue(block, "department");
      const schedule = xmlValue(block, "schedule") ?? "";
      // <schedule> is an enum (full-time | part-time | …), NOT a description —
      // the "never infer from prose" rule is intact.
      const workMode = detectWorkMode(office, title, schedule);
      return {
        id: `personio:${token}:${id}`,
        source: "personio" as const,
        token,
        company,
        title,
        location: office,
        workMode,
        remote: workMode === "remote",
        department,
        postedAt: safeIso(xmlValue(block, "createdAt")),
        category: categorize(title, department),
        salary: null, // the feed carries no compensation field
        // <schedule> is full-time | part-time | full-or-part-time; the mapper
        // reads full-or-part-time as full_time (the role CAN be full-time).
        employmentType: normalizeEmploymentType(schedule),
        applyUrl: id ? safeUrl(`https://${token}.${host}/job/${id}`) : "",
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "");
}

interface BreezyPosition {
  id?: string | null;
  friendly_id?: string | null;
  name?: string | null;
  published_date?: string | null;
  creation_date?: string | null;
  location?: { name?: string | null; is_remote?: boolean | null } | null;
  department?: string | null;
  url?: string | null;
}

export function normalizeBreezy(raw: BreezyPosition[], company: string, token: string): JobPosting[] {
  return (Array.isArray(raw) ? raw : [])
    .map((p) => {
      const externalId = p.friendly_id || p.id || "";
      const location = p.location?.name ?? "";
      const workMode = p.location?.is_remote === true ? "remote" as const : detectWorkMode(location, p.name);
      return {
        id: `breezy:${token}:${externalId}`,
        source: "breezy" as const,
        token,
        company,
        title: p.name ?? "",
        location,
        workMode,
        remote: workMode === "remote",
        department: p.department ?? null,
        postedAt: safeIso(p.published_date ?? p.creation_date),
        category: categorize(p.name ?? "", p.department),
        salary: null,
        applyUrl: safeUrl(p.url ?? (externalId ? `https://${token}.breezy.hr/p/${externalId}` : "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `breezy:${token}:`);
}

// ── iCIMS ───────────────────────────────────────────────────────────────────
// iCIMS hosts each employer's modern career site on the employer's OWN domain
// (careers.company.com), and that site's frontend calls a public JSON endpoint:
//   GET https://{careersite-domain}/api/jobs?page={n}&limit=100
// No auth, no cookies, no JS. Each item nests its fields under `data`.
//
// Richest feed of any vendor we ingest: real posted_date (ISO), structured
// city/state/country, employment_type, AND stated salary min/max — the only
// source besides description-mined text that gives us pay directly.
//
// Discovery is two-hop (2026-07-26 census): CDX/CT enumeration finds the
// classic careers-{tenant}.icims.com portal, whose /jobs/search?ss=1&in_iframe=1
// returns a tiny JS redirect naming the modern domain, which is what we store
// as the token. Token = the career-site host itself (dots and all), so the
// fetcher needs no separate mapping.
export interface IcimsJobData {
  req_id?: string | number | null;
  title?: string | null;
  description?: string | null;
  posted_date?: string | null;
  create_date?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  country_code?: string | null;
  full_location?: string | null;
  short_location?: string | null;
  location_type?: string | null;
  category?: string[] | string | null;
  department?: string | null;
  employment_type?: string | null;
  salary_min_value?: number | string | null;
  salary_max_value?: number | string | null;
  salary_value?: number | string | null;
  hiring_organization?: string | null;
  apply_url?: string | null;
  slug?: string | null;
}
export interface IcimsJobItem { data?: IcimsJobData | null }

/** iCIMS stated pay → the board's freeform salary string. Zeros mean "the
 *  feed carries the field but this posting states nothing" — never rendered
 *  as "$0", the same honesty rule the salary miner follows. */
function icimsSalary(d: IcimsJobData): string | null {
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const lo = num(d.salary_min_value), hi = num(d.salary_max_value), one = num(d.salary_value);
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (lo && hi && hi >= lo) return lo === hi ? `$${fmt(lo)}` : `$${fmt(lo)} - $${fmt(hi)}`;
  if (lo) return `$${fmt(lo)}`;
  if (hi) return `$${fmt(hi)}`;
  if (one) return `$${fmt(one)}`;
  return null;
}

export function normalizeIcims(raw: IcimsJobItem[], company: string, token: string): JobPosting[] {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => {
      const d = (item?.data ?? {}) as IcimsJobData;
      const externalId = String(d.req_id ?? d.slug ?? "").trim();
      const location = String(
        d.full_location || d.short_location || [d.city, d.state, d.country].filter(Boolean).join(", ") || "",
      ).trim();
      const dept = typeof d.department === "string" && d.department.trim() ? d.department.trim() : null;
      const cat = Array.isArray(d.category) ? d.category.filter(Boolean).map((c) => String(c).trim()).join(", ")
        : typeof d.category === "string" ? d.category.trim() : "";
      // location_type is the vendor's own structured field; text detection only
      // fills in when the feed doesn't state one (never guessed from prose).
      //
      // This arm used to read location_type with its own substring ladder,
      // which reproduced BOTH defects of the shared detector's old shape: no
      // negation ("Non-Remote" .includes("remote") -> remote, which is how
      // "RN (PRN - Not Remote)" reached the Remote filter) and remote tested
      // BEFORE hybrid, so location_type "Hybrid Remote" read as remote while
      // the identical text in a title read as hybrid. statedWorkMode is the
      // one reader now; "office" survives as an onsite word there.
      const workMode = workModeFrom(d.location_type, location, d.title, cat);
      return {
        id: `icims:${token}:${externalId}`,
        source: "icims" as const,
        token,
        company,
        title: String(d.title ?? "").trim(),
        location,
        workMode,
        remote: workMode === "remote",
        department: dept ?? (cat || null),
        postedAt: safeIso(d.posted_date ?? d.create_date),
        category: categorize(String(d.title ?? ""), dept ?? cat),
        salary: icimsSalary(d),
        // country_code is the FEED's own ISO-2 — better than location-text
        // detection, same treatment Rippling gets.
        country: /^[A-Za-z]{2}$/.test(String(d.country_code ?? "")) ? String(d.country_code).toUpperCase() : null,
        // The feed's apply_url ends in /login — an email-collection wall with
        // NO job content (verified live 2026-07-26: 9/9 sampled). The sibling
        // /job path renders the actual posting; never send a seeker to a
        // data-capture page before they can even read the role.
        // Already modeled for the salary refusal logic; now a filterable field.
        employmentType: normalizeEmploymentType(d.employment_type),
        applyUrl: safeUrl(String(d.apply_url ?? (externalId ? `https://${token}/jobs/${externalId}/job` : "")).replace(/\/login$/, "/job")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}

// ── Rippling ATS ────────────────────────────────────────────────────────────
// Rippling publishes no documented list API; the public board page embeds the
// job list as first-party structured JSON (Next.js __NEXT_DATA__, react-query
// dehydratedState). That's still the vendor's own data channel — user decision
// 2026-07-16 to include it — but it's an implementation detail that can move,
// so the vendor canary watches it and the breaker quarantines on drift.
// List items carry NO posted date and NO description (undated postings stay
// honest-undated; boards are light by nature), but DO carry structured
// country codes — better than location-text detection.
export interface RipplingJobItem {
  id?: string | number;
  name?: string;
  url?: string;
  department?: { name?: string } | null;
  locations?: Array<{
    name?: string;
    country?: string;
    countryCode?: string;
    city?: string;
    workplaceType?: string; // ON_SITE | REMOTE | HYBRID
  }> | null;
}

/** Pull the job-posts page out of a Rippling board page's __NEXT_DATA__.
 *  Returns null when the payload shape isn't recognizable (drift signal —
 *  distinct from a legitimately empty items array). */
export function extractRipplingJobPosts(html: string): { items: RipplingJobItem[]; totalPages: number } | null {
  const m = html.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as {
      props?: { pageProps?: { dehydratedState?: { queries?: Array<{ queryKey?: unknown[]; state?: { data?: { items?: unknown[]; totalPages?: number } } }> } } };
    };
    const dehydrated = data.props?.pageProps?.dehydratedState;
    const queries = dehydrated?.queries ?? [];
    // A BOARD WITH NO OPEN ROLES IS NOT A BROKEN PARSER.
    //
    // Rippling renders a perfectly healthy page for an employer that is not
    // hiring: dehydratedState is present and `queries` is an EMPTY ARRAY,
    // because there was nothing to prefetch. The old code could not tell that
    // from shape drift and returned null for both, so the caller threw
    // "rippling payload shape unrecognized" and the board was published to the
    // operator as a vendor failure.
    //
    // Measured 2026-08-25 over 198 of 1,051 rippling boards: 2 hit this (1%),
    // matching the 6 standing failures in the live failure list. Both
    // whistler-platinum-jobs and elevationcapital return 157KB of valid page
    // with dehydratedState present, queries [], zero occurrences of
    // "job-posts", and the words "No open" in the rendered text. Neither is
    // broken; neither is hiring.
    //
    // The drift signal is KEPT and made sharper: queries present but carrying
    // no job-posts key still returns null, because that is what a real shape
    // change looks like. Only the empty array is read as an honest zero — the
    // same distinction the personio empty-feed fix drew earlier.
    if (dehydrated && queries.length === 0) return { items: [], totalPages: 1 };
    const q = queries.find((x) => Array.isArray(x.queryKey) && x.queryKey[2] === "job-posts");
    if (!q?.state?.data || !Array.isArray(q.state.data.items)) return null;
    return { items: q.state.data.items as RipplingJobItem[], totalPages: Number(q.state.data.totalPages) || 1 };
  } catch {
    return null;
  }
}

export function normalizeRippling(items: RipplingJobItem[], company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const locs = Array.isArray(j.locations) ? j.locations : [];
      const first = locs[0] ?? {};
      const location = [first.name, locs.length > 1 ? `+${locs.length - 1} more` : ""].filter(Boolean).join(" ");
      const cc = typeof first.countryCode === "string" && /^[A-Z]{2}$/.test(first.countryCode) ? first.countryCode : null;
      // Per-location workplaceType read through the shared label reader, so a
      // negated or unexpected spelling cannot invert here either. HYBRID is
      // asked first: a posting with one hybrid site and one remote site is
      // hybrid, matching detectWorkMode's own order.
      // `.some(m => m === …)` and not `.includes("…")`: these are already
      // CLASSIFIED modes, but a substring call on a work-mode word inside a
      // vendor arm is the exact shape of the defect, and the guard that keeps
      // a seventh ladder out bans it outright rather than trying to tell the
      // two apart by eye.
      const siteModes = locs.map((l) => statedWorkMode(l.workplaceType));
      const workMode = siteModes.some((m) => m === "hybrid") ? "hybrid" as const
        : siteModes.some((m) => m === "remote") ? "remote" as const
        : siteModes.length > 0 && siteModes.every((m) => m === "onsite") ? "onsite" as const
        : siteModes.length > 0 && locs.some((l) => typeof l.workplaceType === "string" && stripNegatedRemote(l.workplaceType) !== l.workplaceType)
          ? (detectWorkMode(location, j.name) === "remote" ? null : detectWorkMode(location, j.name))
        : detectWorkMode(location, j.name);
      return {
        id: `rippling:${token}:${j.id ?? ""}`,
        source: "rippling" as const,
        token,
        company,
        title: j.name ?? "",
        location,
        workMode,
        remote: workMode === "remote",
        department: j.department?.name ?? null,
        postedAt: null, // the board payload carries no dates — undated is honest
        category: categorize(j.name ?? "", j.department?.name),
        salary: null,
        country: cc,
        applyUrl: safeUrl(j.url ?? ""),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `rippling:${token}:`);
}

// ── Paylocity ─────────────────────────────────────────────────────────────
// Paylocity publishes no documented list API; the public board page at
// recruiting.paylocity.com/recruiting/jobs/All/{token} embeds the FULL job
// list as first-party JSON in a page-global pageData assignment. A
// Rippling-class source — the vendor's own data channel, but an
// implementation detail that can move, so the extractor's null is a drift
// signal and never an empty board. Live-captured shape 2026-08-30 across
// three boards (24 + 21 + 17 postings): items carry JobId, JobTitle,
// LocationName, a real PublishedDate (ISO with offset), HiringDepartment,
// a structured IsRemote boolean, and a JobLocation whose Country is a
// "USA"-style word, not ISO-2. IndeedRemoteType also rides along but its
// enum is unmeasured (2 on every observed row, remote or not) — only
// IsRemote is trusted, per the trinary-or-nothing work-mode contract.
export interface PaylocityJobItem {
  JobId?: string | number;
  JobTitle?: string;
  LocationName?: string;
  PublishedDate?: string;
  HiringDepartment?: string | null;
  IsInternal?: boolean;
  IsRemote?: boolean;
  JobLocation?: {
    City?: string | null;
    State?: string | null;
    Zip?: string | null;
    Country?: string | null;
  } | null;
}

/** Pull the embedded job list out of a Paylocity board page.
 *  Returns null when the payload isn't recognizable (drift — the caller must
 *  treat the board as FAILED, not empty). A parsed payload whose Jobs array
 *  is empty is an employer not hiring: an honest zero, same distinction the
 *  personio and rippling fixes drew. Jobs ABSENT or non-array stays null,
 *  because that is what a real shape change looks like — a detail page
 *  carries the same page-global assignment with entirely different keys, and
 *  reading it as an empty board would zero a live employer. */
export function extractPaylocityPageData(html: string): { items: PaylocityJobItem[]; moduleTitle: string | null } | null {
  const m = html.match(/window\.pageData\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as { Jobs?: unknown; ModuleTitle?: unknown };
    if (!Array.isArray(data.Jobs)) return null;
    return {
      items: data.Jobs as PaylocityJobItem[],
      // The board's self-chosen display name — census tooling reads it so a
      // token never has to ship with a guessed employer name.
      moduleTitle: typeof data.ModuleTitle === "string" && data.ModuleTitle.trim() ? data.ModuleTitle.trim() : null,
    };
  } catch {
    return null;
  }
}

export function normalizePaylocity(items: PaylocityJobItem[], company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    // The public payload can embed internal-only postings; their Details page
    // sits behind a login wall, and verify-all already refuses to count them —
    // ingest and verify must agree on what a posting is.
    .filter((j) => j.IsInternal !== true)
    .map((j) => {
      const loc = j.JobLocation ?? {};
      const location = String(j.LocationName ?? "").trim() || [loc.City, loc.State].filter(Boolean).join(", ").trim();
      const title = String(j.JobTitle ?? "").trim();
      const dept = typeof j.HiringDepartment === "string" && j.HiringDepartment.trim() ? j.HiringDepartment.trim() : null;
      const externalId = String(j.JobId ?? "").trim();
      // IsRemote is the vendor's structured field; text detection only fills
      // in when the feed doesn't state one (never guessed from prose).
      const workMode = j.IsRemote === true ? "remote" as const : detectWorkMode(location, title, dept);
      const rawCountry = String(loc.Country ?? "").trim();
      return {
        id: `paylocity:${token}:${externalId}`,
        source: "paylocity" as const,
        token,
        company,
        title,
        location,
        workMode,
        remote: workMode === "remote",
        department: dept,
        // The feed states a real publish date; the shared ingest window drops
        // anything older, so no pre-filtering here.
        postedAt: safeIso(j.PublishedDate),
        category: categorize(title, dept),
        // The list payload's Description is a ~110-char teaser, not the JD —
        // storing it would hand salary mining and the fit scan a stub that
        // looks like a document. Null is honest; the detail page carries the
        // full text if a sweep ever wants it.
        salary: null,
        // Country arrives structurally but as a word ("USA"), not ISO-2 — map
        // the stated value, and fall back to text detection over the whole
        // location for anything unrecognized.
        country: /^(?:usa|us|u\.s\.a?\.?|united states(?: of america)?)$/i.test(rawCountry)
          ? "US"
          : /^[A-Za-z]{2}$/.test(rawCountry)
            // The one two-letter word people write that is NOT its ISO code.
            ? (rawCountry.toUpperCase() === "UK" ? "GB" : rawCountry.toUpperCase())
            : detectCountry([location, loc.City, loc.State, rawCountry].filter(Boolean).join(", ")),
        applyUrl: externalId ? `https://recruiting.paylocity.com/recruiting/jobs/Details/${externalId}` : "",
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}

// ── ADP Workforce Now ─────────────────────────────────────────────────────
// The career-center SPA at workforcenow.adp.com is a JS shell, but the JSON it
// renders from is a public unauthenticated endpoint on the same host
// (…/careercenter/public/events/staffing/v1/job-requisitions) — the page's own
// data channel, confirmed by watching the live page's network calls
// 2026-08-31. First-party but undocumented, so the canary/breaker discipline
// applies, same as rippling and paylocity.
//
// Live-measured shape, 2026-08-31, 100 requisitions across four real boards
// (7 + 13 + 82 + 19): every row carries the requisition id the detail
// endpoint takes, a title and a real posting timestamp; a numeric share id
// arrives in the string custom fields on 79/79 external rows and is the value
// the SPA itself appends to a posting's share link; the employer's own salary
// display string sits beside it on 65/79; department strings existed but were EMPTY on
// all 100 (organizationalUnits: empty on all 100 as well), so department ships
// only when a row actually states one. NOWHERE in any payload — list, detail,
// branding config, page shell — does the employer's NAME appear; the catalog
// entry is the only thing that names the board, exactly the oracle situation.
export interface AdpNameCodedField {
  nameCode?: { codeValue?: string };
  stringValue?: string;
  indicatorValue?: boolean;
  codeValue?: string;
  shortName?: string;
}

export interface AdpJobRequisition {
  itemID?: string;
  requisitionTitle?: string;
  postDate?: string;
  workLevelCode?: { shortName?: string };
  customFieldGroup?: {
    stringFields?: AdpNameCodedField[];
    indicatorFields?: AdpNameCodedField[];
    codeFields?: AdpNameCodedField[];
  };
  requisitionLocations?: Array<{
    nameCode?: { shortName?: string };
    address?: {
      cityName?: string;
      countrySubdivisionLevel1?: { codeValue?: string };
      postalCode?: string;
    };
  }>;
}

/** Every custom field arrives as {nameCode:{codeValue}, value} — one finder. */
const adpField = (fields: AdpNameCodedField[] | undefined, code: string): AdpNameCodedField | undefined =>
  (Array.isArray(fields) ? fields : []).find((f) => f?.nameCode?.codeValue === code);

/**
 * A board token is the career-center URL's cid GUID — plus the ccId when the
 * employer runs a non-default career center, because ccId SELECTS the board:
 * measured live 2026-08-31, one cid answered 19 postings on its default center
 * and 1 on its second (ccId 9200080780705_2). Compound form cid~ccId, same
 * separator contract as workday/oracle; a bare cid means the default center.
 */
export function adpBoardParams(token: string): { cid: string; ccId: string } {
  const [cid, ccId] = String(token).split("~");
  return { cid: cid ?? "", ccId: ccId || "19000101_000001" };
}

// The vendor's own salary display string ("22.50 To 26.40 (USD) Hourly",
// "70000.00 To 85000.00 (USD) Annually") — reshaped into the board's idiom
// when it parses, passed through verbatim when the employer typed something
// else. This is the string the SPA itself gates display on, so using it never
// surfaces a range the employer chose not to render; payGradeRange also rides
// the payload but exists on rows whose display string is absent, and mining it
// would publish figures the career site does not show.
const ADP_SALARY_FREQ: Record<string, string> = { hourly: "per hour", annually: "per year", monthly: "per month", weekly: "per week" };
function adpSalary(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d[\d,]*(?:\.\d+)?)\s+To\s+(\d[\d,]*(?:\.\d+)?)\s+\(([A-Za-z]{3})\)\s+(\w+)$/i);
  if (!m) return s;
  const num = (x: string) => {
    const n = Number(x.replace(/,/g, ""));
    if (!Number.isFinite(n)) return x;
    // Whole figures group ("70,000"); fractional ones keep their cents
    // ("22.50"), because an hourly rate with the cents lopped off reads as a
    // different number.
    return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2);
  };
  const freq = ADP_SALARY_FREQ[m[4].toLowerCase()] ?? m[4].toLowerCase();
  return `${m[3].toUpperCase()} ${num(m[1])}–${num(m[2])} ${freq}`;
}

// Country never arrives as a structured field — measured 2026-08-31, zero of
// 67 requisition locations carried a country code on the address — so it is
// read from the tail of the location display string, which on every
// country-bearing sample ends with a two-letter code (usually preceded by a
// two-letter region). Two traps live here: the two-letter word people write
// for Britain that is NOT its ISO code (normalizePaylocity paid for that one
// already), and the tail of a countryless city-plus-state string being a US
// state that IS some other country's ISO code — California/Canada is only the
// loudest of a dozen such collisions. A state-shaped tail is read as a country
// only when it follows another two-letter code (the measured three-segment
// shape); otherwise the string falls to detectCountry, whose state patterns
// read it as US.
const US_STATE_TAIL = /^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)$/;
function adpCountry(locationText: string): string | null {
  const segs = locationText.split(",").map((x) => x.trim()).filter(Boolean);
  const tail = (segs[segs.length - 1] ?? "").toUpperCase();
  const prev = segs[segs.length - 2] ?? "";
  if (!/^[A-Z]{2}$/.test(tail)) return detectCountry(locationText);
  if (tail === "UK") return "GB";
  if (US_STATE_TAIL.test(tail) && !/^[A-Za-z]{2}$/.test(prev)) return detectCountry(locationText);
  return tail;
}

export function normalizeAdp(items: AdpJobRequisition[], company: string, token: string): JobPosting[] {
  const { cid, ccId } = adpBoardParams(token);
  const boardUrl = `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${cid}&ccId=${ccId}&lang=en_US`;
  return (Array.isArray(items) ? items : [])
    // The public payload marks internal-only postings with an indicator; their
    // apply flow sits behind the employee login. Same line paylocity drew:
    // ingest and verify must agree on what a posting is, and neither counts
    // these.
    .filter((j) => adpField(j.customFieldGroup?.indicatorFields, "InternalPostingFlag")?.indicatorValue !== true)
    .map((j) => {
      const title = String(j.requisitionTitle ?? "").trim();
      const reqId = String(j.itemID ?? "").trim();
      const locs = Array.isArray(j.requisitionLocations) ? j.requisitionLocations : [];
      const first = locs[0] ?? {};
      const firstText = String(first.nameCode?.shortName ?? "").trim() ||
        [first.address?.cityName, first.address?.countrySubdivisionLevel1?.codeValue].filter(Boolean).join(", ").trim();
      const location = [firstText, locs.length > 1 ? `+${locs.length - 1} more` : ""].filter(Boolean).join(" ");
      const dept = String(adpField(j.customFieldGroup?.stringFields, "HomeDepartment")?.stringValue ?? "").trim() || null;
      // The numeric share id the SPA's own URL builder appends to the
      // career-center link — confirmed against the app bundle and against
      // Google-indexed posting URLs. Distinct from the API's requisition id,
      // which the posting id and the detail sweep use. A row without one still
      // links to the board page, where the posting is one click away.
      const shareId = String(adpField(j.customFieldGroup?.stringFields, "ExternalJobID")?.stringValue ?? "").trim();
      // workLevelCode is client-authored ("Part-Time Hourly", "Full Time
      // Employee", "Temporary/seasonal" — all measured live); pay-basis and
      // filler words are stripped so the shared mapper sees the employment
      // kind, and anything it still doesn't recognize stays null.
      const employmentType = normalizeEmploymentType(
        String(j.workLevelCode?.shortName ?? "").toLowerCase().split("/")[0].replace(/\b(hourly|salaried|salary|employee)\b/g, " ").trim(),
      );
      // No structured work-mode field anywhere in the measured payloads —
      // text detection or nothing, per the trinary-or-nothing contract.
      const workMode = detectWorkMode(location, title, dept);
      return {
        id: `adp:${token}:${reqId}`,
        source: "adp" as const,
        token,
        company,
        title,
        location,
        workMode,
        remote: workMode === "remote",
        department: dept,
        // A real ISO timestamp with offset; the shared ingest window does the
        // age filtering, the adapter does none of its own.
        postedAt: safeIso(j.postDate),
        category: categorize(title, dept),
        salary: adpSalary(adpField(j.customFieldGroup?.stringFields, "SalaryRange")?.stringValue),
        country: adpCountry(firstText),
        employmentType,
        applyUrl: shareId ? `${boardUrl}&jobId=${shareId}` : boardUrl,
      };
    })
    .filter((j) => j.title !== "" && !j.id.endsWith(":"));
}

// ── UKG Pro Recruiting ────────────────────────────────────────────────────
//
// The candidate portal's own list endpoint, unauthenticated. Verified live
// 2026-09-01 against Sub-Zero Group: POST .../JobBoardView/LoadSearchResults
// answers { opportunities[], totalCount, locations } with real ISO PostedDate
// values (the sampled board's newest was that morning).
//
// TOKEN IS COMPOUND — `pod~TENANT~boardGuid` — because none of the three parts
// is derivable from the others. UKG runs several recruiting pods and a tenant
// lives on exactly one of them (recruiting vs recruiting2), and the board GUID
// is not guessable: a fabricated one answers 404, which is how this shape was
// confirmed rather than assumed. The census reads all three from the crawled
// URL, so nothing has to be resolved later.
export interface UkgOpportunity {
  Id?: string;
  Title?: string;
  PostedDate?: string;
  RequisitionNumber?: string;
  JobCategoryName?: string;
  FullTime?: boolean;
  BriefDescription?: string;
  Locations?: Array<{
    LocalizedName?: string | null;
    Address?: {
      City?: string | null;
      State?: { Code?: string | null; Name?: string | null } | null;
      Country?: { Code?: string | null; Name?: string | null } | null;
    } | null;
  }> | null;
}

/** `pod~TENANT~guid` -> the three parts, or null when the token is malformed. */
export function ukgBoardParams(token: string): { pod: string; tenant: string; board: string } | null {
  const [pod, tenant, board] = String(token ?? "").split("~");
  if (!pod || !tenant || !board) return null;
  // The pod is part of the hostname; anything but the known shapes is a
  // malformed token, not a new pod to trust blindly.
  if (!/^recruiting[0-9]*$/.test(pod)) return null;
  return { pod, tenant, board };
}

/**
 * Country arrives as ISO-3166 ALPHA-3 ("USA"), and the column is alpha-2.
 * Passing it through would store a code no filter matches — the same shape as
 * the paylocity "USA" trap, one letter longer.
 */
const UKG_ALPHA3: Record<string, string> = {
  USA: "US", CAN: "CA", GBR: "GB", IRL: "IE", AUS: "AU", NZL: "NZ", IND: "IN",
  DEU: "DE", FRA: "FR", ESP: "ES", ITA: "IT", NLD: "NL", BEL: "BE", CHE: "CH",
  AUT: "AT", SWE: "SE", NOR: "NO", DNK: "DK", FIN: "FI", POL: "PL", PRT: "PT",
  MEX: "MX", BRA: "BR", JPN: "JP", CHN: "CN", SGP: "SG", ZAF: "ZA", ARE: "AE",
};

export function normalizeUkg(items: UkgOpportunity[], company: string, token: string): JobPosting[] {
  const parts = ukgBoardParams(token);
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const loc = (j.Locations ?? [])[0] ?? {};
      const addr = loc.Address ?? {};
      const city = String(addr.City ?? "").trim();
      const state = String(addr.State?.Code ?? "").trim();
      const location = [city, state].filter(Boolean).join(", ") || String(loc.LocalizedName ?? "").trim();
      const title = String(j.Title ?? "").trim();
      const externalId = String(j.Id ?? "").trim();
      const dept = typeof j.JobCategoryName === "string" && j.JobCategoryName.trim() ? j.JobCategoryName.trim() : null;
      const raw3 = String(addr.Country?.Code ?? "").trim().toUpperCase();
      const country = UKG_ALPHA3[raw3]
        ?? (/^[A-Z]{2}$/.test(raw3) ? raw3 : detectCountry([location, city, state, String(addr.Country?.Name ?? "")].filter(Boolean).join(", ")));
      const workMode = detectWorkMode(location, title, dept);
      return {
        id: `ukg:${token}:${externalId}`,
        source: "ukg" as const,
        token,
        company,
        title,
        location,
        // The list states no remote flag of its own, so work mode is inferred
        // from text exactly as it is for every other vendor that stays silent.
        workMode,
        remote: workMode === "remote",
        department: dept,
        postedAt: safeIso(j.PostedDate),
        category: categorize(title, dept),
        // BriefDescription is a summary the list ships for free; the full JD
        // and the structured pay live on the detail page, which the
        // description sweep reads. Storing the summary here would leave the
        // sweep nothing to fill, so it is deliberately not stored.
        salary: null,
        country,
        employmentType: j.FullTime === true ? ("full_time" as const) : null,
        applyUrl: parts && externalId
          ? `https://${parts.pod}.ultipro.com/${parts.tenant}/JobBoard/${parts.board}/OpportunityDetail?opportunityId=${externalId}`
          : "",
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}

// ── Pinpoint ──────────────────────────────────────────────────────────────
// Documented public first-party JSON: https://{token}.pinpointhq.com/postings.json
// → { data: [...] }. Structured compensation (min/max/currency/frequency,
// gated by compensation_visible) and a workplace_type enum; NO posted date —
// undated is honest, like BambooHR. Live-captured shape 2026-07-17
// (agencyanalytics).
export interface PinpointPosting {
  id?: string | number;
  title?: string;
  url?: string;
  workplace_type?: string; // "onsite" | "hybrid" | "remote"
  employment_type_text?: string;
  compensation_visible?: boolean;
  compensation_minimum?: number | string | null;
  compensation_maximum?: number | string | null;
  compensation_currency?: string | null;
  compensation_frequency?: string | null; // "annually" | "monthly" | "hourly"
  location?: { name?: string; city?: string; province?: string; country?: string } | null;
  job?: { department?: { name?: string } | null } | null;
}

const PINPOINT_FREQ: Record<string, string> = { annually: "per year", monthly: "per month", hourly: "per hour" };
function pinpointSalary(j: PinpointPosting): string | null {
  if (!j.compensation_visible) return null;
  const min = Number(j.compensation_minimum);
  const max = Number(j.compensation_maximum);
  if (!Number.isFinite(min) || min <= 0) return null;
  const cur = typeof j.compensation_currency === "string" && /^[A-Z]{3}$/.test(j.compensation_currency) ? j.compensation_currency : "";
  const rawFreq = String(j.compensation_frequency ?? "");
  const freq = PINPOINT_FREQ[rawFreq] ?? (rawFreq ? `per ${rawFreq}` : "");
  // A small figure with NO stated frequency ("31.25") is almost certainly an
  // hourly rate we can't prove — displaying it bare would be ambiguous and
  // the salary parser could mis-annualize it. When in doubt, leave it out.
  if (!freq && min < 1_000) return null;
  const range = Number.isFinite(max) && max > min ? `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}` : min.toLocaleString("en-US");
  return [cur, range, freq].filter(Boolean).join(" ") || null;
}

export function normalizePinpoint(items: PinpointPosting[], company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const loc = j.location ?? {};
      const location = String(loc.name || [loc.city, loc.province].filter(Boolean).join(", ") || "").trim();
      // Detect from ALL location fields — the display name alone often lacks
      // the province/country ("Hybrid - Toronto").
      const locFull = [loc.name, loc.city, loc.province, loc.country].filter(Boolean).join(", ");
      const title = String(j.title ?? "").trim();
      const dept = j.job?.department?.name ?? null;
      const workMode = workModeFrom(j.workplace_type, location, title);
      return {
        id: `pinpoint:${token}:${j.id ?? ""}`,
        source: "pinpoint" as const,
        token,
        company,
        title,
        location,
        workMode,
        remote: workMode === "remote",
        department: dept,
        postedAt: null, // no date in the payload — undated is honest
        category: categorize(title, dept),
        salary: pinpointSalary(j),
        employmentType: normalizeEmploymentType(j.employment_type_text),
        country: detectCountry(locFull),
        applyUrl: safeUrl(String(j.url ?? "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `pinpoint:${token}:`);
}

// ── Workday CXS ───────────────────────────────────────────────────────────
// Workday hosts a large share of enterprise employers. Each tenant's own
// career site is powered by a public first-party JSON endpoint
// (POST /wday/cxs/{tenant}/{site}/jobs) — the same data the tenant serves its
// own applicants, no auth, no scraping. Undocumented (a Rippling-class source:
// vendor canary + breaker watch the shape). Token is a compound
// `tenant~dc~site` (three pieces the URL needs). The LIST payload carries only
// a RELATIVE posting age ("Posted 5 Days Ago").
//
// CORRECTED 2026-07-28. This header used to say we "never store that as a
// date" and that "kept postings are honest-undated (like BambooHR)". Both
// stopped being true one day after it was written, and the header was never
// updated — the behaviour is inverted 50-odd lines below. Workday postings get
// a date by TWO paths:
//   1. the relative list age, converted to an absolute day-precision date
//      (fetch time − N days, ±1d) when N <= 30. "30+ Days Ago" is unbounded, so
//      it stays null AND is authority to drop the posting.
//   2. an EXACT startDate from the CXS detail payload, which for workday
//      REPLACES the converted value (see the precedence in index.ts).
// Only the "30+ Days Ago" tail is genuinely undated. BambooHR is a different
// case entirely: its list feed states no date at all, at any age.
//
// This exact drift is the claim-drift failure mode — a header like this is what
// a methodology page, a coverage table or llms.txt gets written from.
export interface WorkdayListItem {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

/** Relative Workday age → days, or null when unparseable. "Posted Today"=0,
 *  "Posted Yesterday"=1, "Posted N Days Ago"=N, "Posted 30+ Days Ago"=31. */
// THE 30-DAY CAP WAS ENFORCED IN ENGLISH ONLY.
//
// Every branch of this parser used to require the literal word "posted", and
// Workday localises postedOn per tenant. So a Spanish tenant saying
// "Publicado hace más de 30 días" — the employer stating, in its own feed,
// that the job is past our cap — parsed as null, which means undated, which
// means kept and served with no age under a badge reading "30-day freshness
// cap".
//
// Measured 2026-08-24: 23,944 servable Workday rows carry no date across 203
// boards. Probing the top 90 of those boards (21,206 rows, 88.6%) split them
// cleanly: 60 boards (13,910 rows) genuinely have the field disabled and are
// honestly undated, while 30 boards (7,296 rows) state an age we were
// throwing away. A full census of one of them, barcelo~wd3 (502 rows, 100%
// undated, 100% servable), found 416 of 522 feed items reading "Publicado
// hace más de 30 días" — 79.7%. Pooled across 22 localized boards, 33.1% of
// sampled items state an age past 30 days.
//
// So the parser stops looking for an English verb and looks for what every
// locale actually carries: a NUMBER, a DAY WORD, and optionally a
// MORE-THAN marker. Anything without a day word returns null — one tenant
// (tutorperini~wd12) puts a location in this field, "Menlo Park, CA", and a
// parser that guessed at bare digits would date postings from street
// numbers.
const WD_TODAY = /\b(today|hoy|aujourd'?hui|heute|vandaag|hoje|oggi|i dag|idag|今天|本日)\b|ausgeschrieben heute/i;
const WD_YESTERDAY = /\b(yesterday|ayer|hier|gestern|gisteren|ontem|ieri|i går|igår|昨天)\b/i;
// Day nouns across the locales Workday serves. Chinese/Japanese carry no word
// boundaries, so they are matched as bare characters.
const WD_DAY_WORD = /\b(days?|d[ií]as?|jours?|tagen?|tage|dagen?|dagar?|giorni?|giorno|päivää?)\b|[天日]/i;
// "more than N" in the same locales, plus Workday's own "N+" shorthand and
// the trailing "or more" forms (fr "ou plus", de "oder mehr", zh "以上").
const WD_MORE_THAN = /\+|\bm[áa]s de\b|\bplus de\b|\bmehr als\b|\bmeer dan\b|\bmais de\b|\bpi[uù] di\b|\bover\b|\bou plus\b|\boder mehr\b|\bo m[áa]s\b|\bof meer\b|\bou mais\b|超過|超过|以上/i;

export function workdayPostedDays(postedOn: string | null | undefined): number | null {
  if (!postedOn) return null;
  const s = String(postedOn).toLowerCase();
  if (WD_TODAY.test(s)) return 0;
  if (WD_YESTERDAY.test(s)) return 1;
  // A day word is required before any number is believed — see the location
  // tenant above.
  if (!WD_DAY_WORD.test(s)) return null;
  const num = s.match(/(\d{1,4})/);
  if (!num) return null;
  const n = Number(num[1]);
  if (!Number.isFinite(n) || n < 0 || n > 3650) return null;
  // "30+" and "more than 30" both mean strictly more than 30, so they must
  // land past the cap rather than exactly on it.
  return WD_MORE_THAN.test(s) ? n + 1 : n;
}

export function normalizeWorkday(items: WorkdayListItem[], company: string, token: string): JobPosting[] {
  // token = tenant~dc~site
  const [tenant, dc, site] = token.split("~");
  if (!tenant || !dc || !site) return [];
  // ONE CLOCK READING FOR THE WHOLE FETCH, and it is not a micro-optimisation.
  //
  // Workday states an age in days, so every row reading "Posted 3 Days Ago"
  // is the SAME stated date. Calling Date.now() inside the map gave each of
  // them a timestamp a few milliseconds apart, which invented an ordering the
  // vendor never expressed — and that ordering silently disabled the
  // employer-spread weave downstream, which may only permute rows sharing an
  // effective_posted (crossing that boundary would claim a recency the row
  // does not have). With every tie group reduced to one row, the weave had
  // nothing to interleave and a page could fill with one employer: measured
  // 2026-08-24, runs of 12-14 consecutive rows from cigna and centene under a
  // caption promising "spread across employers so one company can't fill the
  // page".
  //
  // Sharing one reading restores the tie groups, which is also simply true:
  // these rows are equally recent to the precision the employer published.
  const fetchedAt = Date.now();
  const base = `https://${tenant}.${dc}.myworkdayjobs.com/en-US/${site}`;
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const path = String(j.externalPath ?? "");
      // Requisition id: the `_JR…` suffix on the path, else the first bulletField.
      const reqId = path.split("_").pop() || (Array.isArray(j.bulletFields) ? j.bulletFields[0] : "") || "";
      const loc = String(j.locationsText ?? "").trim();
      // "2 Locations" is a multi-site placeholder, not a place — keep it as
      // display text but it won't resolve to a country (honest).
      const days = workdayPostedDays(j.postedOn);
      const stale = days !== null && days > 30; // Workday says it's past our cap
      // The live inversion of 2026-09-09 came through here: the title
      // "Application Analyst II-Full Time- Days - Cupid/Radiant- NON-REMOTE"
      // has a word boundary at the hyphen, so the old bare \bremote\b matched.
      const workMode = detectWorkMode(loc, String(j.title ?? ""));
      return {
        id: `workday:${token}:${reqId}`,
        source: "workday" as const,
        token,
        company,
        title: String(j.title ?? "").trim(),
        location: loc,
        workMode,
        remote: workMode === "remote",
        department: null,
        // Workday's list states a relative age ("Posted 3 Days Ago") — that IS
        // the company's stated date, at day precision. Convert to absolute
        // (fetch time − N days, ±1d) so these postings carry provenance and
        // participate in date filters and the stated-date medians. "30+ Days
        // Ago" is unbounded — never dated, dropped via _stale.
        // DATED EVEN WHEN PAST THE CAP, and that is the point. A row dropped
        // for being stale used to be stripped inside this normalizer, so the
        // ingest diff never saw it — an ALREADY-STORED posting simply vanished
        // from the feed, which the absence machinery reads as the employer
        // taking it down, and (its posted_at being null) logs to the closure
        // log as a real takedown. The employer took nothing down; we aged it
        // out. Carrying the date lets the shared ingest freshness filter claim
        // it as an age-out instead, which is both true and already handled.
        //
        // For a "30+ days" bucket the exact date is unknowable, so this is a
        // LOWER BOUND (31 days), never a precise claim — and the row is
        // dropped on that basis, so no reader ever sees the figure.
        postedAt: days !== null ? new Date(fetchedAt - days * 86_400_000).toISOString() : null,
        category: categorize(String(j.title ?? ""), null),
        salary: null,
        country: detectCountry(loc),
        applyUrl: safeUrl(path ? `${base}${path}` : ""),
        _stale: stale, // consumed + stripped by the fetcher's freshness filter
      } as JobPosting & { _stale?: boolean };
    })
    // _stale is no longer filtered here: the shared ingest path applies the
    // freshness cap to every vendor uniformly (isDatedBefore -> agedOutIds),
    // and routing Workday through it is what keeps an aged-out posting out of
    // the closure log. The flag stays on the object for callers that want it.
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `workday:${token}:`)
    .map(({ _stale: _drop, ...j }) => j as JobPosting);
}

// ── Oracle Recruiting Cloud (Oracle Fusion HCM) ───────────────────────────
// Large enterprises that run Oracle Fusion HCM publish their careers site off a
// first-party public REST API — the same data the tenant serves its own
// applicants, no auth, no scraping:
//   GET /hcmRestApi/resources/latest/recruitingCEJobRequisitions
//       ?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=CX_1,limit=N,offset=M
// Token is a compound `tenant~region~site` (the three pieces the host and
// finder need); the host is {tenant}.fa.{region}.oraclecloud.com.
//
// Census note (2026-07-24): identity is NOT in this feed — the tenant is an
// opaque 4-letter code and only ~41% of tenants name themselves anywhere. So
// ORC boards are added ONLY as hand-verified sources.ts entries whose display
// name was confirmed against that tenant's own postings; there is no automatic
// discovery path. One tenant (eubt.fa.us6) serves 78k system-generated template
// requisitions — never add a tenant without reading its titles first.
export interface OracleReq {
  Id?: number | string;
  Title?: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  WorkplaceTypeCode?: string;
  JobFamily?: string;
  ShortDescriptionStr?: string;
}

export function normalizeOracle(items: OracleReq[], company: string, token: string): JobPosting[] {
  const [tenant, region, site] = token.split("~");
  if (!tenant || !region || !site) return [];
  const base = `https://${tenant}.fa.${region}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/${site}`;
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const title = String(j.Title ?? "").trim();
      const location = String(j.PrimaryLocation ?? "").trim();
      const id = String(j.Id ?? "").trim();
      // PostedDate is a plain YYYY-MM-DD the employer stated — keep it as a
      // real date (unlike Workday's relative "Posted 3 Days Ago").
      const posted = /^\d{4}-\d{2}-\d{2}/.test(String(j.PostedDate ?? ""))
        ? new Date(`${String(j.PostedDate).slice(0, 10)}T00:00:00Z`).toISOString()
        : null;
      const workMode = workModeFrom(j.WorkplaceTypeCode, location, title);
      const dept = j.JobFamily ? String(j.JobFamily).trim() || null : null;
      return {
        id: `oracle:${token}:${id}`,
        source: "oracle" as const,
        token,
        company,
        title,
        location,
        workMode,
        remote: workMode === "remote",
        department: dept,
        postedAt: posted,
        category: categorize(title, dept),
        salary: null, // ORC exposes no structured compensation on the list payload
        // PrimaryLocationCountry is a 2-letter ISO code straight from the
        // employer — trust it over parsing the free-text location.
        country: (typeof j.PrimaryLocationCountry === "string" && /^[A-Za-z]{2}$/.test(j.PrimaryLocationCountry))
          ? j.PrimaryLocationCountry.toUpperCase()
          : detectCountry(location),
        applyUrl: safeUrl(id ? `${base}/job/${id}` : ""),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `oracle:${token}:`);
}

/** Teamtailor career-site RSS ({token}.teamtailor.com/jobs.rss).
 *
 *  THE COMMENT THAT USED TO BE HERE SAID THE FEED IS "title/link/pubDate only —
 *  location isn't structured". That was wrong, and it cost every Teamtailor
 *  posting its place in three filters.
 *
 *  The feed's own root element declares xmlns:tt="https://teamtailor.com/locations".
 *  Measured on capiosverigeab, 100 items, 2026-08-25:
 *
 *    tt:city        100/100 populated   (Stockholm 22, Göteborg 10, ...)
 *    tt:country     100/100             (Sweden)
 *    tt:department   98/100             (Sjuksköterska 35, Läkare 21, ...)
 *    remoteStatus   100/100             (none 80, hybrid 13, onsite 5, temporary 1)
 *
 *  and the board was storing location "" for 10,858 of 10,858 servable
 *  Teamtailor rows — the entire vendor, invisible to the location filter, and
 *  to the country filter downstream of it, and to department.
 *
 *  remoteStatus is read CONSERVATIVELY. Teamtailor's vocabulary maps "hybrid"
 *  and "fully" cleanly, but "none" is 80% of this sample and means "no remote
 *  status" as readily as it means onsite — and "onsite" exists separately in
 *  the same feed, which is the tell. Claiming onsite for 80% of a vendor on
 *  that inference is exactly the kind of invented field this board does not
 *  publish, so "none" and "temporary" fall through to title detection and stay
 *  null when the title says nothing.
 *
 *  External id = the numeric slug prefix. */
export function normalizeTeamtailor(rss: string, company: string, token: string): JobPosting[] {
  return xmlBlocks(rss, "item")
    .map((item) => {
      const title = xmlValue(item, "title") ?? "";
      const link = xmlValue(item, "link") ?? "";
      const idMatch = link.match(/\/jobs\/(\d+)/);
      const externalId = idMatch ? idMatch[1] : "";
      // City first, then country — the same "Place, Country" shape every other
      // vendor produces, so detectCountry() downstream resolves it with no
      // vendor-specific branch. Either half alone is still worth storing.
      const city = xmlValue(item, "tt:city");
      const country = xmlValue(item, "tt:country");
      const location = [city, country].filter(Boolean).join(", ");
      // Teamtailor's own vocabulary, matched WHOLE (never by substring), so
      // there is no negation surface here: "fully" is its word for remote and
      // means nothing to the shared reader. "none"/"temporary" stay null — see
      // the sample note above. Anything outside the vocabulary falls through
      // to the one shared label reader rather than a second ladder.
      const status = (xmlValue(item, "remoteStatus") ?? "").toLowerCase().trim();
      const statedMode = status === "hybrid" ? "hybrid" as const
        : status === "fully" ? "remote" as const
        : status === "onsite" ? "onsite" as const
        : status === "none" || status === "temporary" ? null
        : statedWorkMode(status);
      const workMode = statedMode ?? detectWorkMode(title, location);
      return {
        id: `teamtailor:${token}:${externalId}`,
        source: "teamtailor" as const,
        token,
        company,
        title,
        location,
        workMode,
        remote: workMode === "remote",
        department: xmlValue(item, "tt:department"),
        postedAt: safeIso(xmlValue(item, "pubDate")),
        category: categorize(title, null),
        salary: null,
        applyUrl: safeUrl(link),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}

export interface JobFilter {
  q?: string;
  location?: string;
  remote?: boolean;
  category?: string;
  /** Board tokens to include; empty/undefined = all. */
  companies?: string[];
}

// Multi-term AND across title+company+department; location is its own field
// so "engineer berlin" in q doesn't silently return nothing.
export function filterJobs(jobs: JobPosting[], f: JobFilter): JobPosting[] {
  const terms = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const loc = (f.location ?? "").toLowerCase().trim();
  const companies = f.companies?.length ? new Set(f.companies) : null;
  return jobs.filter((j) => {
    if (companies && !companies.has(j.token)) return false;
    if (f.category && j.category !== f.category) return false;
    if (f.remote && !j.remote) return false;
    if (loc && !j.location.toLowerCase().includes(loc)) return false;
    if (terms.length) {
      const hay = `${j.title} ${j.company} ${j.department ?? ""}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

/** Newest first; postings without a date sink to the end. */
export function sortJobs(jobs: JobPosting[]): JobPosting[] {
  return [...jobs].sort((a, b) => {
    if (a.postedAt && b.postedAt) return b.postedAt.localeCompare(a.postedAt);
    if (a.postedAt) return -1;
    if (b.postedAt) return 1;
    return a.title.localeCompare(b.title);
  });
}

/** USAJOBS — the U.S. federal government's official job API.
 *
 *  A SINGLE-SOURCE VENDOR, unlike every other adapter here: one national feed
 *  rather than per-employer tenants, so `token` is the fixed string "usajobs"
 *  and the hiring agency travels in each posting's own fields. That makes the
 *  displayed company the AGENCY (Veterans Affairs, Forest Service), not
 *  "USAJOBS" — a visitor is applying to the agency, and the board's employer
 *  facet would otherwise show one 15,000-job blob called "USAJOBS".
 *
 *  Provenance is the cleanest on the board: PublicationStartDate is the
 *  government's own stated publication date, and ApplyURI points at the
 *  official posting. Salary is structured and honest (federal ranges are
 *  published by law), so it is read rather than left null.
 *
 *  NOT AGENT-SENDABLE: federal applications run through USAJOBS accounts and
 *  agency assessments. The board must never badge these as agent-ready.
 */
interface UsajobsRemuneration { MinimumRange?: unknown; MaximumRange?: unknown }
interface UsajobsDescriptor {
  PositionID?: unknown; PositionTitle?: unknown; OrganizationName?: unknown; DepartmentName?: unknown;
  PositionLocation?: Array<{ LocationName?: unknown }>; PositionLocationDisplay?: unknown;
  RemoteIndicator?: unknown; TeleworkEligible?: unknown; PublicationStartDate?: unknown;
  PositionRemuneration?: UsajobsRemuneration[]; JobCategory?: Array<{ Name?: unknown }>;
  PositionSchedule?: Array<{ Name?: unknown }>;
  ApplyURI?: unknown[]; PositionURI?: unknown;
}
interface UsajobsItem { MatchedObjectId?: unknown; MatchedObjectDescriptor?: UsajobsDescriptor }

export function normalizeUsajobs(items: UsajobsItem[], _company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    .map((wrap) => {
      const d = (wrap?.MatchedObjectDescriptor ?? {}) as UsajobsDescriptor;
      const externalId = String(wrap?.MatchedObjectId ?? d.PositionID ?? "").trim();
      const title = String(d.PositionTitle ?? "").trim();
      // The agency IS the employer here; OrganizationName is the parent
      // department, DepartmentName the sub-agency. Prefer the specific one.
      const agency = String(d.OrganizationName ?? d.DepartmentName ?? "").trim();
      const loc = Array.isArray(d.PositionLocation) && d.PositionLocation.length
        ? String(d.PositionLocation[0]?.LocationName ?? "").trim()
        : String(d.PositionLocationDisplay ?? "").trim();
      // Federal remote/telework is stated structurally; text detection only
      // fills the gap, never overrides the government's own field.
      const stated = d.RemoteIndicator === true ? "remote" as const
        : String(d.TeleworkEligible ?? "").toLowerCase() === "true" ? "hybrid" as const
        : null;
      const workMode = stated ?? detectWorkMode(loc, title);
      const posted = safeIso(d.PublicationStartDate);
      const pay = Array.isArray(d.PositionRemuneration) ? d.PositionRemuneration[0] : null;
      const min = Number(pay?.MinimumRange) || 0;
      const max = Number(pay?.MaximumRange) || 0;
      const salary = min > 0 && max > 0
        ? `$${Math.round(min).toLocaleString("en-US")} - $${Math.round(max).toLocaleString("en-US")}`
        : null;
      return {
        id: `usajobs:${token}:${externalId}`,
        source: "usajobs" as const,
        token,
        company: agency || "U.S. Federal Government",
        title,
        location: loc,
        workMode,
        remote: workMode === "remote",
        department: String(d.JobCategory?.[0]?.Name ?? "").trim() || null,
        postedAt: posted,
        category: categorize(title, String(d.JobCategory?.[0]?.Name ?? "")),
        salary,
        // PositionSchedule Name: "Full-time"/"Part-time"/"Intermittent" etc.
        employmentType: normalizeEmploymentType(String(d.PositionSchedule?.[0]?.Name ?? "")),
        // Federal postings are US by definition; the feed also states it.
        country: "US",
        applyUrl: safeUrl(String(d.ApplyURI?.[0] ?? d.PositionURI ?? "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}
