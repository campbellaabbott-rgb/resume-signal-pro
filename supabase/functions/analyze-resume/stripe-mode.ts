// WHICH STRIPE KEY READS A CHECKOUT SESSION (S13-043). The owner's
// test-mode rehearsal of the $5 Full Analysis ends here: Checkout returns to
// /success?session_id=cs_test_..., and a test session exists only on the
// test account, so the live key answered "No such checkout.session" and the
// rehearsal ended in "Invalid Stripe session". A cs_test_ id is read with
// STRIPE_TEST_SECRET_KEY, and only when that is really a test key; every
// other id is read with STRIPE_SECRET_KEY exactly as before, so a live
// session is never judged by the test account. Pure, so vitest reads it too.

export type SessionKey = { key: string | undefined; testMode: boolean };

export function sessionKeyFor(sessionId: unknown, env: (k: string) => string | undefined): SessionKey {
  if (typeof sessionId === "string" && sessionId.startsWith("cs_test_")) {
    const testKey = env("STRIPE_TEST_SECRET_KEY") ?? "";
    return { key: testKey.startsWith("sk_test_") ? testKey : undefined, testMode: true };
  }
  return { key: env("STRIPE_SECRET_KEY"), testMode: false };
}
