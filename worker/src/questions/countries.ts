/**
 * Which country is a work-authorisation question actually about?
 *
 * THE BUG THIS EXISTS TO FIX, found 2026-08-01 in code shipped that morning.
 * `workAuthorized` was a single global boolean, and every authorisation
 * question was answered from it. So a candidate authorised in the UK answered
 * "Yes" to:
 *
 *     Are you legally authorized to work in the US?
 *     Work authorization in Germany:
 *     Are you legally authorised to work in Australia?
 *
 * All three false, stated to an employer under a real person's name, on the one
 * question employers filter hardest on. A wrong answer here is not a bug that
 * wastes an application — it is a false claim about someone's immigration
 * status, and it is worse than not applying.
 *
 * Being authorised somewhere is not being authorised everywhere. A single
 * boolean can only honestly answer a question about the country the candidate
 * said they are in; anything else needs stating explicitly.
 *
 * MATCHING IS DELIBERATELY NARROW. An unrecognised country returns null, and
 * the caller refuses. Guessing a country from a partial string match is how
 * "Are you authorised to work in the Republic of Ireland" becomes an answer
 * about Ireland when the candidate said Northern Ireland — so the aliases here
 * are exact tokens, not substrings of arbitrary words.
 *
 * COPIED BYTE FOR BYTE to supabase/functions/_shared/work-countries.ts, where
 * the review sheet asks the same question of the same labels; the worker
 * builds from worker/src alone, so the two cannot share one file. A test holds
 * them identical: change both, or neither.
 */

/** Canonical code -> the ways forms and people actually write it. */
const COUNTRIES: Record<string, string[]> = {
  // Dotted spellings ("U.S.", "U.S.A.", "U.K.") are not listed: norm() takes
  // the dots out of an initialism first, so they arrive here as "us"/"usa"/"uk".
  // The bare "us" is ALSO the pronoun; countriesIn() reads it as the country
  // only where the label says so (see usAsCountry).
  US: ["united states", "usa", "us", "america", "the states"],
  GB: ["united kingdom", "uk", "great britain", "britain", "england", "scotland", "wales"],
  IE: ["ireland", "republic of ireland", "eire"],
  CA: ["canada"],
  AU: ["australia"],
  NZ: ["new zealand"],
  DE: ["germany", "deutschland", "german"],
  FR: ["france", "french"],
  ES: ["spain", "españa", "espana", "spanish"],
  PT: ["portugal", "portuguese"],
  IT: ["italy", "italia", "italian"],
  NL: ["netherlands", "the netherlands", "holland", "dutch"],
  BE: ["belgium", "belgië", "belgique"],
  CH: ["switzerland", "schweiz", "suisse", "swiss"],
  AT: ["austria", "österreich", "osterreich"],
  PL: ["poland", "polska"],
  SE: ["sweden", "sverige"],
  DK: ["denmark", "danmark"],
  NO: ["norway", "norge"],
  FI: ["finland", "suomi"],
  IN: ["india"],
  SG: ["singapore"],
  AE: ["uae", "united arab emirates", "dubai"],
  ZA: ["south africa"],
  MX: ["mexico", "méxico"],
  BR: ["brazil", "brasil"],
  JP: ["japan"],
  MT: ["malta"],
  LU: ["luxembourg"],
  CZ: ["czechia", "czech republic"],
  HU: ["hungary"],
  RO: ["romania"],
  GR: ["greece"],
  HR: ["croatia"],
  SK: ["slovakia"],
  SI: ["slovenia"],
  BG: ["bulgaria"],
  EE: ["estonia"],
  LV: ["latvia"],
  LT: ["lithuania"],
  CY: ["cyprus"],
  IS: ["iceland"],
  IL: ["israel"],
  HK: ["hong kong"],
  KR: ["south korea"],
  MY: ["malaysia"],
  PH: ["philippines"],
  ID: ["indonesia"],
  TH: ["thailand"],
  VN: ["vietnam"],
  NG: ["nigeria"],
  KE: ["kenya"],
  SA: ["saudi arabia"],
  QA: ["qatar"],
  PK: ["pakistan"],
  AR: ["argentina"],
  CL: ["chile"],
  CO: ["colombia"],
};

