// THE FIRST SEARCH ANSWERS THE QUESTION AS ASKED (spec D2 §2.3).
//
// Measured 2026-10-11: "nurse jobs in Texas" sent as the query found 107 of
// the 1,584 nurse postings the board serves in Texas, because the place was
// searched as words of the title; and "Humana" as a company found nothing,
// because `companies` takes a board token, never a name. A person's AI types
// what the person said. This module reads it the way the person meant it:
//
//   - a trailing "in", "near" or "around" (or "en", "à", "au", "aux", "em",
//     "bei", "nahe", "cerca de", "près de") followed by a KNOWN place moves the
//     place to `location` (a US state or Canadian province by name, a metro
//     alias the board expands, a city of the board's own city table, or
//     "City, ST" with a real state code) or to `country` (a country by name).
//     A city followed by its country ("Manchester UK", "Paris, France") keeps
//     the city in `location` and puts the country in `country` (connect W1,
//     BR-02: the country alone searched all of England for Manchester). An
//     unknown word after "in" is left alone: "Engineer in Training" and "Head
//     of Growth in Fintech" are titles, and a two-letter code alone ("Director
//     of IN programs") is never read as a state;
//   - with no preposition, only a trailing "City, ST" / "City ST", a state or
//     province by name, a metro alias or a city of the board's table moves
//     (connect W1, CJ-06: "registered nurse jobs Austin TX" answered total 0),
//     and never after "of", "the", "for" and the like ("University of Texas");
//   - a trailing "remote" or "anywhere" sets remote:true; a leading one is a
//     title ("Remote Sensing Analyst"). A remote the person excluded (a minus
//     on it, or a negating word before it) is never lifted: the query goes to
//     the board as typed, which is what origin/main's connector sends, and
//     job-board's own split and negated-remote rule read it;
//   - "posted today", "this week", "in the last N days" and "recent" become a
//     date window (maxAgeDays 1, 7 or N) when the caller sent none (BR-05);
//   - "jobs at <Name>" becomes an employer scope the board resolves by name
//     (BR-09); the server re-runs the query as typed when the board resolves
//     no employer;
//   - visa-sponsorship words leave the query, because the board cannot filter
//     on sponsorship and the description tier ranked the employers' refusal
//     disclaimers first (BR-01); a bare "sponsorship" or "visa" stays, since a
//     marketing role or an employer can be called that;
//   - "City, ST" is kept as written, because a city name can span states and
//     the per-city state shares that would justify dropping the state are not
//     in this repository; the answer says so in locationInterpreted;
//   - a place split happens only when the query that remains is not empty,
//     and never when the caller already set that filter itself.
//
// Company names are resolved by the board, never here (sweep S12-080): this
// module only moves the words the person typed after "at" into `companies`,
// and job-board resolves every name under one rule and names what it did.
//
// Pure: no I/O, so the Node suite walks every positive and negative.

import { METRO_ALIASES, STATE_ALIASES } from "../_shared/location-terms.ts";
import { countryMentions, KNOWN_COUNTRY_CODES } from "../_shared/work-countries.ts";
import { KNOWN_CITIES } from "./known-cities.ts";

/** What was read out of the query, said back to the caller. */
export type QueryReading = {
  query: string;
  location?: string;
  country?: string;
  remote?: true;
  /** A date window read from words such as "posted this week". */
  maxAgeDays?: number;
  /** An employer named after "at", for the board to resolve by name. */
  companies?: string[];
  /** The visa-sponsorship words taken out of the query, as typed. */
  sponsorship?: string;
  /** The words moved out of the query, as typed. */
  from?: string;
  /** A location argument read as a city and its country, as it was sent ("London, UK"). */
  locationSent?: string;
  note?: string;
};

/** The filters the caller already set: nothing is moved into one of them. */
export type QueryHas = {
  location?: boolean;
  country?: boolean;
  remote?: boolean;
  /** maxAgeDays or postedAfter. */
  maxAgeDays?: boolean;
  companies?: boolean;
};

/**
 * A place typed after a negation is the place NOT wanted (S12-172):
 * "nurse jobs not in Texas" must not search Texas. The same words
 * job-board/query-place.ts refuses before its own lift, so the board, /v1 and
 * the connector read one query one way.
 */
const NEGATION_BEFORE_PLACE = /(?:^|\s)(?:not|except|excluding|exclude|but|outside|without|minus|other than|anywhere but)$/i;

/**
 * A remote typed after a negation is the remote NOT wanted (wave 4 recheck of
 * the descope): "nurse not remote" lifted to remote:true served only remote
 * postings. The place words, plus the two that negate a work mode, and an
 * article between ("not a remote"). A refused lift leaves the query as typed.
 */
const NEGATION_BEFORE_REMOTE = /(?:^|\s)(?:not|no|non|except|excluding|exclude|but|outside|without|minus|other than|anywhere but)(?:\s+(?:a|an))?$/i;

