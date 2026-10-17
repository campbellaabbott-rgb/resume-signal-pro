/**
 * WHAT THE ACCOUNT PAGE SAYS WHEN THE ACCOUNT GUARD RAN AS A BACKSTOP (plan
 * CP-H).
 *
 * get-account-data runs R1's account guard when a fresh code, link or
 * provider sign-in left no proof (the site's own call to auth-signed-in never
 * landed). When that run cleared a password set before the address was
 * proven, the person is told exactly as the sign-in tells them
 * (AuthContext.ensureGuard): never after a reset, which sets a new password
 * anyway. When the guard's fallback ended every session, this one included,
 * the page says to sign in again.
 */
import { newestAmr } from "@/lib/auth-fragment";

type Translate = (key: string, fallback: string) => string;

export type GuardNotice = { title: string; description?: string };

/** The notices get-account-data's answer calls for, in order; none for an ordinary read. */
export function accountGuardNotices(
  answer: { passwordCleared?: unknown; signedOut?: unknown } | null | undefined,
  accessToken: string | null | undefined,
  t: Translate,
): GuardNotice[] {
  const out: GuardNotice[] = [];
  if (answer?.passwordCleared === true && newestAmr(accessToken) !== "recovery") {
    out.push({
      title: t("auth.guard.passwordClearedTitle", "Your old password was cleared"),
      description: t("auth.guard.passwordCleared", "We cleared a password set on this address before you proved you own it. Set a new one in your account settings if you want one."),
    });
  }
  if (answer?.signedOut === true) {
    out.push({ title: t("accountPage.signedOutEverywhere", "Every session of this account was ended. Please sign in again.") });
  }
  return out;
}
