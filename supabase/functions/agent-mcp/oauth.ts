// OAUTH FOR THE MCP SERVER — the module, not yet wired.
//
// claude.ai, Claude Desktop, Claude mobile, Cowork and ChatGPT hold ONLY an
// OAuth token for a per-user paid credential: none of their connector
// dialogs has a field for a bearer key. This module is everything the server
// needs to accept such a token WITHOUT growing a second identity: a token is
// verified here, its subject is mapped to the account's one live api_keys
// row, and that row is checked and metered by the UNCHANGED api_key_check —
// so an OAuth caller and a pasted key share one row, one quota, one tier.
//
// What lives here, and what deliberately does not:
//   - the RFC 9728 protected-resource-metadata document, served on the path
//     AFTER the function prefix is stripped (project_edge_path_prefix: the
//     production pathname carries the function name; a route compared to the
//     raw pathname passes every local check and never matches in prod);
//   - the 401 + WWW-Authenticate builder, used ONLY for tools/call on a keyed
//     tool with no credential or a credential that fails verification. Never
//     for rate, quota or a revoked key (Claude re-authenticates reactively on
//     a 401, so a 401 for quota is a re-auth loop), never for initialize,
//     tools/list, ping or the unkeyed tools;
//   - verifyOAuthBearer: one function, one place for every check — issuer,
//     audience bound to this server, the client_id that a website session
//     token never carries, a uuid subject, expiry, and the signature (local
//     against the project's JWKS for asymmetric keys, a GoTrue round-trip for
//     the symmetric secret this project still signs with);
//   - subToKeyHash: subject -> the account-linked key row, minting one only
//     when the account has none (api_key_issue_agent revokes every live key
//     the user holds, so minting on every call would log the returning
//     Claude Code buyer out of their config);
//   - the activated_via stamp for the OAuth path.
//
// The dispatcher in index.ts wires these in the integration lane. Until then
// nothing here is reachable, which is the point: the 401 must not ship before
// the authorization server answers its metadata URL.
//
// Import-free on purpose (like _shared/pass.ts), so the Node test suite can
// walk verifyOAuthBearer with hand-built tokens and a stubbed fetch, and Deno
// can import it unchanged. The database client is typed structurally for the
// same reason.

/**
 * The server's own URL, exactly as a user pastes it — no trailing slash. The
 * audience every OAuth token must carry, the `resource` of the metadata
 * document, and the base of the metadata pointer in the 401. Spelled three
 * times across runtimes (here, the access-token hook migration, the page's
 * env-built string) and pinned equal by a guard; change all three or none.
 */
export const MCP_URL = "https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp";

/** The Supabase Auth issuer, derived from the server's origin: one spelling, not two. */
export const AUTH_ISSUER = `${new URL(MCP_URL).origin}/auth/v1`;

/** RFC 9728: appended to the resource URL, because the supabase.co root answers a gateway 401. */
export const PRM_PATH = "/.well-known/oauth-protected-resource";

/**
 * The only scope: `email`. `openid` requires asymmetric signing keys, which
 * this project has not rotated in yet.
 */
export const OAUTH_SCOPE = "email";

/** A pasted key starts with this; anything else in the bearer slot is treated as an OAuth token. */
export const API_KEY_PREFIX = "rb_live_";

const FUNCTION_NAME = "agent-mcp";

export const looksLikeApiKey = (bearer: string): boolean => bearer.startsWith(API_KEY_PREFIX);

// ── 3.1 the protected-resource metadata document ─────────────────────────────

/**
 * The pathname with the edge runtime's prefix removed. Production hands the
 * function `/functions/v1/agent-mcp/...` or `/agent-mcp/...`; local tooling
 * hands it `/...`. Every route decision in this module reads THIS, never the
 * raw pathname.
 */
export function stripFunctionPrefix(pathname: string): string {
  const stripped = pathname
    .replace(/^\/functions\/v1(?=\/|$)/, "")
    .replace(new RegExp(`^/${FUNCTION_NAME}(?=/|$)`), "");
  return stripped === "" ? "/" : stripped;
}

/** True when a GET on this pathname is the metadata document, on any prefix the runtime uses. */
export function isProtectedResourceMetadataPath(pathname: string): boolean {
  return stripFunctionPrefix(pathname).replace(/\/+$/, "") === PRM_PATH;
}

/**
 * RFC 9728. `resource` is the URL exactly as pasted; ONE authorization
 * server, because Claude reads the first and does not fall back.
 */
