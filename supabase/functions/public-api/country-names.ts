// A COUNTRY AS PEOPLE TYPE IT, READ AS THE CODE THE BOARD FILTERS ON
// (lane fix/1121-connector-errors, item 3; the benchmark of 2026-11-11 and the
// live read of 2026-11-21: {query: "Recruiter", country: "Ireland"} answered
// Recruiter jobs in the US, Israel and Canada, because the board keeps only
// ISO alpha-2 codes, drops the rest and searches every country).
//
// ONE FILE, TWO COPIES. agent-mcp/country-names.ts and public-api/country-names.ts
// are byte-identical (a test holds them so); neither function imports the other's
// folder, and nothing here lives under _shared (job-board's upload room).
//
// A FIXED, BUNDLED TABLE. The 250 codes the board accepts (job-board/filters.ts
// ISO_ALPHA2: 249 ISO 3166-1 alpha-2 plus XK), each with its alpha-3 code and
// ICU 78.2's English name frozen as a literal (printed by Node 25.6.1 on
// 2026-11-21), and a hand table of the names people type that ICU's forms miss
// ("Hong Kong SAR China" is not what anyone types). Nothing asks Intl at run
// time. The table was checked by a prototype against 182 typed names judged by
// hand: none read wrong, no folded name belongs to two codes.
//
// NEVER A GUESS. A name with two readings (Georgia, Congo, the Virgin Islands)
// is refused naming both; a region (EU, EMEA, Nordics, remote) is never a
// country; a part of a country the filter cannot bind (England, Scotland,
// Wales, Northern Ireland) is read as the country WITH a note that says so;
// nothing is matched by substring.

export const COUNTRY_CODES: readonly string[] = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
  "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
  "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");

// ISO 3166-1 alpha-3, in the same order (XK has the user-assigned XKX).
const ALPHA3: readonly string[] = ("AND ARE AFG ATG AIA ALB ARM AGO ATA ARG ASM AUT AUS ABW ALA AZE BIH BRB BGD BEL BFA BGR BHR BDI BEN BLM BMU BRN BOL BES BRA BHS BTN BVT BWA BLR BLZ " +
  "CAN CCK COD CAF COG CHE CIV COK CHL CMR CHN COL CRI CUB CPV CUW CXR CYP CZE DEU DJI DNK DMA DOM DZA ECU EST EGY ESH ERI ESP ETH FIN FJI FLK FSM FRO FRA " +
  "GAB GBR GRD GEO GUF GGY GHA GIB GRL GMB GIN GLP GNQ GRC SGS GTM GUM GNB GUY HKG HMD HND HRV HTI HUN IDN IRL ISR IMN IND IOT IRQ IRN ISL ITA JEY JAM JOR JPN " +
  "KEN KGZ KHM KIR COM KNA PRK KOR KWT CYM KAZ LAO LBN LCA LIE LKA LBR LSO LTU LUX LVA LBY MAR MCO MDA MNE MAF MDG MHL MKD MLI MMR MNG MAC MNP MTQ MRT MSR MLT " +
  "MUS MDV MWI MEX MYS MOZ NAM NCL NER NFK NGA NIC NLD NOR NPL NRU NIU NZL OMN PAN PER PYF PNG PHL PAK POL SPM PCN PRI PSE PRT PLW PRY QAT REU ROU SRB RUS RWA " +
  "SAU SLB SYC SDN SWE SGP SHN SVN SJM SVK SLE SMR SEN SOM SUR SSD STP SLV SXM SYR SWZ TCA TCD ATF TGO THA TJK TKL TLS TKM TUN TON TUR TTO TUV TWN TZA UKR UGA " +
  "UMI USA URY UZB VAT VCT VEN VGB VIR VNM VUT WLF WSM XKX YEM MYT ZAF ZMB ZWE").split(" ");

