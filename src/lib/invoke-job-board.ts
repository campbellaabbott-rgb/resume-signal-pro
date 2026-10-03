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
 *   - a counted read waits for a pass first (about a second, once a half hour;
 *     never longer than board-pass.ts's one deadline, script load included);
 *     an uncounted call (status, click, report) never waits, but starts the
 *     check so the pass is ready for the counted read behind it;
 *   - the pass a call is given is the pass it sends as x-rb-pass;
 *   - a refusal with code "pass" gets a fresh pass and ONE retry -- the single
 *     exception to "a budget refusal is never retried" (src/lib/board-budget.ts),
 *     because a fresh pass lifts it at once. The refusal names the pass it
 *     refused, so refusals that land one after another share one new pass;
 *   - a call that carried a pass and got no answer at all forgets that pass, so
 *     a job-board that does not allow the header (a rollback) is read without it.
 */
import type { FunctionInvokeOptions } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { readBoardBudgetRefusal } from "@/lib/board-budget";
import { BOARD_PASS_HEADER, boardPassEnabled, ensureBoardPass, forgetBoardPass, heldBoardPass } from "@/lib/board-pass";

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

/** The call, carrying exactly the pass it was handed (null: the caller's own options, untouched). */
function send<T>(options: FunctionInvokeOptions | undefined, pass: string | null) {
  const sent = supabase.functions.invoke<T>("job-board", pass ? { ...options, headers: { ...(options?.headers ?? {}), [BOARD_PASS_HEADER]: pass } } : options);
  return sent.then((res) => {
    if (pass && (res.error as { name?: unknown } | null)?.name === "FunctionsFetchError") forgetBoardPass(pass);
    return res;
  });
}

async function withPass<T>(options?: FunctionInvokeOptions) {
  if (!BOARD_COUNTED_ACTIONS.has(actionOf(options))) {
    void ensureBoardPass();
    return send<T>(options, heldBoardPass());
  }
  const pass = await ensureBoardPass();
  const first = await send<T>(options, pass);
  if (!first.error) return first;
  const refused = await readBoardBudgetRefusal(first.error);
  if (refused?.code !== "pass") return first;
  // THE ONE RETRY of a budget refusal: a fresh pass, then the same call again.
  const fresh = await ensureBoardPass({ fresh: true, refused: pass });
  if (!fresh) return first;
  return send<T>(options, fresh);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function invokeJobBoard<T = any>(options?: FunctionInvokeOptions) {
  if (!boardPassEnabled()) return supabase.functions.invoke<T>("job-board", options);
  return withPass<T>(options);
}
