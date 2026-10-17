/**
 * WHICH SIGN-IN METHODS ARE LIVE (R1, owner decisions 2026-10-12).
 *
 * Each switch gates one control on /auth, and nothing else on the site may
 * name a method whose switch is off (src/test/r1-signin-copy-guard.test.ts).
 *
 * - GOOGLE_SIGN_IN_LIVE: on in R1's first publish. A Google sign-in is a
 *   mailbox proof, so the account guard (auth-signed-in) must serve first:
 *   the deploy order puts migration 20261014110000 and the functions before
 *   the frontend, verify section 96 must PASS before the frontend is
 *   published, and section 95 FAILs a live bundle that shows Google while
 *   auth-signed-in does not serve its R1 build.
 * - APPLE_SIGN_IN_LIVE: off for good (D10: no Apple; D11: no Microsoft).
 * - CODE_SIGN_IN_LIVE: the emailed sign-in code. It becomes the main button
 *   only after the owner's live test and the rate-limit check (D2); until
 *   then the password leads and no code control renders.
 * - RECOVERY_LIVE: "Forgot password?" and /auth?mode=reset, on in the first
 *   publish with Google (register S12-057). With the magic link gone, an
 *   account made by a magic link, or registered by someone else, has no
 *   password its owner knows: recovery and Google are its only ways in. The
 *   new password is set only after the guard answered, under the same deploy
 *   order as Google.
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

/** How long a sign-in this browser started for a TYPED address stays valid for a returning link (a mail may wait). */
export const PENDING_SIGN_IN_TTL_MS = 60 * 60 * 1000;

/**
 * How long a PROVIDER sign-in (Google) this browser started stays valid for
 * its return. A provider marker cannot name the address, so any token pair
 * that arrives under it is adopted with only the "Signed in as" banner to
 * question it; a Google round trip takes seconds, not an hour (lead decision
 * E, third fixer round).
 */
export const PROVIDER_PENDING_TTL_MS = 10 * 60 * 1000;

/** The shortest password a new or reset password may be (the auth server's own minimum is the owner's setting). */
export const MIN_PASSWORD_LENGTH = 8;
