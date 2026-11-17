// WHAT A SEARCH SAYS BACK ABOUT ITS OWN SCOPE, AND HOW A REGION IS SEARCHED
// (MCP upgrade 3, W1 lane L2).
//
// Each sentence here is read by the person's AI and may be passed on to the
// person, so each says only what the search did:
//   - coverageNote (M8): filterCoverage is the share of the WHOLE BOARD that
//     states a field (job-board reads it from a cached stats row), so the
//     sentence speaks of all postings on the board, and of this search only
//     as the place the unstated postings are left out of;
//   - the region notes (F1, M9): what was searched, what was not, and the one
//     next call that searches the rest; a word that names no fixed list of
//     countries is never turned into one;
//   - the near note: the board matches a place by its name, so towns near it
//     are not searched.
//
// The region search itself is here too (regionSearch, readRegionArgs), so
// query-place.ts (a region in the query) and a region sent as `location` or
// `country` follow one rule. query-place.ts imports from this file, never the
// other way round.
//
// Pure: no I/O.

import { COUNTRIES_PER_SEARCH, membersToSearch, regionNamed, type Region, type RegionNamed, type RegionRead } from "./regions.ts";

/** The filterCoverage keys that select rows on a stated field, in the order the note says them. */
const COVERED = ["workMode", "experience", "pay", "employmentType", "department", "maxYears", "payBasis", "country"] as const;

const shareOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;

/**
 * One sentence per row-selecting filter that covers under half the board, or
 * undefined. `args` are the search's own arguments: they name the argument to
 * leave out. hasStatedPay and vendor select on purpose and get none; pay gets
 * none once includeUnstatedPay brings the unstated postings back.
 */
export function coverageNote(filterCoverage: Record<string, unknown> | null | undefined, args: Record<string, unknown>): string | undefined {
  if (!filterCoverage || typeof filterCoverage !== "object") return undefined;
  const out: string[] = [];
  for (const k of COVERED) {
    if (k === "pay") {
      if (args.includeUnstatedPay === true) continue;
      const floor = shareOf(filterCoverage.salaryFloor);
      const ceiling = shareOf(filterCoverage.salaryCeiling);
      const v = floor ?? ceiling;
      if (v === null || v >= 0.5) continue;
      const named = [floor !== null ? "salaryMin" : "", ceiling !== null ? "salaryMax" : ""].filter(Boolean).join(" and ");
      out.push(`Pay is stated on ${said(v)} of all postings on the board; postings that do not state it are left out of this search. Leave ${named} out, or send includeUnstatedPay: true, to include them.`);
      continue;
    }
    const v = shareOf(filterCoverage[k]);
    if (v === null || v >= 0.5) continue;
    if (k === "workMode" && !args.workMode) {
      out.push(`A work mode is stated on ${said(v)} of all postings on the board; postings that do not state one are left out of this search. Leave remote out to include them.`);
      continue;
    }
    out.push(`${k} is stated on ${said(v)} of all postings on the board; postings that do not state it are left out of this search. Leave it out to include them.`);
  }
  return out.length ? out.join(" ") : undefined;
}

/** A share in words: "about 26%", or "under 1%" rather than "about 0%". */
function said(v: number): string {
  return v < 0.005 ? "under 1%" : `about ${Math.round(v * 100)}%`;
}

/** "the Nordics" opening a sentence. */
const opening = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What a region search did, in one to three sentences. `region` is the list,
 * or null for a word that names none. `countryKept`: a word that names no
 * list was left in `country` (the caller also sent a location), so the board
 * searched no country.
 */
