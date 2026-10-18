/**
 * THE FIRST PROVEN SIGN-IN CLEARS A PASSWORD SET BEFORE IT, AND RECORDS THE
 * PROOF ONLY WHEN THE AUTH LOG VOUCHES FOR IT (R1, plan items CP-006, CP-047,
 * owner decision D15; 2026-10-14).
 *
 * THE TAKEOVER. Sign-ups are confirmed automatically (/auth/v1/settings:
 * mailer_autoconfirm true), so anybody can register victim@example.com with a
 * password. When the real owner later signs in with an emailed code or with
 * Google, they land in that account, and the stranger's password still works.
 *
 * WHAT A CALL DOES, for the caller's own fresh session (auth-signed-in):
 *
 *  1. An address already proven for this account answers proven at once and
 *     changes nothing. That is the whole idempotency rule.
 *  2. Only a session whose NEWEST sign-in method is an emailed code or link
 *     (amr otp, magiclink, recovery) or Google/Apple for the account's own
 *     verified address (amr oauth) is acted on, and only within 15 minutes
 *     of that sign-in. Anything else answers "not proven" and changes nothing.
 *  3. If the auth log VOUCHES for the sign-in (it holds the sign-in's own
 *     entry, under the address the account carries now) and the account has
 *     a password, the password is replaced by a random one AS THIS SESSION
 *     (PUT /auth/v1/user with the caller's own token), which ends every other
 *     session and keeps this one, and other sessions are then signed out once
 *     more by the admin API. Once per session at most (the
 *     account_password_clears claim, taken when a rotation runs), so a
 *     password the person sets after that rotation is never touched by a
 *     later call of the session. (A call that failed before any rotation took
 *     no claim, so a re-ask can still rotate a password set in between: the
 *     site's reset awaits the guard for that reason.)
 *  4. The proof row is written only when, besides that, the token's address
 *     and the email identity match the account's address and the auth log
 *     shows no account change since the sign-in. Otherwise 409, and no proof.
 *
 * WHY THE PASSWORD IS CLEARED EVEN WHEN THE PROOF IS REFUSED FOR AN ACCOUNT
 * CHANGE (a deliberate departure from the plan's order, which refused before
 * rotating). The account-change check reads entries any session of the
 * account can write. Refusing to rotate on them would let the stranger who
 * pre-registered the address keep a script editing the account's metadata
 * every few seconds, so that every sign-in by the real owner is refused and
 * the stranger's password survives. Once the log vouches that the code or
 * link went to the address the account carries, whoever holds the session
 * reads that mailbox, so a password set before it protects nobody but a
 * stranger. What the change check guards is the PROOF, which opens things
 * keyed by the address. A session the log does not vouch for (an
 * address-change confirmation, a log not written to Postgres) clears nothing.
 *
 * WHY THE ADMIN API DOES NOT ROTATE (another departure). GoTrue v2.197.0, the
 * version /auth/v1/health reports, ends EVERY session when an admin sets a
 * password (internal/api/admin.go: user.UpdatePassword(tx, nil), which calls
 * Logout for the user), the caller's own included, so the person who just
 * proved the address would be signed out by the guard. The user's own update
 * (internal/api/user.go) ends every session except the caller's. The admin
 * API is the fallback only when GoTrue REFUSES the session's own update with
 * a rule only an admin can pass (ADMIN_FALLBACK_CODES: reauthentication, a
 * current-password rule, MFA), never on a timeout or a 5xx (review of R1:
 * those answered 200 signedOut, and a timed-out update that had in fact
 * succeeded was rotated twice). The answer then says signedOut, and the site
 * asks the person to sign in again. It runs even when the proof is refused
 * for an account change (S12-086): a stranger who pre-registered the address
 * and enrolled MFA must not keep the password by failing the session's own
 * update. When the proof is not refused it is written BEFORE any rotation,
 * and taken back if the rotation fails, so a rotation never stands without
 * its proof (whose absence made every later call refuse on the rotation's
 * own audit entry).
 *
 * AN ACCOUNT ALREADY PROVEN AT ANOTHER ADDRESS keeps its password (S12-177):
 * it belongs to whoever proved it, and only that owner could have changed
 * its address and set its password.
 *
 * THE AUTH LOG (pinned against supabase/auth v2.197.0,
 * internal/models/audit_log_entry.go and the callers in internal/api):
 *   - a change of address is logged as user_modified: the request
 *     (user.go:294), the confirmation (verify.go:590, written in the same
 *     transaction just BEFORE the session it mints, whose amr is otp), and an
 *     admin edit (admin.go:382, actor the admin, target in traits.user_id).
 *     There is no separate email-change action in this version.
 *   - a password set by the user is user_updated_password (user.go:218).
 *   - a sign-in is login (verify.go:389, external.go:456, token.go), or
 *     user_signedup for a first confirmation (verify.go:340/379), or
 *     identity_linked when Google is linked into an existing account
 *     (external.go:334). Each names the account's address at that moment
 *     in actor_username.
 * Because amr timestamps are whole seconds and the confirmation's entry is
 * written just before its session, the change check starts 60 seconds before
 * the sign-in. And because GoTrue can be configured not to write the log to
 * Postgres at all, the sign-in's own entry is the positive control: no entry,
 * no proof.
 *
 * Plain Web APIs only, apart from the clients it is handed, so the Node test
 * suite runs it against the real migration in pglite.
 */
