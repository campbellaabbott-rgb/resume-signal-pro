// THE REGIONS A SEARCH READS (MCP upgrade 3, W1 lane L2: U3-05 as revised
// by F1, M8 and M9).
//
// Live 2026-11-16: "remote senior data engineer jobs in Europe" kept Europe in
// the title words and answered rows from Austin, Mumbai and Vancouver (c22);
// country "EU" was ignored and the whole board came back (c26). The board's
// country filter takes up to 5 ISO-2 codes a search (job-board filters.ts
// COUNTRY_LIMIT), so a region is an explicit list of codes here, and a region
// larger than that cap is searched by its members with the most postings, in
// an order that was measured and dated, never guessed.
//
// Words that name no fixed list (EMEA, APAC, LatAm, worldwide, global,
// international, anywhere) are recognised only so the answer can say no
// country was guessed.
//
// No imports: scripts/measure-region-search-ab.mjs loads this file as it is.

/** The board's cap on countries in one search (job-board filters.ts). */
export const COUNTRIES_PER_SEARCH = 5;

export type RegionKey =
  | "dach" | "nordics" | "benelux" | "uk_ireland" | "iberia" | "baltics" | "anz" | "north_america"
  | "eu" | "eea" | "europe";

export type Region = {
  key: RegionKey;
  /** How the answer names it ("the Nordics"). */
  name: string;
  /** The region's own word, searched as location text when remote is asked. */
  word: string;
  /** What the answer says of its members, for a region larger than one search ("has 27 member states"). */
  says?: string;
  members: readonly string[];
};

/** The EU's 27 member states, as of 2026. Brexit is why this is a list and not a guess. */
const EU: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];
/** The EEA: the EU plus Iceland, Liechtenstein and Norway. */
const EEA: readonly string[] = [...EU, "IS", "LI", "NO"];
/** Europe as this server reads it: the EEA, the UK and Switzerland. */
const EUROPE: readonly string[] = [...EEA, "GB", "CH"];

export const REGIONS: Readonly<Record<RegionKey, Region>> = {
  dach: { key: "dach", name: "DACH", word: "DACH", members: ["DE", "AT", "CH"] },
  nordics: { key: "nordics", name: "the Nordics", word: "Nordics", members: ["DK", "FI", "IS", "NO", "SE"] },
  benelux: { key: "benelux", name: "Benelux", word: "Benelux", members: ["BE", "NL", "LU"] },
  uk_ireland: { key: "uk_ireland", name: "the UK and Ireland", word: "UK & Ireland", members: ["GB", "IE"] },
  iberia: { key: "iberia", name: "Iberia", word: "Iberia", members: ["ES", "PT"] },
  baltics: { key: "baltics", name: "the Baltics", word: "Baltics", members: ["EE", "LV", "LT"] },
  anz: { key: "anz", name: "Australia and New Zealand", word: "ANZ", members: ["AU", "NZ"] },
  north_america: { key: "north_america", name: "North America", word: "North America", members: ["US", "CA", "MX"] },
  eu: { key: "eu", name: "the EU", word: "EU", says: "has 27 member states", members: EU },
  eea: { key: "eea", name: "the EEA", word: "EEA", says: "has 30 countries (the EU, Iceland, Liechtenstein and Norway)", members: EEA },
  europe: { key: "europe", name: "Europe", word: "Europe", says: "is read here as 32 countries (the EEA, the UK and Switzerland)", members: EUROPE },
};

/**
 * EUROPE'S MEMBERS BY THE POSTINGS THIS CONNECTOR SERVES, most first: the
 * order the EU, the EEA and Europe are cut to 5 by (each takes its own
 * members in this order). Measured by scripts/measure-region-search-ab.mjs
 * through the public board search (52 reads, 2026-11-17T05:44Z); re-run it
 * and paste its order to update. Served then: GB at least 19,331, DE 13,983,
 * FR 12,072, NL 7,196, ES 7,099, IT 4,048, PL 4,039, SE 3,686; the rest at
 * most their board count. Null would mean unmeasured: a large region then
 * searches no country and lists them all.
 */
export const EUROPE_BY_POSTINGS: { measuredAt: string; basis: string; order: readonly string[] } | null = {
  measuredAt: "2026-11-17",
  basis: "scripts/measure-region-search-ab.mjs: per country, the board's count less SmartRecruiters and USAJOBS, which settles the 5 at the head of the EU, the EEA and Europe; a member past every head whose withheld rows were not counted is ordered by the board's count",
  order: ["GB", "DE", "FR", "NL", "ES", "IT", "PL", "SE", "IE", "PT", "CH", "BE", "GR", "RO", "AT", "DK", "CZ", "FI", "HU", "NO", "BG", "SK", "LT", "HR", "LU", "SI", "LV", "CY", "MT", "EE", "LI", "IS"],
};