export function regionNote(r: RegionRead, region: Region | null, opts: { countryKept?: boolean } = {}): string {
  const per = `${COUNTRIES_PER_SEARCH} per search`;
  if (r.neverGuessed) {
    const ask = `Name the countries (country, up to ${COUNTRIES_PER_SEARCH} ISO-2 codes per search) to search them.`;
    return opts.countryKept
      ? `country "${r.typed}" names no fixed list of countries, so none was guessed and no country was searched. ${ask}`
      : `"${r.location ?? r.name}" names no fixed list of countries, so none was guessed: it was matched as text in each posting's location. ${ask}`;
  }
  if (!region) return "";
  if (r.how === "location") {
    const head = `"${r.location ?? region.word}" was matched as text in each posting's location, which finds postings that name only the region, such as "Remote - ${region.word}".`;
    if (!r.searched.length) {
      return `${head} For postings that name a country, also search its countries as country, ${per}: ${region.members.join(",")}.`;
    }
    const which = r.rest.length
      ? ` (the ${r.searched.length} of its ${region.members.length} countries with the most postings this connector serves, counted ${r.measuredAt}; send the other ${r.rest.length} as country too, ${per}: ${r.rest.join(",")})`
      : "";
    return `${head} For postings that name a country, also search country ${r.searched.join(",")}${which}.`;
  }
  if (!r.rest.length) {
    return `Searched ${region.name} as its ${r.searched.length} countries: country ${r.searched.join(",")}.`;
  }
  return `${opening(region.name)} ${region.says ?? `has ${region.members.length} countries`}, and one search takes up to ${COUNTRIES_PER_SEARCH}, ` +
    `so this searched the ${r.searched.length} with the most postings this connector serves (counted ${r.measuredAt}): country ${r.searched.join(",")}. ` +
    `The other ${r.rest.length} were not searched; send them as country to search them, ${per}: ${r.rest.join(",")}.`;
}

/** Said when a place was read after "near" or "around": the board matches the place by its name. */
export function nearNote(place: string): string {
  return `"${place}" was searched by name: nearby towns are not included; name them to search them.`;
}

// ---- How a region is searched (F1, M9). ----

/**
 * A remote typed after a negation is the remote NOT wanted (wave 4 recheck of
 * the descope): "nurse not remote" lifted to remote:true served only remote
 * postings. The place words, plus the two that negate a work mode, and an
 * article between ("not a remote"). A refused lift leaves the query as typed.
 * query-place.ts's trailing-remote lift imports it from here.
 */
export const NEGATION_BEFORE_REMOTE = /(?:^|\s)(?:not|no|non|except|excluding|exclude|but|outside|without|minus|other than|anywhere but)(?:\s+(?:a|an))?$/i;

