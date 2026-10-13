// RESULTS ARRIVE IN PIECES; A ROW THE READER CAN SEE NEVER MOVES.
//
// The first page comes back, then widening groups the reader asked for, then
// (phase 3) hiring lines. Each later piece is inserted below what is showing,
// in its own group, and a row already on screen keeps its place until the
// reader makes an explicit edit (a chip, an answer), which re-tiers the list.
// A row that arrives twice (a widening step can find one again) is kept once,
// where it first appeared.

export interface Grouped<R> {
  /** "page" for the first page; "widen:<step>" for each follow-up group. */
  group: string;
  rows: R[];
}

/** Append `incoming` as a new group below `visible`, dropping ids already shown. */
export function appendGroup<R extends { id: string }>(visible: readonly Grouped<R>[], group: string, incoming: readonly R[]): Grouped<R>[] {
  const shown = new Set(visible.flatMap((g) => g.rows.map((r) => r.id)));
  const fresh: R[] = [];
  for (const r of incoming) {
    if (shown.has(r.id)) continue;
    shown.add(r.id);
    fresh.push(r);
  }
  if (!fresh.length) return [...visible];
  const at = visible.findIndex((g) => g.group === group);
  if (at < 0) return [...visible, { group, rows: fresh }];
  return visible.map((g, i) => (i === at ? { group: g.group, rows: [...g.rows, ...fresh] } : g));
}

/** Fill a field in place (a hiring line, posting terms) without changing any row's position. */
export function fillInPlace<R extends { id: string }>(visible: readonly Grouped<R>[], patch: ReadonlyMap<string, Partial<R>>): Grouped<R>[] {
  return visible.map((g) => ({ group: g.group, rows: g.rows.map((r) => (patch.has(r.id) ? { ...r, ...patch.get(r.id) } : r)) }));
}