/** Metro shorthands that are also ordinary words or too short to trust at the end of a query. */
const METRO_SKIP = new Set(["the city", "la"]);
/**
 * City-table entries never taken from a query, as job-board/query-place.ts
 * skips them: English words ("in reading", "nice") and fragments of other
 * names ("cali", "bern", "gent", "roma").
 */
const CITY_NOT_FROM_QUERY = new Set(["reading", "nice", "cali", "bern", "gent", "roma"]);
/** State codes that are also words a query ends on ("nurse in OR" is the operating room). */
const CODE_IS_A_WORD = new Set(["or", "me", "in", "ok", "hi", "id"]);
/**
 * State codes that are also credentials or modalities in a job title
 * ("Orthopedic PA", "Physician MD", "Radiologic Technologist CT"): read as a
 * state after a city only when that city is in the board's own city table.
 */
const CODE_IS_A_CREDENTIAL = new Set(["pa", "ma", "md", "ct", "mt", "ms", "pe", "ne", "nd", "de", "co", "sc", "va", "al", "la", "ga", "nb", "ns", "on"]);
/** Words a job title ends a role with, never a city before a state code ("Registered Nurse, TX"). */
const ROLE_WORD = /^(?:nurse|assistant|engineer|manager|technician|technologist|tech|specialist|analyst|developer|director|associate|representative|rep|physician|therapist|coordinator|driver|clerk|teacher|lead|supervisor|officer|agent|consultant|administrator|pharmacist|hygienist|worker|operator|mechanic|electrician|cook|cashier|intern|sales|remote|hybrid|onsite|jobs?|roles?|positions?|openings?|practitioner|aide|scientist|designer|accountant|attorney|paralegal|counselor|advisor|adviser|recruiter|executive|president|vp|head|chef|server|nanny|tutor|instructor|professor|librarian|planner|buyer|editor|writer|producer|architect|programmer|admin|staff|team|member|part-time|full-time|time|contract|temp|travel|prn|per diem)$/i;
/** City-table names that are also lower-case words ("wine cork"): a place with no preposition only when capitalised. */
const CITY_IS_A_WORD = new Set(["cork", "essen", "buffalo", "lima", "oxford", "wellington", "porto", "phoenix", "florence", "naples", "brighton", "cambridge", "columbus"]);
/** Words that end a city name only with the word before them ("Salt Lake City", "Colorado Springs"). */
const CITY_SUFFIX = new Set(["city", "springs", "beach", "falls", "heights", "park", "rapids", "hills", "island", "valley", "creek", "harbor", "harbour", "point", "grove", "junction", "gardens", "lake", "lakes", "bay", "bluffs", "rock", "village", "worth", "antonio", "francisco", "diego", "jose", "york", "orleans", "vegas", "angeles", "louis", "paso", "haven", "brunswick", "london", "britain", "rochelle", "jersey", "mexico"]);
/** Words that begin a city name ("San", "Fort", "St."). */
const CITY_PREFIX = new Set(["san", "santa", "santo", "los", "las", "el", "new", "fort", "ft", "ft.", "st", "st.", "saint", "salt", "grand", "palm", "port", "mount", "mt", "mt.", "west", "east", "north", "south", "little", "baton", "corpus", "colorado", "kansas", "oklahoma", "jersey", "sioux", "cedar", "round", "sugar", "college", "des", "boca", "daly", "coral", "overland", "rancho", "lake", "long", "virginia", "pompano", "glen", "bowling", "hot", "ann", "cape", "eau", "white", "green", "oak", "carson", "iowa", "sioux", "royal", "bloomfield", "university", "upper", "lower"]);
/**
 * Words after which a trailing place is part of a name, not where the job is:
 * "University of Texas", "Bank of the West", "Made in America".
 */
const NAME_BEFORE_PLACE = /(?:^|\s)(?:of|the|for|and|&|at|to|with|from|by|on|de|del|la|le|y|und|et|university|college|bank|team|club|state|county|city)$/i;
/** A sector a person names before a country ("Head of Growth in Fintech UK"). */
const SECTOR = /^(?:fintech|healthtech|edtech|insurtech|proptech|tech|technology|saas|ai|crypto|web3|banking|finance|financial services|insurance|retail|healthcare|health care|pharma|biotech|startups?|media|gaming|consulting|energy|government|public sector|education|hospitality|logistics|e-?commerce|marketing|sales|legal|non-?profit|charity|construction|manufacturing|engineering|defen[cs]e|aerospace|automotive|telecoms?|real estate)$/i;
/** A region word in front of a country, not a city in it ("southern Spain", "Remote US"). */
const NOT_A_CITY = /^(?:remote|anywhere|all|greater|upstate|downstate|rural|urban|southern|northern|western|eastern|central|south|north|west|east|mid|middle|coastal|across|any|the|republic|whole|entire|in|near|around|jobs?|roles?)$/i;

