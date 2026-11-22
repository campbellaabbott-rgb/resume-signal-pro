// A PAGE OF THE ROWS THIS SERVER MAY HAND ON, FILLED WHEN THE BOARD HAS THEM
// (lane fix/1121-connector-errors, item 1; the live reads of 2026-11-21: 17 of
// 150 benchmark slots came back empty on 10 of 15 inputs, Manager in Italy
// answered 6 rows for 10 asked with 4 withheld, and the benchmark scores an
// empty slot as a wrong answer).
//
// ONE FILE, TWO COPIES. agent-mcp/board-page-fill.ts and
// public-api/board-page-fill.ts are byte-identical (a test holds them so).
//
// PURE. It is handed the board read, the gate (which rows may be handed on,
// answered as counts by reason, never the dropped rows) and a clock. It never
// reads anything itself.
//
// WHEN IT REFILLS: ON ROWS ACTUALLY DROPPED. The refill starts only when the
// first read dropped at least one row (a page with nothing dropped is the
// board's own answer and makes one board call). Then, while the page holds
// fewer than `limit` rows AND the last read kept said hasMore with a numeric
// nextOffset above the offset it was asked for AND fewer than two refill reads
// were made AND nextOffset is within the caller's deepest offset AND under
// 3,000 ms have passed since the first read began, it reads again with the
// same body at that nextOffset for exactly the rows still missing. A refill
// read that dropped nothing does NOT end the refill: the board can answer a
// refill short of what it was asked (review 2026-11-22: asked for 4, it
// answered 3 and hasMore), and stopping there left a page of 9 with rows
// withheld, hasMore true, one refill read unused and no reason given.
//
// A SHORT PAGE THAT WITHHELD ROWS ALWAYS SAYS WHY. Once the refill has
// started, the only ways out are a full page, hasMore false, or a stated
// pageShortBecause.
//
// NEVER ASK FOR MORE AND CUT. The board reorders inside a page and its
// nextOffset is not always offset + limit, so a page cut short of what was
// read could skip or repeat rows on the next page. An exact-shortfall read
// consumes every row it returns.
//
// A REFILL READ NEVER COSTS THE CALL. It is aborted 6,000 ms after the first
// read began. One that fails, is aborted, or returns an id already answered is
// discarded whole (its rows are not appended, its hasMore and nextOffset are
// not used), so the next page neither repeats nor skips. A short page says why
// (pageShortBecause).

export type DroppedCounts = { bySource: Record<string, number>; federalUnlabelled: number };
export type Row = Record<string, unknown>;
export type BoardAnswer = Record<string, unknown>;
/** The board call. `signal` is passed only on refill and count reads. */
export type BoardRead = (body: Record<string, unknown>, signal?: AbortSignal) => Promise<BoardAnswer>;
/** Which rows may be handed on: the kept rows, and the dropped ones as counts by reason. */
export type PageGate = (rows: Row[]) => Promise<{ kept: Row[]; dropped: DroppedCounts }>;

export type PageShortReason = "refill_limit" | "deepest_offset" | "time_budget" | "board_moved" | "board_error" | "no_next_offset";

/** At most this many refill reads per page. */
export const MAX_REFILL_READS = 2;
/** No refill read starts this long after the first read began. */
export const REFILL_START_BUDGET_MS = 3_000;
/** A refill or count read still running this long after the first read began is abandoned. */
export const REFILL_ABORT_MS = 6_000;
/** How long past the refill phase a count read is waited for. */
export const COUNT_GRACE_MS = 250;

export type FillInput = {
  read: BoardRead;
  gate: PageGate;
  /** The first read's body, as it is sent. */
  body: Record<string, unknown>;
  /** The first read's answer, when the caller made that read itself with `body` (no read is made for it here). */
  first?: BoardAnswer;
  /** When the first read started, on `now`'s clock: the budgets run from it. Defaults to this call. */
  startedAt?: number;
  limit: number;
  offset: number;
  /** The caller's deepest offset: no refill reads past it. */
  deepestOffset: number;
  /** Make the conditional count read beside the first refill (the connector does; /v1 does not). */
  countRead?: boolean;
  /** Read on the first answer: false means the caller will not serve this page (an employer re-run, a scope the board could not apply), so no refill is made. */
  proceed?: (first: BoardAnswer) => boolean;
  now?: () => number;
};