// ICU 78.2's English region names, frozen.
const ICU_NAMES: Readonly<Record<string, string>> = {
  AD: "Andorra", AE: "United Arab Emirates", AF: "Afghanistan", AG: "Antigua & Barbuda", AI: "Anguilla", AL: "Albania", AM: "Armenia", AO: "Angola", AQ: "Antarctica", AR: "Argentina", AS: "American Samoa", AT: "Austria", AU: "Australia", AW: "Aruba", AX: "Åland Islands", AZ: "Azerbaijan",
  BA: "Bosnia & Herzegovina", BB: "Barbados", BD: "Bangladesh", BE: "Belgium", BF: "Burkina Faso", BG: "Bulgaria", BH: "Bahrain", BI: "Burundi", BJ: "Benin", BL: "St. Barthélemy", BM: "Bermuda", BN: "Brunei", BO: "Bolivia", BQ: "Caribbean Netherlands", BR: "Brazil", BS: "Bahamas", BT: "Bhutan", BV: "Bouvet Island", BW: "Botswana", BY: "Belarus", BZ: "Belize",
  CA: "Canada", CC: "Cocos (Keeling) Islands", CD: "Congo - Kinshasa", CF: "Central African Republic", CG: "Congo - Brazzaville", CH: "Switzerland", CI: "Côte d’Ivoire", CK: "Cook Islands", CL: "Chile", CM: "Cameroon", CN: "China", CO: "Colombia", CR: "Costa Rica", CU: "Cuba", CV: "Cape Verde", CW: "Curaçao", CX: "Christmas Island", CY: "Cyprus", CZ: "Czechia",
  DE: "Germany", DJ: "Djibouti", DK: "Denmark", DM: "Dominica", DO: "Dominican Republic", DZ: "Algeria", EC: "Ecuador", EE: "Estonia", EG: "Egypt", EH: "Western Sahara", ER: "Eritrea", ES: "Spain", ET: "Ethiopia", FI: "Finland", FJ: "Fiji", FK: "Falkland Islands", FM: "Micronesia", FO: "Faroe Islands", FR: "France",
  GA: "Gabon", GB: "United Kingdom", GD: "Grenada", GE: "Georgia", GF: "French Guiana", GG: "Guernsey", GH: "Ghana", GI: "Gibraltar", GL: "Greenland", GM: "Gambia", GN: "Guinea", GP: "Guadeloupe", GQ: "Equatorial Guinea", GR: "Greece", GS: "South Georgia & South Sandwich Islands", GT: "Guatemala", GU: "Guam", GW: "Guinea-Bissau", GY: "Guyana",
  HK: "Hong Kong SAR China", HM: "Heard & McDonald Islands", HN: "Honduras", HR: "Croatia", HT: "Haiti", HU: "Hungary", ID: "Indonesia", IE: "Ireland", IL: "Israel", IM: "Isle of Man", IN: "India", IO: "British Indian Ocean Territory", IQ: "Iraq", IR: "Iran", IS: "Iceland", IT: "Italy", JE: "Jersey", JM: "Jamaica", JO: "Jordan", JP: "Japan",
  KE: "Kenya", KG: "Kyrgyzstan", KH: "Cambodia", KI: "Kiribati", KM: "Comoros", KN: "St. Kitts & Nevis", KP: "North Korea", KR: "South Korea", KW: "Kuwait", KY: "Cayman Islands", KZ: "Kazakhstan", LA: "Laos", LB: "Lebanon", LC: "St. Lucia", LI: "Liechtenstein", LK: "Sri Lanka", LR: "Liberia", LS: "Lesotho", LT: "Lithuania", LU: "Luxembourg", LV: "Latvia", LY: "Libya",
  MA: "Morocco", MC: "Monaco", MD: "Moldova", ME: "Montenegro", MF: "St. Martin", MG: "Madagascar", MH: "Marshall Islands", MK: "North Macedonia", ML: "Mali", MM: "Myanmar (Burma)", MN: "Mongolia", MO: "Macao SAR China", MP: "Northern Mariana Islands", MQ: "Martinique", MR: "Mauritania", MS: "Montserrat", MT: "Malta", MU: "Mauritius", MV: "Maldives", MW: "Malawi", MX: "Mexico", MY: "Malaysia", MZ: "Mozambique",
  NA: "Namibia", NC: "New Caledonia", NE: "Niger", NF: "Norfolk Island", NG: "Nigeria", NI: "Nicaragua", NL: "Netherlands", NO: "Norway", NP: "Nepal", NR: "Nauru", NU: "Niue", NZ: "New Zealand", OM: "Oman", PA: "Panama", PE: "Peru", PF: "French Polynesia", PG: "Papua New Guinea", PH: "Philippines", PK: "Pakistan", PL: "Poland", PM: "St. Pierre & Miquelon", PN: "Pitcairn Islands", PR: "Puerto Rico", PS: "Palestinian Territories", PT: "Portugal", PW: "Palau", PY: "Paraguay",
  QA: "Qatar", RE: "Réunion", RO: "Romania", RS: "Serbia", RU: "Russia", RW: "Rwanda", SA: "Saudi Arabia", SB: "Solomon Islands", SC: "Seychelles", SD: "Sudan", SE: "Sweden", SG: "Singapore", SH: "St. Helena", SI: "Slovenia", SJ: "Svalbard & Jan Mayen", SK: "Slovakia", SL: "Sierra Leone", SM: "San Marino", SN: "Senegal", SO: "Somalia", SR: "Suriname", SS: "South Sudan", ST: "São Tomé & Príncipe", SV: "El Salvador", SX: "Sint Maarten", SY: "Syria", SZ: "Eswatini",
  TC: "Turks & Caicos Islands", TD: "Chad", TF: "French Southern Territories", TG: "Togo", TH: "Thailand", TJ: "Tajikistan", TK: "Tokelau", TL: "Timor-Leste", TM: "Turkmenistan", TN: "Tunisia", TO: "Tonga", TR: "Türkiye", TT: "Trinidad & Tobago", TV: "Tuvalu", TW: "Taiwan", TZ: "Tanzania", UA: "Ukraine", UG: "Uganda", UM: "U.S. Outlying Islands", US: "United States", UY: "Uruguay", UZ: "Uzbekistan",
  VA: "Vatican City", VC: "St. Vincent & Grenadines", VE: "Venezuela", VG: "British Virgin Islands", VI: "U.S. Virgin Islands", VN: "Vietnam", VU: "Vanuatu", WF: "Wallis & Futuna", WS: "Samoa", XK: "Kosovo", YE: "Yemen", YT: "Mayotte", ZA: "South Africa", ZM: "Zambia", ZW: "Zimbabwe",
};