/** A search's filler word right before a trailing place ("nurse jobs Texas"). */
const FILLER_AT_END = /(?:^|\s)(?:jobs?|roles?|positions?|openings?|vacanc(?:y|ies)|careers?|work|opportunities|hiring)$/i;
/** A head that still ends on a preposition: a place after it was read (or refused) by the preposition rule. */
const PREPOSITION_AT_END = /(?:^|\s)(?:in|near|around|en|à|au|aux|em|bei|nahe|cerca de|près de|pres de|not|outside|except|at)$/i;
/** Filler a person puts after the role: "nurse jobs in Texas" searches "nurse". */
const FILLER = /\s+(?:jobs?|roles?|positions?|openings?|vacanc(?:y|ies)|careers?|work|stellen|stelle|stellenangebote|empleos?|trabajos?|ofertas?|emplois?|postes?|vagas?|vacatures?)\s*$/i;
/** The same filler where Spanish, French, Portuguese and German put it: first ("trabajo de enfermera", "emploi développeur"). */
const LEADING_FILLER = /^(?:offres?\s+d['’]\s*emploi|ofertas?\s+de\s+(?:empleo|trabajo)|ofertas?|empleos?|trabajos?|vagas?|emplois?|postes?|stellenangebote|stellen|vacatures?)(?:\s+(?:de|du|des|em|als|como|para|voor)\s+|\s+d['’]\s*|\s+)/i;

/** A town named just before "bei" / "near": "in Wildau bei Berlin", "- Unterhaching bei München". */
const TOWN_BEFORE_NEAR = /(?:\s(?:in|en|à|em|im)\s+\S+(?:\s+\S+)?|[-–—|]\s*\p{Lu}\S*(?:\s+\S+)?)$/u;
/** The prepositions a trailing place follows, in English, German, Spanish, French and Portuguese. */
const PLACE_PREPOSITION = /\s(in|near|around|en|à|au|aux|em|bei|nahe|cerca de|près de|pres de)\s+/gi;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const norm = (s: string) => s.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** A place the board's location filter knows by this exact name, or null. */
function knownLocation(place: string): string | null {
  const p = norm(place);
  if (p.length > 2 && has(STATE_ALIASES, p)) return place.trim();
  if (!METRO_SKIP.has(p) && has(METRO_ALIASES, p)) return place.trim();
  return null;
}

/** A city of the board's own city table, or null. */
function knownCity(place: string): string | null {
  const raw = place.trim().toLowerCase().replace(/\s+/g, " ");
  const p = norm(place);
  if (CITY_NOT_FROM_QUERY.has(p)) return null;
  return KNOWN_CITIES.has(raw) || KNOWN_CITIES.has(p) || KNOWN_CITIES.has(fold(p)) ? place.trim() : null;
}

/** "Austin, TX" / "Toronto, ON": a city and a real US state or Canadian province code. */
function cityState(place: string): string | null {
  const m = /^([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Za-z]{2})$/.exec(place.trim());
  if (!m) return null;
  const code = m[2].toUpperCase();
  // Every US state and Canadian province code is a two-letter key of the board's own alias table.
  return has(STATE_ALIASES, code.toLowerCase()) ? `${m[1].trim()}, ${code}` : null;
}

