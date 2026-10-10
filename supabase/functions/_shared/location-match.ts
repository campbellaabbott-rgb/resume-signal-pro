// How a location alias matches a place, the same rule the search RPCs bind
// (migration 20261008100200). Rationale: docs/job-board-index-notes.md#n429-a-state-code-is-not-a-substring

/** ", XX": a state or province code alias (location-terms.ts STATE_ALIASES). */
export function isStateCodeAlias(t: string): boolean {
  return /^, [A-Z]{2}$/.test(t);
}

/**
 * One alias against one place. A code matches case-sensitively and only at a
 * boundary (", OR" in "Portland, OR", never in "New York" or ", Oregon"); any
 * other alias is the case-blind substring it always was.
 */
export function partMatchesTerm(part: string, term: string): boolean {
  if (isStateCodeAlias(term)) return new RegExp(`${term}($|[^A-Za-z])`).test(part);
  return part.toLowerCase().includes(term.toLowerCase());
}

/**
 * One alias as a PostgREST or() branch. A code also requires a US, Canadian or
 * unplaced row (", DE" is Delaware, not "Berlin, DE"); the ILIKE stays first so
 * the trigram index still does the finding. Quoted: the alias carries a comma.
 */
export function locationBranch(term: string): string {
  return isStateCodeAlias(term)
    ? `and(location.ilike."%${term}%",location.match."${term}($|[^A-Za-z])",or(country.is.null,country.in.(US,CA)))`
    : `location.ilike."%${term}%"`;
}
