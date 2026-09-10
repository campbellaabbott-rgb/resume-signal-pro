// Stale-board classification for a cold-slice "stale lane".
//
// WIRED in 2026-09-09.69: index.ts imports this module and follows the plan
// below step for step (the lane sits between the retry lane and the base
// slice; its fold and the `stale_lane` meta write sit beside the
// board_failures write at hop end; status publishes `staleLane`). Everything
// here is pure and unit-tested
// (src/test/every-stale-board-is-named-and-classified.test.ts), which also
// pins the wiring sites in index.ts.
//
// WHAT IT ANSWERS. get_freshness_stats() says the oldest stamp is 14.6 days
// old and names nobody. get_stalest_boards() (20260909218000) names the
// boards; this module says WHY each one is stale, so the lane fetches only the
// ones a fetch could fix and a human reads only the ones it cannot.
//
// MEASURED 2026-09-10 (rows in the 20260909218000 header): of the twelve
// oldest stamps, SEVEN are in the OVERSIZE registry (cgsfederal 36.5 MB,
// cscgeneration-2, paytmpayments, gopuff, trilongroup, gorh, aaff) — the list
// response aborts over the byte budget before parse, so a visit can never
// succeed and no stamp can land, hot phase or cold. Fetching them again is
// the one thing that cannot help, which is the first thing a stale lane has
// to know. A theory that they were uncatalogued was refuted by evaluating
// JOB_SOURCES (both 'constructor' and 'applied' are ashby boards, packed
// `u(...)` entries a quoted-token grep cannot see).
//
// And the oldest of all, 'constructor', is stale for a reason no fetch fixes
// either: it is a property of Object.prototype, so every `Record<string, …>`
// keyed by token in the fetch path reads a FUNCTION for it where it expects
// undefined:
//
//   dormant[t]                   -> Object   (dormancy.ts classifyDormancy: `now - Object`
//                                             is NaN, the board is SKIPPED as dormant on
//                                             every cold slice since 2026-07-14)
//   params.streaks[token] ?? 1   -> Object   (dormancy.ts selectRetries — NaN backoff)
//   deepCursors[s.token] ?? 0    -> Object   (index.ts — NaN offset, if it ever got that far)
//
// That is why its only stamps come from demand fetches, which bypass the
// skip-list. This repo has hit the trap three times before; this is the
// fourth, and it is live. So the FIRST class below is 'prototype_name', it is
// decided before anything else, and this module never indexes a Record by
// token: every collection in StaleContext is a Set or a Map, and the one
// helper that ingests a meta Record (tokensOf) walks OWN keys.
//
// ── WIRING PLAN (for index.ts, after the cold slice is sealed) ──────────────
//
//   1. Read the tail once per cold hop, not per board:
//        const { data } = await client.rpc("get_stalest_boards",
//          { p_limit: STALE_RPC_LIMIT, p_min_age_hours: STALE_LANE_MIN_AGE_H });
//      A null/error result means "no lane this hop" — never a failure.
//      STALE_RPC_LIMIT is index.ts's (60 in .69, raised from 20): the head of
//      the oldest-first list is where permanent residents live — oversize
//      boards never stamp, unresolved tokens stay — and a 20-row window
//      clogged with them silently. index.ts publishes `windowFull` when a
//      full window holds nothing fetchable; the durable fix is a p_exclude
//      on a later RPC revision.
//
//   2. Build the context from state the hop already holds. Every field is a
//      Set/Map; convert meta Records with tokensOf() (own keys only):
//        catalogued:         new Set(JOB_SOURCES.map((s) => s.token))
//        quarantinedVendors: quarantinedVendors                 (already a Set)
//        oversize:           new Set(OVERSIZE_BOARDS.keys())    (already a Map)
//        dormant:            tokensOf(boardFailures.dormant)
//        failing:            tokensOf(boardFailures.failedAt) ∪ tokensOf(streaks)
//        tries:              readStaleTries(staleMeta?.v)       (meta k = "stale_lane")
//
//   3. verdicts = classifyStale(rows, ctx);
//      lane = selectStaleLane(verdicts, { perSlice: STALE_PER_SLICE,
//               exclude: tokens already in this slice ∪ retry lane });
//      Append lane's JobSource entries to the slice the way the retry lane
//      appends retryBoards — same fetch, same stamp, same failure fold.
//      STALE_PER_SLICE = 3 keeps the lane inside the slice's posting budget
//      (three boards at MAX_POSTINGS_PER_VISIT is under one DEEP_PER_SLICE
//      board); it is a ceiling, not a plan.
//
//   4. After the fetch, fold the attempt: tries = bumpStaleTries(tries, lane,
//      okTokens) — a token that STAMPED leaves the map; one that did not
//      counts one more try. Persist writeStaleTries(tries) under meta
//      k = "stale_lane" beside `at`. At STALE_TRIES_MAX the token classifies
//      as 'unresolved' and the lane stops spending fetches on it.
//
//   5. Surface the verdicts on /status as `staleLane: { at, classes:
//      {class: count}, unresolved: [tokens], prototypeNames: [tokens] }` so
//      the two classes no fetch can fix are visible without a log grep.
//
//   Guard already in place: src/test/a-token-named-constructor-reads-a-
//   function-from-the-map.test.ts flags any Record<string, …> read by a token
//   key on the fetch path. Adding a new token-keyed Record for this lane fails
//   that test; use a Map.
// ──────────────────────────────────────────────────────────────────────────