/** "Austin TX": a city and a state code in capitals that is not also a word. */
function cityStateLoose(place: string): string | null {
  const m = /^([A-Za-z][A-Za-z .'-]{1,40}?)\s+([A-Z]{2})$/.exec(place.trim());
  if (!m) return null;
  const code = m[2].toLowerCase();
  if (CODE_IS_A_WORD.has(code) || !has(STATE_ALIASES, code)) return null;
  if (CODE_IS_A_CREDENTIAL.has(code) && !knownCity(m[1])) return null;
  return `${m[1].trim()}, ${m[2]}`;
}

/**
 * The country mentions a place makes, under the guards S13-041 set: a country
 * word counts as a whole word, never as a language ("in Spanish", "French
 * Camp"), never in a "New ..." place named after it ("New South Wales", "New
 * Mexico"), and a compass America is a continent; northern Ireland is the UK's.
 */
const LANGUAGE = new Set(["german", "french", "spanish", "portuguese", "italian", "dutch", "swiss"]);
function mentionsOf(place: string): Array<{ code: string; alias: string; before: string }> {
  const out: Array<{ code: string; alias: string; before: string }> = [];
  for (const m of countryMentions(place)) {
    if (LANGUAGE.has(m.alias) || (/(?:^|\s)new(?:\s+(?:north|south|east|west))?$/.test(m.before) && !m.alias.startsWith("new"))) continue;
    if (m.alias === "america" && /(?:^|\s)(?:latin|(?:north|south)(?:ern)?|central)$/.test(m.before)) continue;
    out.push(m.alias === "ireland" && /(?:^|\s)north(?:ern)?$/.test(m.before) ? { ...m, code: "GB" } : m);
  }
  return out;
}

/** A country by name (never a code), or null. Two countries read as none (n1418). */
function countryOf(place: string): string | null {
  const p = place.trim();
  if (p.length < 3 || /,/.test(p) || p.split(/\s+/).length > 3) return null;
  const codes = new Set(mentionsOf(p).map((m) => m.code));
  return codes.size === 1 ? [...codes][0] : null;
}

/**
 * "Manchester UK", "Paris, France", "Toronto, ON, Canada", "London, GB": a
 * place followed by the country it is in, read as both (connect W1, BR-02).
 * The country is the last one to three words (after an optional comma), a
 * country by name, or by its code in capitals after a comma; what is left is
 * the place, kept as typed. Null when the words before the country are a
 * region ("southern Spain", "Remote US") or empty, or when the place names a
 * second country.
 */
function cityAndCountry(place: string): { city: string; country: string } | null {
  const p = place.trim().replace(/[.!?]+$/, "");
  const words = p.split(/\s+/);
  if (words.length < 2 || words.length > 7) return null;
  for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
    const tail = words.slice(-k).join(" ");
    const city = words.slice(0, -k).join(" ").replace(/[\s,;–—-]+$/, "").trim();
    if (!city || /[0-9]/.test(city) || city.split(/\s+/).length > 4) continue;
    let code: string | null = null;
    if (k === 1 && /^[A-Z]{2}$/.test(tail) && /,$/.test(words[words.length - 2])) {
      // A code after a comma: a country only when it is not a state or province code.
      if (!has(STATE_ALIASES, tail.toLowerCase()) && KNOWN_COUNTRY_CODES.includes(tail)) code = tail;
    }
    let byName = false;
    if (!code) {
      const ms = mentionsOf(tail);
      if (ms.length !== 1 || norm(ms[0].alias) !== norm(tail).replace(/,/g, "").trim() || ms[0].before) continue;
      // "us" is the pronoun unless written in capitals.
      if (ms[0].alias === "us" && tail.replace(/[.,]/g, "") !== "US") continue;
      code = ms[0].code;
      byName = true;
    }
    if (!code) continue;
    const firstWord = city.split(/[\s,]+/)[0];
    if (NOT_A_CITY.test(firstWord) || NOT_A_CITY.test(city)) return null;
    // A second country in the place is two places, not one city.
    if (mentionsOf(city).some((m) => m.code !== code)) return null;
    // The guards a country word carries: "New South Wales" names no city in Wales.
    if (byName && !mentionsOf(p).some((m) => m.code === code)) return null;
    // An industry before a country is a sector, not a town ("Fintech UK"): the country alone, as before.
    if (SECTOR.test(city)) return null;
    return { city, country: code };
  }
  return null;
}

type PlaceRead = { location?: string; country?: string; note?: string };

/** A place that is exactly one of a country's names, or null. */
function exactCountry(place: string): string | null {
  const ms = mentionsOf(place);
  return ms.length === 1 && !ms[0].before && norm(ms[0].alias) === norm(place).replace(/^the /, "") ? ms[0].code : null;
}

/** What a place typed after a preposition is, or null when the board does not know it by name. */
function readPlace(place: string, h: QueryHas): PlaceRead | null {
  const stated = cityState(place) ?? cityStateLoose(place);
  if (stated) return { location: stated, note: `"${stated}" was kept as written: a city name can span states.` };
  const state = knownLocation(place);
  if (state) return { location: state };
  // A place that is a country by one of its own names ("Dubai", "Singapore", "Hong Kong") reads as that country, as before.
  const exact = h.country ? null : exactCountry(place);
  if (exact) return { country: exact };
  const city = knownCity(place);
  if (city) return { location: city };
  const cc = cityAndCountry(place);
  if (cc) {
    return h.country
      ? { location: cc.city }
      : { location: cc.city, country: cc.country, note: `"${place.trim()}" was searched as ${cc.city} in ${cc.country}.` };
  }
  const country = h.country ? null : countryOf(place);
  return country ? { country } : null;
}

/** The city words just before a state code, read back from the end: "Salt Lake City", "San Antonio", "Austin". */
function cityWordsBefore(words: string[]): string[] {
  if (!words.length) return [];
  const clean = (w: string) => w.replace(/[,]+$/, "");
  const cityWord = (w: string) => /^[A-Z]/.test(w) && !ROLE_WORD.test(clean(w)) && !/[;:|()–—]$/.test(w) && w !== "-";
  const out = [clean(words[words.length - 1])];
  let i = words.length - 2;
  if (CITY_SUFFIX.has(out[0].toLowerCase()) && i >= 0 && (cityWord(words[i]) || CITY_PREFIX.has(words[i].toLowerCase()))) {
    out.unshift(clean(words[i]));
    i--;
  }
  while (i >= 0 && out.length < 3 && CITY_PREFIX.has(words[i].toLowerCase())) {
    out.unshift(words[i]);
    i--;
  }
  return out;
}

/** A query whose remainder ends on a separator or filler: "Nurse - " becomes "Nurse". */
const tidy = (s: string) => s.replace(/[\s,;:|(–—-]+$/, "").replace(/^[\s,;:|)–—-]+/, "").replace(/\s+/g, " ").trim();

/**
 * A trailing place with no preposition (connect W1, CJ-06): "registered nurse
 * jobs Austin TX", "nurse jobs Texas", "data analyst NYC". Only the forms the
 * board knows by name; never after a word that makes it part of a name.
 */
function trailingPlace(query: string): { head: string; location: string; words: string; note?: string } | null {
  const q = query.replace(/[\s.!?]+$/, "");
  const words = q.split(/\s+/);
  if (words.length < 2) return null;
  const last = words[words.length - 1];
  const prev = words[words.length - 2];
  // "City, ST" or "City ST".
  if (/^[A-Za-z]{2}$/.test(last) && has(STATE_ALIASES, last.toLowerCase())) {
    const comma = /,$/.test(prev);
    const code = last.toLowerCase();
    if (comma || (last === last.toUpperCase() && !CODE_IS_A_WORD.has(code))) {
      const cityWords = cityWordsBefore(words.slice(0, -1));
      const city = cityWords.join(" ");
      const headWords = words.slice(0, words.length - 1 - cityWords.length);
      const head = tidy(headWords.join(" "));
      // "Security Agent - Houston, TX": a separator before the place is a job title's own place, not a search's.
      const titled = headWords.length > 0 && (/[,;:|–—-]$/.test(headWords[headWords.length - 1]) || /^(?:southern|northern|western|eastern|central|greater|upstate|downstate|downtown|metro|north|south|east|west)$/i.test(headWords[headWords.length - 1]));
      const cityOk = /^[A-Z]/.test(city) && cityWords.every((w) => !ROLE_WORD.test(w.replace(/[,.]+$/, ""))) && !NOT_A_CITY.test(cityWords[0]);
      const credential = CODE_IS_A_CREDENTIAL.has(code) && !knownCity(city);
      if (head && cityOk && !credential && !titled && !NAME_BEFORE_PLACE.test(head) && !PREPOSITION_AT_END.test(head)) {
        const location = `${city}, ${last.toUpperCase()}`;
        return { head, location, words: words.slice(headWords.length).join(" "), note: `"${location}" was kept as written: a city name can span states.` };
      }
    }
    return null;
  }
  // A state or province by name, a metro alias, or a city of the board's table: the last one to three words.
  for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
    const placeWords = words.slice(-k);
    if (placeWords.some((w, i) => /[,;:|()]/.test(i === placeWords.length - 1 ? w : w.replace(/[.]$/, "")))) continue;
    const place = placeWords.join(" ");
    const p = norm(place);
    const city = knownCity(place) !== null && (/^[A-Z]/.test(place) || !CITY_IS_A_WORD.has(p));
    const known = (p.length > 2 && has(STATE_ALIASES, p)) || (p.length > 2 && !METRO_SKIP.has(p) && has(METRO_ALIASES, p)) || city;
    if (!known) continue;
    const headRaw = words.slice(0, -k).join(" ");
    const head = tidy(headRaw);
    // A place NAME with no preposition counts only after the filler a search
    // puts there ("nurse jobs Texas"): "Teller Washington" and "Account
    // Executive, Texas" are titles, and searching them with the place moved
    // out lost the very posting (1,967 board titles, 2026-11-08).
    if (!head || !FILLER_AT_END.test(headRaw) || NAME_BEFORE_PLACE.test(head) || NEGATION_BEFORE_PLACE.test(head)) return null;
    return { head, location: place, words: place };
  }
  return null;
}

