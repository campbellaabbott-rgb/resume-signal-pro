/**
 * Board .103 (spec §7, T-20): THE DISK BAND STATUS SHOWS, NEVER THE SIZE.
 *
 * cost2's nightly stamp keeps a ring of database sizes in job_board_meta
 * `storage_size_ring` (newest first). Lovable's "used" figure is read as
 * (db_bytes + wal_bytes) / 1e9 + an offset, 0.73 GB until two dated owner
 * readings calibrate it. Status shows only the band that reading falls in
 * (<28, 28-32, 32-34, ≥34 GB) and the stamp's time; the exact figure stays in
 * the service-only ring. No reading, or one without its WAL figure, is null:
 * a band without the WAL could read low, and the add gate stops on it.
 */
export const DISK_OFFSET_GB = 0.73;
export type DbBand = { band: "<28" | "28-32" | "32-34" | "≥34"; at: string };

export function dbBandOf(head: unknown): DbBand | null {
  const h = (head ?? {}) as { at?: unknown; db_bytes?: unknown; wal_bytes?: unknown };
  if (typeof h.at !== "string" || !Number.isFinite(Date.parse(h.at)) || h.db_bytes == null || h.wal_bytes == null) return null;
  const db = Number(h.db_bytes), wal = Number(h.wal_bytes);
  if (!(db > 0) || !(wal >= 0)) return null;
  const gb = (db + wal) / 1e9 + DISK_OFFSET_GB;
  return { band: gb < 28 ? "<28" : gb < 32 ? "28-32" : gb < 34 ? "32-34" : "≥34", at: h.at };
}