export type CountOutcome =
  /** The count answer arrived in time. */
  | { state: "answered"; answer: BoardAnswer }
  /** The count read was made and did not answer in time, or failed. */
  | { state: "late" | "failed" }
  /** No count read was made. */
  | { state: "none" };

export type FillResult = {
  rows: Row[];
  /** The first read's answer: total and every disclosure come from it. */
  first: BoardAnswer;
  /** The answer whose hasMore and nextOffset are published: the last read kept. */
  last: BoardAnswer;
  /** Rows the board answered across the reads kept, before the gate. */
  answered: number;
  /** Rows dropped across the reads kept, by reason. */
  dropped: DroppedCounts;
  /** Refill reads made (kept or discarded); 0 when none was. */
  refillReads: number;
  /** Set when the page is short while the published hasMore is true. */
  pageShortBecause?: PageShortReason;
  count: CountOutcome;
};

const droppedTotal = (d: DroppedCounts): number =>
  Object.values(d.bySource).reduce((a, b) => a + b, 0) + d.federalUnlabelled;

const addDropped = (a: DroppedCounts, b: DroppedCounts): DroppedCounts => {
  const bySource = { ...a.bySource };
  for (const [k, v] of Object.entries(b.bySource)) bySource[k] = (bySource[k] ?? 0) + v;
  return { bySource, federalUnlabelled: a.federalUnlabelled + b.federalUnlabelled };
};

const rowsOf = (r: BoardAnswer): Row[] => (Array.isArray(r.jobs) ? (r.jobs as Row[]) : []);
const idOf = (j: Row): string => String(j.id ?? "");

/** Every key the board answers when it searched something other than the query as sent: its total may count a different search. */
const ROUTED_KEYS = [
  "searchRoute", "droppedTerms", "didYouMean", "fuzzyExtra", "semanticExtra", "locationSplit", "locationExpandedFrom", "aliases", "rankedFellBack",
] as const;

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0);

/**
 * THE COUNT READ IS ALLOWED only beside a refill, when the first read dropped
 * a SmartRecruiters row, the body has a query, the first answer names no
 * route and no rescue, says nothing about a capped or unavailable count, and
 * does not echo excludedSources holding smartrecruiters (its total is then
 * already behind the fence).
 */
export function countReadAllowed(body: Record<string, unknown>, first: BoardAnswer, firstDropped: DroppedCounts): boolean {
  if (!((firstDropped.bySource.smartrecruiters ?? 0) > 0)) return false;
  if (typeof body.q !== "string" || !body.q.trim()) return false;
  if (ROUTED_KEYS.some((k) => present(first[k]))) return false;
  if (first.countCapped === true || first.countUnavailable === true || first.relatedUnavailable === true) return false;
  const echoed = Array.isArray(first.excludedSources) ? (first.excludedSources as unknown[]).map(String) : [];
  if (echoed.includes("smartrecruiters")) return false;
  return true;
}

/** The count read's body: the first read's, counting only the withheld system, logged nowhere, with no page. */
export function countBodyOf(body: Record<string, unknown>): Record<string, unknown> {
  const { limit: _l, offset: _o, excludeSources: _x, ...rest } = body;
  return { ...rest, countOnly: true, vendor: "smartrecruiters", noLog: true };
}

const sameStrings = (a: unknown, b: unknown): boolean => {
  const norm = (v: unknown) => (Array.isArray(v) ? v.map(String).sort() : []);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
};

/**
 * TOTAL WITHOUT THE WITHHELD ROWS, ONLY WHEN THE COUNT IS PROVABLY THE SAME
 * SEARCH: the count answer is a count (no jobs array), its total is a whole
 * number at or under the page's, it says neither countCapped nor
 * countUnavailable, and its ignoredFilters equal the page's. relatedTotal is
 * reduced only when both carry it and neither is capped or unavailable.
 * Null when the figure cannot be used.
 */
export function totalWithoutWithheld(first: BoardAnswer, count: BoardAnswer): { total: number; withheldTotal: number; relatedTotal?: number } | null {
  if (Array.isArray(count.jobs)) return null;
  const pageTotal = first.total;
  const n = count.total;
  if (typeof pageTotal !== "number" || typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > pageTotal) return null;
  if (count.countCapped === true || count.countUnavailable === true) return null;
  if (!sameStrings(first.ignoredFilters, count.ignoredFilters)) return null;
  const out: { total: number; withheldTotal: number; relatedTotal?: number } = { total: pageTotal - n, withheldTotal: n };
  if (
    typeof first.relatedTotal === "number" && typeof count.relatedTotal === "number" &&
    first.relatedCapped !== true && count.relatedCapped !== true && first.relatedUnavailable !== true && count.relatedUnavailable !== true &&
    count.relatedTotal <= first.relatedTotal
  ) {
    out.relatedTotal = first.relatedTotal - count.relatedTotal;
  }
  return out;
}