/**
 * Visa-sponsorship words (connect W1, BR-01). The board has no sponsorship
 * filter, and these words in a query matched the employers' own refusal
 * disclaimers in the description tier: seven of ten rows for "visa
 * sponsorship software engineer" said they would not sponsor. A bare
 * "sponsorship" (a marketing role) and a bare "visa" (an employer, a visa
 * officer) are not here; "Tier 2" alone is a support tier.
 */
const VISA_KIND = String.raw`(?:h-?1-?b|tier\s*2|skilled\s+worker|work|employment)`;
const SPONSORSHIP: readonly RegExp[] = [
  new RegExp(String.raw`(?:\b(?:with|offering|offers?|providing|provides?|including|that\s+offers?)\s+)?(?:\ba\s+)?(?:${VISA_KIND}\s+)?\bvisa\s+sponsorships?(?:\s+(?:available|provided|offered|possible|eligible|friendly))?\b`, "gi"),
  new RegExp(String.raw`(?:\b(?:companies|employers)\s+)?(?:\b(?:that|who|which)\s+)?\b(?:will|willing\s+to|can|could|do|does|would)\s+sponsor(?:\s+(?:a\s+|my\s+|your\s+)?(?:${VISA_KIND}\s+)?visas?\b|\s*$)`, "gi"),
  new RegExp(String.raw`(?:\b(?:companies|employers)\s+)?(?:\b(?:that|who|which)\s+)?\bsponsor(?:s|ing)?\s+(?:a\s+|my\s+|your\s+)?(?:${VISA_KIND}\s+)?visas?\b`, "gi"),
  new RegExp(String.raw`(?:\b(?:companies|employers)\s+)?\b(?:that|who|which)\s+sponsors?(?=\s+(?:h-?1-?b|visas?|tier\s*2|skilled\s+worker)\b|\s*$)`, "gi"),
  new RegExp(String.raw`(?:\b(?:with|offering)\s+)?\b(?:h-?1-?b|tier\s*2|skilled\s+worker)\s+visas?(?:\s+sponsor(?:ship|ed)?)?\b`, "gi"),
  /(?:\b(?:with|offering)\s+)?\bh-?1-?b(?:\s+(?:sponsorship|sponsor(?:ed|ing)?|transfer|eligible|friendly))?\b/gi,
  /\btier\s*2\s+sponsor(?:ship|ed)?\b/gi,
  /\bvisa\s+sponsor(?:ed|ing|s)?\b/gi,
  /\b(?:with|offering|providing)\s+sponsorship\b/gi,
  /\bsponsorship\s+(?:available|provided|offered|eligible)\b/gi,
];
/** Joiners left hanging once the sponsorship words are gone ("engineer with"). */
const HANGING_JOINER = /(?:^|\s)(?:with|and|that|who|which|offering|providing|for|requiring|needing|companies|employers)$/i;
const LEADING_JOINER = /^(?:with|and|that|for)\s+/i;

