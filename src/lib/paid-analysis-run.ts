/**
 * ASKING FOR A PAID ANALYSIS (hotfix 2026-11-10: M-S14-005, C-S14-005,
 * C-S14-010).
 *
 * analyze-resume makes one analysis per purchase at a time: a second request
 * while the first is still being made is answered 409 with code
 * analysis_in_progress. The page then asks again every few seconds, so it
 * shows the first run's analysis as soon as it exists (a delivered analysis
 * is answered from its saved copy), instead of failing or paying for a second
 * model run.
 *
 * A request naming only the purchase (the page lost its pointer to the
 * stored résumé) is told what the purchase was bought against: storedInputs
 * when the stored copy is still kept, so the page asks for the analysis from
 * it, and checkoutHadPosting once it is not, so the page asks for the posting
 * with the résumé.
 *
 * Until analyze-resume 2026-11-10.1 is live neither answer exists, and this
 * behaves exactly as the page did before: one ask, and the résumé box.
 */

export const IN_PROGRESS_CODE = "analysis_in_progress";
export const POLL_INTERVAL_MS = 5_000;
/** Past analyze-resume's own budget and its lease: the first run has finished or failed by then. */
export const POLL_BUDGET_MS = 4 * 60_000;

// deno-lint-ignore no-explicit-any
export type Answer = { data: any; error: any };
/**
 * One ask of analyze-resume. The page passes its own
 * supabase.functions.invoke("analyze-resume", { body }) call, so each ask
 * keeps the shape the deploy check reads in the published chunk (section 57:
 * every ask names the page's language).
 */
export type Ask = () => Promise<Answer>;

/** The JSON body of a failed function call, or null. Never throws; the body stays readable for others. */
export async function errorBodyOf(error: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } } | null)?.context;
  if (!ctx || typeof ctx.clone !== "function") return null;
  try {
    const body = await ctx.clone().json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type PollOptions = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  budgetMs?: number;
  intervalMs?: number;
  /** Called once, the first time the page waits on another request's run. */
  onWaiting?: () => void;
};

/**
 * analyze-resume asked once, and asked again the same way while another
 * request for the same purchase is making the analysis, until it answers
 * otherwise or the budget runs out (the last answer is returned either way).
 */
export async function invokePaidAnalysis(ask: Ask, opts: PollOptions = {}): Promise<Answer> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const budget = opts.budgetMs ?? POLL_BUDGET_MS;
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  const started = now();
  let waited = false;
  for (;;) {
    const answer = await ask();
    if (!answer.error) return answer;
    const failure = await errorBodyOf(answer.error);
    if (failure?.code !== IN_PROGRESS_CODE || now() - started >= budget) return answer;
    if (!waited) {
      waited = true;
      opts.onWaiting?.();
    }
    await sleep(interval);
  }
}

export type SessionOnlyAnswer =
  | { kind: "delivered"; data: Record<string, unknown> }
  | { kind: "stored" }
  | { kind: "needsResume"; askPosting: boolean };

/** What a request naming only the purchase was told. */
export async function readSessionOnlyAnswer(answer: Answer): Promise<SessionOnlyAnswer> {
  const { data, error } = answer;
  if (!error && data && !data.error && data.alreadyDelivered) return { kind: "delivered", data };
  const body = error ? await errorBodyOf(error) : (data && typeof data === "object" ? (data as Record<string, unknown>) : null);
  const stored = body?.storedInputs as { resume?: unknown } | undefined;
  if (stored?.resume === true) return { kind: "stored" };
  return { kind: "needsResume", askPosting: body?.checkoutHadPosting === true };
}
