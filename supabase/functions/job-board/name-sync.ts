/**
 * THE NAME-SYNC LANE'S PURE HALF (S11-133).
 *
 * The refresh is insert-only, so a stored posting keeps the name it was
 * written with until something rewrites it. Wave 3's employer-name migration
 * (20261009100100) did that rewrite itself: about 80,800 postings and their
 * closures on 216 boards in one transaction, with an all-postings self-verify
 * that an ingest insert landing mid-migration could trip, rolling everything
 * back. The migration now only adds the names and the trigger change, and the
 * stored rows are renamed here, a board at a time, by the pass-end tail's
 * name-sync lane (NAME_SYNC_VERSION 4).
 *
 * THE DATABASE IS THE WRITER. The names come from public.company_name_overrides,
 * read by the lane, resolved by the trigger's own precedence
 * (apply_company_name_override, 20261009100100): an exact key for a token that
 * carries a "~", then a Workday tenant's first segment for a token that
 * carries "~wd". A bare token is never matched: it is a Workday slug key and
 * nothing else (Climate Corps' greenhouse "cc" is not Chanel's tenant).
 */

/** The override the trigger would write for this token, or null. */
export function overrideFor(token: string, table: ReadonlyMap<string, string>): string | null {
  if (token.includes("~")) {
    const exact = table.get(token);
    if (exact !== undefined) return exact;
  }
  if (token.includes("~wd")) {
    const slug = table.get(token.split("~")[0]);
    if (slug !== undefined) return slug;
  }
  return null;
}

/** The name a board's stored rows must carry: its override, else its catalogue name. */
export function nameSyncTarget(board: { token: string; name: string }, table: ReadonlyMap<string, string>): string {
  return overrideFor(board.token, table) ?? board.name;
}

/** company_name_overrides rows as the lane reads them, into the lookup table. Rows without both fields are dropped. */
export function overrideTable(rows: ReadonlyArray<{ slug?: unknown; display_name?: unknown }> | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows ?? []) {
    if (typeof r.slug === "string" && typeof r.display_name === "string" && r.slug && r.display_name) out.set(r.slug, r.display_name);
  }
  return out;
}