function liftSponsorship(query: string): { rest: string; words: string } | null {
  let rest = query;
  const taken: string[] = [];
  for (const re of SPONSORSHIP) {
    rest = rest.replace(re, (m) => {
      taken.push(m.trim());
      return " ";
    });
  }
  if (!taken.length) return null;
  rest = rest.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) rest = tidy(rest.replace(HANGING_JOINER, "").replace(LEADING_JOINER, ""));
  return { rest, words: taken.join(" ") };
}

/**
 * A date window in words (connect W1, BR-05): "marketing jobs posted this
 * week" searched "posted this week" as title words and answered total 0
 * beside eight rows. "Recent" counts only where it cannot be a title word
 * ("Recent Graduate").
 */
const POSTED = String.raw`(?:posted|listed|added|published|opened)`;
const TIME_WORDS: ReadonlyArray<{ core: string; days: (m: RegExpExecArray) => number; anywhere?: boolean }> = [
  { core: String.raw`(?:(?:in|within|over|from)\s+the\s+|in\s+the\s+)?(?:last|past)\s+(\d{1,2})\s+days?`, days: (m) => Number(m[1]) },
  { core: String.raw`(?:today|in\s+the\s+(?:last|past)\s+24\s+hours)`, days: () => 1 },
  { core: String.raw`(?:(?:within|in|over)\s+)?(?:this|the\s+(?:last|past)|past|last)\s+week`, days: () => 7 },
  { core: String.raw`(?:(?:within|in|over)\s+)?(?:this|the\s+(?:last|past)|past|last)\s+month`, days: () => 30 },
  { core: String.raw`(?:recently\s+posted|posted\s+recently|most\s+recent)`, days: () => 7, anywhere: true },
];
/**
 * A date phrase counts after "posted", "listed" and the like, or at the very
 * end of the query: "Last Week Tonight" and "TODAY Show" are titles, "nurse
 * jobs this week" is a date.
 */
function timeMatch(query: string, core: string, anywhere = false): RegExpExecArray | null {
  const posted = new RegExp(String.raw`\b${POSTED}\s+${core}\b`, "i").exec(query);
  if (posted) return posted;
  const atEnd = new RegExp(String.raw`(?:^|\s)${core}\s*$`, "i").exec(query);
  if (atEnd && !/^today$/i.test(atEnd[0].trim()) ) return atEnd;
  if (atEnd && /(?:\b(?:jobs?|roles?|openings?|positions?|postings?|listings?|vacancies)\s+(?:from\s+)?today\s*$)/i.test(query)) return atEnd;
  if (anywhere) return new RegExp(String.raw`\b${core}\b`, "i").exec(query);
  return null;
}
/** A leading "recent" that is not a graduate ("Recent Graduate" is a title). */
const LEADING_RECENT = /^recent\s+(?!grad|graduates?|college|university|alumni|hires?|phd|ph\.d|master|mba)/i;

function liftTime(query: string): { rest: string; days: number; words: string } | null {
  for (const { core, days, anywhere } of TIME_WORDS) {
    const m = timeMatch(query, core, anywhere);
    if (!m) continue;
    const n = days(m);
    if (!Number.isInteger(n) || n < 1) continue;
    const words = m[0].trim();
    const rest = tidy(`${query.slice(0, m.index)} ${query.slice(m.index + m[0].length)}`.replace(/\s+/g, " "));
    return { rest, days: Math.min(n, 30), words };
  }
  const lead = LEADING_RECENT.exec(query);
  if (lead && !/\bgrad(?:uate|uates|s)?\b/i.test(query)) return { rest: tidy(query.slice(lead[0].length)), days: 7, words: lead[0].trim() };
  return null;
}