// THE NAMES PEOPLE TYPE that the frozen list does not hold, written by hand.
const TYPED_NAMES: Readonly<Record<string, readonly string[]>> = {
  GB: ["UK", "U.K.", "Great Britain", "Britain", "United Kingdom of Great Britain and Northern Ireland"],
  US: ["USA", "U.S.", "U.S.A.", "United States of America", "America", "the States"],
  DE: ["Deutschland", "Federal Republic of Germany"], ES: ["España", "Espana"], IT: ["Italia"], FR: ["Republique francaise"],
  NL: ["Nederland", "The Netherlands", "Holland"], BE: ["Belgique", "België"], CH: ["Schweiz", "Suisse", "Svizzera"], AT: ["Österreich", "Osterreich"],
  PL: ["Polska"], SE: ["Sverige"], DK: ["Danmark"], NO: ["Norge"], FI: ["Suomi"], BR: ["Brasil"], MX: ["México"], PT: ["Portugal"],
  IE: ["Eire", "Éire", "Republic of Ireland"], TR: ["Turkey", "Turkiye"], CZ: ["Czech Republic"], AE: ["UAE", "U.A.E.", "Emirates"],
  KR: ["Korea", "Republic of Korea", "Korea, Republic of", "ROK"], KP: ["Democratic People's Republic of Korea", "Korea, Democratic People's Republic of", "DPRK"],
  RU: ["Russian Federation"], VN: ["Viet Nam"], HK: ["Hong Kong", "Hong Kong SAR", "Hongkong"], MO: ["Macau", "Macao", "Macau SAR"],
  CI: ["Ivory Coast", "Cote d'Ivoire", "Cote dIvoire"], MM: ["Myanmar", "Burma"], BA: ["Bosnia", "Bosnia-Herzegovina"],
  CD: ["Democratic Republic of the Congo", "Democratic Republic of Congo", "DR Congo", "DRC", "Congo-Kinshasa", "Congo, Democratic Republic of the"],
  CG: ["Republic of the Congo", "Republic of Congo", "Congo-Brazzaville"],
  PS: ["Palestine", "State of Palestine", "Palestine, State of"], TW: ["Taiwan, Province of China", "Republic of China"], CN: ["People's Republic of China", "PRC", "Mainland China"],
  IR: ["Iran, Islamic Republic of", "Islamic Republic of Iran"], SY: ["Syrian Arab Republic"], LA: ["Lao People's Democratic Republic", "Lao PDR"],
  MD: ["Moldova, Republic of", "Republic of Moldova"], TZ: ["Tanzania, United Republic of", "United Republic of Tanzania"],
  VE: ["Venezuela, Bolivarian Republic of"], BO: ["Bolivia, Plurinational State of"], BN: ["Brunei Darussalam"], FM: ["Micronesia, Federated States of", "Federated States of Micronesia"],
  MK: ["Macedonia", "Republic of North Macedonia"], SZ: ["Swaziland"], CV: ["Cabo Verde"], TL: ["East Timor"], VA: ["Vatican", "Holy See"],
  BS: ["The Bahamas"], GM: ["The Gambia"], PH: ["The Philippines"], VG: ["Virgin Islands, British"], VI: ["US Virgin Islands", "Virgin Islands, U.S."],
  FK: ["Falkland Islands (Malvinas)", "Falklands"], RE: ["Reunion"], CW: ["Curacao"], SX: ["St. Maarten", "Saint Maarten"], MF: ["Saint-Martin"],
  ST: ["Sao Tome and Principe"], SH: ["Saint Helena, Ascension and Tristan da Cunha"], KG: ["Kyrgyz Republic"], SK: ["Slovak Republic"], ZA: ["RSA"], NZ: ["Aotearoa"],
};