export function protectedResourceMetadata(): {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
  resource_documentation: string;
} {
  return {
    resource: MCP_URL,
    authorization_servers: [AUTH_ISSUER],
    bearer_methods_supported: ["header"],
    scopes_supported: [OAUTH_SCOPE],
    resource_documentation: "https://resumebooster.work/agents",
  };
}

export function protectedResourceResponse(cors: Record<string, string>): Response {
  return new Response(JSON.stringify(protectedResourceMetadata()), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...cors },
  });
}

// ── 3.2 the 401 ──────────────────────────────────────────────────────────────

const UNAUTHORIZED_DESCRIPTION = "Sign in to use this tool";

/** The metadata pointer the 401 must carry: the root fallback can never work behind this gateway. */
export const RESOURCE_METADATA_URL = `${MCP_URL}${PRM_PATH}`;

/**
 * Exactly the response a spec client parses into a sign-in: 401, a Bearer
 * challenge naming where the metadata is and which scope to ask for, the
 * same CORS headers every other answer carries, and a JSON body a client
 * that ignores the header can still read. The caller decides WHEN — this
 * builder never learns the tool name or the deny reason, so it cannot be
 * reached for a rate or quota refusal by accident: those paths never call it.
 */
export function unauthorized(cors: Record<string, string>): Response {
  const challenge =
    `Bearer error="invalid_token", error_description="${UNAUTHORIZED_DESCRIPTION}", ` +
    `resource_metadata="${RESOURCE_METADATA_URL}", scope="${OAUTH_SCOPE}"`;
  return new Response(JSON.stringify({ error: "invalid_token", error_description: UNAUTHORIZED_DESCRIPTION }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": challenge, ...cors },
  });
}

// ── 3.3 verifyOAuthBearer ────────────────────────────────────────────────────

export type OAuthClaims = {
  iss?: unknown; aud?: unknown; sub?: unknown; exp?: unknown; nbf?: unknown;
  client_id?: unknown; email?: unknown; role?: unknown; [k: string]: unknown;
};

export type OAuthVerdict =
  | { ok: true; sub: string; clientId: string; claims: OAuthClaims }
  | { ok: false; reason: OAuthRefusal };

/**
 * Why a token was refused. Logged server-side only; the client always sees
 * the same generic 401, so a probe learns nothing from the reason.
 */
export type OAuthRefusal =
  | "malformed" | "alg" | "iss" | "aud" | "client_id" | "sub" | "exp" | "nbf"
  | "kid" | "jwks" | "signature" | "gotrue";

type Jwk = { kid?: string; kty?: string; alg?: string; use?: string; crv?: string; x?: string; y?: string; n?: string; e?: string };

export type VerifyOptions = {
  /** Injected for the harness; defaults to the isolate's fetch. */
  fetch?: typeof fetch;
  /** Milliseconds since the epoch; defaults to the clock. */
  now?: number;
  /** The anon key GoTrue's gateway wants beside a symmetric token; read from the environment by default. */
  anonKey?: string;
  /** Override for tests; production derives both from MCP_URL. */
  issuer?: string;
  audience?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ASYMMETRIC: Record<string, { importAlgo: EcKeyImportParams | RsaHashedImportParams; verifyAlgo: EcdsaParams | AlgorithmIdentifier }> = {
  ES256: { importAlgo: { name: "ECDSA", namedCurve: "P-256" }, verifyAlgo: { name: "ECDSA", hash: "SHA-256" } },
  RS256: { importAlgo: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verifyAlgo: { name: "RSASSA-PKCS1-v1_5" } },
};
const SYMMETRIC = "HS256";

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlToBytes(segment)));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Header and claims of a compact JWS, unverified — the input to every gate below. */
export function decodeJwt(token: string): { header: Record<string, unknown>; claims: OAuthClaims; signed: string; signature: Uint8Array<ArrayBuffer> } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (!header || !claims) return null;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = b64urlToBytes(parts[2]);
  } catch {
    return null;
  }
  return { header, claims: claims as OAuthClaims, signed: `${parts[0]}.${parts[1]}`, signature };
}

/**
 * The claim gates, in one place, before any network. Each is independent:
 * the audience gate and the client_id gate EACH refuse the frontend's own
 * session token (aud "authenticated", no client_id), so neither carries the
 * whole weight.
 */
