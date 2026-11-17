// Rationale: docs/job-board-index-notes.md#n1591-export-const-disk_offset_gb
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