/**
 * Regions. An "EU/EEA" question is not answerable from a single country unless
 * that country is in the bloc — and even then only where the candidate stated
 * the country, since bloc membership changes and Brexit is the obvious reason
 * to encode this rather than assume it.
 */
const EU_EEA = new Set([
  "IE", "DE", "FR", "ES", "PT", "IT", "NL", "BE", "AT", "PL", "SE", "DK", "FI",
  "MT", "LU", "CZ", "HU", "RO", "GR", "HR", "SK", "SI", "BG", "EE", "LV", "LT", "CY",
  // EEA but not EU
  "NO", "IS",
]);
const REGION_ALIASES: Array<[string, RegExp]> = [
  ["EU_EEA", /\b(eu|e\.u\.|european union|eea|e\.e\.a\.|europe)\b/i],
];

/**
 * Initialisms lose their dots BEFORE punctuation becomes space. The old order
 * turned "U.S." into "u s" and "U.K." into "u k", so no alias could ever match
 * and the commonest spelling on a US form read as "no country" — answered from
 * the candidate's home-country boolean (sweep S8-007).
 */
const undot = (s: string) => s.replace(/\b(?:[A-Za-z]\.){1,3}[A-Za-z]\b\.?/g, (m) => m.replace(/\./g, ""));
const norm = (s: string) =>
  undot(s).toLowerCase().replace(/[.,;:!?()/]/g, " ").replace(/\s+/g, " ").trim();

/**
 * "us" the country, not "us" the pronoun. "Would you work for us in Germany?"
 * is a question about Germany; reading the pronoun as the United States made
 * it [US, DE] and let a US candidate answer it. The capitalised initialism is
 * the country (unless the whole label is shouted, when case says nothing); in
 * lower case only a place phrase ("in the us", "the us", "in us") is.
 */
function usAsCountry(label: string): boolean {
  const u = undot(label);
  if (/[a-z]/.test(u) && /(^|[^A-Za-z])US(?![A-Za-z])/.test(u)) return true;
  return /\b(?:(?:in|within|outside(?:\s+of)?|across|throughout)\s+(?:the\s+)?|the\s+)us\b/i.test(u);
}
/** "Latin America" and "South America" are not the United States. */
const NOT_THE_US_AMERICA = /\b(latin|south|central|north)\s+america\b/;
/**
 * Named multi-country places: ASKED, never absent. Read as no country, they
 * were answered from the home-country boolean, so a UK candidate told
 * employers they may work in North America. North America is the US, Canada
 * and Mexico, each to be covered; LATAM is a region no stated country covers,
 * so the question goes to the candidate. Matched on the normalised label.
 */
const NAMED_REGIONS: Array<[RegExp, string[]]> = [
  [/ north america /, ["US", "CA", "MX"]],
  [/ (?:latin|south|central) america | latam /, ["LATAM"]],
  [/ americas /, ["US", "CA", "MX", "LATAM"]],
];
const PLACE_WORDS_OUTSIDE_COUNTRIES = /\b(?:(?:north|latin|south|central) america|latam|americas|eu|european union|eea|europe)\b/g;

/**
 * The codes this module can reason about. Exported so the account UI cannot
 * offer a country the matcher does not recognise — a chip the candidate ticks
 * that then fails `toCode` would look like a stated authorisation and behave
 * like silence. A test asserts the UI's list is a subset of this one.
 */
export const KNOWN_COUNTRY_CODES: readonly string[] = Object.keys(COUNTRIES);

/**
 * Every place a label names, each as the codes it stands for: a country is
 * one code, "North America" three. Empty = the question names none.
 */
