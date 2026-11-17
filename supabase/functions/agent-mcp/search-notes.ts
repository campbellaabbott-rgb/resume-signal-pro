// WHAT A SEARCH SAYS BACK ABOUT ITS OWN SCOPE, AND HOW A REGION IS SEARCHED
// (MCP upgrade 3, W1 lane L2).
//
// Each sentence here is read by the person's AI and may be passed on to the
// person, so each says only what the search did:
//   - coverageNote (M8): filterCoverage is the share of the WHOLE BOARD that
//     states a field (job-board reads it from a cached stats row), so the
//     sentence speaks of all postings on the board, names when they were
//     counted, and speaks of this search only as the place the unstated
//     postings are left out of. With no count time it says nothing, as the
//     site does: the board withholds the time exactly when a figure may be an
//     older pinned constant;
//   - the region notes (F1, M9): what was searched, what was not, and the one
//     next call that searches the rest; a word that names no fixed list of
//     countries is never turned into one;
//   - the near note: the board matches a place by its name, so towns near it
//     are not searched.
//
// HOW A REGION IS SEARCHED. Spec risk 2 named the flip in advance: "the region
// A/B may favour the country filter; if so, the remote rule flips to both,
// stated". It did (scripts/measure-region-search-ab.mjs, 2026-11-17, remote
// on, titles holding every query word): location "Europe" 0 of 31, 9 of 50
// and 5 of 50; country GB,DE,FR,NL,ES 9 of 50, 50 of 50 and 50 of 50, with at
// most one row in both. So a region with a list is always searched first as
// its countries (a small one whole, a large one by its 5 members with the
// most postings, in the measured order). When remote is asked, the second
// search is stated beside it: location text that finds the remote postings
// naming only the region and no country (c06), which a country filter cannot
// reach. That text is never a word whose letters sit inside other place
// names: the board matches a location as a case-blind substring, so "EU"
// matched Deutschland and Eugene, "ANZ" Tanzania, "Iberia" New Iberia.
//
// L5 WIRING (index.ts is lane L5's; this lane only exports). After
// searchAsMeant has merged readQuery's reading and readLocationArg into the
// arguments it will send:
//   const found = readRegionArgs(args);
//   if (found) {
//     args = withRegionArgs(args, found.args);
//     reading = withRegion(reading ?? { query: String(args.query ?? "") }, found);
//   }
// so locationInterpreted states the place the board was sent, never the
// query reader's intermediate location. found.alsoSearch, when set, is the
// stated second search: a patch over the same arguments the first one was
// sent with. regionNote offers it as a call to make; if L5 runs it itself, it
// must say so instead.
//
// Pure: no I/O. query-place.ts imports from this file, never the other way.

import { COUNTRIES_PER_SEARCH, membersToSearch, regionNamed, type Region, type RegionNamed, type RegionRead } from "./regions.ts";

// ---- Coverage (M8). ----

/** A non-empty argument. */
const sent = (v: unknown): boolean =>
  v !== undefined && v !== null && !(typeof v === "string" && !v.trim()) && !(Array.isArray(v) && v.length === 0);

/**
 * The filterCoverage keys that select rows on a stated field, in the order
 * the note says them: the field in plain words, and the arguments that select
 * on it. Pay is said apart (pay below).
 */
const COVERED: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["workMode", "A work mode", ["workMode", "remote"]],
  ["experience", "An experience level", ["experience"]],
  ["pay", "", ["salaryMin", "salaryMax"]],
  ["employmentType", "An employment type", ["employmentType"]],
  ["department", "A department", ["department"]],
  ["maxYears", "A years-of-experience requirement", ["maxYears"]],
  ["payBasis", "A pay basis (hourly or salaried)", ["payBasis"]],
  ["country", "A country", ["country"]],
];

const shareOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;

