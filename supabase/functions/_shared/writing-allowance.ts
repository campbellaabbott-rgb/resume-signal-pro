/**
 * THE WRITING TOOLS ARE COUNTED BY ACCOUNT (owner decision, 2026-10-12).
 *
 * The tailored résumé, the cover letter and the interview-prep set were free
 * to anyone with the publishable key: every visitor got Pro's headline tools
 * with no sign-in, bounded only by an address allowance a rotating pool walks
 * past. The server now decides by account, and a page cannot change it:
 *
 *   - signed out: none. 401 { error: "sign_in_required" }.
 *   - a free account: one of each tool a UTC day, on the Flash model chain.
 *   - Pro: five packages a UTC day and sixty a UTC month, on the quality
 *     chain. A package is a tailored résumé, a letter and a prep set for one
 *     job, so each tool counts five a day and sixty a month on its own.
 *   - past the allowance: 429 { error: "daily_limit" | "monthly_limit",
 *     resetsAt } with a sentence a person can read in `message`.
 *
 * Our own servers (the service-role key: paid deliveries for past buyers) and
 * a browser naming a purchase the function itself delivers are not counted
 * here; the model spend gate still counts them as before.
 *
 * A use is taken BEFORE the model is called (two tabs cannot both spend the
 * last one: take_writing_tools locks the account's rows) and given back when
 * the call fails, so a model error or a refused draft costs the person
 * nothing. The SQL is take_writing_tools / refund_writing_tools
 * (20261011160000); the figures live here and are passed in, and
 * src/config/writing-allowance.ts mirrors them for the pages (a test holds
 * the two equal).
 */
import { websiteSessionOf, type WebsiteAuth } from "./website-session.ts";
import { accountProStanding } from "./pro-standing.ts";

export type WritingTool = "resume" | "letter" | "prep";

export const WRITING_ALLOWANCE = Object.freeze({
  /** A free account: this many of each tool a UTC day. */
  freePerToolPerDay: 1,
  /** Pro: this many packages (each tool once) a UTC day... */
  proPackagesPerDay: 5,
  /** ...and this many a UTC month. */
  proPackagesPerMonth: 60,
});

/** Pro's writing tools: the quality chain (owner decision 11). */
export const QUALITY_CHAIN: readonly string[] = ["google/gemini-2.5-pro", "openai/gpt-5", "openai/gpt-5-mini"];
/** A free account's daily allowance: Flash, then the small cross-provider model. */
export const FLASH_CHAIN: readonly string[] = ["google/gemini-2.5-flash", "openai/gpt-5-mini"];

export const TAKE_RPC = "take_writing_tools";
export const REFUND_RPC = "refund_writing_tools";

/** Who this call is, for the model chain and for giving a use back. */
export type WritingPass =
  | { kind: "service" }
  | { kind: "purchase" }
  | { kind: "account"; userId: string; tier: "free" | "pro"; useIds: string[] };

// deno-lint-ignore no-explicit-any
export type WritingDb = { rpc: (fn: string, args: Record<string, unknown>) => any };

const TOOL_NAMES: Record<WritingTool, string> = {
  resume: "tailored résumé",
  letter: "cover letter",
  prep: "interview-prep set",
};

function json(body: unknown, status: number, cors: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });
}

/** The refusal for a caller with no website session. */
export function signInRequired(cors: Record<string, string>): Response {
  return json({
    error: "sign_in_required",
    code: "sign_in_required",
    message: "Sign in to use the writing tools. A free account includes one tailored résumé, one cover letter and one interview-prep set a day.",
  }, 401, cors);
}

/** "18:00 UTC" style time, or the date for a month boundary. */
function whenText(resetsAt: string, period: "day" | "month"): string {
  const d = new Date(resetsAt);
  if (!Number.isFinite(d.getTime())) return period === "day" ? "tomorrow" : "next month";
  return period === "day"
    ? `${d.toISOString().slice(11, 16)} UTC`
    : `${d.toISOString().slice(0, 10)} (UTC)`;
}

/** The refusal for a spent allowance. */
export function allowanceSpent(
  reason: "daily_limit" | "monthly_limit",
  tool: WritingTool,
  tier: "free" | "pro",
  limit: number,
  resetsAt: string,
  cors: Record<string, string>,
): Response {
  const period = reason === "daily_limit" ? "day" : "month";
  const what = TOOL_NAMES[tool] ?? "writing tool";
  const message = tier === "pro"
    ? `You've used this ${period}'s ${limit} ${what}s on Pro. You can make more after ${whenText(resetsAt, period)}.`
    : `You've used today's free ${what}. You can make another after ${whenText(resetsAt, period)}, or go Pro for five a day.`;
  const seconds = Math.max(60, Math.ceil((Date.parse(resetsAt) - Date.now()) / 1000) || 3600);
  return json({ error: reason, code: reason, tool, tier, limit, resetsAt, message, retryable: true }, 429, cors, { "Retry-After": String(seconds) });
}

