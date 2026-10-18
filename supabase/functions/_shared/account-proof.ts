/**
 * MAY THIS ACCOUNT ACT FOR THE ADDRESS IT CARRIES? ONE RULE FOR THE ACCOUNT
 * PAGES (plan CP-047, CP-H; S12-002).
 *
 * _shared/mailbox-proof.ts (R1's) answers for a SESSION: a Google or Apple
 * sign-in that verified the address, or email confirmation once the owner has
 * really switched it on. R1 also records, once per (account, address), that a
 * fresh emailed code, link or provider sign-in proved the address
 * (account_mailbox_proofs, written by auth-signed-in). The account pages read
 * all three: a proof recorded once keeps counting on every later sign-in,
 * including a password one, until the address changes (the row is keyed by
 * the address, so a changed address is unproven again).
 *
 * The SQL reader the plan gates call, account_mailbox_proven
 * (20261011170000), applies the same three proofs; a test runs both on one
 * database.
 *
 * Reads through R1's exports only; never writes. Plain Web APIs, so the Node
 * tests import it directly.
 */
import { hasMailboxProof, provenMailbox, type AuthUserLike, type MailboxEnv } from "./mailbox-proof.ts";

/** The account's address when it is proven by any of the three rules, else null. */
export async function accountProvenEmail(
  user: AuthUserLike | null | undefined,
  jwt: string,
  env: MailboxEnv,
): Promise<string | null> {
  const bySession = await provenMailbox(user, jwt, env);
  if (bySession) return bySession;
  const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
  if (!user?.id || !email.includes("@")) return null;
  return (await hasMailboxProof(env.db ?? null, user.id, email)) ? email : null;
}