/** Boards the stale lane may add to one cold slice. A ceiling, not a plan. */
export const STALE_PER_SLICE = 3;
/** Minimum stamp age, in hours, before a board is the stale lane's business. */
export const STALE_LANE_MIN_AGE_H = 72;
/** Fetches the lane spends on one board before calling it unresolved. */
export const STALE_TRIES_MAX = 4;

/** One row of get_stalest_boards(), as PostgREST returns it. */
export interface StaleRow {
  stale_token: string;
  stale_vendor: string | null;
  stamped_at: string;
  age_min: number;
  posting_rows: number;
  live_rows: number;
  newest_effective: string | null;
}

export type StaleClass =
  /** The token is a property of Object.prototype; every token-keyed Record misreads it. Decided first. */
  | "prototype_name"
  /** No sources.ts entry: the rotation never visits it, so no fetch can refresh its stamp. */
  | "uncatalogued"
  /** In the OVERSIZE_BOARDS registry: the list response aborts over the byte budget before a stamp can land. */
  | "oversize"
  /** Its vendor is under the circuit breaker: zero feeds are gated out of processing, so no stamp. */
  | "quarantined"
  /** In the dormancy skip-list: probed on DORMANT_RECHECK_MS cadence, owned by dormancy.ts. */
  | "dormant"
  /** In a failure streak: the retry lane owns its cadence. */
  | "failing"
  /** The stale lane already fetched it STALE_TRIES_MAX times and no stamp landed. A human's, now. */
  | "unresolved"
  /** Catalogued, vendor healthy, no failure, dormancy or oversize record: the rotation has not reached it. The lane's candidate. */
  | "unexplained";

/**
 * Everything classification needs, as Sets and Maps. Never Records: a Record
 * keyed by token is the trap this module exists to name.
 */
export interface StaleContext {
  /** Every token in JOB_SOURCES. */
  catalogued: ReadonlySet<string>;
  /** Vendors under the circuit breaker (meta vendor_breaker.quarantined). */
  quarantinedVendors: ReadonlySet<string>;
  /** Tokens in OVERSIZE_BOARDS (meta oversize_boards.boards, own keys). */
  oversize: ReadonlySet<string>;
  /** Tokens in board_failures.dormant (own keys). */
  dormant: ReadonlySet<string>;
  /** Tokens in board_failures.failedAt or .streaks (own keys). */
  failing: ReadonlySet<string>;
  /** Stale-lane attempts per token (meta stale_lane.tries). */
  tries: ReadonlyMap<string, number>;
  /** Override for STALE_TRIES_MAX; tests use it, the wiring should not. */
  triesMax?: number;
}

export interface StaleVerdict {
  token: string;
  cls: StaleClass;
  /** One sentence a human can act on; never a guess dressed as a fact. */
  reason: string;
  row: StaleRow;
}

/**
 * Is this token a property name of Object.prototype? `in` walks the chain and
 * Object.prototype's chain is null, so this is exactly "would `{}[token]` be
 * something other than undefined". Covers constructor, __proto__, toString,
 * valueOf, hasOwnProperty, isPrototypeOf, propertyIsEnumerable,
 * toLocaleString and the legacy __define/__lookup accessors.
 */
export function isPrototypeName(token: string): boolean {
  return typeof token === "string" && token in Object.prototype;
}

/**
 * Own keys of a meta Record, as a Set. This is the ONLY sanctioned way to
 * bring a token-keyed Record into this module: Object.keys never reports
 * inherited names, so tokensOf({}) does not contain 'constructor'. Anything
 * that is not a plain object yields the empty set — a meta row can hold a
 * string, null, or an array left by an older writer.
 */
export function tokensOf(rec: unknown): Set<string> {
  if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return new Set();
  return new Set(Object.keys(rec as Record<string, unknown>));
}

/** Meta stale_lane.tries -> Map. Non-integer or negative counts are dropped. */
export function readStaleTries(v: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const tries = v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as { tries?: unknown }).tries
    : undefined;
  if (tries === null || typeof tries !== "object" || Array.isArray(tries)) return out;
  for (const [k, n] of Object.entries(tries as Record<string, unknown>)) {
    if (Number.isInteger(n) && (n as number) > 0) out.set(k, n as number);
  }
  return out;
}

/** Map -> the JSON shape meta stores. Own properties only, so any token is safe to write. */
export function writeStaleTries(tries: ReadonlyMap<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of tries) out[k] = n;
  return out;
}