// ONE NAME, TWO READINGS: refused, naming both, never guessed.
const TWO_READINGS: Readonly<Record<string, string>> = {
  georgia: "Georgia is a country (send GE) and a US state (send country US with location Georgia).",
  congo: "Congo is two countries: the Republic of the Congo (send CG) and the Democratic Republic of the Congo (send CD).",
  "virgin islands": "The Virgin Islands are two territories: British (send VG) and U.S. (send VI).",
};
// A PART OF A COUNTRY the country filter cannot bind: read as the country, WITH a note.
const PART_OF: Readonly<Record<string, string>> = { england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB" };
// Never a country.
const REGIONS: ReadonlySet<string> = new Set(["eu", "europe", "european union", "emea", "apac", "latam", "scandinavia", "nordics", "asia", "africa", "middle east", "north america", "south america", "worldwide", "global", "anywhere", "remote"]);

const A3: ReadonlyMap<string, string> = new Map(COUNTRY_CODES.map((c, i) => [ALPHA3[i], c]));
const CODE_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);

/**
 * ONE FOLDING RULE, for the table and for what a caller sends: compatibility
 * form, accents off, lower case, & to "and", apostrophes and dots removed,
 * other punctuation to spaces, a leading "the" dropped, "st" to "saint".
 */
export function foldCountryName(s: unknown): string {
  return String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/['\u2018\u2019`]/g, "").replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "").replace(/^st /, "saint ").replace(/ st /g, " saint ").trim();
}

const NAMES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  const put = (name: string, code: string) => {
    const k = foldCountryName(name);
    if (k) m.set(k, code);
  };
  for (const c of COUNTRY_CODES) put(ICU_NAMES[c], c);
  for (const [c, list] of Object.entries(TYPED_NAMES)) for (const n of list) put(n, c);
  return m;
})();

/** Every folded name and the code it reads as: for the test that no name belongs to two codes. */
export function countryNameTable(): ReadonlyArray<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  for (const c of COUNTRY_CODES) out.push([foldCountryName(ICU_NAMES[c]), c]);
  for (const [c, list] of Object.entries(TYPED_NAMES)) for (const n of list) out.push([foldCountryName(n), c]);
  return out;
}