/** The refusal when the allowance could not be read or written: never a pass. */
function unavailable(cors: Record<string, string>): Response {
  return json({
    error: "limiter_unavailable",
    code: "limiter_unavailable",
    message: "This tool is temporarily unavailable. Please try again in a minute.",
    retryable: true,
  }, 503, cors, { "Retry-After": "60" });
}

export type WritingGateOptions = {
  /** The request comes from our own servers (the caller checked the service-role key). */
  service?: boolean;
  /** The body names a purchase this function delivers (the caller checked it). */
  purchase?: boolean;
  /** The auth client to verify the token with (supabase-js .auth); fetch is used without one. */
  auth?: WebsiteAuth;
};

/**
 * Who may write, and the use taken for it; or the Response to return. Run it
 * after the body is validated and before the model spend gate and any model
 * call. Give the use back with refundWriting() when the call does not deliver.
 */
export async function writingGate(
  db: WritingDb | null | undefined,
  req: Request,
  tools: readonly WritingTool[],
  cors: Record<string, string>,
  opts: WritingGateOptions = {},
): Promise<{ pass: WritingPass } | { refused: Response }> {
  if (opts.service) return { pass: { kind: "service" } };
  if (opts.purchase) return { pass: { kind: "purchase" } };

  const session = await websiteSessionOf(req.headers, opts.auth);
  if (!("session" in session)) return { refused: signInRequired(cors) };
  const userId = session.session.user.id.toLowerCase();
  if (!db) return { refused: unavailable(cors) };

  const standing = await accountProStanding(db, userId);
  if (!standing.known) return { refused: unavailable(cors) };
  return takeWriting(db, userId, standing.pro ? "pro" : "free", tools, cors);
}

/**
 * Take one use of each tool for an account whose tier the caller has already
 * read (generate-apply-package reads Pro itself). Same answer as writingGate.
 */
export async function takeWriting(
  db: WritingDb,
  userId: string,
  tier: "free" | "pro",
  tools: readonly WritingTool[],
  cors: Record<string, string>,
): Promise<{ pass: WritingPass } | { refused: Response }> {
  const perDay = tier === "pro" ? WRITING_ALLOWANCE.proPackagesPerDay : WRITING_ALLOWANCE.freePerToolPerDay;
  const perMonth = tier === "pro" ? WRITING_ALLOWANCE.proPackagesPerMonth : null;

  let answer: unknown;
  try {
    const { data, error } = await db.rpc(TAKE_RPC, {
      p_user_id: userId,
      p_tools: [...tools],
      p_per_day: perDay,
      p_per_month: perMonth,
      p_tier: tier,
    });
    if (error) return { refused: unavailable(cors) };
    answer = data;
  } catch {
    return { refused: unavailable(cors) };
  }
  const a = (answer && typeof answer === "object" ? answer : null) as
    | { allowed?: unknown; reason?: unknown; tool?: unknown; limit?: unknown; resets_at?: unknown; use_ids?: unknown }
    | null;
  if (!a || typeof a.allowed !== "boolean") return { refused: unavailable(cors) };
  if (!a.allowed) {
    const reason = a.reason === "monthly_limit" ? "monthly_limit" : "daily_limit";
    const tool = (tools.includes(a.tool as WritingTool) ? a.tool : tools[0]) as WritingTool;
    const limit = typeof a.limit === "number" ? a.limit : reason === "daily_limit" ? perDay : (perMonth ?? perDay);
    return { refused: allowanceSpent(reason, tool, tier, limit, String(a.resets_at ?? ""), cors) };
  }
  const useIds = Array.isArray(a.use_ids) ? a.use_ids.filter((x): x is string => typeof x === "string") : [];
  return { pass: { kind: "account", userId, tier, useIds } };
}

/** Give the uses back after a call that did not deliver. Never throws. */
export async function refundWriting(db: WritingDb | null | undefined, pass: WritingPass | null | undefined): Promise<void> {
  if (!db || !pass || pass.kind !== "account" || pass.useIds.length === 0) return;
  try {
    await db.rpc(REFUND_RPC, { p_user_id: pass.userId, p_use_ids: pass.useIds });
  } catch {
    // A use not given back costs the person one tool for a day; it never opens a hole.
  }
}

/** The model chain this call is written on: free accounts on Flash, everyone else on the quality chain. */
export function writingChain(pass: WritingPass): string[] {
  return [...(pass.kind === "account" && pass.tier === "free" ? FLASH_CHAIN : QUALITY_CHAIN)];
}
