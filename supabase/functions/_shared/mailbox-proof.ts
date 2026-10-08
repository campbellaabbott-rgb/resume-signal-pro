/**
 * AN ADDRESS ON A SESSION IS NOT PROOF THAT ITS HOLDER READS THAT MAILBOX.
 *
 * The project auto-confirms password sign-ups: /auth/v1/settings answered
 * mailer_autoconfirm = true on 2026-10-04. So anybody can sign up as
 * victim@example.com and hold a perfectly valid session for that address
 * without ever seeing an email. With auto-confirm on, an address CHANGE is
 * applied at once too (the auth server confirms it itself), so even a session
 * that began with an emailed sign-in link proves nothing about the address the
 * account carries now. Anything keyed by an address alone -- purchased scan
 * credits, a Pro subscription -- must not open to a session's address.
 *
 * This module answers one question: may this signed-in session act for the
 * address on its account? It says yes only for:
 *
 *   1. A Google or Apple sign-in, for the address that provider verified.
 *      The session itself must have been made by an OAuth sign-in (its JWT
 *      "amr" names oauth), and the account must carry a google or apple
 *      identity whose provider-verified address IS the account's address.
 *      A password session on the same account does not qualify, and neither
 *      does an account whose address was later changed away from the
 *      provider's.
 *
 *   2. Email confirmation, once the owner has really turned it on. Two
 *      conditions, both required:
 *        - the switch is set: mailbox_proof_settings.confirmation_required_since
 *          holds the moment confirmation was switched on (see
 *          confirmationRequiredSince below), and
 *        - the auth server says so itself: /auth/v1/settings answers
 *          mailer_autoconfirm = false (read here, cached ten minutes; any
 *          failure to read it is "still auto-confirming").
 *      Then the address is proven when the account's email_confirmed_at, or
 *      an emailed sign-in on this session (amr otp, magiclink, recovery,
 *      invite, email_change), is at or after that moment. Accounts that were
 *      auto-confirmed before it stay unproven until they sign in with a link.
 *
 * ONE SWITCH FOR EVERY CALLER (wave 2, 2026-10-08). There used to be two:
 * this module read an EMAIL_CONFIRMED_SINCE secret, while the agent gates
 * (account_mailbox_proven, 20261005130000) read the database row. An owner who
 * set one and not the other turned the proof on for half the platform. The
 * row is now the switch here too. The secret is read ONLY when the row cannot
 * be read at all (no client, an error, no row); a row that answers NULL means
 * "not switched on", whatever the secret says.
 *
 * THE CLOSING STEP IS THE OWNER'S: turn on "Confirm email" in the project's
 * auth settings, then run
 *   UPDATE public.mailbox_proof_settings SET confirmation_required_since = now();
 * Until both happen, a password account spends only purchases it holds or
 * claimed (see _shared/scan-credits.ts), never an address's pool.
 *
 * Plain Web APIs only (atob, fetch), so the Node test suite imports this
 * module directly.
 */

/** Sign-in methods that required reading a message sent to the address. */
export const MAILBOX_AMR_METHODS: ReadonlySet<string> = new Set(["otp", "magiclink", "recovery", "invite", "email_change"]);

/** Providers whose verified-address claim we accept for the same address. */
export const VERIFIED_ADDRESS_PROVIDERS: ReadonlySet<string> = new Set(["google", "apple"]);

export type AuthIdentityLike = {
  provider?: string | null;
  identity_data?: Record<string, unknown> | null;
};

export type AuthUserLike = {
  id?: string | null;
  email?: string | null;
  email_confirmed_at?: string | null;
  identities?: AuthIdentityLike[] | null;
};

const normalize = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

export type AuthMethod = { method: string; at: number | null };

/**
 * The sign-in methods a session's JWT names in its amr claim, with their times
 * (seconds since the epoch) when given. Supabase writes [{method, timestamp}];
 * RFC 8176 writes plain strings; both are read. Call this ONLY on a token the
 * auth server has already accepted (getUser), because the signature is not
 * checked here. Never throws: an unreadable token names no method.
 */
