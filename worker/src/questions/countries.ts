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
  US: ["united states", "usa", "u.s.a.", "u.s.", "us", "america", "the states"],
  GB: ["united kingdom", "uk", "u.k.", "great britain", "britain", "england", "scotland", "wales"],
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
};

/**
 * Regions. An "EU/EEA" question is not answerable from a single country unless
 * that country is in the bloc — and even then only where the candidate stated
 * the country, since bloc membership changes and Brexit is the obvious reason
 * to encode this rather than assume it.
 */
const EU_EEA = new Set([
  "IE", "DE", "FR", "ES", "PT", "IT", "NL", "BE", "AT", "PL", "SE", "DK", "FI",
  // EEA but not EU
  "NO",
]);
const REGION_ALIASES: Array<[string, RegExp]> = [
  ["EU_EEA", /\b(eu|e\.u\.|european union|eea|e\.e\.a\.|europe)\b/i],
];

const norm = (s: string) => s.toLowerCase().replace(/[.,;:!?]/g, " ").replace(/\s+/g, " ").trim();

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
      if (t.includes(` ${a} `)) { hits.add(code); break; }
    }
  }
  for (const [code, re] of REGION_ALIASES) if (re.test(label)) hits.add(code);
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

  for (const a of asked) {
    if (a === "EU_EEA") {
      // Covered only by a country actually in the bloc. The whole reason this
      // is a list rather than a guess is that "Europe" and "the EU" stopped
      // being interchangeable with "the UK" in 2020.
      const inBloc = [...have].find((c) => EU_EEA.has(c));
      if (inBloc) return { kind: "covered", country: inBloc };
      continue;
    }
    if (have.has(a)) return { kind: "covered", country: a };
  }
  return { kind: "not-covered", asked };
}