export function judgeClaims(claims: OAuthClaims, opts: { issuer: string; audience: string; now: number }): OAuthRefusal | null {
  if (claims.iss !== opts.issuer) return "iss";
  const aud = claims.aud;
  const audOk = typeof aud === "string" ? aud === opts.audience : Array.isArray(aud) && aud.includes(opts.audience);
  if (!audOk) return "aud";
  if (typeof claims.client_id !== "string" || claims.client_id.trim() === "") return "client_id";
  if (typeof claims.sub !== "string" || !UUID.test(claims.sub)) return "sub";
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= opts.now) return "exp";
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf * 1000 > opts.now)) return "nbf";
  return null;
}

// JWKS cache, per isolate: one fetch per key set per hour, plus one refetch
// when a token names a kid the cached set lacks (a rotation), throttled so a
// flood of unknown kids cannot turn into a flood of fetches.
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_REFETCH_FLOOR_MS = 20 * 1000;
type JwksEntry = { keys: Jwk[]; fetchedAt: number };
const jwksCache = new Map<string, JwksEntry>();

/** Test seam: forget every cached key set. */
export function resetJwksCache(): void {
  jwksCache.clear();
}

async function loadJwks(url: string, fetchFn: typeof fetch, now: number, force: boolean): Promise<Jwk[] | null> {
  const cached = jwksCache.get(url);
  if (cached) {
    const age = now - cached.fetchedAt;
    const refetch = age >= JWKS_TTL_MS || (force && age >= JWKS_REFETCH_FLOOR_MS);
    if (!refetch) return cached.keys;
  }
  try {
    const res = await fetchFn(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return cached?.keys ?? null;
    const body = await res.json() as { keys?: unknown };
    const keys = Array.isArray(body?.keys) ? body.keys as Jwk[] : [];
    jwksCache.set(url, { keys, fetchedAt: now });
    return keys;
  } catch {
    return cached?.keys ?? null;
  }
}

async function verifyAsymmetric(
  alg: string, kid: string, signed: string, signature: Uint8Array<ArrayBuffer>, jwksUrl: string, fetchFn: typeof fetch, now: number,
): Promise<OAuthRefusal | null> {
  let keys = await loadJwks(jwksUrl, fetchFn, now, false);
  if (keys === null) return "jwks";
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    keys = await loadJwks(jwksUrl, fetchFn, now, true);
    if (keys === null) return "jwks";
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) return "kid";
  if (jwk.alg && jwk.alg !== alg) return "alg";
  const spec = ASYMMETRIC[alg];
  try {
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, spec.importAlgo, false, ["verify"]);
    const ok = await crypto.subtle.verify(spec.verifyAlgo, key, signature, new TextEncoder().encode(signed));
    return ok ? null : "signature";
  } catch {
    return "signature";
  }
}

/**
 * The symmetric case: this project still signs with the legacy shared
 * secret, which an edge isolate does not hold, so the only verifier is
 * GoTrue itself — one round trip per tool call, which at the pass's rate is
 * fine. GoTrue answers the user the token belongs to; the token is proven
 * only if that user IS the subject the claims name. After the owner rotates
 * to asymmetric keys, tokens arrive with a kid and never reach this path.
 *
 * GUESS to probe with the first token minted through consent: GoTrue may
 * refuse a token whose audience the hook rewrote away from "authenticated".
 * If it does, the owner's key rotation is the fix, not a code change here.
 */
async function verifyViaGoTrue(token: string, sub: string, userUrl: string, anonKey: string, fetchFn: typeof fetch): Promise<OAuthRefusal | null> {
  if (!anonKey) return "gotrue";
  try {
    const res = await fetchFn(userUrl, { headers: { Authorization: `Bearer ${token}`, apikey: anonKey, Accept: "application/json" } });
    if (!res.ok) return "signature";
    const body = await res.json() as { id?: unknown };
    return body?.id === sub ? null : "signature";
  } catch {
    return "gotrue";
  }
}

function envAnonKey(): string {
  // Deno only; the Node harness injects its own.
  const d = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  return d?.env.get("SUPABASE_ANON_KEY") ?? "";
}

/**
 * One function, one place for every check. Claim gates first (cheap, no
 * network — a website session token is refused before anything is fetched),
 * then the signature. The verdict is the subject and the client that minted
 * the token, never the token itself: nothing downstream ever sees it.
 */
