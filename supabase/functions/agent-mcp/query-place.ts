// THE FIRST SEARCH ANSWERS THE QUESTION AS ASKED (spec D2 §2.3).
//
// Measured 2026-10-11: "nurse jobs in Texas" sent as the query found 107 of
// the 1,584 nurse postings the board serves in Texas, because the place was
// searched as words of the title; and "Humana" as a company found nothing,
// because `companies` takes a board token, never a name. A person's AI types
// what the person said. This module reads it the way the person meant it:
//
//   - a trailing "in", "near" or "around" followed by a KNOWN place moves the
//     place to `location` (a US state or Canadian province by name, a metro
//     alias the board expands, or "City, ST" with a real state code) or to
//     `country` (a country by name). An unknown word after "in" is left
//     alone: "Engineer in Training" and "Head of Growth in Fintech" are
//     titles, and a two-letter code alone ("Director of IN programs") is
//     never read as a state;
//   - a trailing "remote" or "anywhere" sets remote:true; a leading one is a
//     title ("Remote Sensing Analyst");
//   - "City, ST" is kept as written, because a city name can span states and
//     the per-city state shares that would justify dropping the state are not
//     in this repository; the answer says so in locationInterpreted;
//   - a split happens only when the query that remains is not empty, and
//     never when the caller already set location (or country) itself.
//
// Company names go through job-board's company-suggest (the caller does the
// I/O; pickCompany below is the rule): an exact normalised name, or that name
// with a parenthesised qualifier, resolves to the employer's token(s); any
// other name is named in ignoredFilters with up to five candidates. Two
// different employers are never merged.
//
// Pure: no I/O, so the Node suite walks every positive and negative.

import { METRO_ALIASES, STATE_ALIASES } from "../_shared/location-terms.ts";
import { toCode } from "../_shared/work-countries.ts";

/** What was read out of the query, said back to the caller. */
export type QueryReading = {
  query: string;
  location?: string;
  country?: string;
  remote?: true;
  /** The words moved out of the query, as typed. */
  from?: string;
  note?: string;
};

/** Metro shorthands that are also ordinary words or too short to trust at the end of a query. */
const METRO_SKIP = new Set(["the city", "la"]);
/** Filler a person puts after the role: "nurse jobs in Texas" searches "nurse". */
const FILLER = /\s+(?:jobs?|roles?|positions?|openings?|vacanc(?:y|ies)|careers?|work)\s*$/i;

const norm = (s: string) => s.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();

/** A place the board's location filter knows by this exact name, or null. */
function knownLocation(place: string): string | null {
  const p = norm(place);
  if (p.length > 2 && Object.prototype.hasOwnProperty.call(STATE_ALIASES, p)) return place.trim();
  if (!METRO_SKIP.has(p) && Object.prototype.hasOwnProperty.call(METRO_ALIASES, p)) return place.trim();
  return null;
}

/** "Austin, TX" / "Toronto, ON": a city and a real US state or Canadian province code. */
function cityState(place: string): string | null {
  const m = /^([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Za-z]{2})$/.exec(place.trim());
  if (!m) return null;
  const code = m[2].toUpperCase();
  // Every US state and Canadian province code is a two-letter key of the board's own alias table.
  return Object.prototype.hasOwnProperty.call(STATE_ALIASES, code.toLowerCase()) ? `${m[1].trim()}, ${code}` : null;
}

/** A country by name (never a code), or null. */
function countryOf(place: string): string | null {
  const p = place.trim();
  if (p.length < 3 || /,/.test(p) || p.split(/\s+/).length > 3) return null;
  return toCode(p);
}

/**
 * The query as the person meant it. `hasLocation` / `hasCountry` /
 * `hasRemote`: the caller already set that filter, so nothing is moved into it.
 */
export function readQuery(raw: string, has: { location?: boolean; country?: boolean; remote?: boolean } = {}): QueryReading {
  const original = String(raw ?? "").replace(/\s+/g, " ").trim();
  let query = original;
  const out: QueryReading = { query };
  // remote / anywhere, at the END only.
  const remote = /(?:^|[\s,(-])(?:fully\s+)?(?:remote|anywhere)\)?\s*$/i.exec(query);
  if (remote && !has.remote) {
    const rest = query.slice(0, remote.index).replace(/[\s,(-]+$/, "").trim();
    if (rest) {
      query = rest;
      out.remote = true;
      out.from = original.slice(remote.index).trim();
    }
  }
  const at = /\s(?:in|near|around)\s+([^]+?)\s*$/i.exec(query);
  if (at && !has.location) {
    // "in the bay area", "in the UK": the article is not part of the place.
    const place = at[1].replace(/^the\s+/i, "");
    const rest = query.slice(0, at.index).trim();
    const stated = cityState(place);
    const location = stated ?? knownLocation(place);
    const country = location || has.country ? null : countryOf(place);
    if (rest && (location || country)) {
      query = rest;
      if (location) out.location = location;
      if (country) out.country = country;
      out.from = [original.slice(at.index).trim(), out.from].filter(Boolean).join(" ").trim();
      if (stated) out.note = `"${stated}" was kept as written: a city name can span states.`;
    }
  }
  if (out.location || out.country || out.remote) {
    const trimmed = query.replace(FILLER, "").trim();
    if (trimmed) query = trimmed;
  }
  out.query = query;
  return out;
}

/** An employer candidate as company-suggest answers it. */
export type CompanyCandidate = { token?: unknown; name?: unknown; open?: unknown; tokens?: unknown };

/** Lower-case, accents and punctuation removed: "Domino's" and "dominos" are one name. */
export const foldName = (s: string): string =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\u0080-￿]+/g, "");

/** True for a string that is already a board token rather than a name. */
export const looksLikeToken = (s: string): boolean => /~/.test(s) || /^[a-z0-9][a-z0-9._-]*$/.test(s);

/**
 * The employer an asked name means: every candidate whose name is the asked
 * name exactly (folded), or that name with a parenthesised qualifier ("Acme
 * (UK)"). Their tokens, or null with up to five candidate names for the
 * caller to offer. Never two different employer names.
 */
export function pickCompany(asked: string, candidates: readonly CompanyCandidate[]): { name: string; tokens: string[] } | { candidates: string[] } {
  const want = foldName(asked);
  const base = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, "");
  const hits = candidates.filter((c) => typeof c.name === "string" && (foldName(c.name) === want || foldName(base(c.name)) === want));
  const tokens = [...new Set(hits.flatMap((c) => (Array.isArray(c.tokens) && c.tokens.length ? c.tokens : [c.token]).filter((t): t is string => typeof t === "string" && !!t)))];
  if (hits.length && tokens.length) return { name: base(String(hits[0].name)), tokens };
  return { candidates: candidates.map((c) => String(c.name ?? "")).filter(Boolean).slice(0, 5) };
}
