/**
 * THE BOARD'S DAILY ALLOWANCE, AS THE PAGE SEES IT.
 *
 * job-board counts anonymous reads per address and answers past the cap with
 * a 429 whose JSON body says `error: "board_budget"` (supabase/functions/
 * job-board/anon-budget.ts). supabase-js hands that back as
 * `{ data: null, error: FunctionsHttpError }` with the Response on
 * `error.context`, body unread.
 *
 * Three things follow, and each was a defect before this module existed:
 *   1. A refusal must never be RETRIED. The board's callers retry every failure
 *      once after 1.2s; against a cap that resets at midnight UTC a retry is a
 *      second refused request and nothing else.
 *      THE SINGLE EXCEPTION (.87): code "pass" -- the browser's board pass was
 *      missing or stale -- is lifted at once by a fresh pass, so
 *      src/lib/invoke-job-board.ts gets one and retries exactly ONCE before the
 *      caller ever sees the refusal. Nothing else retries a refusal, and a
 *      second "pass" refusal is final like any other (resetAt null: it stands
 *      until the page is reloaded).
 *   2. A refusal is not an answer about a posting. A deep link whose detail was
 *      refused used to render "Posting no longer available" and mark a LIVE
 *      posting noindex; a hover prefetch used to cache "" (the employer wrote
 *      no description) for every card under the pointer.
 *   3. Once refused, every further counted call would be refused too, so the
 *      page stops asking until the reset and says so in words.
 */
import { useSyncExternalStore } from "react";

export type BoardBudgetRefusalCode = "address" | "country" | "network" | "pass";
export type BoardBudgetRefusal = { code: BoardBudgetRefusalCode; limit: number | null; resetAt: string | null };

const REFUSAL_CODES: ReadonlySet<string> = new Set<BoardBudgetRefusalCode>(["address", "country", "network", "pass"]);

/** The error code the board's 429 carries. The page matches nothing else as a refusal. */
export const BOARD_BUDGET_ERROR = "board_budget";

type ResponseLike = { status: number; clone: () => { json: () => Promise<unknown> } };
const responseOf = (error: unknown): ResponseLike | null => {
  const ctx = (error as { context?: unknown } | null | undefined)?.context as Partial<ResponseLike> | undefined;
  return ctx && typeof ctx.status === "number" && typeof ctx.clone === "function" ? (ctx as ResponseLike) : null;
};

/** The HTTP status behind a supabase-js function error, or null when there was no response at all. */
export function httpStatusOf(error: unknown): number | null {
  return responseOf(error)?.status ?? null;
}

/** The refusal, when this error IS one: a 429 whose body names the board's budget. Anything else is null. */
export async function readBoardBudgetRefusal(error: unknown): Promise<BoardBudgetRefusal | null> {
  if ((error as { message?: unknown } | null | undefined)?.message === BOARD_BUDGET_ERROR) return current();
  const res = responseOf(error);
  if (!res || res.status !== 429) return null;
  try {
    const body = (await res.clone().json()) as { error?: unknown; code?: unknown; limit?: unknown; resetAt?: unknown } | null;
    if (!body || body.error !== BOARD_BUDGET_ERROR) return null;
    return {
      code: typeof body.code === "string" && REFUSAL_CODES.has(body.code) ? (body.code as BoardBudgetRefusalCode) : "address",
      limit: typeof body.limit === "number" ? body.limit : null,
      resetAt: typeof body.resetAt === "string" ? body.resetAt : null,
    };
  } catch {
    return null;
  }
}

// ── the module store: one refusal per page session, cleared at its reset ──

let refusal: BoardBudgetRefusal | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

/** Pure, so it can be a render-time snapshot: the same object until the reset, then null. */
function current(): BoardBudgetRefusal | null {
  return refusal && !(refusal.resetAt && Date.parse(refusal.resetAt) <= Date.now()) ? refusal : null;
}

/** Record a refusal. Every counted board call short-circuits until its reset. */
export function markBoardBudgetRefused(r: BoardBudgetRefusal): void {
  refusal = r;
  if (timer) clearTimeout(timer);
  const ms = r.resetAt ? Date.parse(r.resetAt) - Date.now() : NaN;
  // Re-render at the reset; setTimeout cannot hold more than ~24.8 days.
  if (Number.isFinite(ms) && ms > 0 && ms < 2_000_000_000) timer = setTimeout(() => { refusal = null; timer = null; notify(); }, ms + 1000);
  notify();
}

/** The standing refusal, or null. Self-clears once its reset has passed. */
export function boardBudgetRefusal(): BoardBudgetRefusal | null {
  return current();
}

/** For tests: forget any refusal. */
export function clearBoardBudgetRefusal(): void {
  refusal = null;
  if (timer) { clearTimeout(timer); timer = null; }
  notify();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The standing refusal, re-rendering when one lands or clears. */
export function useBoardBudgetRefusal(): BoardBudgetRefusal | null {
  return useSyncExternalStore(subscribe, boardBudgetRefusal, () => null);
}
