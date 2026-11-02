// Rationale: docs/job-board-index-notes.md#n1506-export-function-uncarriedcompanies-token

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
