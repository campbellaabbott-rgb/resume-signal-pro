/**
 * THE BOARD'S HIRING BADGES: ASKED FOR IN SCREEN ORDER, AND KEPT WHILE THE
 * BOARD IS OPEN (sweep S12-016).
 *
 * get_company_fill_curve computes every employer's record live, and its cost
 * grows with the number of employers asked (anon reads, 2026-11-01: one
 * employer 0.32-0.43 s, 13 employers 2.97 s, the other 38 of the same
 * "accountant" page 8.46 s; a "store manager" page's 53 employers 17.1 s cold
 * and 6.4 s on an immediate repeat). The board asked for every visible
 * employer in ONE call, so the badge on the first card waited for the record
 * of the last, and each board page it remounted for (a card's employer page,
 * then Back) asked for the same employers again.
 *
 * Now the first call carries only the employers of the first screen and the
 * rest follow in later calls, one at a time (the database sees no more
 * concurrent work than it did). Each answered employer is kept in a memo the
 * board's route wrapper owns, so a board page it remounts for draws them
 * without asking, for CURVE_MEMO_TTL_MS. The memo lives as long as the
 * wrapper: leaving the board, or a reload, starts empty. The employer page's
 * own record does not read from here: it states when it was counted, so it
 * always asks.
 */
/** Token -> when it was answered, and the row (null: asked, and no row came back). */
export type CurveMemo = Map<string, { at: number; row: Record<string, unknown> | null }>;
/** How long an answered employer is drawn from the memo instead of asked again. */
export const CURVE_MEMO_TTL_MS = 20 * 60_000;
/** At most this many employers are kept. */
export const CURVE_MEMO_CAP = 600;
/** The first call: the employers a first screen of cards shows. */
export const CURVE_FIRST_CHUNK = 12;
/** Every later call. */
export const CURVE_CHUNK = 24;

const fresh = (at: number, now: number) => Number.isFinite(at) && now - at >= 0 && now - at < CURVE_MEMO_TTL_MS;

/** The employers among `tokens` the memo answers inside the TTL. */
export function cachedCurves(memo: CurveMemo, tokens: readonly string[], now = Date.now()): Map<string, Record<string, unknown> | null> {
  const out = new Map<string, Record<string, unknown> | null>();
  for (const t of tokens) {
    const e = memo.get(t);
    if (e && fresh(e.at, now)) out.set(t, e.row);
  }
  return out;
}

/** Keep one answered call: every employer it asked for, with its row when one came back. */
export function rememberCurves(memo: CurveMemo, asked: readonly string[], rows: readonly unknown[], now = Date.now()): void {
  const askedSet = new Set(asked);
  for (const t of asked) { memo.delete(t); memo.set(t, { at: now, row: null }); }
  for (const r of rows) {
    const tok = r && typeof r === "object" ? (r as { company_token?: unknown }).company_token : undefined;
    if (typeof tok === "string" && askedSet.has(tok)) memo.set(tok, { at: now, row: r as Record<string, unknown> });
  }
  // Oldest first in insertion order: drop the stale, then the oldest past the cap.
  for (const [t, e] of memo) if (!fresh(e.at, now)) memo.delete(t);
  for (const t of memo.keys()) { if (memo.size <= CURVE_MEMO_CAP) break; memo.delete(t); }
}

/** The employers to ask for, in screen order: the first screen, then the rest. */
export function curveChunks(tokens: readonly string[]): string[][] {
  const out: string[][] = [];
  if (tokens.length === 0) return out;
  out.push(tokens.slice(0, CURVE_FIRST_CHUNK));
  for (let i = CURVE_FIRST_CHUNK; i < tokens.length; i += CURVE_CHUNK) out.push(tokens.slice(i, i + CURVE_CHUNK));
  return out;
}