/** A "remote" anywhere in the text that is not minused or negated: "remote senior data engineer". */
export function remoteWordAsked(text: string): boolean {
  for (const m of String(text ?? "").matchAll(/(^|[\s,(])(-?)(?:fully\s+)?remote\b/gi)) {
    if (m[2]) continue;
    if (NEGATION_BEFORE_REMOTE.test(text.slice(0, (m.index ?? 0) + m[1].length).trimEnd())) continue;
    return true;
  }
  return false;
}

/** workMode asks for remote only when every mode it names is remote. */
export function remoteMode(workMode: unknown): boolean {
  const modes = String(workMode ?? "").split(",").map((m) => m.trim().toLowerCase()).filter(Boolean);
  return modes.length > 0 && modes.every((m) => m === "remote");
}

/**
 * How a region is searched. With remote asked, or a large region while no
 * order is measured, a word goes to location text: the region's own word, or
 * `locationText` when the caller sent one. Otherwise its members, cut to one
 * search, go to the country filter. A word that names no fixed list is only
 * ever location text. `asText`: location text whatever was asked (readQuery's
 * lift, which readRegionArgs then reads as a location argument).
 */
export function regionSearch(named: RegionNamed, remote: boolean, locationText?: string, opts: { asText?: boolean } = {}): { location?: string; country?: string; region: RegionRead; note: string } {
  if ("neverGuessed" in named) {
    const location = locationText ?? named.neverGuessed;
    const region: RegionRead = { key: null, name: named.neverGuessed, typed: named.typed, members: [], how: "location", location, searched: [], rest: [], remote, neverGuessed: true };
    return { location, region, note: regionNote(region, null) };
  }
  const reg = named.region;
  const cut = membersToSearch(reg);
  const base = { key: reg.key, name: reg.name, typed: named.typed, members: [...reg.members], remote, ...(cut?.measuredAt ? { measuredAt: cut.measuredAt } : {}) };
  if (remote || !cut || opts.asText) {
    const location = locationText ?? reg.word;
    const region: RegionRead = { ...base, how: "location", location, searched: cut?.searched ?? [], rest: cut?.rest ?? [] };
    return { location, region, note: regionNote(region, reg) };
  }
  const region: RegionRead = { ...base, how: "country", searched: cut.searched, rest: cut.rest };
  return { country: cut.searched.join(","), region, note: regionNote(region, reg) };
}

/** A location argument that is a region, alone or beside a remote word ("Remote - Europe", "Europe (remote)"). */
function regionInLocation(loc: string): { named: RegionNamed; remoteWord: boolean } | null {
  const whole = regionNamed(loc);
  if (whole) return { named: whole, remoteWord: false };
  const m = /^(?:fully )?remote[\s,:;(–—-]+(.+?)\)?$/i.exec(loc) ?? /^(.+?)[\s,:;(–—-]+(?:fully )?remote\)?$/i.exec(loc);
  const named = m ? regionNamed(m[1].replace(/[\s,:;(–—-]+$/, "")) : null;
  return named ? { named, remoteWord: true } : null;
}

/** What readRegionArgs changes: a key set to null is taken out of the search. */
export type RegionArgs = { location?: string | null; country?: string | null };

/**
 * A REGION SENT AS `location` OR `country`, read always: "Europe", "the
 * Nordics", "Remote - Europe", country "EU" (c26). Searched the way
 * query-place.ts's readQuery searches one, and said in regionNote. A location
 * stays as typed whenever it is searched as text. When both are sent, only a
 * region in `country` is read. Null when neither names a region. A whole
 * country and a remote word are never regions, and "anywhere" is left to
 * RC-S9-002 (query-place.ts locationAsField), which keeps its own note as
 * built. No experience filter, ever.
 */
export function readRegionArgs(input: Record<string, unknown>): { args: RegionArgs; region: RegionRead; regionNote: string } | null {
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const loc = str(input.location);
  const ctry = str(input.country);
  const asked = input.remote === true || remoteMode(input.workMode) || remoteWordAsked(str(input.query));
  if (ctry) {
    const named = regionNamed(ctry);
    if (!named) return null;
    if ("neverGuessed" in named) {
      // Beside a location, or naming no part of the world ("worldwide"), it stays in country, which the board ignores.
      if (loc || !named.area) {
        const region: RegionRead = { key: null, name: named.neverGuessed, typed: ctry, members: [], how: "country", searched: [], rest: [], remote: asked, neverGuessed: true };
        return { args: {}, region, regionNote: regionNote(region, null, { countryKept: true }) };
      }
      const s = regionSearch(named, asked);
      return { args: { country: null, location: s.location as string }, region: s.region, regionNote: s.note };
    }
    // The caller's own location keeps its place: the region can only be the country filter.
    if (loc && !membersToSearch(named.region)) return null;
    const s = regionSearch(named, asked && !loc);
    if (s.location) return { args: { country: null, location: s.location }, region: s.region, regionNote: s.note };
    return { args: { country: s.country as string }, region: s.region, regionNote: s.note };
  }
  if (!loc) return null;
  const split = regionInLocation(loc);
  if (!split || ("neverGuessed" in split.named && split.named.neverGuessed === "Anywhere")) return null;
  const s = regionSearch(split.named, asked || split.remoteWord, loc);
  if (s.location) return { args: {}, region: s.region, regionNote: s.note };
  return { args: { location: null, country: s.country as string }, region: s.region, regionNote: s.note };
}