import { mailboxProofState, type MailboxSwitchDb, sessionAuthMethods, verifiedByProvider } from "./mailbox-proof.ts";
import type { WebsiteSession } from "./website-session.ts";

/** Sign-in methods that act: an emailed code or link, or a provider sign-in. */
export const GUARD_METHODS: ReadonlySet<string> = new Set(["otp", "magiclink", "recovery", "oauth"]);
/**
 * The refusals of the session's own password update that only the admin API
 * can get past: a reauthentication or current-password rule, or an MFA level
 * the stranger who pre-registered the address may have enrolled (S12-086).
 * A timeout, a 5xx or anything else is NOT one of them: the admin API ends
 * every session, the caller's too, so it is used only when GoTrue has said
 * the session itself may not set the password (review of R1).
 */
export const ADMIN_FALLBACK_CODES: ReadonlySet<string> = new Set([
  "reauthentication_needed", "reauthentication_not_valid", "current_password_required", "insufficient_aal",
]);
/** How long after its sign-in a session may still be acted on. */
export const FRESH_SESSION_MS = 15 * 60 * 1000;
/** A sign-in stamped this far in the future is a clock we do not trust. */
export const CLOCK_SKEW_MS = 60 * 1000;
/** The account-change check starts this many seconds before the sign-in (amr is whole seconds). */
export const CHANGE_MARGIN_SECONDS = 60;

type RpcResult = { data: unknown; error: unknown };

/** The service-role client: tables and RPCs, plus the two admin auth calls. */
export type GuardAdmin = MailboxSwitchDb & {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  auth: {
    admin: {
      updateUserById: (id: string, attrs: { password: string }) => Promise<{ error?: unknown }>;
      signOut: (jwt: string, scope?: "global" | "local" | "others") => Promise<{ error?: unknown } | void>;
    };
  };
};

export type RotateResult = { ok: boolean; status: number; code?: string };

export type GuardDeps = {
  admin: GuardAdmin;
  /** Sets the password AS the session (PUT /auth/v1/user): GoTrue ends every other session and keeps this one. */
  rotateAsSession: (jwt: string, password: string) => Promise<RotateResult>;
  now?: () => number;
  newSecret?: () => string;
  /** Never handed an address. */
  log?: (step: string, details?: Record<string, unknown>) => void;
};

export type GuardBody = {
  proven: boolean;
  passwordCleared: boolean;
  reason?: string;
  error?: string;
  /** The fallback ended every session, this one included: sign in again. */
  signedOut?: boolean;
};

export type GuardAnswer = { status: 200 | 409 | 503; body: GuardBody };

