/**
 * ONE definition of "is this person entitled to have the agent act for them".
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT TIDINESS. Four functions read
 * agent_subscribers. Two of them — agent-runner and send-agent-digest — checked
 * `status IN (active, trialing)` and the period end. The other two —
 * apply-agent and apply-broker — checked only that A ROW EXISTED:
 *
 *     .from("agent_subscribers").select("email").eq("email", m.email).maybeSingle();
 *     if (!sub) continue;
 *
 * The two that were wrong are exactly the two that PREPARE AND RELEASE
 * APPLICATIONS TO EMPLOYERS. The two that were right only queue rows and send
 * email. The blast radius was inverted relative to the care taken.
 *
 * And a row is not hard to come by. agent-access is unauthenticated, takes an
 * email from the request body, and checkAgentByEmail upserted a row for it
 * whatever the answer was — including `status: "inactive"` for an address with
 * no Stripe presence at all. Verified live on 2026-08-02: an anonymous POST is
 * accepted (HTTP 200, no auth header). So "has a row" was true for anyone who
 * had ever loaded the Account page, and reachable on purpose by anyone else.
 *
 * Nothing had actually been sent, because the worker was offline — which is the
 * only reason this was a bug and not an incident. A gate that is open but
 * unreachable looks exactly like a gate that is closed, right up until the day
 * you connect the thing behind it.
 *
 * So: a pure predicate, no imports, importable by both the Deno functions and
 * the Node test suite. The point is that there is nowhere left to write a
 * FIFTH, subtly different check.
 */

/** Stripe statuses that mean "this subscription is live right now". */
export const ACTIVE_SUBSCRIBER_STATUSES = new Set(["active", "trialing"]);

/** The columns every consumer must select. Selecting less is how this broke. */
export const ENTITLEMENT_COLUMNS = "email, status, current_period_end";

export type SubscriberRow = {
  email?: string | null;
  status?: string | null;
  current_period_end?: string | null;
};

/** Emails are stored normalised by checkAgentByEmail; compare the same way. */
export const normalizeEmail = (email: unknown): string =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

/**
 * NO GRACE PERIOD, deliberately, and this differs from _shared/pro.ts on
 * purpose. pro.ts allows 24 hours past period end because briefly locking a
 * paying subscriber out of a FEATURE is worse than briefly serving a lapsed
 * one — that decision is reversible the moment either party notices.
 *
 * Sending a job application is not reversible. An employer has it. So the agent
 * stops at the period end, and a subscriber whose renewal is mid-flight waits
 * for the next hourly run rather than having applications sent under a
 * subscription that has expired.
 */
export function rowIsEntitled(row: SubscriberRow | null | undefined, now: number = Date.now()): boolean {
  if (!row) return false;
  if (!ACTIVE_SUBSCRIBER_STATUSES.has(String(row.status ?? ""))) return false;
  if (row.current_period_end) {
    const ends = new Date(row.current_period_end).getTime();
    // An unparseable date is not evidence of entitlement.
    if (!Number.isFinite(ends) || ends <= now) return false;
  }
  return true;
}

/** The entitled subset of `emails`, normalised. Unknown addresses are absent. */
export function entitledFromRows(rows: SubscriberRow[] | null | undefined, now: number = Date.now()): Set<string> {
  const out = new Set<string>();
  for (const row of rows ?? []) {
    if (rowIsEntitled(row, now)) {
      const email = normalizeEmail(row.email);
      if (email) out.add(email);
    }
  }
  return out;
}
