/**
 * EVERY BROWSER CALL TO job-board GOES THROUGH HERE.
 *
 * One door, so the board pass (src/lib/board-pass.ts) rides on every call
 * without each call site carrying it: src/test/the-board-pass-rides-every-
 * board-call.test.tsx fails on any other file that invokes job-board directly.
 *
 * With VITE_TURNSTILE_SITE_KEY unset this IS supabase.functions.invoke("job-board",
 * options): same arguments, no header, no wait, nothing loaded.
 *
 * With it set:
 *   - a counted read waits for a pass first (about a second, once a half hour);
 *     an uncounted call (status, click, report) never waits, but starts the
 *     check so the pass is ready for the counted read behind it;
 *   - the pass, when one is held, goes on every call as x-rb-pass;
 *   - a refusal with code "pass" gets a fresh pass and ONE retry -- the single
 *     exception to "a budget refusal is never retried" (src/lib/board-budget.ts),
 *     because a fresh pass lifts it at once;
 *   - a call that carried a pass and got no answer at all forgets the pass, so
 *     a job-board that does not allow the header (a rollback) is read without it.
 */
import type { FunctionInvokeOptions } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { readBoardBudgetRefusal } from "@/lib/board-budget";
import { boardPassEnabled, boardPassHeader, ensureBoardPass, forgetBoardPass } from "@/lib/board-pass";

/**
 * MIRRORS BUDGETED_ACTIONS in supabase/functions/job-board/anon-budget.ts (a
 * test holds the two equal): the actions the board counts, and so the ones a
 * pass is required for. A body with no action is a list.
 */
export const BOARD_COUNTED_ACTIONS: ReadonlySet<string> = new Set([
  "list", "detail", "facets", "company-suggest", "exists", "semantic-search", "application-questions", "verify",
]);

const actionOf = (options?: FunctionInvokeOptions): string =>
  String((options?.body as { action?: unknown } | null | undefined)?.action ?? "list");

function send<T>(options?: FunctionInvokeOptions) {
  const pass = boardPassHeader();
  const carried = Object.keys(pass).length > 0;
  const sent = supabase.functions.invoke<T>("job-board", carried ? { ...options, headers: { ...(options?.headers ?? {}), ...pass } } : options);
  return sent.then((res) => {
    if (carried && (res.error as { name?: unknown } | null)?.name === "FunctionsFetchError") forgetBoardPass();
    return res;
  });
}

async function withPass<T>(options?: FunctionInvokeOptions) {
  if (!BOARD_COUNTED_ACTIONS.has(actionOf(options))) {
    void ensureBoardPass();
    return send<T>(options);
  }
  await ensureBoardPass();
  const first = await send<T>(options);
  if (!first.error) return first;
  const refused = await readBoardBudgetRefusal(first.error);
  if (refused?.code !== "pass") return first;
  // THE ONE RETRY of a budget refusal: a fresh pass, then the same call again.
  if (!(await ensureBoardPass({ fresh: true }))) return first;
  return send<T>(options);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function invokeJobBoard<T = any>(options?: FunctionInvokeOptions) {
  if (!boardPassEnabled()) return supabase.functions.invoke<T>("job-board", options);
  return withPass<T>(options);
}
