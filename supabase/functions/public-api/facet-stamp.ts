// WHEN THE EMPLOYER COUNTS WERE COUNTED (S14X-274).
//
// /v1/companies and /v1/stats serve the board's per-employer counts from the
// meta row k = 'refresh', and dated them with that row's updated_at. Other
// writers move updated_at between passes without recounting anything, and a
// pass whose facet query failed carries the previous counts forward under its
// own refreshedAt, so the served date could be hours newer than the integers.
//
// The counted time is the row's refreshedAt when the row was counted fresh,
// and its facetsCarriedAt (the counted time it carried) when it was a carry.
// This is a public-api copy of job-board/facet-carry.ts carriedCountsAt, held
// equal to it by a cross-runtime test, so this function never imports board
// code and the two cannot disagree about which pass counted a row.
//
// Pure, so the Node suite runs it by value.

export function countedAt(v: Record<string, unknown> | null | undefined): string | null {
  if (!v) return null;
  const at = (x: unknown) => (typeof x === "string" && x !== "" ? x : null);
  return v.facetsCarried ? at(v.facetsCarriedAt) ?? at(v.refreshedAt) : at(v.refreshedAt);
}

/** True when the row's counts were carried from an earlier pass. */
export function countsCarried(v: Record<string, unknown> | null | undefined): boolean {
  return !!v?.facetsCarried;
}
