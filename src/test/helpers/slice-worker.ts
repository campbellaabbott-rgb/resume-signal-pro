/**
 * The refresh worker's per-board steps, lifted out of index.ts and RUN.
 *
 * index.ts cannot be imported (it calls Deno.serve at load and imports from
 * esm.sh), so these cut two spans of the worker loop out of the RAW source
 * (esbuild drops the comments), bind the loop's own names to stubs, and run
 * them:
 *
 *   runGate   — turns of the loop up to the fetch: queue.shift, the
 *               dormancy skip, the start gate (the shipped canStart closure
 *               over the shipped startGate), the yield, the reservation size
 *               and the cold-cursor count. Answers which board was started,
 *               or what deferred it.
 *   runVisit  — everything between the board's first fetch and its success
 *               path: the light re-read, the streamed read, the landed count,
 *               boardsDone, and the failure/oversize branch. Answers what the
 *               visit read, streamed, deferred, failed or registered.
 *
 * A miss throws: the code moved, and the harness must be re-pointed on
 * purpose rather than pass on nothing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { startGate } from "../../../supabase/functions/job-board/start-gate";
import { lightReread, lightRereadStats, type LightRereadStats } from "../../../supabase/functions/job-board/light-reread";
import { noteOversize, type OversizeEntry } from "../../../supabase/functions/job-board/oversize-registry";
import { cursorAfterFailure } from "../../../supabase/functions/job-board/read-window";

export const INDEX_PATH = resolve(__dirname, "../../../supabase/functions/job-board/index.ts");
const RAW = (): string => readFileSync(INDEX_PATH, "utf8");

const between = (src: string, from: string, to: string, what: string, inclusive = false): string => {
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`${what}: anchor not found in index.ts — re-point this harness`);
  return src.slice(a, inclusive ? b + to.length : b);
};

const compile = (ts: string, params: string[]) => {
  let js: string;
  try {
    js = transformSync(ts, { loader: "ts" }).code;
  } catch (e) {
    throw new Error(`the lifted source does not compile (${e instanceof Error ? e.message : String(e)})\n--- lifted ---\n${ts}`);
  }
  return new Function(...params, `${js}\nreturn __run;`);
};

/** Live values of index.ts's own constants, read off the source. */
export const constOf = (name: string): number => {
  const m = RAW().match(new RegExp(`^const ${name} = ([0-9_]+);`, "m"));
  if (!m) throw new Error(`const ${name} not found at the top level of index.ts`);
  return Number(m[1].replace(/_/g, ""));
};

type Board = { source: string; token: string; name?: string; pages?: number };

// ── runGate ─────────────────────────────────────────────────────────────────

export interface GateEnv {
  queue: Board[];
  fetchedInSlice?: number;
  inFlightReserve?: number;
  boardsDone?: number;
  boardBudget?: number;
  elapsedMs?: number;
  heapMb?: number | undefined;
  spinsSoFar?: number;
  dormant?: string[];
  base?: string[];
  baseAttempted?: number;
  inHotPhase?: boolean;
  /** Loop turns to run before giving up (default 1). A deferral or a yield ends a turn; a start ends the run. */
  turns?: number;
}
export interface GateOut {
  /** The board the turn started, or null when it deferred, skipped, yielded or found the queue empty. */
  started: string | null;
  reserve?: number;
  deferred: string[];
  queue: string[];
  waitedMs: number[];
  sizeStopped: boolean;
  wallStopped: boolean;
  heapStopped: boolean;
  baseAttempted: number;
  /** The worker left the loop (the queue was empty), as opposed to moving on to its next turn. */
  exited: boolean;
}