/**
 * "jobs at Humana", "nurse jobs at Kaiser" (connect W1, BR-09): the employer
 * goes to `companies`, which job-board resolves to every board of that name.
 * Only after a filler word, and never a word that makes "at" part of the
 * phrase ("work at home", "jobs at night"). "<Name> jobs" and a bare "<role>
 * at <Name>" are not read: the first is every "nurse jobs", and the second is
 * how titles name a store or a property.
 */
const AT_NOT_AN_EMPLOYER = /^(?:the|a|an|my|our|your|this|that|any|all|least|most|home|night|nights|weekends?|sea|risk|large|scale|heights?|once|first|best|top|entry|senior|level|work|school|night|desk|our|one|two|will|large|height|speed|times?|sites?|site|location|locations|client|clients|customer|customers|startups?|companies|company|employers?|hospitals?)\b/i;
const FILLER_BEFORE_AT = /(?:^|\s)(?:jobs?|roles?|openings?|positions?|careers?|vacancies|opportunities|hiring|work)$/i;

function liftEmployer(query: string): { rest: string; name: string; words: string } | null {
  const i = query.toLowerCase().lastIndexOf(" at ");
  if (i < 0) return null;
  const before = query.slice(0, i).trim();
  let name = query.slice(i + 4).replace(/[\s.!?]+$/, "").replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  // Only after the filler a search puts there: "Retail Sales Associate at
  // Florence" and "Leasing Consultant - Bristol at Sunset" are titles naming
  // a store or a property (1,967 board titles, 2026-11-08).
  if (!FILLER_BEFORE_AT.test(before)) return null;
  if (!name || name.split(/\s+/).length > 5 || AT_NOT_AN_EMPLOYER.test(name) || !/[\p{L}]/u.test(name)) return null;
  name = name.replace(FILLER, "").trim() || name;
  const rest = tidy(before.replace(FILLER, "").replace(/^(?:jobs?|roles?|openings?|positions?|careers?|vacancies|opportunities|hiring|work)$/i, ""));
  return { rest, name, words: query.slice(i).trim() };
}

/**
 * The query as the person meant it. `has`: the filters the caller already
 * set, so nothing is moved into one of them.
 */
export function readQuery(raw: string, h: QueryHas = {}): QueryReading {
  const original = String(raw ?? "").replace(/\s+/g, " ").trim();
  let query = original;
  const out: QueryReading = { query };
  const moved: string[] = [];
  const notes: string[] = [];
  let lifted = false;

  const sponsor = liftSponsorship(query);
  if (sponsor) {
    query = sponsor.rest;
    out.sponsorship = sponsor.words;
    moved.push(sponsor.words);
  }

  if (!h.maxAgeDays) {
    const time = liftTime(query);
    if (time && time.rest) {
      query = time.rest;
      out.maxAgeDays = time.days;
      moved.push(time.words);
      lifted = true;
    }
  }

  // remote / anywhere, at the END only. A minus on it is the board's
  // exclusion ("nurse -remote", "nurse -fully remote"), captured so the lift
  // refuses it, as it refuses a negating word before it.
  const remote = /(?:^|[\s,(])(-?)(?:fully\s+)?(?:remote|anywhere)\)?\s*$/i.exec(query);
  if (remote && !h.remote) {
    const rest = query.slice(0, remote.index).replace(/[\s,(-]+$/, "").trim();
    if (rest && !remote[1] && !NEGATION_BEFORE_REMOTE.test(rest)) {
      moved.push(query.slice(remote.index).trim());
      query = rest;
      out.remote = true;
      lifted = true;
    }
  }

  // A known place after a preposition, read from the LAST preposition back,
  // so "nurse in the ICU in Texas" reads Texas.
  let placeDone = false;
  if (!h.location) {
    const preps = [...query.matchAll(PLACE_PREPOSITION)].reverse();
    for (const at of preps) {
      const rest = query.slice(0, at.index).trim();
      // "in the bay area", "in the UK": the article is not part of the place.
      const place = query.slice((at.index ?? 0) + at[0].length).replace(/^the\s+/i, "").replace(/[\s.!?]+$/, "");
      if (!rest || !place || place.split(/\s+/).length > 6) continue;
      // "Augenoptiker in Barsinghausen bei Hannover": a town near a city is the town's posting, not the city's.
      if (/^(?:bei|nahe|near|around|cerca de|près de|pres de)$/i.test(at[1]) && TOWN_BEFORE_NEAR.test(rest)) break;
      if (NEGATION_BEFORE_PLACE.test(rest)) {
        placeDone = true;
        break;
      }
      const read = readPlace(place, h);
      if (!read) continue;
      moved.push(query.slice(at.index).trim());
      query = rest;
      if (read.location) out.location = read.location;
      if (read.country) out.country = read.country;
      if (read.note) notes.push(read.note);
      placeDone = true;
      lifted = true;
      break;
    }
  }

  if (!h.companies) {
    const employer = liftEmployer(query);
    if (employer) {
      moved.push(employer.words);
      query = employer.rest;
      out.companies = [employer.name];
      lifted = true;
    }
  }

  if (!h.location && !placeDone && !out.companies && !/\sat\s/i.test(query)) {
    const tail = trailingPlace(query);
    if (tail) {
      moved.push(tail.words);
      query = tail.head;
      out.location = tail.location;
      if (tail.note) notes.push(tail.note);
      lifted = true;
    }
  }

  if (lifted || out.sponsorship) {
    const trimmed = tidy(query.replace(FILLER, ""));
    if (trimmed) query = trimmed;
    const lead = query.replace(LEADING_FILLER, "").trim();
    if (lead && lead !== query) query = lead;
  }
  out.query = query;
  const low = original.toLowerCase();
  if (moved.length) out.from = moved.map((w) => [low.indexOf(w.toLowerCase()), w] as const).sort((a, b) => a[0] - b[0]).map(([, w]) => w).join(" ").replace(/\s+/g, " ").trim();
  else delete out.from;
  if (notes.length) out.note = notes.join(" ");
  return out;
}

/**
 * A location ARGUMENT shaped "City, <country>" (connect W1, BR-02): "London,
 * UK" sent as typed matched only rows whose place string holds those exact
 * words (27 software jobs, against 271 for London in GB). Read as the city in
 * `location` and the country in `country`, and said back. Null when the
 * argument is anything else, which goes to the board as typed: "Austin, TX"
 * (the board expands it), a state, a country alone, "remote".
 */
export function readLocationArg(raw: string, h: { country?: string | null } = {}): { location: string; country?: string; note: string } | null {
  const typed = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!typed || typed.length > 120 || cityState(typed) || knownLocation(typed) || knownCity(typed)) return null;
  const cc = cityAndCountry(typed);
  if (!cc) return null;
  const asked = h.country ? String(h.country).trim().toUpperCase() : "";
  if (asked && asked !== cc.country) return null;
  return {
    location: cc.city,
    ...(asked ? {} : { country: cc.country }),
    note: `"${typed}" was searched as ${cc.city} in ${cc.country}: the board files a posting's country in its own field, so the place is matched without the country's name.`,
  };
}

