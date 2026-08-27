// PAGING A STRIPE LIST, ONCE, SO TWO CALLERS CANNOT DRIFT.
//
// Stripe list endpoints return at most 100 objects and set `has_more`; a caller
// that reads only the first page cannot tell a truncated read from a complete
// one. checkProByEmail and checkAgentByEmail both took `limit: 5` Customers per
// email and never looked at has_more — so a subscriber whose active
// subscription sat on an older Customer object read as "no subscription", and
// that verdict is CACHED. Nothing polls to correct it: pro rows are rewritten
// only by check-subscription or create-portal-session, agent rows only on an
// agent-access call or a Stripe webhook. A wrong "inactive" can therefore
// outlive the request that produced it.
//
// HOW REACHABLE IS IT, HONESTLY: in this app the active subscription is on the
// NEWEST Customer at the moment it is created, and the checkout guards refuse a
// second subscription while one is active. So burying one past the fifth
// Customer takes an unusual sequence, and no affected account has been
// demonstrated. This is a robustness fix, not an incident — but "we cannot
// currently construct the path" is a poor reason to keep a read that cannot
// tell truncation from absence.
//
// limit: 100 means the common case still costs exactly one round trip.
//
// reconcile-stripe already pages correctly; this is that loop, extracted, so
// there is one implementation rather than a third spelling.

/**
 * Walk a Stripe list endpoint to exhaustion.
 *
 * `maxPages` is a runaway guard, not a limit anyone should hit: 20 pages is
 * 2,000 objects for one email address. If it ever trips, the read is still
 * truncated — but bounded work beats an unbounded loop inside a request.
 */
export async function listAll<T extends { id: string }>(
  page: (startingAfter?: string) => Promise<{ data: T[]; has_more: boolean }>,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  let startingAfter: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const res = await page(startingAfter);
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return out;
}