export function runGate(env: GateEnv): Promise<GateOut> {
  const raw = RAW();
  const canStartDecl = between(raw, "const canStart = ", "\n  });\n", "the canStart closure", true);
  const loop = between(raw, "const s = queue.shift();", "inFlightReserve += reserve;", "the worker loop's start gate");
  const names = [
    "env", "queue", "skipTokens", "boardKeyOf", "yieldsByToken", "YIELD_SPIN_LIMIT", "budgetSkipped", "setTimeout",
    "inHotPhase", "deepTokens", "CAPPED_VISIT_VENDORS", "MAX_POSTINGS_PER_VISIT", "COLD_BOARD_RESERVE", "baseTokens",
    "startGate", "SLICE_POSTING_BUDGET", "sliceWallStart", "SLICE_WALL_BUDGET_MS", "memStamp", "HEAP_SOFT_LIMIT_MB", "boardBudget",
  ];
  const run = compile(`async function __run() {
    let fetchedInSlice = env.fetchedInSlice, inFlightReserve = env.inFlightReserve, boardsDone = env.boardsDone, baseAttempted = env.baseAttempted;
    let sizeStopped = false, wallStopped = false, heapStopped = false;
    ${canStartDecl}
    for (let __turn = 0; __turn < env.turns; __turn++) {
      ${loop}
      return { started: s.token, reserve, baseAttempted, sizeStopped, wallStopped, heapStopped, exited: false };
    }
    return { started: null, baseAttempted, sizeStopped, wallStopped, heapStopped, exited: false };
  }`, names);
  const queue = env.queue.map((b) => ({ name: b.token, ...b }));
  const deferred: string[] = [];
  const waitedMs: number[] = [];
  const first = env.queue[0];
  const yields = new Map<string, number>(first && env.spinsSoFar ? [[first.token, env.spinsSoFar]] : []);
  const scope: Record<string, unknown> = {
    env: { fetchedInSlice: env.fetchedInSlice ?? 0, inFlightReserve: env.inFlightReserve ?? 0, boardsDone: env.boardsDone ?? 0, baseAttempted: env.baseAttempted ?? 0, turns: env.turns ?? 1 },
    queue,
    skipTokens: new Set(env.dormant ?? []),
    boardKeyOf: (s: Board) => s.token,
    yieldsByToken: yields,
    YIELD_SPIN_LIMIT: constOf("YIELD_SPIN_LIMIT"),
    budgetSkipped: deferred,
    setTimeout: (f: () => void, ms: number) => { waitedMs.push(ms); f(); },
    inHotPhase: env.inHotPhase ?? false,
    deepTokens: new Set<string>(),
    CAPPED_VISIT_VENDORS: new Set<string>(),
    MAX_POSTINGS_PER_VISIT: constOf("MAX_POSTINGS_PER_VISIT"),
    COLD_BOARD_RESERVE: constOf("COLD_BOARD_RESERVE"),
    baseTokens: new Set(env.base ?? []),
    startGate,
    SLICE_POSTING_BUDGET: constOf("SLICE_POSTING_BUDGET"),
    sliceWallStart: Date.now() - (env.elapsedMs ?? 1_000),
    SLICE_WALL_BUDGET_MS: constOf("SLICE_WALL_BUDGET_MS"),
    memStamp: () => ("heapMb" in env ? (env.heapMb === undefined ? {} : { heapMb: env.heapMb }) : { heapMb: 40 }),
    HEAP_SOFT_LIMIT_MB: constOf("HEAP_SOFT_LIMIT_MB"),
    boardBudget: env.boardBudget ?? constOf("MAX_BOARDS_PER_SLICE"),
  };
  return (run(...names.map((n) => scope[n])) as () => Promise<Omit<GateOut, "deferred" | "queue" | "waitedMs"> | undefined>)().then((o) => ({
    started: null, sizeStopped: false, wallStopped: false, heapStopped: false, baseAttempted: env.baseAttempted ?? 0, exited: true,
    ...(o ?? {}),
    deferred, queue: queue.map((b) => b.token), waitedMs,
  }));
}

// ── runVisit ────────────────────────────────────────────────────────────────

type Read = { jobs: unknown[]; raw: unknown } | null;
export interface VisitEnv {
  board: Board;
  /** The first fetch's verdict ("" with a non-null firstRead when it landed). */
  failReason: string;
  firstRead?: Read;
  /** What fetchBoard answers on a further read: the read, or a failure verdict. */
  reread?: (call: { light: boolean; startOffset: number }) => { read: Read; reason?: string };
  /** The set refuses this board (enrolDynamicLight answers false). */
  refuse?: boolean;
  lightAtStart?: boolean;
  /** The start gate's verdict for the re-read. */
  gate?: string;
  base?: boolean;
  baseAttempted?: number;
  inFlightReserve?: number;
  reserve?: number;
  stats?: LightRereadStats;
  done?: Set<string>;
  /** SLIM_SPECS as the span sees it (default none: nothing streams). */
  slimSpecs?: Record<string, unknown>;
  /** What the streamed read (readOversizeBoard) answers, told whether the board is light when it starts. */
  stream?: (call: { light: boolean }) => Read;
}
export interface VisitOut {
  r: Read;
  failReason: string;
  fetchCalls: Array<{ light: boolean; startOffset: number; reserveDuring: number }>;
  /** Each streamed read: whether the board was light (so its list URL the light one) and the reservation during it. */
  streamCalls: Array<{ light: boolean; reserveDuring: number }>;
  enrolCalls: number;
  light: boolean;
  fetchedInSlice: number;
  boardsDone: number;
  baseAttempted: number;
  inFlightReserve: number;
  deferred: string[];
  oversized: string[];
  failed: string[];
  registry: Map<string, OversizeEntry>;
  gateAsked: unknown[];
  stats: LightRereadStats;
}

