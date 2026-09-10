import { supabase } from "@/integrations/supabase/client";

/**
 * THE ONE READ OF THE BOARD'S STORED FACET ROW, shared by every page that
 * prints a board-wide count beside a name.
 *
 * action:"facets" reads job_board_meta k='refresh_head' — the row serveList
 * serves from — and answers with the category map, the per-source map and ONE
 * stamp for both. /explore's eighteen tiles and the vendor dropdown on /jobs
 * are two readers of the same integers; a second copy of this function is how
 * the two would drift (a deadline on one, a stamp rule on the other).
 *
 * What this module decides, once:
 *   - the deadline. A failure must be fast and stated, not a long blank
 *     control: the edge function's own notes record a {limit:1} list call at
 *     30,728ms during the 2026-08-30 saturation incident, and this exit is one
 *     indexed single-row read that should answer in milliseconds.
 *   - the shape. Every field is validated here so a reader never sees a map
 *     that is not a map, a stamp that is not a string, or an array where an
 *     object was promised. A reader that wants MORE (Explore refuses a category
 *     row with no positive entries) applies its own rule on top.
 *
 * What it deliberately does NOT decide: whether a count is publishable. Both
 * readers hold their own standing rule for that — a number without its date
 * basis is not printed — and they hold it where the sentence is rendered.
 */
export interface BoardFacetsReply {
  /** category -> servable count, or null when the reply carried no usable map. */
  categories: Record<string, number> | null;
  /** The pass stamp for the whole row. Null is reachable on the serving path
   *  (refresh_headline_open patches a row without touching it). */
  refreshedAt: string | null;
  /** True when the counts are LAST pass's, carried through a failed facet
   *  aggregate and re-stamped with the current pass time. */
  carried: boolean;
  /** When the carried counts were actually taken; null when the row did not
   *  say. Meaningless unless `carried`. */
  carriedAt: string | null;
  /** source -> servable count under both serving predicates. Null when the
   *  head row predates the build that forwards it (the deploy window) — the
   *  reply had no map. {} when a map ARRIVED and held nothing a count can be
   *  (an empty board: refresh_job_board_facets COALESCEs the aggregate to '{}'
   *  and the server forwards it as such). The two are kept apart on purpose:
   *  absence is not twenty zeros, and an empty map is not an old function. A
   *  page decides what {} means for it — Jobs publishes no numbers and no
   *  basis line for one. Entries are finite non-negative integers; anything
   *  else is dropped. */
  sources: Record<string, number> | null;
  /** The stamp the per-source map was taken under — the same pass as
   *  refreshedAt today, carried separately so a later build can split them. */
  sourcesAt: string | null;
}

/** How long a page waits for its numbers before saying it could not get them. */
export const FACET_DEADLINE_MS = 6000;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const stringOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A count map with only the entries a count can honestly be: finite,
 *  non-negative integers. A negative or a NaN is a shape we do not understand
 *  and is left out rather than printed. */
function countMap(raw: unknown): Record<string, number> | null {
  if (!isPlainObject(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (k && Number.isFinite(n) && n >= 0 && Number.isInteger(n)) out[k] = n;
  }
  return out;
}

/**
 * One request, bounded. Resolves null on error, on timeout, or on a reply that
 * is not an object — a throw never escapes, so a caller's failure path is the
 * only path a failure can take.
 */
export async function readBoardFacets(deadlineMs: number = FACET_DEADLINE_MS): Promise<BoardFacetsReply | null> {
  try {
    const { data, error } = await Promise.race([
      supabase.functions.invoke("job-board", { body: { action: "facets" } }),
      new Promise<{ data: null; error: true }>((res) =>
        setTimeout(() => res({ data: null, error: true }), deadlineMs)),
    ]);
    if (error) return null;
    if (!isPlainObject(data)) return null;
    const r = data as {
      categories?: unknown; refreshedAt?: unknown; facetsCarried?: unknown; facetsCarriedAt?: unknown;
      sources?: unknown; sourcesAt?: unknown;
    };
    return {
      categories: countMap(r.categories),
      refreshedAt: stringOrNull(r.refreshedAt),
      carried: r.facetsCarried === true,
      carriedAt: stringOrNull(r.facetsCarriedAt),
      // `sources` is null on an older function — the deploy-window contract —
      // and an object otherwise. A map that arrived but validated to nothing
      // is still a map (an empty board), not an absent one; the reader
      // decides what an empty map means for it.
      sources: countMap(r.sources),
      sourcesAt: stringOrNull(r.sourcesAt),
    };
  } catch {
    return null;
  }
}
