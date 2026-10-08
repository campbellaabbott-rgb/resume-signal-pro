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
 * The codes this module can reason about. Exported so the account UI cannot
 * offer a country the matcher does not recognise — a chip the candidate ticks
 * that then fails `toCode` would look like a stated authorisation and behave
 * like silence. A test asserts the UI's list is a subset of this one.
 */
export const KNOWN_COUNTRY_CODES: readonly string[] = Object.keys(COUNTRIES);

/** Every country/region a label mentions. Empty = the question names none. */
export function countriesIn(label: string): string[] {
  const t = ` ${norm(label)} `;
  const hits = new Set<string>();
  for (const [code, aliases] of Object.entries(COUNTRIES)) {
    for (const a of aliases) {
      // Whole-token match. Substring matching turns "us" into a hit on
      // "industry", "discuss" and "customer" — which would silently attach a
      // country to questions that name none.
      if (code === "US" && a === "us") {
        if (t.includes(" us ") && usAsCountry(label)) { hits.add(code); break; }
        continue;
      }
      if (code === "US" && a === "america" && NOT_THE_US_AMERICA.test(t)) continue;
      if (t.includes(` ${a} `)) { hits.add(code); break; }
    }
  }
  for (const [code, re] of REGION_ALIASES) if (re.test(undot(label))) hits.add(code);
  return [...hits];
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
): CountryVerdict {
  const asked = countriesIn(label);
  if (asked.length === 0) return { kind: "no-country" };

  const own = toCode(ownCountry);
  const have = new Set(authorised);
  if (own) have.add(own);

  // EVERY named country must be covered. One match used to be enough, so
  // "authorised to work in the US and Canada?" was a Yes for a candidate who
  // had stated only the US: a claim about Canada nobody made (S8-007).
  let first: string | null = null;
  for (const a of asked) {
    if (a === "EU_EEA") {
      // Covered only by a country actually in the bloc. The whole reason this
      // is a list rather than a guess is that "Europe" and "the EU" stopped
      // being interchangeable with "the UK" in 2020.
      const inBloc = [...have].find((c) => EU_EEA.has(c));
      if (!inBloc) return { kind: "not-covered", asked };
      first = first ?? inBloc;
      continue;
    }
    if (!have.has(a)) return { kind: "not-covered", asked };
    first = first ?? a;
  }
  return { kind: "covered", country: first ?? asked[0]! };
}
