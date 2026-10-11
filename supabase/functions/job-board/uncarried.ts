/**
 * AN EMPLOYER WE DO NOT CARRY IS NOT AN EMPLOYER WITH NO OPENINGS (sweep
 * S11-020).
 *
 * The list filtered company_token IN (...) without asking the catalogue, so a
 * token the board has never read (amazon, google, a typo) answered 200 with
 * total 0 and nothing else. The company page read that zero as the employer's
 * own answer: an indexable "<X> has no open roles" with a claim offer, for any
 * string anyone put in the address, each one a false statement about a real
 * company on the query it ranks for.
 *
 * The list now names such tokens. When EVERY employer a request scopes to is
 * outside the catalogue, the reply is the empty list shape plus
 * `unknownCompanies`, and the page says we do not carry that employer instead
 * of saying it is not hiring. A scope that mixes carried and uncarried tokens
 * is served as before: its rows are real.
 *
 * Pure, so vitest walks it against the real catalogue.
 */

/** The tokens of a company scope none of which the catalogue carries, or null. */
export function uncarriedCompanies(tokens: readonly string[], catalogue: ReadonlySet<string>): string[] | null {
  if (tokens.length === 0) return null;
  return tokens.every((t) => !catalogue.has(t)) ? [...new Set(tokens)] : null;
}

/**
 * The list reply for a scope of employers the board does not carry: the
 * shape every list exit keeps (the page renders the same chrome around it),
 * no rows, a zero that is the board's own count for that scope, and the
 * tokens it does not carry.
 */
export function uncarriedListReply(tokens: readonly string[]): Record<string, unknown> {
  return {
    jobs: [], total: 0, hasMore: false, nextOffset: 0,
    unknownCompanies: [...tokens],
    companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0,
    refreshedAt: null,
  };
}
