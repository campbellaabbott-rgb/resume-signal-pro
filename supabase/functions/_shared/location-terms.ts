// LOCATION ALIASES, SHARED — so the API's default engine and the board mean the same place.
//
// These tables and locationTerms() lived inside job-board. /v1's default
// engine could not reach them, so it REFUSED location= outright rather than
// match the string literally and answer a narrower question under the same
// parameter name (the divergence the board itself was once bitten by: "bay
// area" returned San Jose 10 on one path and zero on the other). Lifted here
// 2026-09-03, byte-for-byte, so both engines expand "NYC" and "bay area" into
// the same places. The board imports them back; nothing about its behaviour
// changes. Guards that used to read these out of index.ts read this file now.

export const sanitizeTerm = (t: string) => t.replace(/[%_\\|"]/g, "").trim();

export const STATE_ALIASES: Record<string, { names: string[]; keepRaw: boolean }> = {
  "alabama": { names: ["Alabama", ", AL"], keepRaw: false },
  "al": { names: ["Alabama", ", AL"], keepRaw: false },
  "alaska": { names: ["Alaska", ", AK"], keepRaw: false },
  "ak": { names: ["Alaska", ", AK"], keepRaw: false },
  "arizona": { names: ["Arizona", ", AZ"], keepRaw: false },
  "az": { names: ["Arizona", ", AZ"], keepRaw: false },
  "arkansas": { names: ["Arkansas", ", AR"], keepRaw: false },
  "ar": { names: ["Arkansas", ", AR"], keepRaw: false },
  "california": { names: ["California", ", CA"], keepRaw: false },
  "ca": { names: ["California", ", CA"], keepRaw: false },
  "colorado": { names: ["Colorado", ", CO"], keepRaw: false },
  "co": { names: ["Colorado", ", CO"], keepRaw: false },
  "connecticut": { names: ["Connecticut", ", CT"], keepRaw: false },
  "ct": { names: ["Connecticut", ", CT"], keepRaw: false },
  "delaware": { names: ["Delaware", ", DE"], keepRaw: false },
  "de": { names: ["Delaware", ", DE"], keepRaw: false },
  "florida": { names: ["Florida", ", FL"], keepRaw: false },
  "fl": { names: ["Florida", ", FL"], keepRaw: false },
  "georgia": { names: ["Georgia", ", GA"], keepRaw: false },
  "ga": { names: ["Georgia", ", GA"], keepRaw: false },
  "hawaii": { names: ["Hawaii", ", HI"], keepRaw: false },
  "hi": { names: ["Hawaii", ", HI"], keepRaw: false },
  "idaho": { names: ["Idaho", ", ID"], keepRaw: false },
  "id": { names: ["Idaho", ", ID"], keepRaw: false },
  "illinois": { names: ["Illinois", ", IL"], keepRaw: false },
  "il": { names: ["Illinois", ", IL"], keepRaw: false },
  "indiana": { names: ["Indiana", ", IN"], keepRaw: false },
  "in": { names: ["Indiana", ", IN"], keepRaw: false },
  "iowa": { names: ["Iowa", ", IA"], keepRaw: false },
  "ia": { names: ["Iowa", ", IA"], keepRaw: false },
  "kansas": { names: ["Kansas", ", KS"], keepRaw: false },
  "ks": { names: ["Kansas", ", KS"], keepRaw: false },
  "kentucky": { names: ["Kentucky", ", KY"], keepRaw: false },
  "ky": { names: ["Kentucky", ", KY"], keepRaw: false },
  "louisiana": { names: ["Louisiana", ", LA"], keepRaw: false },
  "la": { names: ["Louisiana", ", LA"], keepRaw: false },
  "maine": { names: ["Maine", ", ME"], keepRaw: false },
  "me": { names: ["Maine", ", ME"], keepRaw: false },
  "maryland": { names: ["Maryland", ", MD"], keepRaw: false },
  "md": { names: ["Maryland", ", MD"], keepRaw: false },
  "massachusetts": { names: ["Massachusetts", ", MA"], keepRaw: false },
  "ma": { names: ["Massachusetts", ", MA"], keepRaw: false },
  "michigan": { names: ["Michigan", ", MI"], keepRaw: false },
  "mi": { names: ["Michigan", ", MI"], keepRaw: false },
  "minnesota": { names: ["Minnesota", ", MN"], keepRaw: false },
  "mn": { names: ["Minnesota", ", MN"], keepRaw: false },
  "mississippi": { names: ["Mississippi", ", MS"], keepRaw: false },
  "ms": { names: ["Mississippi", ", MS"], keepRaw: false },
  "missouri": { names: ["Missouri", ", MO"], keepRaw: false },
  "mo": { names: ["Missouri", ", MO"], keepRaw: false },
  "montana": { names: ["Montana", ", MT"], keepRaw: false },
  "mt": { names: ["Montana", ", MT"], keepRaw: false },
  "nebraska": { names: ["Nebraska", ", NE"], keepRaw: false },
  "ne": { names: ["Nebraska", ", NE"], keepRaw: false },
  "nevada": { names: ["Nevada", ", NV"], keepRaw: false },
  "nv": { names: ["Nevada", ", NV"], keepRaw: false },
  "new hampshire": { names: ["New Hampshire", ", NH"], keepRaw: false },
  "nh": { names: ["New Hampshire", ", NH"], keepRaw: false },
  "new jersey": { names: ["New Jersey", ", NJ"], keepRaw: false },
  "nj": { names: ["New Jersey", ", NJ"], keepRaw: false },
  "new mexico": { names: ["New Mexico", ", NM"], keepRaw: false },
  "nm": { names: ["New Mexico", ", NM"], keepRaw: false },
  "new york": { names: ["New York", ", NY"], keepRaw: false },
  "ny": { names: ["New York", ", NY"], keepRaw: false },
  "north carolina": { names: ["North Carolina", ", NC"], keepRaw: false },
  "nc": { names: ["North Carolina", ", NC"], keepRaw: false },
  "north dakota": { names: ["North Dakota", ", ND"], keepRaw: false },
  "nd": { names: ["North Dakota", ", ND"], keepRaw: false },
  "ohio": { names: ["Ohio", ", OH"], keepRaw: false },
  "oh": { names: ["Ohio", ", OH"], keepRaw: false },
  "oklahoma": { names: ["Oklahoma", ", OK"], keepRaw: false },
  "ok": { names: ["Oklahoma", ", OK"], keepRaw: false },
  "oregon": { names: ["Oregon", ", OR"], keepRaw: false },
  "or": { names: ["Oregon", ", OR"], keepRaw: false },
  "pennsylvania": { names: ["Pennsylvania", ", PA"], keepRaw: false },
  "pa": { names: ["Pennsylvania", ", PA"], keepRaw: false },
  "rhode island": { names: ["Rhode Island", ", RI"], keepRaw: false },
  "ri": { names: ["Rhode Island", ", RI"], keepRaw: false },
  "south carolina": { names: ["South Carolina", ", SC"], keepRaw: false },
  "sc": { names: ["South Carolina", ", SC"], keepRaw: false },
  "south dakota": { names: ["South Dakota", ", SD"], keepRaw: false },
  "sd": { names: ["South Dakota", ", SD"], keepRaw: false },
  "tennessee": { names: ["Tennessee", ", TN"], keepRaw: false },
  "tn": { names: ["Tennessee", ", TN"], keepRaw: false },
  "texas": { names: ["Texas", ", TX"], keepRaw: false },
  "tx": { names: ["Texas", ", TX"], keepRaw: false },
  "utah": { names: ["Utah", ", UT"], keepRaw: false },
  "ut": { names: ["Utah", ", UT"], keepRaw: false },
  "vermont": { names: ["Vermont", ", VT"], keepRaw: false },
  "vt": { names: ["Vermont", ", VT"], keepRaw: false },
  "virginia": { names: ["Virginia", ", VA"], keepRaw: false },
  "va": { names: ["Virginia", ", VA"], keepRaw: false },
  "washington": { names: ["Washington", ", WA"], keepRaw: false },
  "wa": { names: ["Washington", ", WA"], keepRaw: false },
  "west virginia": { names: ["West Virginia", ", WV"], keepRaw: false },
  "wv": { names: ["West Virginia", ", WV"], keepRaw: false },
  "wisconsin": { names: ["Wisconsin", ", WI"], keepRaw: false },
  "wi": { names: ["Wisconsin", ", WI"], keepRaw: false },
  "wyoming": { names: ["Wyoming", ", WY"], keepRaw: false },
  "wy": { names: ["Wyoming", ", WY"], keepRaw: false },
  "district of columbia": { names: ["District of Columbia", ", DC"], keepRaw: false },
  "dc": { names: ["District of Columbia", ", DC"], keepRaw: false },
  "alberta": { names: ["Alberta", ", AB"], keepRaw: false },
  "ab": { names: ["Alberta", ", AB"], keepRaw: false },
  "british columbia": { names: ["British Columbia", ", BC"], keepRaw: false },
  "bc": { names: ["British Columbia", ", BC"], keepRaw: false },
  "manitoba": { names: ["Manitoba", ", MB"], keepRaw: false },
  "mb": { names: ["Manitoba", ", MB"], keepRaw: false },
  "new brunswick": { names: ["New Brunswick", ", NB"], keepRaw: false },
  "nb": { names: ["New Brunswick", ", NB"], keepRaw: false },
  "newfoundland and labrador": { names: ["Newfoundland and Labrador", ", NL"], keepRaw: false },
  "nl": { names: ["Newfoundland and Labrador", ", NL"], keepRaw: false },
  "nova scotia": { names: ["Nova Scotia", ", NS"], keepRaw: false },
  "ns": { names: ["Nova Scotia", ", NS"], keepRaw: false },
  "ontario": { names: ["Ontario", ", ON"], keepRaw: false },
  "on": { names: ["Ontario", ", ON"], keepRaw: false },
  "prince edward island": { names: ["Prince Edward Island", ", PE"], keepRaw: false },
  "pe": { names: ["Prince Edward Island", ", PE"], keepRaw: false },
  "quebec": { names: ["Quebec", ", QC"], keepRaw: false },
  "qc": { names: ["Quebec", ", QC"], keepRaw: false },
  "saskatchewan": { names: ["Saskatchewan", ", SK"], keepRaw: false },
  "sk": { names: ["Saskatchewan", ", SK"], keepRaw: false },
};

export const METRO_ALIASES: Record<string, { names: string[]; keepRaw: boolean }> = {
  nyc: { names: ["New York"], keepRaw: true },
  "new york city": { names: ["New York"], keepRaw: false },
  sf: { names: ["San Francisco"], keepRaw: false },
  "bay area": { names: ["San Francisco", "Oakland", "San Jose"], keepRaw: false },
  la: { names: ["Los Angeles"], keepRaw: false },
  philly: { names: ["Philadelphia"], keepRaw: false },
  atl: { names: ["Atlanta"], keepRaw: false },
  dfw: { names: ["Dallas", "Fort Worth"], keepRaw: false },
  nola: { names: ["New Orleans"], keepRaw: false },
  "the city": { names: ["New York"], keepRaw: false },

  // A CITY WRITTEN IN ITS OWN LANGUAGE IS A DIFFERENT STRING, AND SUBSTRING
  // MATCHING CANNOT BRIDGE THAT. Nothing connects "Munich" to "München" — a
  // visitor sees whichever spelling their own vocabulary happens to share with
  // the employer's HR system, and never learns the rest exists.
  //
  // MEASURED LIVE 2026-08-22 (fresh, present postings), English form vs local:
  //   Bangalore  3,074  /  Bengaluru 3,181   — either speller misses about half
  //   Munich       966  /  München     757
  //   Warsaw     1,017  /  Warszawa    265
  //   Milan        642  /  Milano      240
  //   Lisbon       535  /  Lisboa      163
  //   Prague       449  /  Praha       113
  //   Florence     425  /  Firenze      17
  //   Geneva       351  /  Genève       48
  //   Brussels     314  /  Bruxelles   124
  //   Vienna       294  /  Wien        193
  //   Zurich       288  /  Zürich      178
  //   Copenhagen   206  /  København    39
  //   Cologne      119  /  Köln        346   — the English speller sees 26%
  //   Krakow       398  /  Kraków      148
  //   Gothenburg    42  /  Göteborg     18
  //
  // EVERY LOCAL FORM WAS CHECKED FOR SUBSTRING POISON before being listed, the
  // same test that keeps "LA" from matching "Plain City". Each of the forms
  // below returns only its own city.
  //
  // ROME IS DELIBERATELY ABSENT. "%Roma%" looked like the biggest win in the
  // set at 1,270 hits and is almost entirely ROMANIA — Bucharest, Cluj-Napoca,
  // Timișoara. Anchoring it as "Roma," survives Romania but still collects
  // "Roma, QLD, Australia" and "VIA ROMA," in Talamona, for 70 hits. A filter
  // that answers "Rome" with Bucharest is worse than one that answers with
  // less, so Rome keeps the plain substring it already had.
  //
  // Mumbai/Bombay and The Hague/Den Haag are absent for the opposite reason:
  // the alternate spelling returns ZERO postings, so the entry would be dead
  // weight pretending to be coverage.
  munich: { names: ["Munich", "München"], keepRaw: false },
  "münchen": { names: ["Munich", "München"], keepRaw: false },
  muenchen: { names: ["Munich", "München"], keepRaw: false },
  cologne: { names: ["Cologne", "Köln"], keepRaw: false },
  "köln": { names: ["Cologne", "Köln"], keepRaw: false },
  koeln: { names: ["Cologne", "Köln"], keepRaw: false },
  vienna: { names: ["Vienna", "Wien"], keepRaw: false },
  wien: { names: ["Vienna", "Wien"], keepRaw: false },
  prague: { names: ["Prague", "Praha"], keepRaw: false },
  praha: { names: ["Prague", "Praha"], keepRaw: false },
  lisbon: { names: ["Lisbon", "Lisboa"], keepRaw: false },
  lisboa: { names: ["Lisbon", "Lisboa"], keepRaw: false },
  milan: { names: ["Milan", "Milano"], keepRaw: false },
  milano: { names: ["Milan", "Milano"], keepRaw: false },
  florence: { names: ["Florence", "Firenze"], keepRaw: false },
  firenze: { names: ["Florence", "Firenze"], keepRaw: false },
  zurich: { names: ["Zurich", "Zürich"], keepRaw: false },
  "zürich": { names: ["Zurich", "Zürich"], keepRaw: false },
  geneva: { names: ["Geneva", "Genève"], keepRaw: false },
  "genève": { names: ["Geneva", "Genève"], keepRaw: false },
  geneve: { names: ["Geneva", "Genève"], keepRaw: false },
  copenhagen: { names: ["Copenhagen", "København"], keepRaw: false },
  "københavn": { names: ["Copenhagen", "København"], keepRaw: false },
  kobenhavn: { names: ["Copenhagen", "København"], keepRaw: false },
  gothenburg: { names: ["Gothenburg", "Göteborg"], keepRaw: false },
  "göteborg": { names: ["Gothenburg", "Göteborg"], keepRaw: false },
  goteborg: { names: ["Gothenburg", "Göteborg"], keepRaw: false },
  warsaw: { names: ["Warsaw", "Warszawa"], keepRaw: false },
  warszawa: { names: ["Warsaw", "Warszawa"], keepRaw: false },
  krakow: { names: ["Krakow", "Kraków"], keepRaw: false },
  "kraków": { names: ["Krakow", "Kraków"], keepRaw: false },
  cracow: { names: ["Krakow", "Kraków"], keepRaw: false },
  brussels: { names: ["Brussels", "Bruxelles", "Brussel"], keepRaw: false },
  bruxelles: { names: ["Brussels", "Bruxelles", "Brussel"], keepRaw: false },
  bangalore: { names: ["Bangalore", "Bengaluru"], keepRaw: false },
  bengaluru: { names: ["Bangalore", "Bengaluru"], keepRaw: false },
};

/**
 * Expand a typed location into the strings actually worth searching.
 *
 * Returns the alias that fired so the board can SAY it expanded the search —
 * a visitor who typed "SF" and sees San Francisco results deserves to know
 * why, and a visitor who meant something else needs to see that we guessed.
 */
/**
 * The location for search_jobs — ONE name, not a delimited list.
 *
 * The pipe-delimited version was correct and is reverted, because the
 * migration that taught search_jobs to split on "|" created a fourteen-
 * parameter OVERLOAD of a fifteen-parameter function and broke ranked search
 * outright (PGRST203). Dropping that overload restores the real definition —
 * which matches ONE substring — so sending "Philly|Philadelphia" here would
 * now match nothing at all. Worse than the bug it fixed.
 *
 * INTERIM, and still better than before: send the first CANONICAL name rather
 * than what the visitor typed. "Philly" searches Philadelphia (1,541 rows
 * instead of 13) and "NYC" searches New York. The union across every alias
 * name is lost on this path until the split lands on the real definition —
 * the browse path keeps it, because it builds its own or() and never touches
 * this RPC.
 *
 * Prefers a canonical name over the raw token deliberately: for "NYC" the
 * names are ["NYC", "New York"], and New York is 12,168 rows against 344.
 */
export function rankedLocationParam(raw: unknown): string | null {
  const { terms } = locationTerms(raw);
  if (terms.length === 0) return null;
  // EVERY NAME, NOT THE BEST SINGLE GUESS.
  //
  // This used to pick one canonical name because the RPC took a single text
  // parameter and matched it with one ILIKE. The browse path had no such limit
  // — it ORs every expanded name — so the two paths answered the same request
  // differently, and the difference was invisible: measured live, "bay area"
  // alone returned San Francisco 40 / San Jose 10 / Oakland 5, while adding
  // q=engineer returned San Francisco 54 / Oakland 1 / San Jose ZERO. Typing a
  // job title shrank the metro.
  //
  // Worse once the disclosure shipped: both paths emit the same
  // locationSearched list, so the page printed "Searched 'bay area' as San
  // Francisco, Oakland, San Jose" over results that had only ever been matched
  // against San Francisco.
  //
  // The RPC splits this on "|" as of 20260823010000. A pipe is the separator
  // because state aliases deliberately CONTAIN commas (", TX" is what stops a
  // bare code matching inside ordinary words) and because sanitizeTerm strips
  // pipes from anything a visitor types — so the only source of one is this
  // table. A single-name location produces no pipe and behaves exactly as it
  // always did.
  const joined = terms.map((t) => sanitizeTerm(t)).filter(Boolean).join("|");
  return joined || null;
}

export function locationTerms(raw: unknown): { terms: string[]; expandedFrom: string | null } {
  const clean = sanitizeTerm(String(raw ?? ""));
  if (!clean) return { terms: [], expandedFrom: null };
  // Metro first: "NYC" and "LA" are cities, not states, and must not be
  // shadowed by a same-spelled code.
  const hit = METRO_ALIASES[clean.toLowerCase()] ?? STATE_ALIASES[clean.toLowerCase()];
  if (!hit) return { terms: [clean], expandedFrom: null };
  return {
    terms: hit.keepRaw ? [clean, ...hit.names] : [...hit.names],
    expandedFrom: clean,
  };
}



