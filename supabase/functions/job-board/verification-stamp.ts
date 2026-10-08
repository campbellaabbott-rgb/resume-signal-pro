// The verification stamp (job_board_verifications), keyed by board on a shared token.
// Rationale: docs/job-board-index-notes.md#n428-a-stamp-per-board-on-a-shared-token
import { boardKey } from "./dormancy.ts";

type Board = { source: string; token: string };
export interface StampRow { company_token: string; verified_at: string }

/**
 * What a successful visit stamps: its board's own key, and on a shared token
 * the bare token too, which every reader that joins on company_token still
 * reads as "a board on this token read" (the freshness rollup, the company
 * pages). Only the board key says which board.
 */
export function stampRows(s: Board, shared: ReadonlySet<string>, fields: Record<string, unknown>): Array<Record<string, unknown>> {
  const key = boardKey(s.source, s.token, shared);
  return key === s.token
    ? [{ company_token: s.token, ...fields }]
    : [{ company_token: key, ...fields }, { company_token: s.token, ...fields }];
}

/** The stamp a served job's recheckedAt reads. */
export function stampKeyOfJob(j: { source?: unknown; token?: unknown }, shared: ReadonlySet<string>): string {
  const token = String(j.token ?? "");
  return token ? boardKey(String(j.source ?? ""), token, shared) : "";
}

/**
 * Keep the per-board stamps in step with the catalogue, from the board keys
 * the table holds now (`have`) and the bare stamps of the shared tokens:
 * - seed: a board on a shared token with no stamp of its own gets the token's
 *   bare stamp, what it was last vouched for. A board that reads moves its own;
 *   one that cannot read keeps this one, which ages, so its rows leave through
 *   the 48h sweep instead of riding the twin's stamp. Written with
 *   ignoreDuplicates, so an existing board stamp is never moved back.
 * - remove: a board key whose token is no longer shared. Its board stamps the
 *   bare token now, and a key left behind would age and send the board's live
 *   rows to the 48h sweep every night.
 */
export function stampPlan(
  have: readonly string[],
  bare: readonly unknown[],
  boards: readonly Board[],
  shared: ReadonlySet<string>,
): { seed: StampRow[]; remove: string[] } {
  const want = new Set(boards.filter((b) => shared.has(b.token)).map((b) => boardKey(b.source, b.token, shared)));
  const held = new Set(have);
  const at = new Map<string, string>();
  for (const r of bare) {
    const t = (r as { company_token?: unknown }).company_token;
    const v = (r as { verified_at?: unknown }).verified_at;
    if (typeof t === "string" && typeof v === "string" && shared.has(t)) at.set(t, v);
  }
  const seed: StampRow[] = [];
  for (const b of boards) {
    if (!shared.has(b.token)) continue;
    const key = boardKey(b.source, b.token, shared);
    const v = at.get(b.token);
    if (v && !held.has(key)) seed.push({ company_token: key, verified_at: v });
  }
  return { seed, remove: [...held].filter((k) => k.includes(":") && !want.has(k)) };
}

/** The stale RPC's rows the lane classifies: a shared token's bare row is dropped, its boards' own stamps stand for them. */
export function laneRows<R extends { stale_token: string }>(rows: readonly R[], shared: ReadonlySet<string>): R[] {
  return rows.filter((r) => !shared.has(r.stale_token));
}
