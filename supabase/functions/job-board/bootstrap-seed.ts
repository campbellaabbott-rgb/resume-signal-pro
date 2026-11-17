/**
 * W4-1 (board .103): A DEPLOY SEEDS THE BOOTSTRAP LANE WITH WHAT IS NEW, NOT
 * WITH EVERY EMPTY BOARD.
 *
 * Through .102 a BUILD_VERSION change appended every board with no stored row
 * (get_empty_boards), and an empty queue at an unchanged version seeded the
 * same list again: 11,776 at the .102 deploy, 4,576 still pending 2026-11-17
 * 21:21Z, about 27-32 lap-minutes (model F) or 87-113 (model R) spent reading
 * boards the rotation reads anyway, most of them read and found empty many
 * times over (capacity.md section 6).
 *
 * Now a version change REPLACES the queue with, in this order:
 *   (a) the tokens this build repointed: a RETIRED_TWIN_KEYS entry the last
 *       seed had not seen whose token the catalogue carries under another
 *       vendor (their old reads say nothing about the new board);
 *   (b) the empties no read has ever stamped (no job_board_verifications row
 *       under the token): boards a catalogue change added, which the rotation
 *       would otherwise reach only a lap later;
 *   (c) the empties of a vendor whose READER_VERSION entry changed (a new
 *       reader may find what the old one could not).
 * The old queue held only what the old rule seeded; anything in it no read
 * has stamped comes back under (b), so nothing the lane exists for is lost,
 * and a token leaves the next seed once a read stamps it, so the drain the
 * 2026-08-24 restart defect never let finish now ends. If the stamps cannot be
 * read, nothing is seeded and the version is not stamped, so the next slice
 * tries again. An empty queue at an unchanged version seeds nothing.
 *
 * Pure, so vitest walks it.
 */

type Board = { source: string; token: string };

/** The vendors whose READER_VERSION entry differs from the stored one (an absent entry is 0). */
export function readersChanged(stored: Readonly<Record<string, number>> | null | undefined, now: Readonly<Record<string, number>>): Set<string> {
  const s = stored ?? {};
  return new Set([...Object.keys(now), ...Object.keys(s)].filter((v) => (now[v] ?? 0) !== (s[v] ?? 0)));
}

/**
 * (a): the tokens of twin keys the last seed had not seen (all of them when it
 * stored none), each only while its own key has left the catalogue and its
 * token is carried under another vendor.
 */
export function repointedTokens(twins: readonly string[], storedTwins: readonly string[] | null | undefined, sources: readonly Board[]): string[] {
  const seen = new Set(storedTwins ?? []);
  const out: string[] = [];
  for (const k of twins) {
    const i = k.indexOf(":");
    const [src, tk] = [k.slice(0, i), k.slice(i + 1)];
    if (seen.has(k) || out.includes(tk)) continue;
    if (sources.some((s) => s.token === tk && s.source === src)) continue;
    if (sources.some((s) => s.token === tk && s.source !== src)) out.push(tk);
  }
  return out;
}

/** The queue a version change writes: (a), then (b), then (c), each token once. */
export function bootstrapSeed(i: {
  repointed: readonly string[];
  /** get_empty_boards: catalogue tokens with no stored row. */
  empty: readonly string[];
  /** The empties some read has stamped. */
  verified: ReadonlySet<string>;
  /** The vendors a catalogue token is read from. */
  vendorsOf: (token: string) => readonly string[];
  changedReaders: ReadonlySet<string>;
}): { queue: string[]; repointed: number; unread: number; readerChanged: number } {
  const out = new Set<string>(i.repointed);
  const a = out.size;
  for (const t of i.empty) if (!i.verified.has(t)) out.add(t);
  const b = out.size - a;
  if (i.changedReaders.size) for (const t of i.empty) if (i.vendorsOf(t).some((v) => i.changedReaders.has(v))) out.add(t);
  return { queue: [...out], repointed: a, unread: b, readerChanged: out.size - a - b };
}

/**
 * The failure state a repointed token leaves behind: its entries under the
 * bare token and under each source:token key, in every map that holds them.
 * null when it holds none, so the caller writes nothing.
 */
export function clearRepointedFailures(v: Record<string, unknown>, tokens: readonly string[], sourcesOf: (token: string) => readonly string[]): Record<string, unknown> | null {
  const keys = new Set(tokens.flatMap((t) => [t, ...sourcesOf(t).map((s) => `${s}:${t}`)]));
  let hit = false;
  const out: Record<string, unknown> = { ...v };
  for (const [m, map] of Object.entries(v)) {
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    const kept = Object.fromEntries(Object.entries(map).filter(([k]) => !keys.has(k)));
    if (Object.keys(kept).length !== Object.keys(map).length) { hit = true; out[m] = kept; }
  }
  return hit ? out : null;
}
