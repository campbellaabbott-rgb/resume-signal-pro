// WHICH LIMITS A REFUSAL MAY STATE (S14X-275).
//
// api_key_check answers a denial with the key's per-minute and daily numbers,
// but it reads the day bucket only on the way to deciding "quota_exceeded".
// A per-minute refusal and a revoked key come back with quota_used 0 because
// nothing was read, not because nothing was spent, and the old refusal turned
// that 0 into X-Quota-Remaining equal to the whole daily quota: a client told
// it had 1,000 calls left by the response that refused its call.
//
// So a refusal carries the per-minute pair, which the check always reads, and
// the daily pair only when the daily bucket is the reason. Success responses
// are unchanged: a call that was allowed read both.
//
// Pure, so the Node suite runs it by value.

export type RefusalDecision = {
  deny_reason: string;
  rate_limit: number;
  rate_used: number;
  quota_limit: number;
  quota_used: number;
};

export function refusalHeaders(d: RefusalDecision | null): Record<string, string> {
  if (!d) return {};
  const out: Record<string, string> = {
    "X-RateLimit-Limit": String(d.rate_limit),
    "X-RateLimit-Remaining": String(Math.max(0, d.rate_limit - d.rate_used)),
  };
  if (d.deny_reason === "quota_exceeded") {
    out["X-Quota-Limit"] = String(d.quota_limit);
    out["X-Quota-Remaining"] = String(Math.max(0, d.quota_limit - d.quota_used));
  }
  return out;
}
