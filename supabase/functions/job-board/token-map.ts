// A token-keyed map that survives a token named 'constructor'.
//
// The deep cursor (job_board_meta.deep_cursor) is a JSON object keyed by
// board token. Read into a `Record<string, number>` and indexed by token, it
// misreads every token that is also a property of Object.prototype: for
// 'constructor' — a real, catalogued ashby board — `rec[token] ?? 0` yields
// a FUNCTION, `Number.isInteger` on it is false, and the board's offset
// reads as NaN. This repo has met that trap four times; the guard in
// src/test/a-token-named-constructor-reads-a-function-from-the-map.test.ts
// now refuses any token-keyed Record read on the fetch path.
//
// So the in-memory shape is a Map, and this module is the ONLY bridge to and
// from the JSON shape the meta row stores. Both directions walk OWN keys and
// define OWN properties:
//
//   - reading uses Object.entries, which never reports an inherited name, so
//     an empty row yields an empty Map (not one that "has" constructor);
//   - writing uses Object.fromEntries, which defines each key as an own data
//     property — `out[k] = n` would instead invoke the setter for '__proto__'
//     and silently drop that entry.
//
// The round-trip a token named 'constructor' must survive:
//   Map{constructor => 500} -> {"constructor":500} -> JSON -> Map{constructor => 500}
// is pinned by the guard test, together with '__proto__'.
//
// Positive integers only, because that is what both readers of the deep_cursor
// row already keep: the fast lane's work list and status.deepCursor. Nested
// objects under non-token keys (`__lane`, `__laps`) are not integers and fall
// through untouched, exactly as they did through the Record form.

/** JSON object -> Map of the entries whose value is a positive integer. Own keys only. */
export function tokenMapFromRecord(rec: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return out;
  for (const [k, n] of Object.entries(rec as Record<string, unknown>)) {
    if (Number.isInteger(n) && (n as number) > 0) out.set(k, n as number);
  }
  return out;
}

/** Map -> the JSON object the meta row stores. Every key becomes an OWN property, whatever its name. */
export function tokenMapToRecord(m: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(m) as Record<string, number>;
}
