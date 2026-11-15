// The oversize registry (meta oversize_boards), keyed by board: bare token, or source:token on a shared token.
// Rationale: docs/job-board-index-notes.md#n422-oversize-registry-by-board
import { boardKey, keySource, keyToken } from "./dormancy.ts";

/** `wait`: refused only because the slice's one stream was taken (or its clock or heap was short), `at` its first refusal; `bare`: read without details (D7). */
export interface OversizeEntry { source: string; mb: number; at: string; wait?: true; bare?: true }
type Board = { source: string; token: string };

/** Refill `reg` from the persisted boards record; a key an older build wrote by bare token takes its stored source.
 *  A board the catalogue no longer carries is dropped (board .102); returns how many were. */
export function loadOversizeEntries(reg: Map<string, OversizeEntry>, boards: unknown, shared: ReadonlySet<string>, catalogued?: ReadonlySet<string>): number {
  reg.clear();
  let dropped = 0;
  if (!boards || typeof boards !== "object") return 0;
  for (const [k, e] of Object.entries(boards as Record<string, { source?: unknown; mb?: unknown; at?: unknown; wait?: unknown; bare?: unknown } | null>)) {
    if (!e || typeof e !== "object") continue;
    const src = keySource(k) ?? String(e.source ?? "");
    const key = src ? boardKey(src, keyToken(k), shared) : k;
    if (catalogued && !catalogued.has(key)) { dropped++; continue; }
    reg.delete(key);
    reg.set(key, { source: src, mb: Number(e.mb) || 0, at: String(e.at ?? ""), ...(e.wait === true ? { wait: true } : {}), ...(e.bare === true ? { bare: true } : {}) } as OversizeEntry);
  }
  return dropped;
}

/** Record an over-bound visit, newest last; true when the row needs writing (new board, size or flag moved, or stamp 12h old). */
export function noteOversize(reg: Map<string, OversizeEntry>, s: Board, mb: number, shared: ReadonlySet<string>, now = Date.now(), flag?: "wait" | "bare"): boolean {
  const key = boardKey(s.source, s.token, shared);
  const prev = reg.get(key);
  const prevAge = prev ? now - new Date(prev.at).getTime() : Infinity;
  reg.delete(key);
  reg.set(key, { source: s.source, mb, at: flag === "wait" && prev?.wait ? prev.at : new Date(now).toISOString(), ...(flag ? { [flag]: true } : {}) });
  return !prev || Math.abs(prev.mb - mb) >= 0.1 || !(prevAge < 12 * 3_600_000) || !!prev.wait !== (flag === "wait") || !!prev.bare !== (flag === "bare");
}

/** The waiting board refused longest ago that the slice does not already carry: a cold slice's one stream goes to it first. */
export function nextWaiting(reg: ReadonlyMap<string, OversizeEntry>, taken: ReadonlySet<string>): string | null {
  let best: [string, string] | null = null;
  for (const [k, e] of reg) if (e.wait && !taken.has(k) && (!best || e.at < best[1])) best = [k, e.at];
  return best?.[0] ?? null;
}

/** A board that read leaves the registry; its token's twin keeps its own entry. True when an entry went. */
export function clearOversize(reg: Map<string, OversizeEntry>, s: Board, shared: ReadonlySet<string>): boolean {
  return reg.delete(boardKey(s.source, s.token, shared));
}

/** Whether an aged posting row belongs to a registered board the cursor cannot read (a bare-read board is read: its rows exit as any board's). */
export function heldOversize(reg: ReadonlyMap<string, OversizeEntry>, r: { source?: unknown; company_token?: unknown }, shared: ReadonlySet<string>): boolean {
  const e = reg.get(boardKey(String(r.source ?? ""), String(r.company_token ?? ""), shared));
  return !!e && !e.bare;
}

/** The keys of registered boards no read reaches, which the stale lane leaves out; a bare-read board is not one. */
export const unreadKeys = (reg: ReadonlyMap<string, OversizeEntry>): string[] => [...reg].filter(([, e]) => !e.bare).map(([k]) => k);

/** The registered boards' tokens, once each: get_stalest_boards' p_exclude and classifyStale take tokens. */
export function oversizeTokens(reg: ReadonlyMap<string, unknown>): string[] {
  return [...new Set([...reg.keys()].map(keyToken))];
}

/** status.oversizeBoards: `token` stays the bare token the verifiers filter on, `key` names the board. Largest first, top 50. */
export function oversizeStatusRows(boards: unknown): Array<{ token: string; key: string; source: string; mb: number; at: string; wait?: true; bare?: true }> {
  const rec = boards && typeof boards === "object" ? boards as Record<string, { source?: unknown; mb?: unknown; at?: unknown; wait?: unknown; bare?: unknown } | null> : {};
  return Object.entries(rec)
    .map(([key, e]) => ({ token: keyToken(key), key, source: String(e?.source ?? ""), mb: Number(e?.mb) || 0, at: String(e?.at ?? ""), ...(e?.wait === true ? { wait: true as const } : {}), ...(e?.bare === true ? { bare: true as const } : {}) }))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, 50);
}