export async function verifyOAuthBearer(token: string, opts: VerifyOptions = {}): Promise<OAuthVerdict> {
  const now = opts.now ?? Date.now();
  const issuer = opts.issuer ?? AUTH_ISSUER;
  const audience = opts.audience ?? MCP_URL;
  const fetchFn = opts.fetch ?? fetch;

  const jwt = decodeJwt(token);
  if (!jwt) return { ok: false, reason: "malformed" };
  const alg = typeof jwt.header.alg === "string" ? jwt.header.alg : "";
  if (alg !== SYMMETRIC && !ASYMMETRIC[alg]) return { ok: false, reason: "alg" };

  const refused = judgeClaims(jwt.claims, { issuer, audience, now });
  if (refused) return { ok: false, reason: refused };
  const sub = jwt.claims.sub as string;
  const clientId = (jwt.claims.client_id as string).trim();

  if (alg === SYMMETRIC) {
    const bad = await verifyViaGoTrue(token, sub, `${issuer}/user`, opts.anonKey ?? envAnonKey(), fetchFn);
    if (bad) return { ok: false, reason: bad };
  } else {
    const kid = typeof jwt.header.kid === "string" ? jwt.header.kid : "";
    if (!kid) return { ok: false, reason: "kid" };
    const bad = await verifyAsymmetric(alg, kid, jwt.signed, jwt.signature, `${issuer}/.well-known/jwks.json`, fetchFn, now);
    if (bad) return { ok: false, reason: bad };
  }
  return { ok: true, sub, clientId, claims: jwt.claims };
}

// ── 3.4 sub -> the account-linked key ────────────────────────────────────────

/**
 * The slice of a Supabase client this module touches, typed structurally so
 * the file stays import-free. A real SupabaseClient satisfies it.
 */
export type KeyStore = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => any;
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null } | null; error: unknown }>;
    };
  };
};

export type KeyMapping = { keyHash: string; minted: boolean };

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The subject's one live key row, by hash — the identity api_key_check
 * meters. Minted ONLY when the account holds none: the mint RPC revokes every
 * live key the user has, so calling it when a key exists would log a
 * returning Claude Code or Cursor user out of their config. The raw key is
 * discarded the moment its hash is computed; an OAuth caller never needs the
 * plaintext, because the row is the credential. Null means the account could
 * not be given a key (no email on the user, or the mint refused) — the
 * caller answers in band, never with a 401, because the token was valid.
 */
export async function subToKeyHash(client: KeyStore, sub: string): Promise<KeyMapping | null> {
  const { data: existing } = await client.from("api_keys")
    .select("key_hash").eq("user_id", sub).is("revoked_at", null).limit(1).maybeSingle();
  const found = (existing as { key_hash?: unknown } | null)?.key_hash;
  if (typeof found === "string" && found.length > 0) return { keyHash: found, minted: false };

  const { data: userRes } = await client.auth.admin.getUserById(sub);
  const email = userRes?.user?.email;
  if (typeof email !== "string" || email.trim() === "") return null;

  const rawKey = API_KEY_PREFIX + [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const keyHash = await sha256Hex(rawKey);
  const { data: issued, error } = await client.rpc("api_key_issue_agent", {
    p_user_id: sub,
    p_email: email,
    p_key_hash: keyHash,
    p_key_prefix: rawKey.slice(0, 16),
  }).maybeSingle();
  if (error) return null;
  const row = issued as { issued_ok?: boolean } | null;
  if (!row?.issued_ok) return null;
  // Two first calls for one account can both see no key and both mint; the
  // RPC revokes every other live row, so the hash THIS call minted may
  // already be a revoked row's. Re-read the account's live key and answer
  // with whichever mint survived — the lookup is by user_id, never by the
  // hash in hand. The mint's own hash stands in only when the re-read
  // answers nothing (a store that cannot read back its own write).
  const { data: live } = await client.from("api_keys")
    .select("key_hash").eq("user_id", sub).is("revoked_at", null).limit(1).maybeSingle();
  const survivor = (live as { key_hash?: unknown } | null)?.key_hash;
  return { keyHash: typeof survivor === "string" && survivor.length > 0 ? survivor : keyHash, minted: true };
}

// ── 3.4 step 4: how the pass was activated, for the OAuth path ──────────────

/**
 * The `activated_via` value for a token minted by an OAuth client. The stamp
 * itself is written by the dispatcher's one helper (noteActivatedVia in
 * index.ts) for both paths — this module names the value, never writes it.
 */
export const oauthVia = (clientId: string): string => `oauth:${clientId}`;

