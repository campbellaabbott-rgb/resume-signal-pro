// MAY A NEW SUBSCRIPTION BE BILLED TO THE STRIPE CUSTOMER THIS ADDRESS HAS?
// (S12-099, wave 4 round 2, checkout-catalogue).
//
// create-subscription-checkout billed a new plan to the customer Stripe
// already had for the buyer's address, so the portal could show one place
// for everything it pays for (L6-05). But sign-ups are confirmed
// automatically: anyone can register a former customer's address, buy Pro,
// and have the plan land on THAT customer, whose invoices, card and billing
// address the portal then shows them. A customer is reused only when this
// account provably owns it:
//   - a Pro or agent cache row bound to this account names that customer
//     (the proof create-portal-session already accepts), or
//   - the account has proven this mailbox (account_mailbox_proofs, written by
//     auth-signed-in when a code, link or provider sign-in proves it).
// Otherwise Stripe makes a new customer at checkout. A read that fails proves
// nothing, so it reuses nothing: a new customer is the safe side.
//
// Pure apart from the client it is handed.

import { hasMailboxProof } from "./mailbox-proof.ts";

// deno-lint-ignore no-explicit-any
type TableClient = { from: (table: string) => any };

/** Does a Pro or agent cache row bound to this account name this Stripe customer? */
export async function rowBindsCustomer(db: TableClient, userId: string, customerId: string): Promise<boolean> {
  for (const table of ["pro_subscribers", "agent_subscribers"]) {
    try {
      const { data, error } = await db.from(table).select("user_id")
        .eq("user_id", userId).eq("stripe_customer_id", customerId).limit(1);
      if (!error && Array.isArray(data) && data.length > 0) return true;
    } catch (_) {
      // An unread table proves nothing; the other proofs still apply.
    }
  }
  return false;
}

/** The customer a new subscription may be billed to, or null for "let Stripe make one". */
export async function reusableCustomer(
  db: TableClient,
  buyer: { id: string; email: string },
  candidate: string | null | undefined,
): Promise<string | null> {
  if (!candidate || !buyer.id) return null;
  if (await rowBindsCustomer(db, buyer.id, candidate)) return candidate;
  try {
    if (await hasMailboxProof(db, buyer.id, buyer.email)) return candidate;
  } catch (_) {
    // A failed read proves nothing.
  }
  return null;
}
