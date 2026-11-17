// Rationale: docs/job-board-index-notes.md#n1587-type-board-source-string-token-string

type Board = { source: string; token: string };

/** The vendors whose READER_VERSION entry differs from the stored one (an absent entry is 0). */
export function readersChanged(stored: Readonly<Record<string, number>> | null | undefined, now: Readonly<Record<string, number>>): Set<string> {
  const s = stored ?? {};
  return new Set([...Object.keys(now), ...Object.keys(s)].filter((v) => (now[v] ?? 0) !== (s[v] ?? 0)));
}

// Rationale: docs/job-board-index-notes.md#n1588-export-function-repointedtokens-twins-re
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

// Rationale: docs/job-board-index-notes.md#n1589-export-function-clearrepointedfailures-v
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
