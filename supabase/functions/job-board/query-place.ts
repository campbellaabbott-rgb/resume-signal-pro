/**
 * A PLACE TYPED INTO THE SEARCH BOX IS A PLACE (wave 4, job-board .93).
 *
 * "nurse jobs in Texas" matched 104 titles; q "nurse" + location "Texas" 1,592
 * (live 2026-10-12). A trailing "in / near / around <place>" moves into the
 * location (or country) filter only when the board knows the place by name: a
 * state or province, a metro alias, normalize.ts's city table, "City, ST" or a
 * country. "Engineer in Training" stays text. Named in intentFilters, undone
 * by noIntent.
 *
 * "City, ST" is the city in that state under every spelling: "Austin, TX" held
 * 2,564 rows, "Austin, Texas" 1,297 more, bare "Austin" 5,505 with Austin MN.
 *
 * Pure, so vitest walks it.
 */
import { locationTerms, METRO_ALIASES, sanitizeTerm, STATE_ALIASES } from "../_shared/location-terms.ts";
import { cityCountry } from "./normalize.ts";

export type PlaceLift = {
  /** The words moved, as typed ("in Texas"), for the intentFilters disclosure. */
  label: string;
  /** The query without them; "" when only filler words were left ("jobs in Texas"). */
  head: string;
  patch: { location: string } | { country: string };
};

/**
 * Country names as people type them, with the code the country column holds.
 * The test reads every entry through normalize.ts's statedCountry, so this
 * cannot name a country differently from the column. Short forms count only in
 * capitals ("in US", "in UK"), never "us".
 */
export const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  "united states": "US", "usa": "US", "us": "US", "united kingdom": "GB", "uk": "GB",
  "germany": "DE", "canada": "CA", "france": "FR", "netherlands": "NL",
  "india": "IN", "australia": "AU", "poland": "PL", "spain": "ES", "mexico": "MX", "brazil": "BR",
  "philippines": "PH", "sweden": "SE", "denmark": "DK", "norway": "NO", "switzerland": "CH",
  "austria": "AT", "ireland": "IE", "belgium": "BE", "portugal": "PT", "italy": "IT", "japan": "JP",
  "new zealand": "NZ", "romania": "RO", "hungary": "HU", "finland": "FI",
  "greece": "GR", "israel": "IL", "united arab emirates": "AE", "saudi arabia": "SA",
  "south africa": "ZA", "argentina": "AR", "colombia": "CO", "chile": "CL", "peru": "PE",
  "vietnam": "VN", "indonesia": "ID",
};

/** State codes that are also words a query ends on ("nurse in OR" is the operating room). */
const CODE_IS_A_WORD: ReadonlySet<string> = new Set(["OR", "ME", "IN", "OK", "HI", "ID"]);

/**
 * City-table entries never taken from a query: English words ("in reading",
 * "nice") and fragments of other names ("cali", "bern", "gent", "roma").
 */
const CITY_NOT_FROM_QUERY: ReadonlySet<string> = new Set(["reading", "nice", "cali", "bern", "gent", "roma"]);

const stateOf = (s: string) => STATE_ALIASES[s.trim().toLowerCase()];

/** "City, ST" or "City, State" with a state or province the alias table knows. */
const CITY_STATE = /^([\p{L}][\p{L} .'-]*?)\s*,\s*([\p{L} .]+)$/u;

/** The filter a typed place becomes, or null when the board does not know it by name. */
export function knownPlace(place: string): { location: string } | { country: string } | null {
  const lower = place.toLowerCase();
  const cs = CITY_STATE.exec(place);
  if (cs) return stateOf(cs[2]) ? { location: place } : null;
  if (/^[A-Za-z]{2}$/.test(place)) {
    // A bare code only as written in capitals, and never one that is also a word: a state, else "US" / "UK".
    if (place !== place.toUpperCase() || CODE_IS_A_WORD.has(place)) return null;
    if (stateOf(place)) return { location: place };
    return COUNTRY_NAMES[lower] ? { country: COUNTRY_NAMES[lower] } : null;
  }
  if (stateOf(lower)) return { location: place };
  if (lower !== "the city" && (lower.length > 2 || place === place.toUpperCase()) && METRO_ALIASES[lower]) return { location: place };
  const country = COUNTRY_NAMES[lower];
  if (country && (lower.length > 3 || place === place.toUpperCase())) return { country };
  if (!CITY_NOT_FROM_QUERY.has(lower) && cityCountry(place) !== null) return { location: place };
  return null;
}

/** The last "in / near / around", then the place to the end (a leading "the" dropped). */
const TRAILING_PLACE = /^(.*\S)\s+(in|near|around)\s+(?:the\s+)?([\p{L}][\p{L} .'’,-]*?)[\s.!?]*$/iu;

/**
 * The trailing place a query names, or null. `filler` is the board's own list
 * of words that cannot be in a title: when the head is only those ("jobs in
 * Texas"), the head becomes "" and the request browses the place.
 */
export function liftTrailingPlace(q: string, filler: ReadonlySet<string>): PlaceLift | null {
  const m = TRAILING_PLACE.exec(q.trim());
  if (!m) return null;
  const place = m[3].replace(/’/g, "'").replace(/\s+/g, " ").trim();
  if (!place || place.split(" ").length > 4) return null;
  const patch = knownPlace(place);
  if (!patch) return null;
  const head = m[1].trim();
  const onlyFiller = head.toLowerCase().split(/\s+/).every((w) => filler.has(w));
  return { label: `${m[2].toLowerCase()} ${m[3].trim()}`, head: onlyFiller ? "" : head, patch };
}

/**
 * The location strings to search, as locationTerms answers, except that
 * "City, ST" / "City, State" searches the city in that state under each
 * spelling the employers use: "Austin, TX", "Austin, Texas", "Austin,TX".
 */
export function placeTerms(raw: unknown): { terms: string[]; expandedFrom: string | null } {
  const clean = sanitizeTerm(String(raw ?? ""));
  const cs = CITY_STATE.exec(clean);
  const st = cs ? stateOf(cs[2]) : undefined;
  if (!cs || !st) return locationTerms(raw);
  const city = cs[1].trim();
  const code = st.names.find((n) => n.startsWith(", "))?.slice(2) ?? "";
  const name = st.names.find((n) => !n.startsWith(", ")) ?? "";
  const terms = [...new Set([`${city}, ${code}`, `${city}, ${name}`, `${city},${code}`].filter((t) => !/, ?$/.test(t)))];
  return { terms, expandedFrom: clean };
}

/** placeTerms for search_jobs' p_location, pipe-joined as rankedLocationParam does. */
export function rankedPlaceParam(raw: unknown): string | null {
  const joined = placeTerms(raw).terms.map((t) => sanitizeTerm(t)).filter(Boolean).join("|");
  return joined || null;
}
