// WHICH RÉSUMÉ A CHECKOUT WILL BE DELIVERED FROM, KEPT ON OUR SIDE.
//
// Pure, no imports: create-product-checkout, stripe-webhook and
// verify-product-purchase use it, and the tests execute it.
//
// Until 2026-10-04 create-product-checkout wrote the temporary store's id into
// the Stripe session's metadata, and the two deliverers read it back from
// there. That id is a bearer key: get_temp_resume answers it to anyone holding
// the public key, for the 24 hours the text is kept. So anyone who could read
// the Stripe account's session metadata (a dashboard user, a restricted key, a
// connected app, an export) could read the buyer's whole résumé.
//
// Now the id never leaves us. The minter writes it to checkout_resume_refs,
// keyed by the Stripe session id, a table only service_role can read, and the
// deliverers look it up by the session id Stripe hands them. The row is
// deleted with the temporary résumé it points to (a foreign key, migration
// 20261004150000), so the reference lives exactly as long as the text.

export const CHECKOUT_RESUME_TABLE = "checkout_resume_refs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIPE_SESSION = /^cs_[A-Za-z0-9_]{1,250}$/;

/** The temporary-store id a request body names, or null when it is not one. */
export function tempResumeIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return UUID.test(s) ? s.toLowerCase() : null;
}

/**
 * The one method this module needs from a service-role client: from(table),
 * used for one insert and one select-by-key. Typed loosely so a supabase-js
 * client of any generic shape, and the tests' fake, both fit.
 */
// deno-lint-ignore no-explicit-any
export type RefClient = { from: (table: string) => any };

/**
 * "recorded": the reference is kept. "gone": the temporary résumé it names no
 * longer exists (expired or never stored), which is what the deliverers would
 * have found anyway. "failed": anything else -- the caller must not let a buyer
 * pay for a delivery that cannot find its résumé.
 */
export type RememberOutcome = "recorded" | "gone" | "failed";

/** Writes the reference for one Stripe session. Never throws. */
export async function rememberCheckoutResume(
  db: RefClient,
  stripeSessionId: string,
  resumeSessionId: string,
): Promise<RememberOutcome> {
  if (!STRIPE_SESSION.test(stripeSessionId) || !UUID.test(resumeSessionId)) return "failed";
  try {
    const { error } = await db.from(CHECKOUT_RESUME_TABLE).insert({
      stripe_session_id: stripeSessionId,
      resume_session_id: resumeSessionId,
    });
    if (!error) return "recorded";
    // 23503: the foreign key found no temporary résumé with that id.
    if (error.code === "23503") return "gone";
    // 23505: the same Stripe session recorded twice (an idempotent retry).
    if (error.code === "23505") return "recorded";
    console.error(`[CHECKOUT-RESUME-REF] ${stripeSessionId}: ${error.message}`);
    return "failed";
  } catch (e) {
    console.error(`[CHECKOUT-RESUME-REF] ${stripeSessionId}: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }
}

/**
 * The temporary-store id a paid session is delivered from: the reference kept
 * at checkout, looked up by the Stripe session id. A session minted before
 * this change (or the synthetic one verify-product-purchase builds for a Pro
 * grant, whose id never went to Stripe) still names it in metadata.session_id;
 * that is read only when no reference is kept, and only while the text it
 * points to exists, which is 24 hours at most.
 */
export async function resumeSessionForCheckout(
  db: RefClient,
  stripeSessionId: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): Promise<string | null> {
  if (stripeSessionId && STRIPE_SESSION.test(stripeSessionId)) {
    try {
      const { data, error } = await db
        .from(CHECKOUT_RESUME_TABLE)
        .select("resume_session_id")
        .eq("stripe_session_id", stripeSessionId)
        .maybeSingle();
      if (error) console.error(`[CHECKOUT-RESUME-REF] lookup ${stripeSessionId}: ${error.message}`);
      const kept = tempResumeIdOf(data?.resume_session_id);
      if (kept) return kept;
    } catch (e) {
      console.error(`[CHECKOUT-RESUME-REF] lookup ${stripeSessionId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return tempResumeIdOf(metadata?.session_id);
}