const normalize = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A random password nobody is told: 48 random bytes, base64url, plus one
 * character of each class so a password-strength rule set in the auth
 * settings can never refuse it. 68 characters, under bcrypt's 72.
 */
export function newRotationSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + "Aa1!";
}

/** PUT /auth/v1/user with the caller's own token. Never throws. */
export function sessionPasswordRotator(supabaseUrl: string, anonKey: string, fetchImpl: typeof fetch = fetch) {
  const base = String(supabaseUrl ?? "").replace(/\/+$/, "");
  return async (jwt: string, password: string): Promise<RotateResult> => {
    if (!base || !anonKey) return { ok: false, status: 0, code: "not_configured" };
    try {
      const r = await fetchImpl(`${base}/auth/v1/user`, {
        method: "PUT",
        headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) return { ok: true, status: r.status };
      let code: string | undefined;
      try {
        const j = await r.json();
        code = typeof j?.error_code === "string" ? j.error_code : typeof j?.code === "string" ? j.code : undefined;
      } catch { /* a body that is not JSON names no code */ }
      return { ok: false, status: r.status, code };
    } catch {
      return { ok: false, status: 0, code: "network" };
    }
  };
}

/** The session's newest sign-in method and its time in ms, or null when the token names none. */
export function newestSignIn(jwt: string): { method: string; atMs: number | null } | null {
  const all = sessionAuthMethods(jwt);
  if (!all.length) return null;
  let best = all[0];
  for (const m of all) {
    if (m.at != null && (best.at == null || m.at > best.at)) best = m;
  }
  return { method: best.method, atMs: best.at != null ? best.at * 1000 : null };
}

const answer = (status: GuardAnswer["status"], body: GuardBody): GuardAnswer => ({ status, body });
const unavailable = (reason: string, passwordCleared = false): GuardAnswer =>
  answer(503, { proven: false, passwordCleared, reason, error: "We could not finish checking this sign-in. Please try again." });

const REFUSAL_TEXT: Record<string, string> = {
  token_email_mismatch: "This session was issued for a different address than the account now carries.",
  no_email_identity: "This account has no email sign-in to check the address against.",
  identity_mismatch: "The account's email sign-in names a different address than the account carries.",
  audit_unconfirmed: "The sign-in could not be confirmed from the auth log, so the address stays unproven.",
  signed_in_for_another_address: "This sign-in was made for a different address than the account now carries.",
  changed_since_sign_in: "The account changed after this sign-in, so the address stays unproven. Sign in again with a fresh code.",
  no_session: "This token names no session.",
};

const inFlight = new Map<string, Promise<GuardAnswer>>();

/**
 * Run the guard for one website session. Concurrent calls for the same session
 * inside one isolate share one run; across isolates the per-session claim and
 * the proof row's unique key keep the effects single.
 */
export function runMailboxGuard(deps: GuardDeps, session: WebsiteSession): Promise<GuardAnswer> {
  const sid = typeof session.claims.session_id === "string" ? session.claims.session_id : `jwt:${session.jwt}`;
  const running = inFlight.get(sid);
  if (running) return running;
  const p = guardOnce(deps, session).finally(() => inFlight.delete(sid));
  inFlight.set(sid, p);
  return p;
}

async function guardOnce(deps: GuardDeps, session: WebsiteSession): Promise<GuardAnswer> {
  const { admin } = deps;
  const now = (deps.now ?? Date.now)();
  const log = deps.log ?? (() => undefined);
  const { user, jwt, claims } = session;
  const userId = user.id;
  const email = normalize(user.email);
  if (!email.includes("@")) return answer(200, { proven: false, passwordCleared: false, reason: "no_email" });

  // 1. Proven already: nothing to do, whatever this session is.
  const state = await mailboxProofState(admin, userId, email);
  if (state === "present") return answer(200, { proven: true, passwordCleared: false, reason: "already_proven" });
  if (state === "error") return unavailable("unavailable");

  // 2. Only a fresh emailed or provider sign-in is acted on.
  const newest = newestSignIn(jwt);
  if (!newest || !GUARD_METHODS.has(newest.method)) {
    return answer(200, { proven: false, passwordCleared: false, reason: "not_a_mailbox_sign_in" });
  }
  if (newest.atMs == null || now - newest.atMs > FRESH_SESSION_MS || newest.atMs - now > CLOCK_SKEW_MS) {
    return answer(200, { proven: false, passwordCleared: false, reason: "stale_session" });
  }
  if (newest.method === "oauth" && !verifiedByProvider(user, jwt)) {
    return answer(200, { proven: false, passwordCleared: false, reason: "provider_not_verified" });
  }
  const sessionId = typeof claims.session_id === "string" && UUID.test(claims.session_id) ? claims.session_id : null;
  if (!sessionId) return answer(409, { proven: false, passwordCleared: false, reason: "no_session", error: REFUSAL_TEXT.no_session });
  const amrAt = new Date(newest.atMs);

  // Read first, before anything of ours is written to the auth log. The log
  // VOUCHES for this sign-in when it holds the sign-in's own entry and every
  // such entry names the address the account carries now. An address-change
  // confirmation mints a session with amr otp and writes no sign-in entry, so
  // its session is never vouched for: it clears nothing and proves nothing.
  const signIns = await admin.rpc("auth_sign_in_addresses", { p_user_id: userId, p_at: amrAt.toISOString() });
  if (signIns.error || !Array.isArray(signIns.data)) return unavailable("unavailable");
  const addresses = (signIns.data as unknown[]).map(normalize);
  const vouched = addresses.length > 0 && addresses.every((a) => a === email);

  // 4. Does this sign-in prove the address the account carries now?
  let refusal: string | null = null;
  const emailIdentity = (user.identities ?? []).find((i) => i?.provider === "email");
  if (normalize(claims.email) !== email) refusal = "token_email_mismatch";
  else if (newest.method !== "oauth" && !emailIdentity) refusal = "no_email_identity";
  else if (emailIdentity && normalize(emailIdentity.identity_data?.email) !== email) refusal = "identity_mismatch";
  else if (addresses.length === 0) refusal = "audit_unconfirmed";
  else if (!vouched) refusal = "signed_in_for_another_address";
  else {
    const since = new Date(newest.atMs - CHANGE_MARGIN_SECONDS * 1000).toISOString();
    const { data, error } = await admin.rpc("auth_changed_since", { p_user_id: userId, p_since: since });
    if (error || typeof data !== "boolean") return unavailable("unavailable");
    if (data !== false) refusal = "changed_since_sign_in";
  }

  // 3. A password set before the address was proven does not survive a
  // sign-in the log vouches for, whatever else the account did since.
  let passwordCleared = false;
  let signedOut = false;
  let hasPassword = false;
  let proofWritten = false;
  if (vouched) {
    const { data, error } = await admin.rpc("auth_user_has_password", { p_user_id: userId });
    if (error || typeof data !== "boolean") return unavailable("unavailable");
    hasPassword = data;
  }
  if (hasPassword) {
    // AN ACCOUNT ALREADY PROVEN AT ANOTHER ADDRESS (S12-177) belongs to
    // whoever proved it: nobody could pre-register it, its address changed
    // only through its owner, and its password is the owner's. It is not
    // cleared; only this address's proof is recorded below.
    const elsewhere = await provenAtAnotherAddress(admin, userId, email);
    if (elsewhere === "error") return unavailable("unavailable");
    if (elsewhere === "present") hasPassword = false;
  }
  const proofRow = (cleared: boolean) => ({
    user_id: userId, email, method: newest.method, amr_at: amrAt.toISOString(), password_cleared: cleared,
  });
  const undo = async (withProof: boolean) => {
    if (withProof) await admin.from("account_mailbox_proofs").delete().eq("user_id", userId).eq("email", email);
    await admin.from("account_password_clears").delete().eq("session_id", sessionId);
  };
  if (hasPassword) {
    // Another call may have proven the address meanwhile; then nothing is rotated.
    const again = await mailboxProofState(admin, userId, email);
    if (again === "present") return answer(200, { proven: true, passwordCleared: false, reason: "already_proven" });
    if (again === "error") return unavailable("unavailable");
    const claim = await admin.from("account_password_clears").insert({ session_id: sessionId, user_id: userId });
    const claimError = (claim as { error?: { code?: string } | null }).error;
    if (claimError && claimError.code !== "23505") return unavailable("unavailable");
    if (!claimError) {
      // THE PROOF BEFORE THE ROTATION (review of R1). A rotation whose proof
      // then failed left the session's own password change in the auth log,
      // and every later call (and a new code within a minute) read it as an
      // account change and refused: the old password gone and the address
      // never proven. Now a proof that cannot be written stops the call before
      // anything is rotated, and a rotation that fails takes its proof back.
      if (!refusal) {
        const ins = await admin.from("account_mailbox_proofs").insert(proofRow(true));
        const insError = (ins as { error?: { code?: string } | null }).error;
        if (insError && insError.code !== "23505") {
          await undo(false);
          return unavailable("proof_not_recorded");
        }
        proofWritten = true;
      }
      const secret = (deps.newSecret ?? newRotationSecret)();
      const rotated = await deps.rotateAsSession(jwt, secret);
      if (rotated.ok) {
        passwordCleared = true;
        try {
          const out = await admin.auth.admin.signOut(jwt, "others");
          if (out && (out as { error?: unknown }).error) log("other sessions: the admin sign-out was refused; the password update already ended them", { userId });
        } catch {
          log("other sessions: the admin sign-out threw; the password update already ended them", { userId });
        }
      } else if (rotated.code && ADMIN_FALLBACK_CODES.has(rotated.code)) {
        // GoTrue said this session may not set the password. The admin API
        // can, ending every session (this one too: the person signs in again).
        // Also when the proof is refused for an account change (S12-086): the
        // log vouched that this sign-in reached the mailbox, so a stranger's
        // MFA or reauthentication rule must not keep their password alive.
        log("the session's own password update was refused; rotating through the admin API, which ends every session", { userId, status: rotated.status, code: rotated.code });
        const { error } = await admin.auth.admin.updateUserById(userId, { password: secret });
        if (error) {
          await undo(proofWritten);
          return unavailable("rotation_failed");
        }
        passwordCleared = true;
        signedOut = true;
      } else {
        // A timeout, a 5xx, a refusal no admin rule answers: nothing rotated
        // (or a rotation we cannot see), so nothing claimed and nothing proven.
        log("the session's own password update failed; nothing rotated", { userId, status: rotated.status, code: rotated.code ?? null });
        await undo(proofWritten);
        return unavailable("rotation_failed");
      }
    }
  }

  if (refusal) {
    log("proof refused", { userId, reason: refusal, passwordCleared, signedOut });
    return answer(409, {
      proven: false, passwordCleared, reason: refusal, error: REFUSAL_TEXT[refusal] ?? "The address stays unproven.",
      ...(signedOut ? { signedOut: true } : {}),
    });
  }

  if (!proofWritten) {
    const ins = await admin.from("account_mailbox_proofs").insert(proofRow(passwordCleared));
    const insError = (ins as { error?: { code?: string } | null }).error;
    if (insError && insError.code !== "23505") return unavailable("proof_not_recorded", passwordCleared);
  }
  return answer(200, {
    proven: true,
    passwordCleared,
    ...(signedOut ? { signedOut: true, reason: "every_session_ended" } : {}),
  });
}

/** Whether the account holds a proof for any address but this one. */
async function provenAtAnotherAddress(admin: GuardAdmin, userId: string, email: string): Promise<"present" | "absent" | "error"> {
  try {
    const { data, error } = await admin.from("account_mailbox_proofs").select("id").eq("user_id", userId).neq("email", email).limit(1);
    if (error || !Array.isArray(data)) return "error";
    return data.length > 0 ? "present" : "absent";
  } catch {
    return "error";
  }
}
