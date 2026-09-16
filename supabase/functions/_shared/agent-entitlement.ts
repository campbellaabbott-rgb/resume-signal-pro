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
 * So: a pure predicate, importable by both the Deno functions and the Node
 * test suite. The point is that there is nowhere left to write a FIFTH,
 * subtly different check. Its one import is the pass module, for the pass
 * tier's send ceiling — a number this file must read, never spell.
 */
import { PASS_APPLICATIONS, PASS_TIER } from "./pass.ts";

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

/**
 * THE SECOND WAY TO BE ALLOWED, BESIDE — NEVER INSIDE — rowIsEntitled.
 *
 * A six-hour pass lets an agent request applications without a subscription.
 * It is deliberately NOT folded into rowIsEntitled: that predicate has six
 * call sites in five functions, and two of them (agent-runner's nightly pick,
 * send-agent-digest's morning email) are subscription products. Extending the
 * one predicate would have turned a $29 session into a one-night subscription
 * for free. So the pass gets its own predicate, and only the apply path — the
 * places that act on a request the buyer's own agent made — may ask it. A
 * guard pins that the two subscription-only functions never import these.
 *
 * Two different questions, because they are asked at two different moments:
 *   mayApply       "may a NEW request be accepted right now" — the pass must be
 *                  live: activated, not closed, clock still running, and an
 *                  application left to spend.
 *   packetIsFunded "was THIS row paid for" — asked by the preparer and the
 *                  broker hours later. A request accepted at 5:50 and sent at
 *                  hour seven is honoured: the row carries the pass that paid
 *                  for it, and nothing downstream re-checks the clock. Doing
 *                  otherwise is exactly how the day-8 lapse unclaimed paid work.
 */
export type PassRow = {
  activated_at?: string | null;
  expires_at?: string | null;
  closed_at?: string | null;
  applications_total?: number | null;
  applications_used?: number | null;
};

/** Live: activated, not closed, clock still running, at least one application left. */
export function passIsLive(p: PassRow | null | undefined, now: number = Date.now()): boolean {
  if (!p) return false;
  if (!p.activated_at) return false;
  if (p.closed_at) return false;
  if (!p.expires_at) return false;
  const ends = new Date(p.expires_at).getTime();
  // An unparseable clock is not evidence of a running one.
  if (!Number.isFinite(ends) || ends <= now) return false;
  const total = Number(p.applications_total ?? 0);
  const used = Number(p.applications_used ?? 0);
  if (!Number.isFinite(total) || !Number.isFinite(used)) return false;
  return total - used > 0;
}

/** A new request may be accepted: a live subscription OR a live pass. */
export function mayApply(
  sub: SubscriberRow | null | undefined,
  pass: PassRow | null | undefined,
  now: number = Date.now(),
): boolean {
  return rowIsEntitled(sub, now) || passIsLive(pass, now);
}

/**
 * This queue row or packet was paid for: by a live subscription, or by the
 * pass stamped on it at accept. The pass window is NOT re-checked here — the
 * row IS the receipt.
 */
export function packetIsFunded(
  sub: SubscriberRow | null | undefined,
  packet: { pass_id?: string | null } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (rowIsEntitled(sub, now)) return true;
  const id = packet?.pass_id;
  return typeof id === "string" && id.length > 0;
}

/**
 * HOW MANY APPLICATIONS A DAY THIS TIER MAY SEND.
 *
 * auto_apply_daily_cap is chosen by the candidate, 1–20, with no relationship
 * to what they pay. A seven-day trial could therefore authorise the same twenty
 * unattended applications a day as a paying subscriber — and a trial costs
 * nothing to start, needs no card at checkout past the first step, and can be
 * repeated with another address. "The customer picks their own limit" is not a
 * rate limit, it is a suggestion.
 *
 * A trial is a smaller number on purpose, not a worse product: five real
 * applications a day is a fair demonstration of what the agent does, and the
 * ceiling is the thing that makes abuse of a free week uninteresting.
 *
 * THE CANDIDATE'S CHOICE STILL WINS WHEN IT IS LOWER. This is a ceiling, never
 * a target — someone who set 3 gets 3 on any tier. Raising a person's cap
 * because they upgraded would be a change they did not ask for, applied to
 * something that sends messages in their name.
 */
export const TIER_SEND_CEILING: Readonly<Record<string, number>> = {
  active: 20,
  trialing: 5,
  // The pass: its applications ARE its ceiling, read from the one module
  // that spells them. Without this entry tierCeiling answers 0 for a pass
  // holder and nothing they paid for ever releases.
  [PASS_TIER]: PASS_APPLICATIONS,
};

/** Tiers with no entry send nothing — rowIsEntitled has already refused them. */
export function tierCeiling(status: unknown): number {
  return TIER_SEND_CEILING[String(status ?? "")] ?? 0;
}

/**
 * The cap actually in force: the lower of what the candidate chose and what
 * their tier allows.
 *
 * Returns 0 for an unknown tier rather than falling back to the chosen value —
 * a status this code does not recognise must not be able to authorise sending
 * by being unrecognised.
 */
export function effectiveDailyCap(chosen: unknown, status: unknown): number {
  const n = Number(chosen);
  const want = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return Math.min(want, tierCeiling(status));
}

/**
 * ASK THE SET THE SAME WAY IT WAS BUILT. entitledFromRows normalises every key
 * it stores, so a lookup with a raw address silently misses.
 *
 * Both callers had this bug, and it fails in the direction that looks healthy:
 * an entitled subscriber whose mandate row stores "Name@Gmail.com" is dropped
 * from the run, and the run reports `{"ok":true,"mandates":0}` — indistinguish-
 * able from "nobody has set one up". agent-runner skipped them out of the
 * morning queue; send-agent-digest skipped their email. Nobody gets an error.
 *
 * send-agent-digest is the clearest evidence it was a slip rather than a
 * decision: the suppression check on the SAME LINE lowercases the address while
 * the entitlement check beside it does not.
 *
 * So the comparison stops being something each call site re-derives.
 */
export const isEntitled = (entitled: Set<string>, email: unknown): boolean => {
  const normalized = normalizeEmail(email);
  return normalized !== "" && entitled.has(normalized);
};