export async function runVisit(env: VisitEnv): Promise<VisitOut> {
  const raw = RAW();
  const fetchAt = raw.indexOf("r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors.get(s.token) ?? 0);");
  if (fetchAt < 0) throw new Error("the worker's first fetch moved — re-point this harness");
  const release = "finally { inFlightReserve -= reserve; }";
  const startAt = raw.indexOf(release, fetchAt);
  const endAt = raw.indexOf("const cursorBefore = deepCursors.get(s.token) ?? 0;", startAt);
  if (startAt < 0 || endAt < 0) throw new Error("the worker's post-fetch span moved — re-point this harness");
  const span = raw.slice(startAt + release.length, endAt);
  const names = [
    "env", "s", "reserve", "client", "lightReread", "LIGHT_CAPABLE_VENDORS", "isLight", "enrolDynamicLight", "canStart", "fetchBoard",
    "lightRereadDone", "lightStats", "SLIM_SPECS", "sliceWallStart", "STREAM_READ_BUDGET_MS", "SLICE_WALL_BUDGET_MS", "memStamp",
    "HEAP_SOFT_LIMIT_MB", "readOversizeBoard", "freshCutoffMs", "breadcrumb", "deepLane", "deepTokens", "oversized", "noteOversize",
    "OVERSIZE_BOARDS", "SHARED_TOKENS", "budgetSkipped", "failed", "waitUntil", "boardFailures", "boardKeyOf", "cursorAfterFailure",
    "deepCursors", "baseTokens",
  ];
  const run = compile(`async function __run() {
    let r = env.r, failReason = env.failReason, inFlightReserve = env.inFlightReserve, fetchedInSlice = 0, boardsDone = 0;
    let baseAttempted = env.baseAttempted, oversizeDirty = false, deepCursorsDirty = false;
    env.reserveNow = () => inFlightReserve;
    for (let __once = 0; __once < 1; __once++) {
      ${span}
    }
    return { r, failReason, inFlightReserve, fetchedInSlice, boardsDone, baseAttempted };
  }`, names);
  const s = { name: env.board.token, ...env.board };
  const key = `${s.source}:${s.token}`;
  const lightSet = new Set<string>(env.lightAtStart ? [key] : []);
  const fetchCalls: VisitOut["fetchCalls"] = [];
  const streamCalls: VisitOut["streamCalls"] = [];
  let enrolCalls = 0;
  const gateAsked: unknown[] = [];
  const registry = new Map<string, OversizeEntry>();
  const deferred: string[] = [], oversized: string[] = [], failed: string[] = [];
  const stats = env.stats ?? lightRereadStats();
  const inner: { r: Read; failReason: string; inFlightReserve: number; baseAttempted: number; reserveNow?: () => number } = {
    r: env.firstRead ?? null, failReason: env.failReason, inFlightReserve: env.inFlightReserve ?? 7, baseAttempted: env.baseAttempted ?? 0,
  };
  const scope: Record<string, unknown> = {
    env: inner,
    s,
    reserve: env.reserve ?? 40,
    client: { from: () => ({ upsert: () => Promise.resolve({ error: null }) }) },
    lightReread,
    LIGHT_CAPABLE_VENDORS: new Set(["greenhouse"]),
    isLight: (b: Board) => lightSet.has(`${b.source}:${b.token}`),
    enrolDynamicLight: async (_c: unknown, b: Board) => {
      enrolCalls++;
      if (env.refuse) return false;
      lightSet.add(`${b.source}:${b.token}`);
      return true;
    },
    canStart: (newBoard: unknown) => { gateAsked.push(newBoard); return env.gate ?? "ok"; },
    fetchBoard: async (b: Board, onFail: (m: string) => void, startOffset: number) => {
      const light = lightSet.has(`${b.source}:${b.token}`);
      fetchCalls.push({ light, startOffset, reserveDuring: inner.reserveNow!() });
      const out = env.reread ? env.reread({ light, startOffset }) : { read: null, reason: "HTTP 500" };
      if (!out.read) onFail(out.reason ?? "");
      return out.read;
    },
    lightRereadDone: env.done ?? new Set<string>(),
    lightStats: stats,
    SLIM_SPECS: env.slimSpecs ?? {},
    sliceWallStart: Date.now() - 1_000,
    STREAM_READ_BUDGET_MS: constOf("STREAM_READ_BUDGET_MS"),
    SLICE_WALL_BUDGET_MS: constOf("SLICE_WALL_BUDGET_MS"),
    memStamp: () => ({ heapMb: 40 }),
    HEAP_SOFT_LIMIT_MB: constOf("HEAP_SOFT_LIMIT_MB"),
    readOversizeBoard: async (b: Board) => {
      const light = lightSet.has(`${b.source}:${b.token}`);
      streamCalls.push({ light, reserveDuring: inner.reserveNow!() });
      return env.stream ? env.stream({ light }) : null;
    },
    freshCutoffMs: 0,
    breadcrumb: async () => {},
    deepLane: null,
    deepTokens: new Set<string>(),
    oversized,
    noteOversize,
    OVERSIZE_BOARDS: registry,
    SHARED_TOKENS: new Set<string>(),
    budgetSkipped: deferred,
    failed,
    waitUntil: (p: unknown) => p,
    boardFailures: { streaks: {} },
    boardKeyOf: (b: Board) => b.token,
    cursorAfterFailure,
    deepCursors: new Map<string, number>(),
    baseTokens: new Set(env.base ? [s.token] : []),
  };
  const out = await (run(...names.map((n) => scope[n])) as () => Promise<{ r: Read; failReason: string; inFlightReserve: number; fetchedInSlice: number; boardsDone: number; baseAttempted: number }>)();
  return { ...out, fetchCalls, streamCalls, enrolCalls, light: lightSet.has(key), deferred, oversized, failed, registry, gateAsked, stats };
}