function placesIn(label: string): string[][] {
  const t = ` ${norm(label)} `;
  const places: string[][] = [];
  for (const [code, aliases] of Object.entries(COUNTRIES)) {
    for (const a of aliases) {
      // Whole-token match. Substring matching turns "us" into a hit on
      // "industry", "discuss" and "customer" — which would silently attach a
      // country to questions that name none.
      if (code === "US" && a === "us") {
        if (t.includes(" us ") && usAsCountry(label)) { places.push([code]); break; }
        continue;
      }
      if (code === "US" && a === "america" && NOT_THE_US_AMERICA.test(t)) continue;
      if (t.includes(` ${a} `)) { places.push([code]); break; }
    }
  }
  for (const [code, re] of REGION_ALIASES) if (re.test(undot(label))) places.push([code]);
  for (const [re, codes] of NAMED_REGIONS) if (re.test(t)) places.push(codes);
  return places;
}

/** Every country/region code a label names. Empty = the question names none. */
export function countriesIn(label: string): string[] {
  return [...new Set(placesIn(label).flat())];
}

/**
 * True when the places a label names are joined by "or" and nothing else
 * ("the UK or Ireland", "either the UK or the EU"): one of them answers it.
 * Anything else between them, "and" included, and every place is needed.
 */
function joinedOnlyByOr(label: string): boolean {
  let t = ` ${norm(label)} `;
  const words = Object.entries(COUNTRIES)
    .flatMap(([code, aliases]) => aliases.filter((a) => !(code === "US" && a === "us") || usAsCountry(label)))
    .sort((a, b) => b.length - a.length);
  t = t.replace(PLACE_WORDS_OUTSIDE_COUNTRIES, " § ");
  for (const w of words) t = t.split(` ${w} `).join(" § ");
  const first = t.indexOf("§");
  const last = t.lastIndexOf("§");
  if (first === last) return false;
  const between = t.slice(first, last + 1);
  return / or /.test(between) && between.replace(/§|\b(?:or|either|the)\b/g, "").trim() === "";
}

/** Turn a candidate's free-text country into a code, or null if unrecognised. */
export function toCode(country: string): string | null {
  const t = ` ${norm(country)} `;
  for (const [code, aliases] of Object.entries(COUNTRIES)) {
    for (const a of aliases) if (t.includes(` ${a} `)) return code;
  }
  return null;
}

export type CountryVerdict =
  | { kind: "no-country" }
  | { kind: "covered"; country: string }
  | { kind: "not-covered"; asked: string[] };

/**
 * Can we honestly answer an authorisation question about these countries?
 *
 * @param authorised codes the candidate has explicitly said they may work in
 * @param ownCountry their stated country, which the single `work_authorized`
 *        boolean is about and nothing more
 */
export function coverage(
  label: string,
  authorised: readonly string[],
  ownCountry: string,
  opts: { orMeansAny?: boolean } = {},
): CountryVerdict {
  const places = placesIn(label);
  const asked = countriesIn(label);
  if (asked.length === 0) return { kind: "no-country" };

  const own = toCode(ownCountry);
  const have = new Set(authorised);
  if (own) have.add(own);

  // Covered only by a country actually in the bloc. The whole reason this
  // is a list rather than a guess is that "Europe" and "the EU" stopped
  // being interchangeable with "the UK" in 2020.
  const covers = (code: string): string | null =>
    code === "EU_EEA" ? [...have].find((c) => EU_EEA.has(c)) ?? null : have.has(code) ? code : null;
  const coveredBy = (place: string[]): string | null => {
    const by = place.map(covers);
    return by.every((c) => c !== null) ? by[0]! : null;
  };

  // "Authorised in the UK or the EU?" is answered by either: a candidate
  // stating the UK says a true Yes. Only where the caller says a disjunction
  // can be met by one place (authorisation, not sponsorship).
  if (opts.orMeansAny && places.length > 1 && joinedOnlyByOr(label)) {
    for (const p of places) {
      const by = coveredBy(p);
      if (by) return { kind: "covered", country: by };
    }
    return { kind: "not-covered", asked };
  }

  // EVERY named place must be covered. One match used to be enough, so
  // "authorised to work in the US and Canada?" was a Yes for a candidate who
  // had stated only the US: a claim about Canada nobody made (S8-007).
  let first: string | null = null;
  for (const p of places) {
    const by = coveredBy(p);
    if (!by) return { kind: "not-covered", asked };
    first = first ?? by;
  }
  return { kind: "covered", country: first ?? asked[0]! };
}
