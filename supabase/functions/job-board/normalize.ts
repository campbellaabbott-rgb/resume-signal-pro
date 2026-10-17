// Rationale: docs/job-board-index-notes.md#n958-import-type-jobsourcekind-from-sources-t

import type { JobSourceKind } from "./sources.ts";
import { categorize, type JobCategory } from "./categories.ts";
// Rationale: docs/job-board-index-notes.md#n959-import-load_dependent_periods-parsesalar
import { LOAD_DEPENDENT_PERIODS, parseSalaryStructured } from "../_shared/salary-extract.ts";

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
  // Rationale: docs/job-board-index-notes.md#n1214-employmenttype-employmenttype-null
  employmentType?: EmploymentType | null;
  // Rationale: docs/job-board-index-notes.md#n1215-employmenttypetext-string-null
  employmentTypeText?: string | null;
}

export type EmploymentType = "full_time" | "part_time" | "contract" | "temporary" | "internship";

// Rationale: docs/job-board-index-notes.md#n1216-export-function-normalizeemploymenttype
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

// Rationale: docs/job-board-index-notes.md#n960-const-safeurl-u-unknown-string
const safeUrl = (u: unknown): string => {
  if (typeof u !== "string") return "";
  if (/^https:\/\//i.test(u)) return u;
  if (/^http:\/\//i.test(u)) return "https://" + u.slice(7);
  return "";
};

// Rationale: docs/job-board-index-notes.md#n961-export-const-posted_at_garbage_floor_ms
export const POSTED_AT_GARBAGE_FLOOR_MS = Date.parse("2010-01-01T00:00:00Z");

// Rationale: docs/job-board-index-notes.md#n962-export-function-sanepostedat-iso-string
export function sanePostedAt(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso || typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (t > now + 2 * 86_400_000) return null;      // future beyond clock-skew grace
  // Rationale: docs/job-board-index-notes.md#n963-if-t-now-return-new-date
  if (t > now) return new Date(now).toISOString();
  if (t < POSTED_AT_GARBAGE_FLOOR_MS) return null; // epoch-zero / typo junk
  return iso;
}

// Rationale: docs/job-board-index-notes.md#n964-export-function-normalizeclosetitle-titl
export function normalizeCloseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[([{][^)\]}]*\d[^)\]}]*[)\]}]/g, " ")          // (R-48213), [Req 10422]
    .replace(/\s*[-–—#·|]\s*(?:req|job|id|jr)?[\s#:-]*\d{3,}\s*$/i, " ") // trailing "- 10422" / "#10422"
    .replace(/\s+/g, " ")
    .trim();
}

// Rationale: docs/job-board-index-notes.md#n965-export-function-safeiso-value-unknown-st
export function safeIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Rationale: docs/job-board-index-notes.md#n966-export-function-isdatedbefore-sanitizedp
export function isDatedBefore(sanitizedPostedAt: string | null, cutoffMs: number): boolean {
  return sanitizedPostedAt !== null && Date.parse(sanitizedPostedAt) < cutoffMs;
}

// Rationale: docs/job-board-index-notes.md#n967-const-unescapeentities-s-string
const unescapeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    // Rationale: docs/job-board-index-notes.md#n968-replace-x-a-f-gi-_
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const c = parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; })
    .replace(/&#(\d+);/g, (_, d) => { const c = parseInt(d, 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; })
    .replace(/&nbsp;/g, " ")
    // Rationale: docs/job-board-index-notes.md#n969-replace-mdash-gi-u2014
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

// Rationale: docs/job-board-index-notes.md#n970-const-p_negated_remote-new-regexp
const P_NEGATED_REMOTE = new RegExp(
  [
    // EN — "non-remote", "non remote", "nonremote", "not remote", "no remote"
    "\\b(?:non|not|no)[-\\s]?remote\\b",
    // EN — "not a remote role", "not fully remote", "not eligible for remote"
    "\\bnot\\s+(?:a\\s+|an\\s+|fully\\s+)?remote\\b",
    "\\bnot\\s+(?:eligible|available|open|considered)\\s+(?:for|to)\\s+remote\\b",
    // Rationale: docs/job-board-index-notes.md#n971-bremote-s-s-no-none-s
    "\\bremote\\s*[:=(–—-]\\s*(?:no|none)\\s*(?=$|[).|,;·/])",
    // Rationale: docs/job-board-index-notes.md#n972-b-remote-wfh-work-s-from
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

// Rationale: docs/job-board-index-notes.md#n1217-export-const-negated_remote_source-p_neg
export const NEGATED_REMOTE_SOURCE = P_NEGATED_REMOTE.source;

// Rationale: docs/job-board-index-notes.md#n1218-export-function-stripnegatedremote-s-str
export function stripNegatedRemote(s: string): string {
  return s.replace(P_NEGATED_REMOTE, " ");
}

// Rationale: docs/job-board-index-notes.md#n973-const-p_hybrid-bhybrid-b-bhybride-b
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

// Rationale: docs/job-board-index-notes.md#n1219-export-function-statedworkmode-label-str
export function statedWorkMode(label: string | null | undefined): "remote" | "hybrid" | "onsite" | null {
  if (typeof label !== "string" || !label.trim()) return null;
  const enumMode = vendorWorkMode(label);
  if (enumMode) return enumMode;
  const detected = detectWorkMode(label);
  if (detected) return detected;
  return /\boffice\b/i.test(stripNegatedRemote(label)) ? "onsite" : null;
}

// Rationale: docs/job-board-index-notes.md#n1220-export-function-workmodefrom
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

// Rationale: docs/job-board-index-notes.md#n1221-export-const-home_office_token_source-bh
export const HOME_OFFICE_TOKEN_SOURCE = "\\bhome\\s+office\\b";
// Rationale: docs/job-board-index-notes.md#n1222-export-const-site_label_word_source-b-in
export const SITE_LABEL_WORD_SOURCE = "\\b(?:inc|llc|corp|foundation|gmbh|departments?)\\b";
/** A cost-centre number. Three digits minimum: a one- or two-digit residue is
 *  as likely to be a street number or a floor. */
export const SITE_LABEL_NUMBER_SOURCE = "^[0-9]{3,}$";

const P_HOME_OFFICE_ANY = new RegExp(HOME_OFFICE_TOKEN_SOURCE, "i");
const P_HOME_OFFICE_ALL = new RegExp(HOME_OFFICE_TOKEN_SOURCE, "gi");
const P_SITE_LABEL_WORD = new RegExp(SITE_LABEL_WORD_SOURCE, "i");
const P_SITE_LABEL_NUMBER = new RegExp(SITE_LABEL_NUMBER_SOURCE);

// Rationale: docs/job-board-index-notes.md#n1223-export-function-homeofficeresidue-locati
export function homeOfficeResidue(locationName: string | null | undefined): string | null {
  const s = String(locationName ?? "");
  if (!P_HOME_OFFICE_ANY.test(s)) return null;
  return s.replace(P_HOME_OFFICE_ALL, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Rationale: docs/job-board-index-notes.md#n1224-export-function-ishomeofficesitelabel-lo
export function isHomeOfficeSiteLabel(locationName: string | null | undefined): boolean {
  const residue = homeOfficeResidue(locationName);
  if (residue === null) return false;
  return residue === "" || P_SITE_LABEL_NUMBER.test(residue) || P_SITE_LABEL_WORD.test(residue);
}

// Rationale: docs/job-board-index-notes.md#n1225-export-function-withouthomeofficetoken-s
export function withoutHomeOfficeToken(s: string | null | undefined): string | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const left = s.replace(P_HOME_OFFICE_ALL, " ").replace(/\s+/g, " ").trim();
  return left === "" ? null : left;
}

// Rationale: docs/job-board-index-notes.md#n974-const-vendor_mode-new-map-string-remote
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

// Rationale: docs/job-board-index-notes.md#n975-const-country_patterns-readonlyarray-rea
const COUNTRY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:united states|u\.?s\.?a\.?|estados unidos)\b/i, "US"],
  // Rationale: docs/job-board-index-notes.md#n976-b-united-kingdom-england-scotland-new
  [/\b(?:united kingdom|england|scotland|(?<!new south )wales|northern ireland)\b|\bUK\b/i, "GB"],
  [/\b(?:germany|deutschland)\b/i, "DE"],
  [/\bcanada\b/i, "CA"],
  [/\bfrance\b/i, "FR"],
  [/\b(?:netherlands|nederland)\b/i, "NL"],
  [/\bindia\b/i, "IN"],
  [/\b(?:australia|new south wales)\b/i, "AU"],
  [/\b(?:poland|polska)\b/i, "PL"],
  [/\b(?:spain|españa)\b/i, "ES"],
  // Rationale: docs/job-board-index-notes.md#n977-b-new-mexico-m-xico-b
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
  // Rationale: docs/job-board-index-notes.md#n978-b-beth-s-israel-b-i
  [/\b(?<!beth\s)israel\b/i, "IL"],
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
  // Rationale: docs/job-board-index-notes.md#n979-bchina-b-i-cn
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

// Rationale: docs/job-board-index-notes.md#n1226-export-const-us_state_codes-readonlyset
/** The same fifty-one codes P_US_STATE_CODE carries, read off it so there is one list. */
export const US_STATE_CODES: ReadonlySet<string> = new Set(
  (P_US_STATE_CODE.source.match(/\(([A-Z|]+)\)/)?.[1] ?? "").split("|").filter(Boolean),
);
const P_COUNTRY_WORD_US_TOWN = /\b(peru|turkey)\s*,\s*([A-Za-z]{2})(?![A-Za-z])/i;
function countryWordNamesAUsTown(s: string): boolean {
  const m = P_COUNTRY_WORD_US_TOWN.exec(s);
  return !!m && m[2] === m[2].toUpperCase() && US_STATE_CODES.has(m[2]);
}
// Rationale: docs/job-board-index-notes.md#n980-const-p_us_state_code_leading
const P_US_STATE_CODE_LEADING =
  /^(AK|AR|AZ|CT|FL|IA|KS|KY|MN|NC|ND|NH|NJ|NM|NV|NY|RI|SD|TN|TX|UT|VT|WI|WV|WY|IL|MO)\s*[-–—]?\s+[A-Za-z]/;

// Rationale: docs/job-board-index-notes.md#n981-const-p_us_state_code_leading_punct-new
const P_US_STATE_CODE_LEADING_PUNCT = new RegExp(`^(${[...US_STATE_CODES].join("|")})\\s*[,\\-–—]\\s*(?=[A-Za-z])`);
const P_US_PREFIXED_STATE = new RegExp(`^(?:US|USA)\\s*[-–—,]\\s*(${[...US_STATE_CODES].join("|")})\\s*(?:[-–—,]|$)`);
// Rationale: docs/job-board-index-notes.md#n982-const-state_codes_that_are_countries_we_
const STATE_CODES_THAT_ARE_COUNTRIES_WE_CARRY: ReadonlySet<string> = new Set([
  "AL", "AR", "AZ", "CA", "CO", "DE", "ID", "IL", "IN", "KY", "MA", "MO", "MT", "PA", "TN",
]);
const P_CA_PROV_SEGMENT = /^(?:ON|QC|BC|AB|MB|SK|NS|NB|PE|NL|YT|NT|NU)$/;
const P_US_WORDS = /\b(?:US|USA|United States)\b/;

/** The state a location's punctuated state-first form names ("SD, Aberdeen"), or null. */
function leadingPunctuatedState(s: string): string | null {
  const m = P_US_STATE_CODE_LEADING_PUNCT.exec(s);
  if (!m) return null;
  const code = m[1];
  const rest = s.slice(m[0].length);
  const segments = rest.split(/[-–—,;·|/]/).map((x) => x.trim()).filter(Boolean);
  if (segments.some((x) => P_CA_PROV_SEGMENT.test(x)) || P_CA_PROV_NAME.test(rest)) return null;
  const places = segments.map((x) => cityCountry(x));
  if (places.includes(code)) return null;
  for (const [re, c] of COUNTRY_PATTERNS) if (c !== "US" && re.test(s)) return null;
  if (STATE_CODES_THAT_ARE_COUNTRIES_WE_CARRY.has(code)) {
    const placed = places.some((c) => c !== null) || P_US_STATE_NAME.test(rest) || P_US_WORDS.test(rest);
    if (!placed) return null;
  }
  return code;
}

/** Australian state codes a trailing two-letter code can carry (the others are three letters). */
const AU_STATE_CODES: ReadonlySet<string> = new Set(["WA", "SA", "NT"]);

/** "IL - Tel Aviv", "IN, Chennai": a leading code followed by a city the table files in the country that code names. */
function leadingCodeItsOwnCountry(s: string): string | null {
  const m = P_US_STATE_CODE_LEADING_PUNCT.exec(s);
  if (!m) return null;
  const places = s.slice(m[0].length).split(/[-–—,;·|/]/).map((x) => cityCountry(x.trim())).filter((c) => c !== null);
  return places.includes(m[1]) ? m[1] : null;
}

/** The state a location's leading form states outright: "US-TX-Houston" or "SD, Aberdeen". */
function leadingStatedState(s: string): string | null {
  return P_US_PREFIXED_STATE.exec(s)?.[1] ?? leadingPunctuatedState(s);
}
const P_US_STATE_NAME = /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;
const P_CA_PROV_NAME = /\b(?:ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland)\b/i;

// Rationale: docs/job-board-index-notes.md#n983-export-const-country_map_version
export const COUNTRY_MAP_VERSION = 10;
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
  ["tunis", "TN"],
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

/** The trailing ", XX" (optionally a ZIP after it) a location ends with, upper case as written. */
const P_TRAILING_CODE = /,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/;

export function detectCountry(location: string | null | undefined): string | null {
  return countryOf(location, true);
}

// Rationale: docs/job-board-index-notes.md#n1227-export-function-statedcountry-location-s
export function statedCountry(location: string | null | undefined): string | null {
  return countryOf(location, false);
}

function countryOf(location: string | null | undefined, guessFromCity: boolean): string | null {
  if (!location) return null;
  const s = String(location).slice(0, 300);
  // The two measured US towns whose names are countries — see the docblock on
  // countryWordNamesAUsTown for why this is a named pair and not a reordering.
  if (countryWordNamesAUsTown(s)) return "US";
  // Rationale: docs/job-board-index-notes.md#n984-if-s-wa-sa-nt-s
  if (/,\s*(?:WA|SA|NT)(?:\s+\d{4})?\s*$/.test(s) && cityCountry(s.split(",")[0]) === "AU") return "AU";
  const tail = P_TRAILING_CODE.exec(s);
  if (tail) {
    const city = cityCountry(s.split(",")[0]);
    if (city !== null && city === tail[1]) return city;
    // Rationale: docs/job-board-index-notes.md#n985-const-segs-s-split-map-x
    const segs = s.split(",").map((x) => x.trim());
    if (tail[1] === "CA" && segs.length >= 3 && (P_CA_PROV_SEGMENT.test(segs[segs.length - 2]) || P_CA_PROV_NAME.test(segs[segs.length - 2]))) return "CA";
    if (city === "AU" && AU_STATE_CODES.has(tail[1])) return "AU";
    if (US_STATE_CODES.has(tail[1])) {
      // ...unless the string names that same country in words: "India, IN".
      for (const [re, code] of COUNTRY_PATTERNS) if (code === tail[1] && re.test(s)) return code;
      return "US";
    }
  }
  // The state-first form with its punctuation (S11-027), ahead of the country
  // words only because it already refuses a string that names a country.
  if (leadingStatedState(s) !== null) return "US";
  // Rationale: docs/job-board-index-notes.md#n986-const-refused-leadingcodeitsowncountry-s
  const refused = leadingCodeItsOwnCountry(s);
  if (refused !== null) return refused;
  for (const [re, code] of COUNTRY_PATTERNS) if (re.test(s)) return code;
  if (P_US_STATE_CODE.test(s) || P_US_STATE_NAME.test(s) || P_US_STATE_CODE_LEADING.test(s)) return "US";
  if (P_CA_PROV_CODE.test(s) || P_CA_PROV_NAME.test(s)) return "CA";
  if (/\bUS\b/.test(s)) return "US"; // "Remote - US", "US Remote" — after state codes so ", USA" paths won
  return guessFromCity ? cityCountry(s) : null;
}

// Rationale: docs/job-board-index-notes.md#n987-bump-when-the-vocabularies-or-the

// Rationale: docs/job-board-index-notes.md#n1228-export-const-region_map_version
// Rationale: docs/job-board-index-notes.md#n988-export-const-region_map_version
export const REGION_MAP_VERSION = 3;

// Rationale: docs/job-board-index-notes.md#n989-const-us_state_name_to_code-record-strin
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

// Rationale: docs/job-board-index-notes.md#n1229-const-namepattern-names-string
const namePattern = (names: string[]) =>
  new RegExp(`\\b(${[...names].sort((a, b) => b.length - a.length).join("|")})\\b`, "i");
const P_US_STATE_NAME_CAP = namePattern(Object.keys(US_STATE_NAME_TO_CODE));
const P_CA_PROV_NAME_CAP = namePattern(Object.keys(CA_PROV_NAME_TO_CODE));

// Rationale: docs/job-board-index-notes.md#n1230-export-function-detectregion
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
  // Rationale: docs/job-board-index-notes.md#n990-const-prefixed-p_us_prefixed_state-exec
  const prefixed = P_US_PREFIXED_STATE.exec(s);
  if (prefixed?.[1]) return `US-${prefixed[1]}`;
  const named = new Set<string>();
  for (const m of s.matchAll(new RegExp(P_US_STATE_NAME_CAP.source, "gi"))) {
    const c = US_STATE_NAME_TO_CODE[String(m[1]).toLowerCase()];
    if (c) named.add(c);
  }
  // The punctuated state-first form ("SD, Sioux Falls") names its state
  // unless a spelled-out state elsewhere in the string disagrees with it.
  const lead = leadingPunctuatedState(s);
  if (lead) return named.size === 0 || (named.size === 1 && named.has(lead)) ? `US-${lead}` : null;
  if (named.size > 1) return null;
  if (named.size === 1) return `US-${[...named][0]}`;
  const leading = P_US_STATE_CODE_LEADING.exec(s);
  if (leading?.[1]) return `US-${leading[1]}`;
  return null;
}

// Rationale: docs/job-board-index-notes.md#n1231-export-function-isplacelesslocation-v-st
// Rationale: docs/job-board-index-notes.md#n991-block

// Rationale: docs/job-board-index-notes.md#n1232-export-function-isplacelesslocation-v-st
export function isPlacelessLocation(v: string | null | undefined): boolean {
  const s = String(v ?? "").trim();
  if (!s) return true;
  return /^\d+\s+(?:locations?|sites?|emplacements?|standorte|locaties)$/i.test(s);
}

// Rationale: docs/job-board-index-notes.md#n1233-export-const-list_mode_unstated-readonly
export const LIST_MODE_UNSTATED: ReadonlySet<string> = new Set(["workday", "jazzhr"]);

// Rationale: docs/job-board-index-notes.md#n1234-export-function-listmayrewritemode
export function listMayRewriteMode(
  source: string,
  prev: { work_mode?: string | null; location?: string | null; title?: string | null },
  row: { location?: string | null; title?: string | null },
): boolean {
  if (!LIST_MODE_UNSTATED.has(source) || prev.work_mode == null) return true;
  // A placeholder over a stored place says nothing about the place, so it
  // counts as the same location; the title can still have changed.
  const sameLocation = (isPlacelessLocation(row.location) && !isPlacelessLocation(prev.location)) ||
    String(row.location ?? "") === String(prev.location ?? "");
  const sameTitle = String(row.title ?? "") === String(prev.title ?? "");
  if (sameLocation && sameTitle) return false;
  return detectWorkMode(prev.location, prev.title) === prev.work_mode;
}

/** What a Workday CXS job-detail payload says about where the job is. */
export interface WorkdayDetailPlace {
  /** ISO 3166-1 alpha-2, or null when the payload does not state one we trust. */
  country: string | null;
  /** The employer's own display location string, or null. */
  location: string | null;
  /** How many FURTHER sites the requisition lists beyond `location`. */
  additionalCount: number;
}

/**
 * Read the place out of a Workday CXS job-detail payload. Pure: the caller
 * fetches, this only parses.
 *
 * THE COUNTRY COMES FROM THE CODE, AND THE CODE MUST AGREE WITH THE PLACE WE
 * ARE ABOUT TO STORE. The payload states the country twice — once as an
 * alpha-2 code under the requisition's location, once as a spelled-out
 * `country.descriptor` beside the display location. On 366 of 367 live
 * postings they agree. On the 367th the display location read "Germany -
 * Munich" with descriptor "Germany" while the requisition's own country code
 * said IE: a multi-site requisition whose primary site is in a different
 * country from the site being displayed.
 *
 * We store the display location, so a country that contradicts it would put a
 * Munich-labelled row in the Ireland bucket — the right number under the wrong
 * noun. Where they disagree this returns null and the row stays unplaced,
 * which is the board's stated behaviour for anything it cannot place.
 *
 * THE CHECK READS THE DISPLAY LOCATION AS WELL AS THE DESCRIPTOR, because the
 * descriptor is the field that can be ABSENT. Across 253 live payloads the
 * alpha-2 code is present on 252 and `jobPostingInfo.country.descriptor` on
 * 251 — one carries the code with no descriptor, and on that shape the refusal
 * could not fire at all: the salesforce payload with its descriptor deleted
 * returns country IE beside the location "Germany - Munich", a Munich row in
 * the Ireland bucket, which is the exact failure this paragraph says it
 * prevents. So the code is checked against BOTH readings, and a contradiction
 * from either refuses. Both names are resolved through detectCountry, the same
 * table every other surface uses, so there is no second country vocabulary to
 * drift from the first.
 *
 * THE SITE COUNT RIDES OUT WITH THEM, because the caller cannot judge the
 * precision of what it is being handed without it. A requisition listing 52
 * sites hands us ONE display location, and a subdivision derived from that one
 * site is written into a longitudinal series that outlives the posting.
 *
 * NOTHING HERE READS THE APPLY URL. The path slug of a Workday apply URL names
 * a place for most of these rows, and reading it through a gazetteer was
 * measured at 14.4% wrong — "Beth Israel Deaconess Medical Center" resolving
 * to Israel, "Poland Remote" to the United States. The employer answers this
 * question directly in the payload; there is no reason to guess at a URL.
 */
export function workdayDetailPlace(payload: unknown): WorkdayDetailPlace {
  const info = (payload as { jobPostingInfo?: Record<string, unknown> } | null)?.jobPostingInfo;
  if (!info || typeof info !== "object") return { country: null, location: null, additionalCount: 0 };
  const jrl = info.jobRequisitionLocation as { country?: { alpha2Code?: unknown } } | null | undefined;
  const raw = jrl?.country?.alpha2Code;
  // Uppercase two letters or nothing: a well-formed code is the only thing
  // that gets written into a column the country filter reads.
  const code = typeof raw === "string" && /^[A-Za-z]{2}$/.test(raw.trim()) ? raw.trim().toUpperCase() : null;
  const locRaw = info.location;
  const location = typeof locRaw === "string" && locRaw.trim() ? locRaw.trim() : null;
  const descRaw = (info.country as { descriptor?: unknown } | null | undefined)?.descriptor;
  // The two readings of the SAME claim: the country the payload names beside
  // the display location, and the country the display location itself names.
  const fromDescriptor = typeof descRaw === "string" ? detectCountry(descRaw) : null;
  // Rationale: docs/job-board-index-notes.md#n992-const-lead-location-p_us_state_code_lead
  const lead = location ? P_US_STATE_CODE_LEADING_PUNCT.exec(location) : null;
  const fromLocation = !location
    ? null
    : lead && code && code !== "US" && lead[1] === code
      ? statedCountry(location.slice(lead[0].length))
      : statedCountry(location);
  let country: string | null;
  if (code && (fromDescriptor || fromLocation)) {
    // Stated twice, disagreeing on either reading — refuse.
    const contradicted = (!!fromDescriptor && fromDescriptor !== code) || (!!fromLocation && fromLocation !== code);
    country = contradicted ? null : code;
  } else {
    country = code ?? fromDescriptor ?? fromLocation;
  }
  const addl = Array.isArray(info.additionalLocations) ? info.additionalLocations : [];
  // Rationale: docs/job-board-index-notes.md#n993-if-country
  if (country) {
    for (const a of addl) {
      const other = typeof a === "string" ? detectCountry(a) : null;
      if (other && other !== country) { country = null; break; }
    }
  }
  return { country, location, additionalCount: addl.length };
}

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

// Rationale: docs/job-board-index-notes.md#n994-const-coord_suffix-s-s-d-d
const COORD_SUFFIX = /\s*\|\s*-?\d{1,3}\.\d{3,}(?:\s*\|\s*-?\d{1,3}\.\d{3,})?\s*$/;
export function stripCoordinateSuffix(location: string): string {
  return location.replace(COORD_SUFFIX, "").trim();
}

// Rationale: docs/job-board-index-notes.md#n995-export-function-greenhouseapi-token-stri
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
  // Rationale: docs/job-board-index-notes.md#n996-const-titlesperurl-new-map-string-set
  const titlesPerUrl = new Map<string, Set<string>>();
  for (const j of raw.jobs ?? []) {
    const u = j.absolute_url ?? "";
    if (!u) continue;
    if (!titlesPerUrl.has(u)) titlesPerUrl.set(u, new Set());
    titlesPerUrl.get(u)!.add(j.title ?? "");
  }
  // Rationale: docs/job-board-index-notes.md#n997-const-euboard-token-startswith-eu
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
      // Rationale: docs/job-board-index-notes.md#n998-postedat-j-first_published-null
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
// Rationale: docs/job-board-index-notes.md#n999-const-fmtamount-n-number-n-tolocalestrin
const fmtAmount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A vendor's pay-interval word to the board's period, or null when it names none. */
export function vendorPayPeriod(v: unknown): StatedPayPeriod | null {
  const s = String(v ?? "").toLowerCase();
  if (/hour/.test(s)) return "hour";
  if (/\bday|daily/.test(s)) return "day";
  if (/week/.test(s)) return "week";
  if (/month/.test(s)) return "month";
  if (/year|annual|annum/.test(s)) return "year";
  return null;
}

export function leverSalary(r?: { min?: number; max?: number; currency?: string; interval?: string }): string | null {
  if (!r || (!r.min && !r.max)) return null;
  // A one-time payment is not a rate of pay.
  if (/one[- ]?time/i.test(r.interval ?? "")) return null;
  const sym = CURRENCY_SYMBOL[r.currency ?? ""] ?? (r.currency ? `${r.currency} ` : "");
  const min = typeof r.min === "number" && r.min > 0 ? r.min : null;
  const max = typeof r.max === "number" && r.max > 0 ? r.max : null;
  // The vendor's own interval, through the one formatter whose output the
  // parser reads back to the same figures (statedPayText), when it maps.
  const period = vendorPayPeriod(r.interval);
  if (period !== null) {
    const stated = statedPayText(period, min ?? max, min !== null ? max : null, r.currency ?? null, CURRENCY_SYMBOL[r.currency ?? ""] ?? null);
    if (stated !== null) return stated;
  }
  const range = [r.min, r.max].filter((n): n is number => typeof n === "number" && n > 0).map(fmtAmount).join("–");
  if (!range) return null;
  const interval = r.interval ? `/${r.interval.replace(/-time|ly$/i, (m) => (m.toLowerCase() === "ly" ? "" : m))}` : "";
  return `${sym}${range}${interval ? interval.toLowerCase() : ""}`;
}

// Rationale: docs/job-board-index-notes.md#n1000-export-type-statedpayperiod-hour-day-wee

export type StatedPayPeriod = "hour" | "day" | "week" | "month" | "year";

/** The period word the shared parser recognises, per period. */
const STATED_PAY_PERIOD_WORD: Record<StatedPayPeriod, string> = {
  hour: "per hour",
  day: "per day",
  week: "per week",
  month: "per month",
  year: "per year",
};

/** Two decimals, always: never three, which the parser reads as a thousands group. */
const fmtStatedPay = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Rationale: docs/job-board-index-notes.md#n1235-function-statedpaytext
function statedPayText(
  period: StatedPayPeriod,
  min: number | null,
  max: number | null,
  currencyCode: string | null,
  currencySymbol: string | null,
): string | null {
  if (min === null || !Number.isFinite(min) || min <= 0) return null;
  if (max !== null && Number.isFinite(max) && max < min) return null;
  const ceiling = max !== null && Number.isFinite(max) && max > min ? max : null;
  const code = String(currencyCode ?? "").trim().toUpperCase();
  const sym = String(currencySymbol ?? "").trim();
  const marker = /^[A-Z]{3}$/.test(code) ? `${code} ` : sym;
  if (!marker) return null;
  const figures = ceiling === null ? fmtStatedPay(min) : `${fmtStatedPay(min)} – ${fmtStatedPay(ceiling)}`;
  const text = `${marker}${figures} ${STATED_PAY_PERIOD_WORD[period]}`;
  const read = parseSalaryStructured(text, null, null);
  if (!read || read.period !== period || read.annualMin === null) return null;
  if (read.min !== min) return null;
  if (ceiling === null ? read.max !== null : read.max !== ceiling) return null;
  return text;
}

// Rationale: docs/job-board-index-notes.md#n1236-const-statedpayfigure-v-unknown-number-n
const statedPayFigure = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const s = String(v ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const PERSONIO_PAY_PERIOD: Record<string, StatedPayPeriod> = {
  hourly: "hour",
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

// Rationale: docs/job-board-index-notes.md#n1237-export-function-personiosalary-si
export function personioSalary(si: {
  min?: string | number | null;
  max?: string | number | null;
  currencyCode?: string | null;
  currencySymbol?: string | null;
  type?: string | null;
} | null | undefined): string | null {
  if (!si) return null;
  const min = statedPayFigure(si.min);
  if (min === null) return null;
  const period = PERSONIO_PAY_PERIOD[String(si.type ?? "").trim().toLowerCase()];
  if (!period) return null;
  return statedPayText(period, min, statedPayFigure(si.max), si.currencyCode ?? null, si.currencySymbol ?? null);
}

// Rationale: docs/job-board-index-notes.md#n1238-export-function-statesthesamemoney-a-str
export function statesTheSameMoney(a: string | null, b: string | null, country?: string | null): boolean {
  if (!a || !b || a === b) return false;
  const x = parseSalaryStructured(a, country ?? null, null);
  const y = parseSalaryStructured(b, country ?? null, null);
  if (!x || !y) return false;
  const samePeriod = x.period === null || y.period === null || x.period === y.period;
  return samePeriod && x.min === y.min && x.max === y.max && x.currency === y.currency;
}

// Rationale: docs/job-board-index-notes.md#n1239-export-const-schedule_words_not_stored-r
export const SCHEDULE_WORDS_NOT_STORED: ReadonlySet<string> = new Set(["personio"]);

export function sweepRefusesAnnual(
  source: string | null | undefined,
  storedAnnualMin: number | null,
  nextAnnualMin: number | null,
  nextPeriod: string | null,
): boolean {
  if (!SCHEDULE_WORDS_NOT_STORED.has(String(source ?? ""))) return false;
  if (storedAnnualMin !== null || nextAnnualMin === null) return false;
  return LOAD_DEPENDENT_PERIODS.has(String(nextPeriod ?? ""));
}

const LD_PAY_PERIOD: Record<string, StatedPayPeriod> = {
  HOUR: "hour",
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  YEAR: "year",
};

// Rationale: docs/job-board-index-notes.md#n1240-const-ld_period_band-record-statedpayper
const LD_PERIOD_BAND: Record<StatedPayPeriod, { lo: number; hi: number } | null> = {
  // lo 0 defers to the parser's own hourly floor rather than restating it.
  hour: { lo: 0, hi: 200 },
  day: null,
  week: null,
  month: null,
  year: { lo: 20_000, hi: Number.POSITIVE_INFINITY },
};

// Rationale: docs/job-board-index-notes.md#n1241-export-function-ldbasesalarytext-pay
export function ldBaseSalaryText(pay: {
  currency: string | null;
  min: number | null;
  max: number | null;
  point: number | null;
  unitText: string | null;
} | null | undefined): string | null {
  if (!pay) return null;
  const period = LD_PAY_PERIOD[String(pay.unitText ?? "").trim().toUpperCase()];
  // Rationale: docs/job-board-index-notes.md#n1001-if-period-return-null
  if (!period) return null;
  const band = LD_PERIOD_BAND[period];
  if (!band) return null;
  const min = pay.min ?? pay.point;
  const max = pay.min !== null ? pay.max : null;
  if (min === null) return null;
  const outOfBand = (n: number) => n < band.lo || n >= band.hi;
  if (outOfBand(min) || (max !== null && outOfBand(max))) return null;
  return statedPayText(period, min, max, pay.currency, null);
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
      // Rationale: docs/job-board-index-notes.md#n1002-const-workmode-statedworkmode-j-workplac
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
      // Rationale: docs/job-board-index-notes.md#n1003-const-workmode-p-location-hybrid-true
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

// Rationale: docs/job-board-index-notes.md#n1004-all-tag-tag-block-contents-in

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
  salary?: { min?: string | number | null; max?: string | number | null; period?: string | null; type?: string | null; currency?: string | null } | null;
}

export function normalizeRecruitee(raw: { offers?: RecruiteeOffer[] }, company: string, token: string): JobPosting[] {
  return (raw.offers ?? [])
    .map((o) => {
      const location = o.location || [o.city, o.country].filter(Boolean).join(", ");
      const sal = o.salary;
      // Rationale: docs/job-board-index-notes.md#n1005-const-salperiod-sal-vendorpayperiod-sal
      const salPeriod = sal ? vendorPayPeriod(sal.period ?? sal.type) : null;
      const salMin = sal ? statedPayFigure(sal.min) : null;
      const salMax = sal ? statedPayFigure(sal.max) : null;
      const salary = sal && sal.min && sal.max
        ? (salPeriod !== null && salMin !== null
            ? statedPayText(salPeriod, salMin, salMax, sal.currency ?? null, null)
              ?? `${sal.currency ? sal.currency + " " : ""}${sal.min} - ${sal.max} ${STATED_PAY_PERIOD_WORD[salPeriod]}`.trim()
            : `${sal.currency ? sal.currency + " " : ""}${sal.min} - ${sal.max}${sal.type ? ` ${sal.type}` : ""}`.trim())
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
        // Rationale: docs/job-board-index-notes.md#n1006-employmenttype-normalizeemploymenttype-o
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
      // Rationale: docs/job-board-index-notes.md#n1007-const-pay-xmlblocks-block-salaryinformat
      const pay = xmlBlocks(block, "salaryInformation")[0];
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
        salary: pay
          ? personioSalary({
            min: xmlValue(pay, "min"),
            max: xmlValue(pay, "max"),
            currencyCode: xmlValue(pay, "currencyCode"),
            currencySymbol: xmlValue(pay, "currencySymbol"),
            type: xmlValue(pay, "type"),
          })
          : null,
        // <schedule> is full-time | part-time | full-or-part-time; the mapper
        // reads full-or-part-time as full_time (the role CAN be full-time).
        employmentType: normalizeEmploymentType(schedule),
        // Rationale: docs/job-board-index-notes.md#n1008-employmenttypetext-schedule-null
        employmentTypeText: schedule || null,
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

// Rationale: docs/job-board-index-notes.md#n1009-export-interface-icimsjobdata
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

// Rationale: docs/job-board-index-notes.md#n1242-function-icimssalary-d-icimsjobdata-stri
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

// Rationale: docs/job-board-index-notes.md#n1243-export-function-icimscountry-feedcode-un
export function icimsCountry(feedCode: unknown, location: string | null | undefined): string | null {
  const code = /^[A-Za-z]{2}$/.test(String(feedCode ?? "")) ? String(feedCode).toUpperCase() : null;
  if (code === null) return detectCountry(location);
  const first = String(location ?? "").split(";")[0].slice(0, 300);
  const notOwn = (m: RegExpExecArray | null) => !!m?.[1] && m[1] !== code;
  const us = notOwn(P_US_STATE_CODE.exec(first)) || P_US_STATE_NAME.test(first) || notOwn(P_US_STATE_CODE_LEADING.exec(first));
  const ca = notOwn(P_CA_PROV_CODE.exec(first)) || P_CA_PROV_NAME.test(first);
  const site = us && !ca ? "US" : ca && !us ? "CA" : null;
  return site !== null && site !== code ? site : code;
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
      // Rationale: docs/job-board-index-notes.md#n1010-const-workmode-workmodefrom-d-location_t
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
        // Rationale: docs/job-board-index-notes.md#n1011-country-icimscountry-d-country_code-loca
        country: icimsCountry(d.country_code, location),
        // Rationale: docs/job-board-index-notes.md#n1012-employmenttype-normalizeemploymenttype-d
        employmentType: normalizeEmploymentType(d.employment_type),
        applyUrl: safeUrl(String(d.apply_url ?? (externalId ? `https://${token}/jobs/${externalId}/job` : "")).replace(/\/login$/, "/job")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}

// Rationale: docs/job-board-index-notes.md#n1013-export-interface-ripplingjobitem
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

// Rationale: docs/job-board-index-notes.md#n1244-export-function-extractripplingjobposts
export function extractRipplingJobPosts(html: string): { items: RipplingJobItem[]; totalPages: number } | null {
  const m = html.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as {
      props?: { pageProps?: { dehydratedState?: { queries?: Array<{ queryKey?: unknown[]; state?: { data?: { items?: unknown[]; totalPages?: number } } }> } } };
    };
    const dehydrated = data.props?.pageProps?.dehydratedState;
    const queries = dehydrated?.queries ?? [];
    // Rationale: docs/job-board-index-notes.md#n1014-if-dehydrated-queries-length-return-item
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
      // Rationale: docs/job-board-index-notes.md#n1015-const-sitemodes-locs-map-l-statedworkmod
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

// Rationale: docs/job-board-index-notes.md#n1016-export-interface-paylocityjobitem
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

// Rationale: docs/job-board-index-notes.md#n1245-export-function-extractpaylocitypagedata
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
    // Rationale: docs/job-board-index-notes.md#n1017-filter-j-j-isinternal-true
    .filter((j) => j.IsInternal !== true)
    .map((j) => {
      const loc = j.JobLocation ?? {};
      // Rationale: docs/job-board-index-notes.md#n1018-const-sitename-string-j-locationname-tri
      const siteName = String(j.LocationName ?? "").trim();
      const cityState = [loc.City, loc.State].filter(Boolean).join(", ").trim();
      const siteLabel = isHomeOfficeSiteLabel(siteName);
      const location = siteLabel && cityState ? cityState : siteName || cityState;
      const title = String(j.JobTitle ?? "").trim();
      const dept = typeof j.HiringDepartment === "string" && j.HiringDepartment.trim() ? j.HiringDepartment.trim() : null;
      const externalId = String(j.JobId ?? "").trim();
      // Rationale: docs/job-board-index-notes.md#n1019-const-modelocation-sitelabel-citystate-l
      const modeLocation = siteLabel ? cityState : location;
      const workMode = j.IsRemote === true
        ? "remote" as const
        : detectWorkMode(modeLocation, title, withoutHomeOfficeToken(dept));
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
        // Rationale: docs/job-board-index-notes.md#n1020-salary-null
        salary: null,
        // Rationale: docs/job-board-index-notes.md#n1021-country-usa-us-u-s-a
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

// Rationale: docs/job-board-index-notes.md#n1022-export-interface-adpnamecodedfield
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

// Rationale: docs/job-board-index-notes.md#n1246-export-function-adpboardparams-token-str
export function adpBoardParams(token: string): { cid: string; ccId: string } {
  const [cid, ccId] = String(token).split("~");
  return { cid: cid ?? "", ccId: ccId || "19000101_000001" };
}

// Rationale: docs/job-board-index-notes.md#n1023-const-adp_salary_freq-record-string-stri
const ADP_SALARY_FREQ: Record<string, string> = { hourly: "per hour", annually: "per year", monthly: "per month", weekly: "per week" };
function adpSalary(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d[\d,]*(?:\.\d+)?)\s+To\s+(\d[\d,]*(?:\.\d+)?)\s+\(([A-Za-z]{3})\)\s+(\w+)$/i);
  if (!m) return s;
  const num = (x: string) => {
    const n = Number(x.replace(/,/g, ""));
    if (!Number.isFinite(n)) return x;
    // Rationale: docs/job-board-index-notes.md#n1024-return-number-isinteger-n-n-tolocalestri
    return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2);
  };
  const freq = ADP_SALARY_FREQ[m[4].toLowerCase()] ?? m[4].toLowerCase();
  return `${m[3].toUpperCase()} ${num(m[1])}–${num(m[2])} ${freq}`;
}

// Rationale: docs/job-board-index-notes.md#n1025-const-us_state_tail-al-ak-az-ar
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
    // Rationale: docs/job-board-index-notes.md#n1026-filter-j-adpfield-j-customfieldgroup-ind
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
      // Rationale: docs/job-board-index-notes.md#n1027-const-shareid-string-adpfield-j-customfi
      const shareId = String(adpField(j.customFieldGroup?.stringFields, "ExternalJobID")?.stringValue ?? "").trim();
      // Rationale: docs/job-board-index-notes.md#n1028-const-employmenttype-normalizeemployment
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

// Rationale: docs/job-board-index-notes.md#n1029-export-interface-ukgopportunity
export interface UkgOpportunity {
  Id?: string;
  Title?: string;
  PostedDate?: string;
  RequisitionNumber?: string;
  JobCategoryName?: string;
  FullTime?: boolean;
  BriefDescription?: string;
  // Rationale: docs/job-board-index-notes.md#n1030-joblocationtype-number-null
  JobLocationType?: number | null;
  Locations?: Array<{
    // Rationale: docs/job-board-index-notes.md#n1031-localizedname-string-null
    LocalizedName?: string | null;
    LocalizedDescription?: string | null;
    Address?: {
      City?: string | null;
      State?: { Code?: string | null; Name?: string | null } | null;
      Country?: { Code?: string | null; Name?: string | null } | null;
    } | null;
  }> | null;
}

// Rationale: docs/job-board-index-notes.md#n1247-const-ukg_location_type-new-map-number-s
const UKG_LOCATION_TYPE = new Map<number, string>([[0, "Hybrid"], [1, "On-site"], [2, "Remote"]]);
export function ukgLocationTypeMode(raw: unknown): "remote" | "hybrid" | "onsite" | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return statedWorkMode(UKG_LOCATION_TYPE.get(raw) ?? null);
}

// Rationale: docs/job-board-index-notes.md#n1248-function-logunmappedukglocationtype-raw
function logUnmappedUkgLocationType(raw: unknown): void {
  if (typeof raw === "number" && Number.isInteger(raw) && raw !== -1 && ukgLocationTypeMode(raw) === null) {
    console.log(`[JOB-BOARD] unmapped UKG JobLocationType: ${String(raw).slice(0, 40)}`);
  }
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

// Rationale: docs/job-board-index-notes.md#n1249-const-ukg_alpha3-record-string-string
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
      // Rationale: docs/job-board-index-notes.md#n1032-const-enummode-ukglocationtypemode-j-job
      const enumMode = ukgLocationTypeMode(j.JobLocationType);
      logUnmappedUkgLocationType(j.JobLocationType);
      // Rationale: docs/job-board-index-notes.md#n1033-const-vendorlabels-j-locations
      const vendorLabels = (j.Locations ?? [])
        .flatMap((L) => [L?.LocalizedName, L?.LocalizedDescription])
        .filter((s): s is string => typeof s === "string" && s.trim() !== "")
        .join(" · ");
      // Rationale: docs/job-board-index-notes.md#n1034-const-textmode-detectworkmode
      const textMode = detectWorkMode(
        withoutHomeOfficeToken(location),
        title,
        withoutHomeOfficeToken(dept),
        withoutHomeOfficeToken(vendorLabels),
      );
      // Rationale: docs/job-board-index-notes.md#n1035-const-workmode-enummode-textmode-enummod
      const workMode = enumMode && textMode && enumMode !== textMode ? null : (enumMode ?? textMode);
      return {
        id: `ukg:${token}:${externalId}`,
        source: "ukg" as const,
        token,
        company,
        title,
        location,
        workMode,
        remote: workMode === "remote",
        department: dept,
        postedAt: safeIso(j.PostedDate),
        category: categorize(title, dept),
        // Rationale: docs/job-board-index-notes.md#n1036-salary-null
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

// Rationale: docs/job-board-index-notes.md#n1037-export-interface-pinpointposting
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
  // Rationale: docs/job-board-index-notes.md#n1038-if-freq-min-_000-return-null
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
// Rationale: docs/job-board-index-notes.md#n1039-const-wd_today-b-today-hoy-aujourd
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
  // Rationale: docs/job-board-index-notes.md#n1040-const-fetchedat-date-now
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
      // Rationale: docs/job-board-index-notes.md#n1041-const-workmode-detectworkmode-loc-string
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
        // Rationale: docs/job-board-index-notes.md#n1042-postedat-days-null-new-date-fetchedat
        postedAt: days !== null ? new Date(fetchedAt - days * 86_400_000).toISOString() : null,
        category: categorize(String(j.title ?? ""), null),
        salary: null,
        country: detectCountry(loc),
        applyUrl: safeUrl(path ? `${base}${path}` : ""),
        _stale: stale, // consumed + stripped by the fetcher's freshness filter
      } as JobPosting & { _stale?: boolean };
    })
    // Rationale: docs/job-board-index-notes.md#n1043-filter-j-j-applyurl-j-title
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `workday:${token}:`)
    .map(({ _stale: _drop, ...j }) => j as JobPosting);
}

// Rationale: docs/job-board-index-notes.md#n1044-export-interface-oraclereq
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

// Rationale: docs/job-board-index-notes.md#n1250-export-function-normalizeteamtailor-rss
export function normalizeTeamtailor(rss: string, company: string, token: string): JobPosting[] {
  return xmlBlocks(rss, "item")
    .map((item) => {
      const title = xmlValue(item, "title") ?? "";
      const link = xmlValue(item, "link") ?? "";
      const idMatch = link.match(/\/jobs\/(\d+)/);
      const externalId = idMatch ? idMatch[1] : "";
      // Rationale: docs/job-board-index-notes.md#n1045-const-city-xmlvalue-item-tt-city
      const city = xmlValue(item, "tt:city");
      const country = xmlValue(item, "tt:country");
      const location = [city, country].filter(Boolean).join(", ");
      // Rationale: docs/job-board-index-notes.md#n1046-const-status-xmlvalue-item-remotestatus
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

// Rationale: docs/job-board-index-notes.md#n1251-interface-usajobsremuneration-minimumran
interface UsajobsRemuneration { MinimumRange?: unknown; MaximumRange?: unknown; RateIntervalCode?: unknown; Description?: unknown }
/** UserArea.Details: where the API puts the summary, the duties and the telework fields (S8-023). */
interface UsajobsDetails { JobSummary?: unknown; MajorDuties?: unknown; TeleworkEligible?: unknown; RemoteIndicator?: unknown }
interface UsajobsDescriptor {
  PositionID?: unknown; PositionTitle?: unknown; OrganizationName?: unknown; DepartmentName?: unknown;
  PositionLocation?: Array<{ LocationName?: unknown; CountryCode?: unknown }>; PositionLocationDisplay?: unknown;
  RemoteIndicator?: unknown; TeleworkEligible?: unknown; PublicationStartDate?: unknown;
  PositionRemuneration?: UsajobsRemuneration[]; JobCategory?: Array<{ Name?: unknown }>;
  PositionSchedule?: Array<{ Name?: unknown }>; QualificationSummary?: unknown;
  ApplyURI?: unknown[]; PositionURI?: unknown;
  UserArea?: { Details?: UsajobsDetails };
}
interface UsajobsItem { MatchedObjectId?: unknown; MatchedObjectDescriptor?: UsajobsDescriptor }

const usajobsId = (wrap: UsajobsItem, d: UsajobsDescriptor) => String(wrap?.MatchedObjectId ?? d.PositionID ?? "").trim();
const statedBool = (v: unknown): boolean | null => (v === true || v === "true" || v === "True" ? true : v === false || v === "false" || v === "False" ? false : null);
// RateIntervalCode -> the words the salary parser reads; "WC" (without compensation) states no pay.
const USAJOBS_RATE: Record<string, string> = { PA: "per year", PH: "per hour", PD: "per day", PW: "per week", PM: "per month" };

/** The posting body the feed carries: Details.JobSummary, Details.MajorDuties, QualificationSummary. */
export function usajobsDescriptions(items: unknown, token: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const wrap of (Array.isArray(items) ? items : []) as UsajobsItem[]) {
    const d = (wrap?.MatchedObjectDescriptor ?? {}) as UsajobsDescriptor;
    const det = d.UserArea?.Details ?? {};
    const duties = Array.isArray(det.MajorDuties) ? det.MajorDuties.map(String).join("\n") : String(det.MajorDuties ?? "");
    const text = [det.JobSummary, duties, d.QualificationSummary]
      .map((x) => htmlToText(String(x ?? "").slice(0, 200_000)).trim())
      .filter(Boolean)
      .join("\n\n");
    const id = usajobsId(wrap, d);
    if (id && text) out.set(`usajobs:${token}:${id}`, text);
  }
  return out;
}

const USAJOBS_US_TERRITORY = /^(puerto rico|guam|american samoa|northern mariana islands|(u\.?s\.? )?virgin islands(,? u\.?s\.?)?|wake island|midway islands?|johnston atoll)$/i;
export function normalizeUsajobs(items: UsajobsItem[], _company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    .map((wrap) => {
      const d = (wrap?.MatchedObjectDescriptor ?? {}) as UsajobsDescriptor;
      const det = d.UserArea?.Details ?? {};
      const externalId = usajobsId(wrap, d);
      const title = String(d.PositionTitle ?? "").trim();
      // The agency IS the employer here; OrganizationName is the parent
      // department, DepartmentName the sub-agency. Prefer the specific one.
      const agency = String(d.OrganizationName ?? d.DepartmentName ?? "").trim();
      const first = Array.isArray(d.PositionLocation) && d.PositionLocation.length ? d.PositionLocation[0] : null;
      const loc = first ? String(first.LocationName ?? "").trim() : String(d.PositionLocationDisplay ?? "").trim();
      // Rationale: docs/job-board-index-notes.md#n1047-const-remotesaid-statedbool-det-remotein
      const remoteSaid = statedBool(det.RemoteIndicator ?? d.RemoteIndicator);
      const teleworkSaid = statedBool(det.TeleworkEligible ?? d.TeleworkEligible);
      const stated = remoteSaid === true ? "remote" as const
        : teleworkSaid === true ? "hybrid" as const
        : remoteSaid === false && teleworkSaid === false ? "onsite" as const
        : null;
      const workMode = stated ?? detectWorkMode(loc, title);
      const posted = safeIso(d.PublicationStartDate);
      const pay = Array.isArray(d.PositionRemuneration) ? d.PositionRemuneration[0] : null;
      const min = Number(pay?.MinimumRange) || 0;
      const max = Number(pay?.MaximumRange) || 0;
      const code = String(pay?.RateIntervalCode ?? "").trim().toUpperCase();
      const per = USAJOBS_RATE[code] ?? (/^per (year|hour|day|week|month)$/i.test(String(pay?.Description ?? "").trim()) ? String(pay?.Description).trim().toLowerCase() : "");
      const money = (n: number) => (per === "per hour" || !Number.isInteger(n)
        ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `$${Math.round(n).toLocaleString("en-US")}`);
      const salary = min > 0 && max > 0 && code !== "WC"
        ? `${money(min)} - ${money(max)}${per ? ` ${per}` : ""}`
        : null;
      // Rationale: docs/job-board-index-notes.md#n1048-const-cc-string-first-countrycode-trim
      const cc = String(first?.CountryCode ?? "").trim();
      const country = (cc ? detectCountry(cc) : null) ?? detectCountry(loc) ?? (!cc || /united states/i.test(cc) || USAJOBS_US_TERRITORY.test(cc) ? "US" : null);
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
        country,
        applyUrl: safeUrl(String(d.ApplyURI?.[0] ?? d.PositionURI ?? "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}

// Rationale: docs/job-board-index-notes.md#n1049-block

// Rationale: docs/job-board-index-notes.md#n1252-export-const-oracle_dev_tenant_re-dev-te
export const ORACLE_DEV_TENANT_RE = /^[^~]*-(dev|test|stage|uat)\d*(?:-|$)/i;

/** `tenant` of an Oracle `tenant~region~site` token; null for any other shape. */
export function oracleTenantOf(token: string): string | null {
  const parts = String(token ?? "").split("~");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return parts[0];
}

/** True only for an Oracle-shaped token whose tenant segment is a sandbox. */
export function isOracleDevToken(token: string): boolean {
  const tenant = oracleTenantOf(token);
  return tenant !== null && ORACLE_DEV_TENANT_RE.test(tenant);
}

/** The tenant-level identity of a requisition: `oracle:<tenant>:<reqId>`. */
export function oracleReqKey(token: string, reqId: string): string | null {
  const tenant = oracleTenantOf(token);
  const id = String(reqId ?? "").trim();
  if (!tenant || !id) return null;
  return `oracle:${tenant}:${id}`;
}

/** The same key derived from a stored posting id `oracle:<token>:<reqId>`; null for other vendors. */
export function oracleReqKeyOfId(id: string): string | null {
  const parts = String(id ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "oracle") return null;
  return oracleReqKey(parts[1], parts[2]);
}

/** The reqId of a stored Oracle posting id; null for any other shape. */
export function oracleReqIdOfId(id: string): string | null {
  const parts = String(id ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "oracle" || !parts[2]) return null;
  return parts[2];
}

// Rationale: docs/job-board-index-notes.md#n1253-export-function-rankoraclesites
export function rankOracleSites(
  entries: ReadonlyArray<{ source: string; token: string }>,
  canonical: Readonly<Record<string, string>>,
): Map<string, number> {
  const byTenant = new Map<string, string[]>();
  for (const e of entries) {
    if (e.source !== "oracle") continue;
    const tenant = oracleTenantOf(e.token);
    if (!tenant) continue;
    const list = byTenant.get(tenant) ?? [];
    if (!list.includes(e.token)) list.push(e.token);
    byTenant.set(tenant, list);
  }
  const ranks = new Map<string, number>();
  for (const [tenant, sites] of byTenant) {
    if (sites.length < 2) continue;
    const want = canonical[tenant];
    const head = want && sites.includes(want) ? want : sites[0];
    const ordered = [head, ...sites.filter((t) => t !== head)];
    ordered.forEach((t, i) => ranks.set(t, i));
  }
  return ranks;
}

export interface OracleHolderRow {
  id: string;
  token: string;
  /** Catalog rank of the holder's site, or null when its token is not ranked (untracked, single-site, unknown). */
  rank: number | null;
  // Rationale: docs/job-board-index-notes.md#n1254-missing-boolean
  missing?: boolean;
}

export interface OracleSubsitePlan {
  /** Fetched reqIds this site must NOT store: a better-ranked sibling holds them. */
  dropReqIds: Set<string>;
  /** Ids of THIS site's stored rows that a better-ranked sibling now owns — OUR action, exit as untracked. */
  shedMineIds: string[];
  /** Ids of lower-ranked siblings' rows for reqs this site owns — OUR action, exit as untracked. */
  shedSiblingIds: string[];
}

// Rationale: docs/job-board-index-notes.md#n1255-export-function-planoraclesubsitevisit-a
export function planOracleSubsiteVisit(args: {
  token: string;
  rank: number;
  fetched: Iterable<string>;
  stored: ReadonlyMap<string, string>;
  holders: ReadonlyMap<string, ReadonlyArray<OracleHolderRow>>;
  /** Bound on sibling rows shed in one visit; the rest converge on later visits. */
  shedCap?: number;
  /** The feed was read to its end this visit. Default false: assume windowed. */
  fullRead?: boolean;
}): OracleSubsitePlan {
  const { token, rank, stored, holders } = args;
  const shedCap = args.shedCap ?? 1000;
  const fullRead = args.fullRead === true;
  const plan: OracleSubsitePlan = { dropReqIds: new Set(), shedMineIds: [], shedSiblingIds: [] };
  const fetchedSet = new Set(args.fetched);
  const reqIds = new Set<string>([...fetchedSet, ...stored.keys()]);
  const isLive = (h: OracleHolderRow) => h.rank !== null && h.missing !== true;
  for (const reqId of reqIds) {
    const key = oracleReqKey(token, reqId);
    if (!key) continue;
    const rows = holders.get(key) ?? [];
    let bestOther: number | null = null;
    let anyLiveSibling = false;
    for (const h of rows) {
      if (h.token === token || !isLive(h)) continue;
      anyLiveSibling = true;
      if (bestOther === null || (h.rank as number) < bestOther) bestOther = h.rank as number;
    }
    if (bestOther !== null && bestOther < rank) {
      // A better-ranked live sibling owns this requisition.
      if (fetchedSet.has(reqId)) plan.dropReqIds.add(reqId);
      const mine = stored.get(reqId);
      if (mine) plan.shedMineIds.push(mine);
      continue;
    }
    if (!fetchedSet.has(reqId)) {
      // Rationale: docs/job-board-index-notes.md#n1050-const-mine-stored-get-reqid
      const mine = stored.get(reqId);
      if (fullRead && anyLiveSibling && mine) plan.shedMineIds.push(mine);
      continue;
    }
    // This site serves it and is the best live holder (or the only ranked
    // one). Shed lower-ranked live copies, and every stamped ranked copy.
    for (const h of rows) {
      if (h.token === token || h.rank === null) continue;
      if (h.missing !== true && h.rank <= rank) continue;
      if (plan.shedSiblingIds.length >= shedCap) break;
      plan.shedSiblingIds.push(h.id);
    }
  }
  return plan;
}