/**
 * Fold one hop's stale-lane attempt into the tries map. A token that STAMPED
 * (is in okTokens) leaves the map — the lane's job for it is done. A token
 * the lane fetched that did not stamp counts one more try. Tokens the lane
 * did not fetch are untouched. Pure: returns a new Map.
 */
export function bumpStaleTries(
  tries: ReadonlyMap<string, number>,
  fetched: readonly string[],
  okTokens: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map(tries);
  for (const t of fetched) {
    if (okTokens.has(t)) out.delete(t);
    else out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}

/**
 * Classify every row, oldest first, one class each, decided in this order:
 *
 *   prototype_name > uncatalogued > oversize > quarantined > dormant > failing
 *   > unresolved > unexplained
 *
 * The order is "what a fetch could change, from least to most": a prototype
 * name must never reach a token-keyed map at all; an uncatalogued token has no
 * fetch to be given; oversize and quarantined cannot stamp until something
 * outside the lane changes; dormant and failing already have lanes; unresolved
 * has had this lane's budget; unexplained is what is left, and it is the only
 * class selectStaleLane() will fetch.
 *
 * Pure: inputs are never mutated; the same inputs give the same verdicts.
 */
export function classifyStale(rows: readonly StaleRow[], ctx: StaleContext): StaleVerdict[] {
  const triesMax = ctx.triesMax ?? STALE_TRIES_MAX;
  const out: StaleVerdict[] = [];
  for (const row of rows) {
    const token = row.stale_token;
    const vendor = row.stale_vendor ?? "";
    const facts = `${row.posting_rows} rows, ${row.live_rows} live, stamped ${row.stamped_at} (${Math.round(row.age_min / 60)} h)`;
    let cls: StaleClass;
    let reason: string;
    if (isPrototypeName(token)) {
      cls = "prototype_name";
      reason = `'${token}' is a property of Object.prototype: every Record<string, …> keyed by token reads a function or accessor for it instead of undefined (deepCursors, dormancy streaks/dormant). It must not enter any lane until those maps are Maps; ${facts}.`;
    } else if (!ctx.catalogued.has(token)) {
      cls = "uncatalogued";
      reason = `no sources.ts entry, so the rotation never visits it and no fetch can refresh its stamp; its rows persist while the orphan prune is blocked (catalogSize < catalogHighwater); ${facts}.`;
    } else if (ctx.oversize.has(token)) {
      cls = "oversize";
      reason = `in OVERSIZE_BOARDS: the ${vendor || "vendor"} list response aborts over the byte budget before parse, so no stamp can land while it stays over; ${facts}.`;
    } else if (vendor && ctx.quarantinedVendors.has(vendor)) {
      cls = "quarantined";
      reason = `vendor '${vendor}' is under the circuit breaker: its zero feeds are gated out of processing, so the stamp waits for the quarantine to lift; ${facts}.`;
    } else if (ctx.dormant.has(token)) {
      cls = "dormant";
      reason = `in the dormancy skip-list after DEAD_BOARD_THRESHOLD failures; probed once per DORMANT_RECHECK_MS by dormancy.ts, not by this lane; ${facts}.`;
    } else if (ctx.failing.has(token)) {
      cls = "failing";
      reason = `in a failure streak; the retry lane owns its backoff, and a stale lane fetching it too would spend two budgets on one dead feed; ${facts}.`;
    } else if ((ctx.tries.get(token) ?? 0) >= triesMax) {
      cls = "unresolved";
      reason = `the stale lane fetched it ${ctx.tries.get(token)} times and no stamp landed (the fetch succeeds but the stamp does not, or it fails without entering a streak); a human has to look; ${facts}.`;
    } else {
      cls = "unexplained";
      reason = `catalogued, vendor healthy, no failure, dormancy or oversize record: the rotation has not reached it; the stale lane's candidate; ${facts}.`;
    }
    out.push({ token, cls, reason, row });
  }
  return out;
}

/**
 * The tokens the lane fetches this hop: 'unexplained' verdicts only, oldest
 * stamp first, minus anything already in the slice, capped at perSlice.
 * Every other class is either another lane's, or nobody's to fetch.
 */
export function selectStaleLane(
  verdicts: readonly StaleVerdict[],
  opts: { perSlice: number; exclude: ReadonlySet<string> },
): string[] {
  return verdicts
    .filter((v) => v.cls === "unexplained" && !opts.exclude.has(v.token))
    .slice()
    .sort((a, b) => b.row.age_min - a.row.age_min)
    .slice(0, Math.max(opts.perSlice, 0))
    .map((v) => v.token);
}

/** Per-class counts for /status. Every class appears, zero included, so a missing key never reads as "none". */
export function countByClass(verdicts: readonly StaleVerdict[]): Record<StaleClass, number> {
  const out: Record<StaleClass, number> = {
    prototype_name: 0, uncatalogued: 0, oversize: 0, quarantined: 0,
    dormant: 0, failing: 0, unresolved: 0, unexplained: 0,
  };
  for (const v of verdicts) out[v.cls] += 1;
  return out;
}
