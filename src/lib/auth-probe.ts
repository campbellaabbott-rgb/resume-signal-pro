/**
 * WHOSE ACCOUNT A LINK SIGNS IN TO, ASKED BEFORE ANY SESSION EXISTS HERE
 * (login-CSRF protection; review of R1, 2026-10-12, decision 3).
 *
 * A link from the mail, a provider's return, or tokens someone pasted into a
 * URL can sign a visitor into the SENDER's account, where whatever the visitor
 * then uploads is the sender's to read. So a link this browser did not start
 * is never adopted first and questioned after: it is resolved here, through a
 * throwaway auth client that keeps nothing (no storage, no refresh timer, no
 * URL reading), and the page asks "Is this you?" with the address the AUTH
 * SERVER names. Only a yes hands the session to the site's own client.
 *
 *   - resolveTokens: a pair of tokens from a URL. The access token's own claims
 *     are never trusted for the address: an expired, forged token naming the
 *     visitor's address would be refreshed with the sender's refresh token. The
 *     auth server answers for the pair (a refresh when the access token has
 *     expired), and its answer's tokens are the ones adopted.
 *   - verifyLink: our own mail's token_hash, spent by the press of Continue
 *     (a mail scanner's GET spends nothing), with the session kept here only.
 *   - revoke: "Not you?" ends that session on the auth server, so the tokens a
 *     stranger sent stop working in this browser; nothing of the visitor's is
 *     touched.
 *
 * Never throws: every failure is { error }.
 */
import { createClient, type EmailOtpType, type Session, type SupabaseClient } from "@supabase/supabase-js";

export type Probed = { session: Session; email: string };
/**
 * `transient`: the auth server could not be reached or did not answer (a
 * network failure, a timeout, a 5xx, a 408/429), so the same credential may
 * well succeed on a second try and must NOT be spent. A definite answer (an
 * expired, used or malformed token: a 4xx with its reason) is not transient.
 */
export type ProbeFailure = { error: string; transient: boolean };
export type ProbeResult = Probed | ProbeFailure;

/** Whether an auth-js error is one the next try may pass (lead decision D, third fixer round). */
export function transientAuthFailure(e: unknown): boolean {
  const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : null;
  if (status !== null) return status === 0 || status >= 500 || status === 408 || status === 429;
  const m = String((e as { message?: unknown })?.message ?? e ?? "");
  return /fetch|network|timeout|timed out|load failed|aborted|ECONN|socket/i.test(m);
}

const failure = (e: unknown, fallback: string): ProbeFailure => ({
  error: (e instanceof Error ? e.message : typeof (e as { message?: unknown })?.message === "string" ? String((e as { message: string }).message) : String(e ?? "")) || fallback,
  transient: transientAuthFailure(e),
});

let seq = 0;

/** A client that keeps nothing: memory storage, no refresh, no URL reading. */
function throwaway(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) throw new Error("auth not configured");
  const mem = new Map<string, string>();
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `rb-auth-probe-${++seq}`,
      storage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => { mem.set(k, v); },
        removeItem: (k: string) => { mem.delete(k); },
      },
    },
  });
}

function probed(session: Session | null | undefined): ProbeResult {
  const email = session?.user?.email;
  if (!session?.access_token || !session.refresh_token || typeof email !== "string" || !email.includes("@")) return { error: "no_session", transient: false };
  return { session, email: email.trim().toLowerCase() };
}

/** The account a pair of URL tokens signs in to, as the auth server says. */
export async function resolveTokens(accessToken: string, refreshToken: string): Promise<ProbeResult> {
  try {
    const { data, error } = await throwaway().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) return failure(error, "refused");
    return probed(data?.session);
  } catch (e) {
    return failure(e, "refused");
  }
}

/**
 * Spend a token_hash link, keeping its session out of the site's client. A
 * transient failure leaves the link unspent (the caller keeps the hash and
 * offers Try again); only a definite refusal spends it.
 */
export async function verifyLink(tokenHash: string, type: EmailOtpType): Promise<ProbeResult | { verified: true; session: null }> {
  try {
    const { data, error } = await throwaway().auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return failure(error, "refused");
    // An address-change link's first half confirms without a session.
    if (!data?.session) return { verified: true, session: null };
    return probed(data.session);
  } catch (e) {
    return failure(e, "refused");
  }
}

/** End a session the visitor said is not theirs. Best effort; never throws. */
export async function revoke(session: Pick<Session, "access_token" | "refresh_token"> | null | undefined): Promise<void> {
  if (!session?.access_token || !session.refresh_token) return;
  try {
    const c = throwaway();
    const { error } = await c.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (!error) await c.auth.signOut({ scope: "local" });
  } catch { /* the tokens are dropped from this browser either way */ }
}
