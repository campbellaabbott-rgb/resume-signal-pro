/**
 * A WEBSITE SESSION, AND NOT A TOKEN MINTED FOR SOMETHING ELSE (R1, 2026-10-14).
 *
 * Several functions act for "the signed-in person" on the word of a bearer
 * token the auth server accepts. Today every token the auth server signs is a
 * website session. Once the OAuth 2.1 server is enabled for the AI connectors
 * (owner decision D12, plan item S9-001), the same server will also sign
 * tokens for a connector, which carry a client_id claim and should never act
 * as the person on the website. A token is a website session here only when:
 *
 *   - it is a signed-in user's token (role "authenticated"), so the
 *     publishable key every visitor holds never costs an auth round trip;
 *   - it carries no client_id claim, whatever its value;
 *   - its audience is exactly "authenticated";
 *   - the auth server, asked with the publishable (anon) key, still answers
 *     with a user for it: a signature, an expiry and a session that still
 *     exists, which a decode here cannot judge.
 *
 * The claims are read before the auth server is asked. That only ever
 * refuses more: a token is accepted when the auth server ALSO accepts it.
 *
 * Plain Web APIs only, apart from the auth client a caller may hand in, so the
 * Node test suite imports this module directly.
 */
import { bearerOf } from "./service-caller.ts";

/** The auth user as the auth server returns it, with the fields the R1 callers read. */
export type WebsiteUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  identities?: Array<{ provider?: string | null; identity_data?: Record<string, unknown> | null }> | null;
  [key: string]: unknown;
};

/** The slice of a supabase-js auth client this module uses (anon key). */
export type WebsiteAuth = {
  getUser: (jwt: string) => Promise<{ data?: { user?: unknown } | null; error?: unknown }>;
};

export type WebsiteSession = { user: WebsiteUser; jwt: string; claims: Record<string, unknown> };

export type WebsiteRefusal = { reason: string; error: string };

/**
 * A JWT's payload, decoded without checking the signature. Call it only to
 * refuse, or beside a check by the auth server. null for anything that is
 * not a three-part token with a JSON object in the middle.
 */
export function jwtClaims(jwt: string | null | undefined): Record<string, unknown> | null {
  try {
    const parts = String(jwt ?? "").split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Why these claims are not a website session's, or null when they could be one. */
export function websiteClaimsRefusal(claims: Record<string, unknown> | null): WebsiteRefusal | null {
  if (!claims) return { reason: "invalid_session", error: "Sign in again." };
  if (claims.role !== "authenticated" || typeof claims.sub !== "string" || !claims.sub) {
    return { reason: "not_signed_in", error: "Sign in first." };
  }
  if (Object.prototype.hasOwnProperty.call(claims, "client_id")) {
    return { reason: "connector_token", error: "A token issued to a connected app cannot act on the website." };
  }
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (audiences.length !== 1 || audiences[0] !== "authenticated") {
    return { reason: "wrong_audience", error: "This token was not issued for the website." };
  }
  return null;
}

function readEnv(name: string): string {
  try {
    const d = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
    return d?.env?.get(name) ?? "";
  } catch {
    return "";
  }
}

/**
 * The auth server's own answer for a token, asked with the publishable key:
 * the same request supabase-js getUser makes (GET /auth/v1/user). Used only
 * when a caller hands in no client.
 */
function anonAuthFromEnv(): WebsiteAuth {
  const url = readEnv("SUPABASE_URL").replace(/\/+$/, "");
  const anonKey = readEnv("SUPABASE_ANON_KEY");
  return {
    getUser: async (jwt: string) => {
      if (!url || !anonKey) return { data: { user: null }, error: { message: "auth server not configured" } };
      const r = await fetch(`${url}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return { data: { user: null }, error: { message: `auth server answered ${r.status}` } };
      return { data: { user: await r.json() }, error: null };
    },
  };
}

/** The website session behind a request's bearer token, or why there is none. Never throws. */
export async function websiteSessionOf(
  headers: Headers,
  auth?: WebsiteAuth,
): Promise<{ ok: true; session: WebsiteSession } | ({ ok: false } & WebsiteRefusal)> {
  const jwt = bearerOf(headers);
  if (!jwt) return { ok: false, reason: "no_session", error: "Sign in first." };
  const claims = jwtClaims(jwt);
  const refusal = websiteClaimsRefusal(claims);
  if (refusal) return { ok: false, ...refusal };
  try {
    const { data, error } = await (auth ?? anonAuthFromEnv()).getUser(jwt);
    const user = data?.user as WebsiteUser | null | undefined;
    if (error || !user || typeof user.id !== "string" || user.id !== claims!.sub) {
      return { ok: false, reason: "invalid_session", error: "Sign in again." };
    }
    return { ok: true, session: { user, jwt, claims: claims! } };
  } catch {
    return { ok: false, reason: "invalid_session", error: "Sign in again." };
  }
}

/**
 * The caller's website session, or a 401 Response that says why not.
 * `opts.auth` is the anon-key auth client to verify with (supabase-js
 * createClient(url, anonKey).auth); without one, the same request is made with
 * fetch. `opts.headers` are added to the refusal (CORS, the build stamp).
 */
export async function requireWebsiteSession(
  req: Request,
  opts: { auth?: WebsiteAuth; headers?: Record<string, string> } = {},
): Promise<WebsiteSession | Response> {
  const r = await websiteSessionOf(req.headers, opts.auth);
  if ("session" in r) return r.session;
  const refusal = r as WebsiteRefusal;
  return new Response(JSON.stringify({ error: refusal.error, reason: refusal.reason }), {
    status: 401,
    headers: { ...(opts.headers ?? {}), "Content-Type": "application/json" },
  });
}
