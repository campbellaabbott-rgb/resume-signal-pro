// How a location alias matches a place, the same rule the search RPCs bind
// (migrations 20261008100200, 20261009101000). Rationale: docs/job-board-index-notes.md#n429-a-state-code-is-not-a-substring
// and #n480-a-state-code-that-leads-the-place

/** ", XX": a state or province code alias (location-terms.ts STATE_ALIASES). */
export function isStateCodeAlias(t: string): boolean {
  return /^, [A-Z]{2}$/.test(t);
}

/** The ten province codes among the aliases; every other code is a US state's. */
export const PROVINCE_CODES: ReadonlySet<string> = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK"]);

/**
 * A code alias's three case-sensitive regexes, as the RPCs build them.
 * trailing "Portland, OR" and noSpace "Austin,TX": a US, Canadian or unplaced
 * row. leading "TX - Houston", "SD, Sioux Falls", "US-TX-Houston",
 * "Austin - TX", "USA TX Austin": only a row placed in the code's own country.
 */
export function codePatterns(term: string): { trailing: string; noSpace: string; leading: string; home: "US" | "CA" } {
  const c = term.slice(2);
  return {
    trailing: `, ${c}($|[^A-Za-z])`,
    noSpace: `,${c}($|[^A-Za-z])`,
    leading: `^${c} ?([-,]|$)|- ?${c}($|[^A-Za-z])|^USA? ${c}($|[^A-Za-z])`,
    home: PROVINCE_CODES.has(c) ? "CA" : "US",
  };
}

/**
 * One alias against one place. A code matches case-sensitively, at a boundary,
 * trailing or leading (", OR" in "Portland, OR" and "OR - Eugene", never in
 * "New York" or ", Oregon"); any other alias is the case-blind substring it
 * always was. The card has no country here, so the leading form's country
 * test is the query's alone.
 */
export function partMatchesTerm(part: string, term: string): boolean {
  if (isStateCodeAlias(term)) {
    const p = codePatterns(term);
    return [p.trailing, p.noSpace, p.leading].some((re) => new RegExp(re).test(part));
  }
  return part.toLowerCase().includes(term.toLowerCase());
}

/**
 * One alias as a PostgREST or() branch. The trailing forms also require a US,
 * Canadian or unplaced row (", DE" is Delaware, not "Berlin, DE"); the leading
 * form requires the code's own country ("CA - Brossard" in Canada is not
 * California). The location trigram index answers every arm, the ILIKEs and
 * the regex alike. Quoted: the values carry commas and parentheses.
 */
export function locationBranch(term: string): string {
  if (!isStateCodeAlias(term)) return `location.ilike."%${term}%"`;
  const p = codePatterns(term);
  const c = term.slice(2);
  const placed = "or(country.is.null,country.in.(US,CA))";
  return `or(and(location.ilike."%${term}%",location.match."${p.trailing}",${placed}),` +
    `and(location.ilike."%,${c}%",location.match."${p.noSpace}",${placed}),` +
    `and(location.match."${p.leading}",country.eq.${p.home}))`;
}
