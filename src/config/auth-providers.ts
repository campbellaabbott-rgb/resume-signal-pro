/**
 * WHICH SIGN-IN METHODS ARE LIVE (R1, owner decisions 2026-10-12).
 *
 * Each switch gates one control on /auth, and nothing else on the site may
 * name a method whose switch is off (src/test/r1-signin-copy-guard.test.ts).
 *
 * - GOOGLE_SIGN_IN_LIVE: Google is enabled on the auth server, but the button
 *   ships off. A separate small publish turns it on once verify section 96
 *   shows auth-signed-in serving, because a Google sign-in is a mailbox proof
 *   and the account guard must be there to act on it.
 * - APPLE_SIGN_IN_LIVE: off for good (D10: no Apple; D11: no Microsoft).
 * - CODE_SIGN_IN_LIVE: the emailed sign-in code. It becomes the main button
 *   only after the owner's live test and the rate-limit check (D2); until
 *   then the password leads and no code control renders.
 * - RECOVERY_LIVE: "Forgot password?" and /auth?mode=reset. The reset path
 *   needs the account guard serving (the new password is set only after the
 *   guard answered), so it flips in the same follow-up publish as Google.
 *
 * The follow-up publish changes GOOGLE_SIGN_IN_LIVE and RECOVERY_LIVE to true
 * here and nothing else: every string those controls need already ships, in
 * src/i18n/auth/*.json.
 */
export const GOOGLE_SIGN_IN_LIVE: boolean = true;
export const APPLE_SIGN_IN_LIVE: boolean = false;
export const CODE_SIGN_IN_LIVE: boolean = false;
export const RECOVERY_LIVE: boolean = true;

/**
 * The flags as one string the live Auth chunk carries, so verify section 95
 * can read what is live from the bundle itself. Each half is a separate
 * literal: when the build folds the constant, only the live half survives.
 */
export const AUTH_FLAGS_MARK: string = [
  GOOGLE_SIGN_IN_LIVE ? "rb-auth:google=on" : "rb-auth:google=off",
  CODE_SIGN_IN_LIVE ? "rb-auth:code=on" : "rb-auth:code=off",
  RECOVERY_LIVE ? "rb-auth:recovery=on" : "rb-auth:recovery=off",
  APPLE_SIGN_IN_LIVE ? "rb-auth:apple=on" : "rb-auth:apple=off",
].join(" ");

/**
 * Where a person who cannot sign in writes. The same address the footer and
 * the help button show (a test holds them equal): support@ on our own domain
 * may bounce (register CP-017), so it is not used until the owner confirms it.
 */
export const AUTH_SUPPORT_EMAIL = "resumeboostersupp@gmail.com";

/** Seconds before "Resend" is offered for an emailed code. */
export const RESEND_AFTER_SECONDS = 60;

/** How long a sign-in this browser started stays valid for a returning link or provider. */
export const PENDING_SIGN_IN_TTL_MS = 60 * 60 * 1000;

/** The shortest password a new or reset password may be (the auth server's own minimum is the owner's setting). */
export const MIN_PASSWORD_LENGTH = 8;
