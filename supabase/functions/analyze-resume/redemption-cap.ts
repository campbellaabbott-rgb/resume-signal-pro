// A PRO MEMBER OPENS AT MOST TEN INCLUDED ANALYSES A DAY AND SIXTY IN THIRTY
// DAYS, WHENEVER THE GRANTS WERE MINTED (S14X-079, the redemption half).
//
// pro_grants_cap (20261112111000) counts grants at mint, and an unopened grant
// stops counting after an hour, while a grant stays redeemable until its paid
// period ends plus a week. So grants pressed on thirty days and never opened
// could all be opened on one day. This counts the account's redemptions by
// when they happened (consumed_at), the same limits and the same account key
// (user_id, else the address) the trigger uses, before any model run.
import { PRO_GRANTS_PER_DAY, PRO_GRANTS_PER_MONTH } from "../_shared/pro-perks.ts";

const DAY_MS = 86_400_000;

export type RedemptionCap = "daily" | "monthly";

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

/**
 * Which limit this account's redemptions have reached, or null. A count that
 * cannot be read is null: the cap is fair use, and the redemption was never
 * counted here before, so a database hiccup does not refuse a paid member.
 */
export async function redemptionCapReached(
  db: Db,
  grant: { user_id?: string | null; email?: string | null },
  now: number = Date.now(),
): Promise<RedemptionCap | null> {
  const account = typeof grant.user_id === "string" && grant.user_id ? grant.user_id : null;
  const email = typeof grant.email === "string" ? grant.email.trim().toLowerCase() : "";
  if (!account && !email) return null;
  try {
    let q = db.from("pro_grants").select("consumed_at");
    q = account ? q.eq("user_id", account) : q.is("user_id", null).eq("email", email);
    const { data, error } = await q.gt("consumed_at", new Date(now - 30 * DAY_MS).toISOString()).limit(PRO_GRANTS_PER_MONTH + 1);
    if (error || !Array.isArray(data)) return null;
    const dayStart = now - DAY_MS;
    const today = data.filter((r: { consumed_at?: unknown }) => Date.parse(String(r.consumed_at)) > dayStart).length;
    if (today >= PRO_GRANTS_PER_DAY) return "daily";
    if (data.length >= PRO_GRANTS_PER_MONTH) return "monthly";
    return null;
  } catch (_) {
    return null;
  }
}

/** The refusal's words: what the plan includes, that nothing was spent, and when it opens again. */
export function redemptionCapMessage(cap: RedemptionCap): string {
  return cap === "daily"
    ? `Pro includes up to ${PRO_GRANTS_PER_DAY} Full Analyses a day and ${PRO_GRANTS_PER_MONTH} a month, and this account has opened today's ${PRO_GRANTS_PER_DAY}. This one is unspent: open it again tomorrow.`
    : `Pro includes up to ${PRO_GRANTS_PER_DAY} Full Analyses a day and ${PRO_GRANTS_PER_MONTH} a month, and this account has opened ${PRO_GRANTS_PER_MONTH} in the last 30 days. This one is unspent: open it again once the count falls.`;
}
