// Rationale: docs/job-board-index-notes.md#n1488-export-function-tokenmapfromrecord-rec-u

/** JSON object -> Map of the entries whose value is a positive integer. Own keys only. */
export function tokenMapFromRecord(rec: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return out;
  for (const [k, n] of Object.entries(rec as Record<string, unknown>)) {
    if (Number.isInteger(n) && (n as number) > 0) out.set(k, n as number);
  }
  return out;
}

/** Map -> the JSON object the meta row stores. Every key becomes an OWN property, whatever its name. */
export function tokenMapToRecord(m: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(m) as Record<string, number>;
}
