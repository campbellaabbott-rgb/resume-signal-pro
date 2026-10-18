/**
 * THE WRITING TOOLS' REFUSALS, AS THE ACCOUNT PAGE SAYS THEM (owner decision
 * 2026-10-12: the writing tools are counted by account on the server).
 *
 * generate-apply-package, generate-cover-letter, generate-tailored-resume and
 * generate-interview-coach refuse in exactly two ways:
 *   401 { error: "sign_in_required" }: no account;
 *   429 { error: "daily_limit" | "monthly_limit", resetsAt }: the account has
 *       used its allowance (a free account one of each a day, Pro five
 *       packages a day and sixty a month).
 * supabase.functions.invoke turns any non-2xx into an error whose `context` is
 * the Response, with `data` null, so the account panels read the body here and
 * say what happened and when it ends, never "Generation failed, try again",
 * which sends a person to retry something that cannot work until tomorrow.
 *
 * The sentence is worded on the page (t(key, English default)), from the code
 * and resetsAt, so it is translated like every other string; the server's own
 * English `message` is not shown.
 */

export type WritingRefusalCode = "sign_in_required" | "daily_limit" | "monthly_limit";

export type WritingRefusal = {
  code: WritingRefusalCode;
  /** When the allowance comes back (ISO), for the two limits; null otherwise. */
  resetsAt: string | null;
};

type Translate = (key: string, fallback: string, vars?: Record<string, unknown>) => string;

const CODES: ReadonlySet<string> = new Set(["sign_in_required", "daily_limit", "monthly_limit"]);

/**
 * The refusal an invoke error carries, or null for any other failure (a model
 * timeout, a grounding refusal, the network). Never throws.
 */
export async function writingRefusalOf(error: unknown): Promise<WritingRefusal | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (!ctx || typeof ctx !== "object") return null;
  const status = (ctx as { status?: unknown }).status;
  if (status !== 401 && status !== 429) return null;
  let body: unknown = null;
  try {
    const res = ctx as Response;
    const copy = typeof res.clone === "function" ? res.clone() : res;
    body = typeof copy.json === "function" ? await copy.json() : null;
  } catch {
    body = null;
  }
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; code?: unknown; resetsAt?: unknown };
  const code = typeof b.error === "string" && CODES.has(b.error) ? b.error : typeof b.code === "string" && CODES.has(b.code) ? b.code : null;
  if (!code) return null;
  if (code === "sign_in_required" && status !== 401) return null;
  if (code !== "sign_in_required" && status !== 429) return null;
  const resetsAt = typeof b.resetsAt === "string" && Number.isFinite(Date.parse(b.resetsAt)) ? b.resetsAt : null;
  return { code: code as WritingRefusalCode, resetsAt };
}

/** The refusal in a sentence a person can act on. */
export function writingRefusalText(r: WritingRefusal, t: Translate, locale?: string): string {
  if (r.code === "sign_in_required") {
    return t("writingRefusal.signIn", "Sign in to use the writing tools. A free account includes one tailored résumé, one cover letter and one interview-prep set a day.");
  }
  const when = r.resetsAt
    ? new Date(r.resetsAt).toLocaleString(locale, { weekday: "short", hour: "numeric", minute: "2-digit" })
    : null;
  if (r.code === "monthly_limit") {
    return when
      ? t("writingRefusal.monthly", "You've used this month's writing allowance. You can make more after {{when}}.", { when })
      : t("writingRefusal.monthlyNoTime", "You've used this month's writing allowance. You can make more next month.");
  }
  return when
    ? t("writingRefusal.daily", "You've used today's writing allowance. You can make more after {{when}}; what you made so far is saved.", { when })
    : t("writingRefusal.dailyNoTime", "You've used today's writing allowance. You can make more tomorrow; what you made so far is saved.");
}