/** A refill read that settles as an answer, an abort, or a failure, never a throw. */
async function settled(p: Promise<BoardAnswer>): Promise<{ ok: true; r: BoardAnswer } | { ok: false; aborted: boolean }> {
  try {
    return { ok: true, r: await p };
  } catch (e) {
    return { ok: false, aborted: (e as Error)?.name === "AbortError" || (e as Error)?.name === "TimeoutError" };
  }
}

/**
 * THE PAGE. The first read is made as today (its failure is the call's
 * failure); then up to two refill reads, each bounded in start time and in
 * wait; then, when it was started, the count read is waited for up to
 * COUNT_GRACE_MS more.
 */
export async function fillPage(input: FillInput): Promise<FillResult> {
  const now = input.now ?? (() => Date.now());
  const t0 = input.startedAt ?? now();
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), Math.max(0, REFILL_ABORT_MS - (now() - t0)));
  try {
    const first = input.first ?? await input.read(input.body);
    const firstRows = rowsOf(first);
    const firstGate = await input.gate(firstRows);
    const rows: Row[] = [...firstGate.kept];
    const seen = new Set(firstRows.map(idOf));
    let dropped = firstGate.dropped;
    let answered = firstRows.length;
    let last = first;
    // Refilled only when the first read dropped a row and the caller will serve this page.
    const refilling = droppedTotal(firstGate.dropped) > 0 && !(input.proceed && !input.proceed(first));
    let askedOffset = input.offset;
    let refillReads = 0;
    let because: PageShortReason | undefined;
    let countP: Promise<CountOutcome> | null = null;

    while (refilling && rows.length < input.limit && last.hasMore === true) {
      const next = last.nextOffset;
      if (typeof next !== "number" || !Number.isFinite(next) || next <= askedOffset) { because = "no_next_offset"; break; }
      if (refillReads >= MAX_REFILL_READS) { because = "refill_limit"; break; }
      if (next > input.deepestOffset) { because = "deepest_offset"; break; }
      if (now() - t0 >= REFILL_START_BUDGET_MS) { because = "time_budget"; break; }
      const missing = input.limit - rows.length;
      const refillBody = { ...input.body, offset: next, limit: missing, noLog: true };
      refillReads++;
      if (input.countRead && !countP && countReadAllowed(input.body, first, firstGate.dropped)) {
        countP = settled(input.read(countBodyOf(input.body), controller.signal))
          .then((s): CountOutcome => (s.ok ? { state: "answered", answer: s.r } : { state: "failed" }));
      }
      const got = await settled(input.read(refillBody, controller.signal));
      if ("aborted" in got) { because = got.aborted ? "time_budget" : "board_error"; break; }
      const gotRows = rowsOf(got.r);
      if (gotRows.some((j) => seen.has(idOf(j)))) { because = "board_moved"; break; }
      const g = await input.gate(gotRows);
      for (const j of gotRows) seen.add(idOf(j));
      rows.push(...g.kept);
      dropped = addDropped(dropped, g.dropped);
      answered += gotRows.length;
      last = got.r;
      askedOffset = next;
    }
    // The reason is published only for a page that is short while it says more exists.
    const pageShortBecause = rows.length < input.limit && last.hasMore === true ? because : undefined;

    let count: CountOutcome = { state: "none" };
    if (countP) {
      const late = new Promise<CountOutcome>((resolve) => setTimeout(() => resolve({ state: "late" }), COUNT_GRACE_MS));
      count = await Promise.race([countP, late]);
    }
    return {
      rows: rows.slice(0, input.limit), first, last, answered, dropped, refillReads,
      ...(pageShortBecause ? { pageShortBecause } : {}),
      count,
    };
  } finally {
    clearTimeout(abortTimer);
    // Anything still in flight (a count read past its grace) is abandoned.
    controller.abort();
  }
}

/** The dropped counts as one number. */
export const withheldCount = droppedTotal;
