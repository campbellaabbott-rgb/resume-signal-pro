// THE OWNER'S TEST-MODE REHEARSAL OF THE $5 FULL ANALYSIS (S13-043,
// create-checkout 2026-11-03.1). Nothing minted a test-mode Full Analysis
// session, so the owner could not watch the sale deliver end to end without
// real money. create-checkout now mints one on the Stripe TEST account when,
// and only when, the owner asks: the body's testMode is true AND x-admin-key
// matches ADMIN_API_KEY. A visitor's testMode is ignored, so no visitor is
// ever sent a session that takes no money. The key read lives here, not in
// create-checkout's index.ts: that file is a live-key minter, and the guards
// that list live minters leave out a function naming the test key (the
// test-key sandbox, create-test-checkout).

import { keyMatches } from "../_shared/admin-key.ts";

/** What the owner is told when the rehearsal is asked for and no sk_test_ key is set. */
export const REHEARSAL_UNCONFIGURED = "The rehearsal needs an sk_test_ secret key in STRIPE_TEST_SECRET_KEY.";

/**
 * The key the rehearsal mints with: null when no rehearsal was asked for by
 * the owner (every visitor, and the owner without testMode), "" when the
 * owner asked and no sk_test_ key is set (refused, never minted live), and
 * the sk_test_ key otherwise.
 */
export function rehearsalKeyOf(headers: Headers, body: unknown, env: (k: string) => string | undefined): string | null {
  const asked = (body as { testMode?: unknown } | null | undefined)?.testMode === true
    && keyMatches(headers.get("x-admin-key") ?? "", env("ADMIN_API_KEY") ?? "");
  if (!asked) return null;
  const key = env("STRIPE_TEST_SECRET_KEY") ?? "";
  return key.startsWith("sk_test_") ? key : "";
}
