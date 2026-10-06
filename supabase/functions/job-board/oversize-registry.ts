// The oversize registry (meta oversize_boards), keyed by board: bare token, or source:token on a shared token.
// Rationale: docs/job-board-index-notes.md#n422-oversize-registry-by-board
import { boardKey, keySource, keyToken } from "./dormancy.ts";

export interface OversizeEntry { source: string; mb: number; at: string }
type Board = { source: string; token: string };

/** Refill `reg` from the persisted boards record; a key an older build wrote by bare token takes its stored source. */
export function loadOversizeEntries(reg: Map<string, OversizeEntry>, boards: unknown, shared: ReadonlySet<string>): void {
  reg.clear();
  if (!boards || typeof boards !== "object") return;
  for (const [k, e] of Object.entries(boards as Record<string, { source?: unknown; mb?: unknown; at?: unknown } | null>)) {
    if (!e || typeof e !== "object") continue;
    const src = keySource(k) ?? String(e.source ?? "");
    const key = src ? boardKey(src, keyToken(k), shared) : k;
    reg.delete(key);
    reg.set(key, { source: src, mb: Number(e.mb) || 0, at: String(e.at ?? "") });
  }
}

/** Record an over-bound visit, newest last; true when the row needs writing (new board, size moved, or stamp 12h old). */
export function noteOversize(reg: Map<string, OversizeEntry>, s: Board, mb: number, shared: ReadonlySet<string>, now = Date.now()): boolean {
  const key = boardKey(s.source, s.token, shared);
  const prev = reg.get(key);
  const prevAge = prev ? now - new Date(prev.at).getTime() : Infinity;
  reg.delete(key);
  reg.set(key, { source: s.source, mb, at: new Date(now).toISOString() });
  return !prev || Math.abs(prev.mb - mb) >= 0.1 || !(prevAge < 12 * 3_600_000);
}

/** A board that read leaves the registry; its token's twin keeps its own entry. True when an entry went. */
export function clearOversize(reg: Map<string, OversizeEntry>, s: Board, shared: ReadonlySet<string>): boolean {
  return reg.delete(boardKey(s.source, s.token, shared));
}

/** Whether an aged posting row belongs to a registered board. */
export function heldOversize(reg: ReadonlyMap<string, unknown>, r: { source?: unknown; company_token?: unknown }, shared: ReadonlySet<string>): boolean {
  return reg.has(boardKey(String(r.source ?? ""), String(r.company_token ?? ""), shared));
}

/** The registered boards' tokens, once each: get_stalest_boards' p_exclude and classifyStale take tokens. */
export function oversizeTokens(reg: ReadonlyMap<string, unknown>): string[] {
  return [...new Set([...reg.keys()].map(keyToken))];
}

/** status.oversizeBoards: `token` stays the bare token the verifiers filter on, `key` names the board. Largest first, top 50. */
export function oversizeStatusRows(boards: unknown): Array<{ token: string; key: string; source: string; mb: number; at: string }> {
  const rec = boards && typeof boards === "object" ? boards as Record<string, { source?: unknown; mb?: unknown; at?: unknown } | null> : {};
  return Object.entries(rec)
    .map(([key, e]) => ({ token: keyToken(key), key, source: String(e?.source ?? ""), mb: Number(e?.mb) || 0, at: String(e?.at ?? "") }))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, 50);
}
