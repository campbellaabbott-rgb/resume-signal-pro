/**
 * What check-subscription tells a signed-in account, and which customer
 * "Manage billing" opens (S14: M-S14-002, M-S14-006, C-S14-004). The
 * address's plan is described only when it is the account's own (bound, or
 * unbound on a mailbox the account proved); otherwise the account's own rows
 * are, and an account with none learns only linkPending. Cases:
 * src/test/a-pro-member-who-changes-their-billing-email-in-stripe-keeps-pro-the-portal-and-no-second-plan.test.ts.
 */

import { proRowIsLive, proStandingFrom, type ProRow } from "./pro-standing.ts";
import { isOwingStatus, statusRank } from "./subscription-standing.ts";

export type PlanRow = ProRow & { tier?: string | null; bound?: boolean | null };

/** Whose plan the address's answer rests on: this account's, another's, or nobody's yet. */
export type AddressOwner = "caller" | "other" | "unbound";

/** The buyer the Stripe subscription names wins; otherwise the account the address's row is bound to. */
export function addressOwnerOf(callerId: string, statedBuyer: unknown, rowUserId: unknown): AddressOwner {
  const named = typeof statedBuyer === "string" && statedBuyer ? statedBuyer
    : typeof rowUserId === "string" && rowUserId ? rowUserId : null;
  if (!named) return "unbound";
  return named.toLowerCase() === callerId.toLowerCase() ? "caller" : "other";
}

/** The tier an account's plan rests on: live Pro, live agent, owing Pro, owing agent, else none (a retired agent plan is shown as retired). */
export function planTierOf(rows: ReadonlyArray<PlanRow>, now: number = Date.now()): "pro" | "agent" | null {
  const live = rows.filter((r) => proRowIsLive(r, now));
  if (live.some((r) => r.tier === "pro")) return "pro";
  if (live.some((r) => r.tier === "agent")) return "agent";
  const owing = rows.filter((r) => isOwingStatus(String(r.status ?? "")));
  if (owing.some((r) => r.tier === "pro")) return "pro";
  if (owing.some((r) => r.tier === "agent")) return "agent";
  return null;
}

/** The row an account's plan is described from: live, then owing, then any; Pro first, a paid row before a trial. */
export function planRowOf(rows: ReadonlyArray<PlanRow>, now: number = Date.now()): PlanRow | null {
  const firstOf = (list: ReadonlyArray<PlanRow>) =>
    list.find((r) => r.tier === "pro" && r.status === "active") ?? list.find((r) => r.tier === "pro")
      ?? list.find((r) => r.status === "active") ?? list[0];
  const live = rows.filter((r) => proRowIsLive(r, now));
  if (live.length) return firstOf(live);
  const owing = rows.filter((r) => isOwingStatus(String(r.status ?? "")));
  return owing.length ? firstOf(owing) : firstOf(rows) ?? null;
}

/** live 3, owing 2, any other status 1, nothing 0. */
function rowRank(row: PlanRow | null, now: number): number {
  if (!row) return 0;
  if (proRowIsLive(row, now)) return 3;
  return isOwingStatus(String(row.status ?? "")) ? 2 : row.status ? 1 : 0;
}

function addressRank(address: Record<string, unknown>): number {
  if (address.active === true) return 3;
  const status = typeof address.status === "string" ? address.status : "";
  return isOwingStatus(status) ? 2 : status ? 1 : 0;
}

export interface AccountAnswerInput {
  /** The address's answer: active, status, currentPeriodEnd, cancelAtPeriodEnd, needsPaymentUpdate, cached or stale. */
  address: Record<string, unknown>;
  owner: AddressOwner;
  /** pro_entitlement_rows, plus the plan Stripe just answered when it is the account's. */
  rows: ReadonlyArray<PlanRow>;
  /** pro_entitlement_rows could not be read. */
  rowsUnread?: boolean;
  /** The account's own live Pro plan is set to end (its bound row says so). */
  ownEnds?: boolean;
  now?: number;
}

export interface AccountAnswer {
  body: Record<string, unknown>;
  basis: "address" | "account" | "none";
  /** The account's row the answer describes (basis "account"). */
  plan: PlanRow | null;
}

export function accountAnswer(input: AccountAnswerInput): AccountAnswer {
  const { address, owner, rows } = input;
  const now = input.now ?? Date.now();
  // About the reading (from the cache, or past the live-check allowance), not the plan.
  const meta: Record<string, unknown> = {};
  for (const k of ["cached", "stale"]) if (k in address) meta[k] = address[k];
  const nothing = { status: "inactive", currentPeriodEnd: null, cancelAtPeriodEnd: false, needsPaymentUpdate: false };
  if (input.rowsUnread) {
    // Nothing is said to be unlinked on a read that failed, and only the account's own plan is described.
    return owner === "caller"
      ? { body: { ...address }, basis: "address", plan: null }
      : { body: { active: false, trialing: false, consumablesIncluded: false, planTier: null, ...nothing, ...meta }, basis: "none", plan: null };
  }
  const standing = proStandingFrom(rows, now);
  const head = { active: standing.pro, trialing: standing.trialing, consumablesIncluded: standing.consumables, planTier: planTierOf(rows, now) };
  const own = planRowOf(rows, now);
  const callers = owner === "caller" || (owner === "unbound" && rows.some((r) => r.tier === "pro" && r.bound === false));
  const linkPending = !callers && addressRank(address) >= 2 && !standing.pro;

  if (callers && addressRank(address) >= rowRank(own, now)) {
    // The address's live plan not counted for this account (a cache write that failed): only "one to link" (D8).
    if (address.active === true && !standing.pro) return { body: { ...head, linkPending: true, ...meta }, basis: "address", plan: null };
    return {
      body: { ...address, ...head, ...(standing.pro && standing.status && address.active !== true ? { status: standing.status } : {}) },
      basis: "address",
      plan: null,
    };
  }
  if (own) {
    const status = String(own.status ?? "inactive");
    const end = own.current_period_end as unknown;
    return {
      body: {
        ...head,
        status,
        currentPeriodEnd: end instanceof Date ? end.toISOString() : typeof end === "string" && end ? end : null,
        cancelAtPeriodEnd: proRowIsLive(own, now) && input.ownEnds === true,
        needsPaymentUpdate: isOwingStatus(status),
        ...(linkPending ? { linkPending: true } : {}),
        ...meta,
      },
      basis: "account",
      plan: own,
    };
  }
  return { body: linkPending ? { ...head, linkPending: true, ...meta } : { ...head, ...nothing, ...meta }, basis: "none", plan: null };
}

/**
 * The customer "Manage billing" opens: the address's own live or owing plan,
 * else the account's bound customer (read before the lookup; the binding is
 * the proof), else what the lookup found. A mailbox proof counts only for a
 * customer Stripe lists for that address.
 */
export function portalCustomerOf(
  found: { stripeCustomerId: string | null; status: string; matchedBy?: "address" | "customer" },
  boundCustomer: string | null,
): { customerId: string | null; viaBinding: boolean; mailboxCounts: boolean } {
  const byAddress = found.matchedBy === "address" && !!found.stripeCustomerId && statusRank(found.status) >= 2;
  const customerId = byAddress ? found.stripeCustomerId : boundCustomer ?? found.stripeCustomerId ?? null;
  return {
    customerId,
    viaBinding: !byAddress && !!boundCustomer && customerId === boundCustomer,
    mailboxCounts: !!customerId && found.stripeCustomerId === customerId && found.matchedBy === "address",
  };
}