/** The alpha-3 code of a code the board accepts. */
export function alpha3Of(code: string): string | null {
  const i = COUNTRY_CODES.indexOf(code);
  return i >= 0 ? ALPHA3[i] : null;
}

export type CountryReading =
  | { absent: true }
  | { code: string; partOf?: string }
  | { ambiguous: string }
  | { region: true }
  | { unread: true };

/**
 * One entry, in this order: two readings (refused, naming both); a part of a
 * country (the country, with a note); a region (never a country); a name or a
 * hand spelling, exact after folding, BEFORE the code rules (so "UAE" is AE
 * and "UK" is GB); two letters that are a code the board accepts; three
 * letters that are an alpha-3 code. Never a substring match.
 */
export function readCountry(entry: unknown): CountryReading {
  const raw = String(entry ?? "").trim();
  const k = foldCountryName(raw);
  if (!k) return { absent: true };
  // Own keys only: a caller's "constructor" is not a reading.
  if (Object.prototype.hasOwnProperty.call(TWO_READINGS, k)) return { ambiguous: TWO_READINGS[k] };
  if (Object.prototype.hasOwnProperty.call(PART_OF, k)) return { code: PART_OF[k], partOf: raw };
  if (REGIONS.has(k)) return { region: true };
  const named = NAMES.get(k);
  if (named) return { code: named };
  const up = k.replace(/ /g, "").toUpperCase();
  if (/^[A-Z]{2}$/.test(up)) return CODE_SET.has(up) ? { code: up } : { unread: true };
  if (/^[A-Z]{3}$/.test(up) && A3.has(up)) return { code: A3.get(up)! };
  return { unread: true };
}

/** The board's own cap on countries in one search (job-board/filters.ts COUNTRY_LIMIT). */
export const COUNTRIES_PER_SEARCH = 5;

export type CountryArg = {
  /** The codes to send, in the order asked, duplicates folded. */
  codes: string[];
  /** Each entry that was not already its code, and the code it was read as. */
  read: Record<string, string>;
  /** A part of a country searched as the whole country, said. */
  notes: string[];
  /** Why the argument cannot be searched: each entry named. Empty when it can. */
  errors: string[];
};

/**
 * A whole country argument. Not sent (undefined, null, blank, an empty array)
 * is no country. Otherwise the whole string is read as one name first (ISO's
 * own names hold commas: "Korea, Republic of"), then as a comma list, or an
 * array. More than five countries is refused (the board's cap), never trimmed.
 */
export function countryArg(value: unknown): CountryArg {
  const out: CountryArg = { codes: [], read: {}, notes: [], errors: [] };
  if (value === undefined || value === null) return out;
  const whole = Array.isArray(value) ? null : readCountry(value);
  const wholeRead = whole !== null && ("code" in whole || "ambiguous" in whole);
  const parts = wholeRead
    ? [String(value)]
    : (Array.isArray(value) ? value : String(value).split(",")).map((x) => String(x ?? "").trim()).filter(Boolean);
  for (const p of parts) {
    const r = readCountry(p);
    if ("absent" in r) continue;
    if ("ambiguous" in r) {
      out.errors.push(`country: ${JSON.stringify(p.trim())} has two readings. ${r.ambiguous}`);
      continue;
    }
    if ("region" in r || "unread" in r) {
      out.errors.push(`country: ${JSON.stringify(p.trim())} is not a country this board knows.`);
      continue;
    }
    if (!out.codes.includes(r.code)) out.codes.push(r.code);
    if (p.trim() !== r.code) out.read[p.trim()] = r.code;
    if (r.partOf) out.notes.push(`${r.partOf} was searched as the whole of ${r.code}: the country filter has no smaller unit. Add a city in location to narrow it.`);
  }
  if (!out.errors.length && out.codes.length > COUNTRIES_PER_SEARCH) {
    out.errors.push(`country names ${out.codes.length} countries; one search takes up to ${COUNTRIES_PER_SEARCH}.`);
  }
  return out;
}

/** The fix every country refusal carries. */
export const COUNTRY_FIX = "Send ISO codes or names, e.g. IE, GB or Ireland; up to 5, comma-separated.";