/**
 * A place the board reads by name only (connect W3, BR-10): a ZIP or postal
 * code, or a misspelt name one slip from a place the board knows, starting
 * with the same letter, and only when exactly one name is that close. Read
 * over the 1,347 real place names in the corpus rows, two slips or a changed
 * first letter suggested Cork for York, Rome for Home and Wellington for
 * Wilmington; "Bicester" (two slips from Leicester) gets no suggestion. Said
 * beside an answer that found nothing, never in place of one.
 */
const ZIP = /^\d{5}(?:-\d{4})?$/;
const PLACE_NAMES: readonly string[] = (() => {
  const out = new Set<string>();
  for (const k of Object.keys(STATE_ALIASES)) if (k.length > 3) out.add(k);
  for (const k of Object.keys(METRO_ALIASES)) if (k.length > 3 && !METRO_SKIP.has(k)) out.add(k);
  for (const k of KNOWN_CITIES) if (k.length > 3 && !CITY_NOT_FROM_QUERY.has(k)) out.add(k);
  return [...out];
})();

/** Optimal string alignment distance, capped: a swap of two neighbouring letters is one slip ("Pheonix"). */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
  }
  return d[a.length][b.length];
}

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function placeHint(location: string): { zip: boolean; didYouMean?: string; hint: string } | null {
  const typed = String(location ?? "").trim();
  if (!typed) return null;
  if (ZIP.test(typed)) {
    return { zip: true, hint: "This board reads places by name, not by ZIP or postal code: send a city and state, e.g. Austin, TX." };
  }
  const first = typed.split(",")[0].trim();
  const p = norm(fold(first));
  if (p.length < 4 || knownLocation(first) || knownCity(first) || has(STATE_ALIASES, p)) return null;
  const cap = 1;
  let best: string | null = null;
  let bestD = cap + 1;
  let tied = false;
  for (const name of PLACE_NAMES) {
    if (fold(name)[0] !== p[0]) continue;
    const d = editDistance(p, fold(name), cap);
    if (d === 0 || d > cap) continue;
    if (d < bestD) {
      best = name;
      bestD = d;
      tied = false;
    } else if (d === bestD && fold(name) !== fold(best ?? "")) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  const suggestion = titleCase(best);
  return { zip: false, didYouMean: suggestion, hint: `No posting matched the place "${typed}" with this search. Did you mean ${suggestion}? Send a city and state, e.g. Austin, TX.` };
}

/**
 * The place a query names after its last "in", "near" or "around", or a
 * trailing ZIP code: what a hint is about when a search found nothing.
 */
export function placeInQuery(query: string): string | null {
  const q = String(query ?? "").trim();
  const zip = /(?:^|\s)(\d{5}(?:-\d{4})?)\s*$/.exec(q);
  if (zip) return zip[1];
  const m = /\s(?:in|near|around)\s+([A-Za-z][A-Za-z .'-]{2,30})$/i.exec(q);
  return m ? m[1].trim() : null;
}