/** The board's filterCoverageAt as "2026-11-17 05:44 UTC", or null when it sent none. */
function countedAt(at: unknown): string | null {
  if (typeof at !== "string" || !at.trim()) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * One sentence per row-selecting filter that covers under half the board, or
 * undefined. `args` are the search's own arguments: the sentence names every
 * one of them that selects on that field. A field the board read from words
 * in the query (it lifts "remote", "entry level", "part time") is said as
 * such. hasStatedPay and vendor select on purpose and get none; pay gets none
 * once includeUnstatedPay brings those postings back (which the board does
 * only without hasStatedPay). `filterCoverageAt` is the board's own count
 * time: without it, nothing is said.
 */
export function coverageNote(
  filterCoverage: Record<string, unknown> | null | undefined,
  args: Record<string, unknown>,
  filterCoverageAt?: unknown,
): string | undefined {
  if (!filterCoverage || typeof filterCoverage !== "object") return undefined;
  const at = countedAt(filterCoverageAt);
  if (!at) return undefined;
  const out: string[] = [];
  for (const [k, field, argNames] of COVERED) {
    if (k === "pay") {
      const statedOnly = args.hasStatedPay === true;
      if (args.includeUnstatedPay === true && !statedOnly) continue;
      const floor = shareOf(filterCoverage.salaryFloor);
      const ceiling = shareOf(filterCoverage.salaryCeiling);
      const v = floor ?? ceiling;
      if (v === null || v >= 0.5) continue;
      const named = argNames.filter((a) => sent(args[a]));
      if (!named.length) named.push(...[floor !== null ? "salaryMin" : "", ceiling !== null ? "salaryMax" : ""].filter(Boolean));
      const leave = statedOnly
        ? `Leave ${named.join(" and ")} out to include them.`
        : `Leave ${named.join(" and ")} out, or send includeUnstatedPay: true, to include them.`;
      out.push(`A pay figure the pay filter can compare (a yearly figure, or a rate turned into one) is on ${said(v)} of all postings on the board (counted ${at}); postings without one are left out of this search. ${leave}`);
      continue;
    }
    const v = shareOf(filterCoverage[k]);
    if (v === null || v >= 0.5) continue;
    const named = argNames.filter((a) => (a === "remote" ? args.remote === true : sent(args[a])));
    const leave = named.length
      ? `Leave ${named.join(" and ")} out to include them.`
      : "It was read from words in the query; take those words out to include them.";
    out.push(`${field} is stated on ${said(v)} of all postings on the board (counted ${at}); postings that do not state one are left out of this search. ${leave}`);
  }
  return out.length ? out.join(" ") : undefined;
}

/** A share under half in words: "about 26%", "under 1%" rather than "about 0%", and never "about 50%". */
function said(v: number): string {
  return v < 0.005 ? "under 1%" : `about ${Math.min(49, Math.round(v * 100))}%`;
}

/** Said when a place was read after "near" or "around": the board matches the place by its name. */
export function nearNote(place: string): string {
  return `"${place}" was searched by name: nearby towns are not included; name them to search them.`;
}

// ---- Is remote asked? The board's own lift, mirrored. ----

/**
 * job-board normalize.ts NEGATED_REMOTE_SOURCE, byte for byte (a test holds
 * the two equal): a negated remote is struck before the board lifts one.
 */
const BOARD_NEGATED_REMOTE = new RegExp(
  String.raw`\b(?:non|not|no)[-\s]?remote\b|\bnot\s+(?:a\s+|an\s+|fully\s+)?remote\b|\bnot\s+(?:eligible|available|open|considered)\s+(?:for|to)\s+remote\b|\bremote\s*[:=(–—-]\s*(?:no|none)\s*(?=$|[).|,;·/])|\b(?:remote|wfh|work\s+from\s+home|home\s?office)\s*[:=–—-]?\s*(?:not\s+(?:available|offered|permitted|an\s+option)|unavailable)\b|\b(?:non|not|no)[-\s]?(?:wfh|work\s+from\s+home|home\s?office)\b|\bno\s+remote\s+(?:work|option|options|opportunit(?:y|ies))\b|\b(?:keine|kein|nicht)\s+(?:im\s+)?home\s?office\b|\b(?:non|sans|aucun)[-\s]?t[ée]l[ée]travail\b|\bpas\s+de\s+t[ée]l[ée]travail\b|\bt[ée]l[ée]travail\s*[:=(–—-]\s*non\s*(?=$|[).|,;·/])|\b(?:no|n[ãa]o)[-\s]?remoto\b|\b(?:sin|no)\s+teletrabajo\b|\b(?:geen|niet)\s+thuiswerken\b`,
  "gi",
);
export const BOARD_NEGATED_REMOTE_SOURCE = BOARD_NEGATED_REMOTE.source;

/**
 * job-board index.ts INTENT_FILTERS, the rows whose patch is workMode remote,
 * verbatim (a test reads them there): "wfh" and "work from home" lift remote,
 * and "Remote Sensing Analyst" or "Remote Patient Monitoring Nurse" do not.
 */
export const BOARD_REMOTE_LIFTS: readonly RegExp[] = [
  /\bwork(?:ing)? from home\b/i,
  /\bwfh\b/i,
  /\btele(?:commut|work)\w*\b/i,
  /\bhome[- ]based\b/i,
  /\bremote(?:ly)? only\b/i,
  /\bremote(?:ly)?\b(?![\s-]+(?:sensing|pilots?|patient|monitoring|operated)\b)/i,
];

/**
 * True when the board will read remote out of this query, as its intent lift
 * does when the caller sent no workMode or remote: a minused word is the
 * board's exclusion and a quoted phrase is never a filter, both set aside
 * first, then a negated remote is struck, then the lift's own words are
 * looked for. One pass each, so a long query costs linear time.
 */
export function remoteWordAsked(text: string): boolean {
  const words: string[] = String(text ?? "").match(/-?"[^"]*"|\S+/g) ?? [];
  const kept = words.filter((w) => !w.startsWith('"') && !(w.length > 1 && w.startsWith("-")));
  const s = kept.join(" ").replace(BOARD_NEGATED_REMOTE, " ");
  return BOARD_REMOTE_LIFTS.some((re) => re.test(s));
}

/** workMode asks for remote only when every mode it names is remote. */
export function remoteMode(workMode: unknown): boolean {
  const modes = String(workMode ?? "").split(",").map((m) => m.trim().toLowerCase()).filter(Boolean);
  return modes.length > 0 && modes.every((m) => m === "remote");
}

// ---- How a region is searched (F1, M9, spec risk 2). ----

/** What readRegionArgs changes in a search: a key set to null is taken out of it. */
export type RegionArgs = { location?: string | null; country?: string | null; remote?: true };

/** A region read from the arguments, how it is searched, and what is said. */
export type RegionFound = {
  /** The patch for the search as sent. */
  args: RegionArgs;
  region: RegionRead;
  regionNote: string;
  /** The stated second search, remote asked: a patch over the same arguments `args` patches. */
  alsoSearch?: RegionArgs;
};

const PER_SEARCH = `${COUNTRIES_PER_SEARCH} per search`;
const NAME_THEM = `Name the countries (country, up to ${COUNTRIES_PER_SEARCH} ISO-2 codes per search) to search them.`;

/** A region's words as a location argument sends them: a leading "the" and trailing full stops dropped. */
const asTyped = (s: string) => s.replace(/^the\s+/i, "").replace(/[\s.!?]+$/, "").trim();

/** What a list search said: "<typed>" read as its countries, and the rest when it is larger than one search. */
function countryNote(region: Region, typed: string, searched: readonly string[], rest: readonly string[], measuredAt?: string): string {
  if (!rest.length) return `"${typed}" is read here as country ${searched.join(",")}.`;
  return `"${typed}" is read here as ${region.says ?? `${region.members.length} countries`}, and one search takes up to ${COUNTRIES_PER_SEARCH}, ` +
    `so this searched the ${searched.length} with the most postings this connector serves (counted ${measuredAt}): country ${searched.join(",")}. ` +
    `The other ${rest.length} were not searched; send them as country to search them, ${PER_SEARCH}: ${rest.join(",")}.`;
}

/** The stated second search for remote postings that name only the region, or why there is none. */
function remoteArmNote(region: Region): string {
  const why = "A country filter leaves out remote postings that name only the region and no country";
  if (!region.text) return ` ${why}; ${region.textSays}.`;
  const example = region.example ?? `Remote - ${region.text}`;
  return ` ${why} (such as "${example}"): to find them, run the same search again with location "${region.text}" and no country${region.textSays ? ` (${region.textSays})` : ""}.`;
}

/** A word that names no fixed list, searched as location text. */
function neverGuessedNote(text: string): string {
  return `"${text}" names no fixed list of countries, so none was guessed: it was matched as text in each posting's location, which also matches any place whose name holds those letters. ${NAME_THEM}`;
}

/**
 * A region with a list, searched as its countries (the measured head of a
 * large one). Remote asked: the second search is stated, as location text
 * when the region has a safe one. `lead`: said first (what a location argument
 * was read as). `extra`: the rest of the first search's patch.
 */
function listSearch(named: { region: Region; typed: string }, asked: boolean, extra: RegionArgs, lead = ""): RegionFound {
  const reg = named.region;
  const typed = asTyped(named.typed);
  const cut = membersToSearch(reg);
  const base = { key: reg.key, name: reg.name, typed: named.typed, members: [...reg.members], remote: asked };
  if (!cut) {
    // A large region with no measured order: its safe text, never 5 guessed countries.
    const text = reg.text ?? reg.word;
    const region: RegionRead = { ...base, how: "location", location: text, searched: [], rest: [...reg.members] };
    return {
      args: { ...extra, country: null, location: text },
      region,
      regionNote: `${lead}"${typed}" is read here as ${reg.says ?? `${reg.members.length} countries`}, more than one search takes, and no order to choose ${COUNTRIES_PER_SEARCH} by is measured, so it was matched as text: location "${text}". To search its countries, send them as country, ${PER_SEARCH}: ${reg.members.join(",")}.`,
    };
  }
  const arm = asked && reg.text ? { location: reg.text } : undefined;
  const region: RegionRead = {
    ...base, how: "country", searched: [...cut.searched], rest: [...cut.rest],
    ...(cut.measuredAt ? { measuredAt: cut.measuredAt } : {}),
    ...(arm ? { alsoSearch: arm } : {}),
  };
  return {
    args: { ...extra, country: cut.searched.join(",") },
    region,
    regionNote: lead + countryNote(reg, typed, cut.searched, cut.rest, cut.measuredAt) + (asked ? remoteArmNote(reg) : ""),
    ...(arm ? { alsoSearch: { location: arm.location, country: null, ...(extra.remote ? { remote: true as const } : {}) } } : {}),
  };
}

/** A location argument that is a region, alone or beside a remote word ("Remote - Europe", "Europe (remote)"). */
function regionInLocation(loc: string): { named: RegionNamed; remoteWord: boolean; part: string } | null {
  const whole = regionNamed(loc);
  if (whole) return { named: whole, remoteWord: false, part: loc };
  const m = /^(?:fully )?remote[\s,:;(–—-]+(.+?)\)?$/i.exec(loc) ?? /^(.+?)[\s,:;(–—-]+(?:fully )?remote\)?$/i.exec(loc);
  const part = m ? m[1].replace(/[\s,:;(–—-]+$/, "") : "";
  const named = part ? regionNamed(part) : null;
  return named ? { named, remoteWord: true, part } : null;
}

/**
 * A REGION SENT AS `location` OR `country`, read always: "Europe", "the
 * Nordics", "Remote - Europe", country "EU" (c26), and the region word the
 * query reader lifts to `location` ("jobs in the EU"). A region with a list
 * goes to `country` (its measured head when larger than one search), with
 * remote asked or not; with remote asked, `alsoSearch` is the stated second
 * search. A location in a remote-word shape is read as remote: true and the
 * region, and said. When both are sent, only a region in `country` is read: a
 * small one is searched beside the caller's location, a larger one is taken
 * out (the caller's place stands, as on main, where the board ignored it).
 * Words that name no fixed list are never turned into countries. Null when
 * neither names a region. A whole country and a remote word are never
 * regions, and "anywhere" is left to RC-S9-002 (query-place.ts
 * locationAsField), which keeps its own note as built. No experience filter,
 * ever.
 */
export function readRegionArgs(input: Record<string, unknown>): RegionFound | null {
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const loc = str(input.location);
  const rawCountry = input.country;
  const ctry = Array.isArray(rawCountry) ? rawCountry.map((c) => String(c).trim()).filter(Boolean).join(",") : typeof rawCountry === "string" ? str(rawCountry) : sent(rawCountry) ? String(rawCountry) : "";
  // The board lifts a remote out of the query only when the caller sent no work mode.
  const modeSent = sent(input.workMode) || (input.remote !== undefined && input.remote !== null);
  const asked = input.remote === true || remoteMode(input.workMode) || (!modeSent && remoteWordAsked(str(input.query)));

  if (ctry) {
    const named = regionNamed(ctry);
    if (!named) return null;
    if ("neverGuessed" in named) {
      // Beside a location, or naming no part of the world ("worldwide"), it stays in country, which the board ignores.
      if (loc || !named.area) {
        const region: RegionRead = { key: null, name: named.neverGuessed, typed: ctry, members: [], how: "none", searched: [], rest: [], remote: asked, neverGuessed: true };
        return { args: {}, region, regionNote: `country "${ctry}" names no fixed list of countries, so none was guessed and no country was searched. ${NAME_THEM}` };
      }
      const text = asTyped(ctry);
      const region: RegionRead = { key: null, name: named.neverGuessed, typed: ctry, members: [], how: "location", location: text, searched: [], rest: [], remote: asked, neverGuessed: true };
      return { args: { country: null, location: text }, region, regionNote: `country ${neverGuessedNote(text)}` };
    }
    if (loc) {
      const reg = named.region;
      const cut = membersToSearch(reg);
      if (cut && !cut.rest.length) {
        const region: RegionRead = { key: reg.key, name: reg.name, typed: ctry, members: [...reg.members], how: "country", searched: [...cut.searched], rest: [], remote: asked };
        return { args: { country: cut.searched.join(",") }, region, regionNote: `country ${countryNote(reg, asTyped(ctry), cut.searched, [])}` };
      }
      // Cut to 5, the place the caller named could fall outside the search (Warsaw beside the EU's top 5): taken out instead.
      const region: RegionRead = { key: reg.key, name: reg.name, typed: ctry, members: [...reg.members], how: "none", searched: [], rest: [...reg.members], remote: asked };
      return {
        args: { country: null },
        region,
        regionNote: `country "${ctry}" is read here as ${reg.says ?? `${reg.members.length} countries`}, more than one search takes (${COUNTRIES_PER_SEARCH}), so no country was sent: location "${loc}" was searched on its own.`,
      };
    }
    const found = listSearch(named, asked, {});
    return { ...found, regionNote: `country ${found.regionNote}` };
  }

  if (!loc) return null;
  const split = regionInLocation(loc);
  if (!split || ("neverGuessed" in split.named && split.named.neverGuessed === "Anywhere")) return null;
  // "Remote - Europe": the remote in it is the caller's, unless a work mode was sent.
  const setRemote = split.remoteWord && !modeSent;
  const remote = asked || setRemote;
  const lead = !split.remoteWord ? ""
    : setRemote ? `location "${loc}" was read as remote: true and "${asTyped(split.part)}". `
    : asked ? `location "${loc}" was read as "${asTyped(split.part)}", remote as sent. `
    : `location "${loc}" was read as "${asTyped(split.part)}"; the remote in it was not applied, because a work mode was sent. `;
  if ("neverGuessed" in split.named) {
    // A word that names no fixed list stays location text: as typed, or its own words out of a remote shape.
    const text = split.remoteWord ? asTyped(split.part) : loc;
    const region: RegionRead = { key: null, name: split.named.neverGuessed, typed: split.part, members: [], how: "location", location: text, searched: [], rest: [], remote, neverGuessed: true };
    const args: RegionArgs = { ...(text !== loc ? { location: text } : {}), ...(setRemote ? { remote: true as const } : {}) };
    return { args, region, regionNote: (split.remoteWord ? lead : "") + neverGuessedNote(text) };
  }
  return listSearch(split.named, remote, { location: null, ...(setRemote ? { remote: true as const } : {}) }, lead);
}

/** The arguments with a region's patch applied: a key set to null is taken out. */
export function withRegionArgs<A extends Record<string, unknown>>(args: A, patch: RegionArgs): A {
  const out: Record<string, unknown> = { ...args };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out as A;
}

/** The reading said back to the caller (locationInterpreted): the place keys the search was sent, never an intermediate one. */
export type PlaceReading = { query: string; location?: string; country?: string; remote?: true; region?: RegionRead; regionNote?: string };

/** `reading` with the region's patch applied, as the search arguments get it, and its region and regionNote. */
export function withRegion<R extends PlaceReading>(reading: R, found: RegionFound): R {
  return { ...withRegionArgs(reading as R & Record<string, unknown>, found.args), region: found.region, regionNote: found.regionNote };
}