export function sessionAuthMethods(jwt: string): AuthMethod[] {
  try {
    const part = String(jwt ?? "").split(".")[1];
    if (!part) return [];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    const amr = Array.isArray(payload?.amr) ? payload.amr : [];
    const out: AuthMethod[] = [];
    for (const a of amr) {
      if (typeof a === "string") out.push({ method: a, at: null });
      else if (a && typeof a.method === "string") {
        out.push({ method: a.method, at: Number.isFinite(Number(a.timestamp)) ? Number(a.timestamp) : null });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Rule 1: an OAuth session whose provider verified this very address. */
export function verifiedByProvider(user: AuthUserLike | null | undefined, jwt: string): boolean {
  const email = normalize(user?.email);
  if (!user?.id || !email.includes("@")) return false;
  if (!sessionAuthMethods(jwt).some((m) => m.method === "oauth")) return false;
  return (user.identities ?? []).some((i) => {
    if (!VERIFIED_ADDRESS_PROVIDERS.has(String(i?.provider ?? ""))) return false;
    const d = i?.identity_data ?? {};
    const verified = d.email_verified === true || d.email_verified === "true";
    return verified && normalize(d.email) === email;
  });
}

/**
 * Rule 2, given that the auth server has confirmed it no longer auto-confirms:
 * the account's address was confirmed, or this session signed in through a
 * message sent to it, at or after the moment confirmation was switched on.
 */
export function confirmedSinceEnforcement(
  user: AuthUserLike | null | undefined,
  jwt: string,
  confirmedSince: string | null | undefined,
): boolean {
  const email = normalize(user?.email);
  if (!user?.id || !email.includes("@")) return false;
  const since = Date.parse(String(confirmedSince ?? ""));
  if (!Number.isFinite(since)) return false;
  const confirmed = Date.parse(String(user.email_confirmed_at ?? ""));
  if (Number.isFinite(confirmed) && confirmed >= since) return true;
  return sessionAuthMethods(jwt).some((m) => MAILBOX_AMR_METHODS.has(m.method) && m.at != null && m.at * 1000 >= since);
}

/** A service-role client: only .from(t).select(c).eq(k, v).maybeSingle() is used. */
// deno-lint-ignore no-explicit-any
export type MailboxSwitchDb = { from: (table: string) => any };

export type MailboxEnv = {
  /** The client whose mailbox_proof_settings row IS the switch. */
  db?: MailboxSwitchDb | null;
  /**
   * EMAIL_CONFIRMED_SINCE: the documented FALLBACK, read only when the row
   * cannot be read. Never consulted when the row answers, even NULL.
   */
  confirmedSince?: string | null;
  supabaseUrl?: string;
  anonKey?: string;
  fetchImpl?: typeof fetch;
};

/**
 * WHEN SIGN-UP CONFIRMATION WAS SWITCHED ON, from the one row every caller
 * reads (public.mailbox_proof_settings, id = true). A row that answers is the
 * answer, NULL included. Only a read that fails -- no client, an error, the
 * row missing -- falls back to `env.confirmedSince`. Read on every call (one
 * primary-key row), so the owner's UPDATE takes effect on the next request.
 */
export async function confirmationRequiredSince(env: MailboxEnv): Promise<string | null> {
  const fallback = typeof env.confirmedSince === "string" && env.confirmedSince.trim() ? env.confirmedSince.trim() : null;
  if (!env.db) return fallback;
  try {
    const { data, error } = await env.db
      .from("mailbox_proof_settings")
      .select("confirmation_required_since")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return fallback;
    const raw = (data as { confirmation_required_since?: unknown }).confirmation_required_since;
    const iso = raw instanceof Date ? raw.toISOString() : typeof raw === "string" ? raw : "";
    return Number.isFinite(Date.parse(iso)) ? iso : null;
  } catch {
    return fallback;
  }
}

let autoconfirmCache: { off: boolean; at: number } | null = null;
const AUTOCONFIRM_TTL_MS = 10 * 60 * 1000;

/** For tests: forget the cached auth-settings answer. */
export function resetAutoconfirmCache(): void {
  autoconfirmCache = null;
}

/**
 * True only when the auth server itself answers mailer_autoconfirm = false.
 * Any failure (no URL, a non-200, a timeout, a missing field) is false:
 * "still auto-confirming", which proves nothing.
 */
export async function autoconfirmIsOff(env: MailboxEnv): Promise<boolean> {
  if (autoconfirmCache && Date.now() - autoconfirmCache.at < AUTOCONFIRM_TTL_MS) return autoconfirmCache.off;
  let off = false;
  try {
    if (env.supabaseUrl) {
      const f = env.fetchImpl ?? fetch;
      const r = await f(`${env.supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, {
        headers: env.anonKey ? { apikey: env.anonKey } : {},
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        const s = await r.json();
        off = s?.mailer_autoconfirm === false;
      }
    }
  } catch {
    off = false;
  }
  autoconfirmCache = { off, at: Date.now() };
  return off;
}

/**
 * The account's address when this session has proven it reads that mailbox,
 * else null. `user` is what getUser(jwt) returned for this same jwt.
 */
export async function provenMailbox(
  user: AuthUserLike | null | undefined,
  jwt: string,
  env: MailboxEnv = {},
): Promise<string | null> {
  const email = normalize(user?.email);
  if (!user?.id || !email.includes("@")) return null;
  if (verifiedByProvider(user, jwt)) return email;
  const since = await confirmationRequiredSince(env);
  if (confirmedSinceEnforcement(user, jwt, since) && await autoconfirmIsOff(env)) return email;
  return null;
}
