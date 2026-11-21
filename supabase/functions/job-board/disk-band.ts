// Rationale: docs/job-board-index-notes.md#n1591-export-const-disk_offset_gb
export const DISK_OFFSET_GB = 0.73;
/** The WAL bound when a stamp carries no WAL figure (spec §7, C-D6): Supabase's stated default max_wal_size, 1 GB. */
export const MAX_WAL_BOUND_BYTES = 1_073_741_824;
export type DbBand = { band: "<28" | "28-32" | "32-34" | "≥34"; at: string };

export function dbBandOf(head: unknown): DbBand | null {
  const h = (head ?? {}) as { at?: unknown; db_bytes?: unknown; wal_bytes?: unknown; max_wal_bytes?: unknown };
  if (typeof h.at !== "string" || !Number.isFinite(Date.parse(h.at)) || h.db_bytes == null) return null;
  // cost2's ring as built stamps {at, db_bytes, top}: the WAL is then its bound, the stamp's own or the default.
  const db = Number(h.db_bytes), wal = Number(h.wal_bytes ?? h.max_wal_bytes ?? MAX_WAL_BOUND_BYTES);
  if (!(db > 0) || !(wal >= 0)) return null;
  const gb = (db + wal) / 1e9 + DISK_OFFSET_GB;
  return { band: gb < 28 ? "<28" : gb < 32 ? "28-32" : gb < 34 ? "32-34" : "≥34", at: h.at };
}