/** The spellings each region is typed in, after normalising (see spelling()). */
const SPELLINGS: ReadonlyArray<readonly [RegionKey, readonly string[]]> = [
  ["dach", ["dach", "d a ch"]],
  ["nordics", ["nordics", "nordic countries", "nordic region"]],
  ["benelux", ["benelux"]],
  ["uk_ireland", ["uk and ireland", "uk and i", "uki", "united kingdom and ireland", "britain and ireland", "great britain and ireland", "ireland and the uk", "ireland and uk"]],
  ["iberia", ["iberia", "iberian peninsula"]],
  ["baltics", ["baltics", "baltic states", "baltic countries", "baltic region"]],
  ["anz", ["anz", "australia and new zealand", "new zealand and australia", "au and nz", "aunz"]],
  ["north_america", ["north america"]],
  ["eu", ["eu", "european union"]],
  ["eea", ["eea", "european economic area"]],
  ["europe", ["europe"]],
];

/**
 * Words that name no fixed list of countries, with the word the answer and the
 * location search use. `area`: the word still names a part of the world
 * (EMEA), so it can be searched as location text; the others (worldwide,
 * global) name no part at all, and are never moved into a search.
 */
const NEVER_GUESSED: ReadonlyArray<readonly [string, string, boolean]> = [
  ["emea", "EMEA", true], ["apac", "APAC", true], ["asia pacific", "Asia Pacific", true], ["latam", "LATAM", true], ["latin america", "Latin America", true],
  ["worldwide", "Worldwide", false], ["global", "Global", false], ["international", "International", false], ["anywhere", "Anywhere", false],
];

/**
 * One spelling for every way a region is written: lower case, dots gone
 * ("E.U."), "&", "+" and "/" read as "and", a hyphen as a space
 * ("Asia-Pacific", "D-A-CH"), a leading "the" and trailing full stops
 * dropped. A closing bracket is kept, so "(remote in the EU)" names no region.
 */
function spelling(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s*[&+/]\s*/g, " and ")
    .replace(/(\p{L})-(?=\p{L})/gu, "$1 ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/[\s!?]+$/, "")
    .trim();
}

const BY_SPELLING: ReadonlyMap<string, RegionKey> = new Map(SPELLINGS.flatMap(([k, ss]) => ss.map((s) => [s, k] as const)));
const NEVER_BY_SPELLING: ReadonlyMap<string, readonly [string, boolean]> = new Map(NEVER_GUESSED.map(([s, w, area]) => [s, [w, area]] as const));

export type RegionNamed = { region: Region; typed: string } | { neverGuessed: string; typed: string; area: boolean };

/** The region a whole text names, a word that names no fixed list, or null. */
export function regionNamed(text: string): RegionNamed | null {
  const typed = String(text ?? "").trim();
  const s = spelling(typed);
  if (!s) return null;
  const key = BY_SPELLING.get(s);
  if (key) return { region: REGIONS[key], typed };
  const never = NEVER_BY_SPELLING.get(s);
  return never ? { neverGuessed: never[0], typed, area: never[1] } : null;
}

/**
 * The members one search takes: a small region whole, a large one its first
 * 5 in the measured order with the rest listed. Null for a large region while
 * no order is measured.
 */
export function membersToSearch(region: Region): { searched: string[]; rest: string[]; measuredAt?: string } | null {
  if (region.members.length <= COUNTRIES_PER_SEARCH) return { searched: [...region.members], rest: [] };
  const measured = EUROPE_BY_POSTINGS;
  if (!measured) return null;
  const ranked = measured.order.filter((c) => region.members.includes(c));
  // A member the measurement did not list goes last, never dropped.
  const order = [...ranked, ...region.members.filter((c) => !ranked.includes(c))];
  return { searched: order.slice(0, COUNTRIES_PER_SEARCH), rest: order.slice(COUNTRIES_PER_SEARCH), measuredAt: measured.measuredAt };
}

/** What a region search did, said back to the caller beside regionNote. */
export type RegionRead = {
  /** The region, or null for a word that names no fixed list (EMEA). */
  key: RegionKey | null;
  name: string;
  /** The words as the caller wrote them. */
  typed: string;
  members: string[];
  /** country: the members went to the country filter; location: a word went to location text. */
  how: "country" | "location";
  /** The text searched as location, when how is location. */
  location?: string;
  /** The members put in `country` (or offered for it, when how is location). */
  searched: string[];
  /** The members not searched. */
  rest: string[];
  remote: boolean;
  measuredAt?: string;
  neverGuessed?: true;
};
