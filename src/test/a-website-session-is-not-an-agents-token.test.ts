// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { createHmac, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  API_KEY_PREFIX, AUTH_ISSUER, MCP_URL, OAUTH_SCOPE, PRM_PATH, RESOURCE_METADATA_URL,
  decodeJwt, isProtectedResourceMetadataPath, judgeClaims, looksLikeApiKey, oauthVia,
  protectedResourceMetadata, protectedResourceResponse, resetJwksCache,
  stripFunctionPrefix, subToKeyHash, unauthorized, verifyOAuthBearer,
  type KeyStore, type OAuthClaims,
} from "../../supabase/functions/agent-mcp/oauth";

/**
 * A WEBSITE SESSION IS NOT AN AGENT'S TOKEN.
 *
 * The OAuth module for the MCP server, walked with hand-built tokens against
 * a stubbed network — before it is wired, so the wiring commit inherits a
 * verifier that has already refused every shape it must refuse:
 *
 *   - the frontend's own session JWT (aud "authenticated", no client_id) is
 *     refused by TWO independent gates, and each is proven to refuse it
 *     alone;
 *   - wrong issuer, wrong audience, expired, not-yet-valid, a non-uuid
 *     subject, an unsigned or foreign-signed token, an unknown key id;
 *   - the JWKS is fetched once per isolate and refetched once on an unknown
 *     kid, never per call, never in a flood;
 *   - the symmetric case (this project still signs HS256) proves the token
 *     through GoTrue's user endpoint — the ONLY place the token is ever sent —
 *     and only when the user GoTrue answers IS the subject the claims name.
 *
 * Plus the two documents the handshake is made of (the RFC 9728 metadata, the
 * 401 challenge) read back as responses, the path match that must see through
 * the runtime's function prefix, and the subject-to-key mapping that mints
 * ONLY when the account holds no live key.
 *
 * Everything here is behaviour: the module is imported and called. No token,
 * no URL and no number is asserted by spelling that the module does not
 * itself export.
 */

const subtle = webcrypto.subtle;
const ROOT = resolve(__dirname, "../..");
const SUB = "0f4a7c2e-9b1d-4e3a-8c6f-2d5b7a9e1c3f";
const CLIENT = "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d";
const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);
const KID = "signing-key-1";
const cors = { "Access-Control-Allow-Origin": "*" };

const b64url = (b: Uint8Array | string): string => Buffer.from(b).toString("base64url");

type KeyPair = { priv: CryptoKey; jwk: JsonWebKey & { kid: string; alg: string; use: string } };
async function es256(kid: string): Promise<KeyPair> {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", pair.publicKey);
  return { priv: pair.privateKey, jwk: { ...jwk, kid, alg: "ES256", use: "sig" } };
}

async function signEs256(claims: Record<string, unknown>, key: CryptoKey, header: Record<string, unknown> = { alg: "ES256", typ: "JWT", kid: KID }): Promise<string> {
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signed));
  return `${signed}.${b64url(new Uint8Array(sig))}`;
}

function signHs256(claims: Record<string, unknown>, secret = "a-secret-the-edge-does-not-hold"): string {
  const signed = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", secret).update(signed).digest("base64url")}`;
}

/** The claims of a token minted for an OAuth client, after the hook bound its audience. */
const oauthClaims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: AUTH_ISSUER, aud: MCP_URL, sub: SUB, exp: NOW / 1000 + 600, iat: NOW / 1000,
  client_id: CLIENT, email: "one@example.com", role: "authenticated", ...over,
});

/** The claims of the frontend's own session token: no client_id, the default audience. */
const sessionClaims = (): Record<string, unknown> => {
  const c = oauthClaims({ aud: "authenticated" });
  delete c.client_id;
  return c;
};

type Route = (init?: RequestInit) => { status: number; body: unknown };
function stubFetch(routes: Record<string, Route>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    const { status, body } = route(init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return Object.assign(fn as unknown as typeof fetch, { calls });
}

const JWKS_URL = `${AUTH_ISSUER}/.well-known/jwks.json`;
const USER_URL = `${AUTH_ISSUER}/user`;

let keys: KeyPair;
beforeEach(async () => {
  resetJwksCache();
  keys = await es256(KID);
});

const jwksRoute = (...jwks: KeyPair["jwk"][]): Route => () => ({ status: 200, body: { keys: jwks } });

describe("the claim gates, each on its own", () => {
  const judge = (claims: Record<string, unknown>) => judgeClaims(claims as OAuthClaims, { issuer: AUTH_ISSUER, audience: MCP_URL, now: NOW });

  it("a token minted for an OAuth client with this server as its audience passes every gate", () => {
    expect(judge(oauthClaims())).toBeNull();
  });

  it("the website's own session token is refused — and by the audience gate first", () => {
    expect(judge(sessionClaims())).toBe("aud");
  });

  it("the audience gate alone refuses a session token that somehow carries a client_id", () => {
    expect(judge(oauthClaims({ aud: "authenticated" }))).toBe("aud");
  });

  it("the client_id gate alone refuses a token with the right audience and no client", () => {
    const c = oauthClaims();
    delete c.client_id;
    expect(judge(c)).toBe("client_id");
    expect(judge(oauthClaims({ client_id: "" }))).toBe("client_id");
    expect(judge(oauthClaims({ client_id: "   " }))).toBe("client_id");
    expect(judge(oauthClaims({ client_id: 42 }))).toBe("client_id");
  });

  it("the audience may be an array, as long as this server is in it", () => {
    expect(judge(oauthClaims({ aud: ["something-else", MCP_URL] }))).toBeNull();
    expect(judge(oauthClaims({ aud: ["something-else"] }))).toBe("aud");
    expect(judge(oauthClaims({ aud: `${MCP_URL}/` }))).toBe("aud");
  });

  it("a foreign issuer is refused before anything else", () => {
    expect(judge(oauthClaims({ iss: "https://other.example/auth/v1" }))).toBe("iss");
    const c = oauthClaims();
    delete c.iss;
    expect(judge(c)).toBe("iss");
  });

  it("the subject must be a uuid — the account it maps to", () => {
    expect(judge(oauthClaims({ sub: "not-a-uuid" }))).toBe("sub");
    expect(judge(oauthClaims({ sub: "" }))).toBe("sub");
    const c = oauthClaims();
    delete c.sub;
    expect(judge(c)).toBe("sub");
  });

  it("an expired token, a token without an expiry, and a token not yet valid are refused", () => {
    expect(judge(oauthClaims({ exp: NOW / 1000 - 1 }))).toBe("exp");
    expect(judge(oauthClaims({ exp: NOW / 1000 }))).toBe("exp");
    expect(judge(oauthClaims({ exp: "soon" }))).toBe("exp");
    const c = oauthClaims();
    delete c.exp;
    expect(judge(c)).toBe("exp");
    expect(judge(oauthClaims({ nbf: NOW / 1000 + 5 }))).toBe("nbf");
    expect(judge(oauthClaims({ nbf: NOW / 1000 - 5 }))).toBeNull();
  });
});

describe("verifyOAuthBearer over the wire, asymmetric keys", () => {
  it("a good token verifies against the fetched key set and yields the subject and the client", async () => {
    const fetch = stubFetch({ [JWKS_URL]: jwksRoute(keys.jwk) });
    const token = await signEs256(oauthClaims(), keys.priv);
    const v = await verifyOAuthBearer(token, { fetch, now: NOW });
    expect(v).toMatchObject({ ok: true, sub: SUB, clientId: CLIENT });
    expect(fetch.calls.map((c) => c.url)).toEqual([JWKS_URL]);
  });

  it("the token itself is never sent anywhere on the asymmetric path", async () => {
    const fetch = stubFetch({ [JWKS_URL]: jwksRoute(keys.jwk) });
    const token = await signEs256(oauthClaims(), keys.priv);
    await verifyOAuthBearer(token, { fetch, now: NOW });
    for (const c of fetch.calls) {
      const headers = (c.init?.headers ?? {}) as Record<string, string>;
      expect(Object.values(headers).join(" ")).not.toContain(token);
      expect(c.url).not.toContain(token);
    }
  });

  it("the website session token is refused without a single network call", async () => {
    const fetch = stubFetch({ [JWKS_URL]: jwksRoute(keys.jwk) });
    const token = await signEs256(sessionClaims(), keys.priv);
    const v = await verifyOAuthBearer(token, { fetch, now: NOW });
    expect(v).toEqual({ ok: false, reason: "aud" });
    expect(fetch.calls).toHaveLength(0);
  });

  it.each([
    ["wrong issuer", { iss: "https://other.example/auth/v1" }, "iss"],
    ["wrong audience", { aud: "https://other.example/functions/v1/agent-mcp" }, "aud"],
    ["expired", { exp: NOW / 1000 - 60 }, "exp"],
    ["not a uuid subject", { sub: "admin" }, "sub"],
  ])("%s is refused before the key set is fetched", async (_label, over, reason) => {
    const fetch = stubFetch({ [JWKS_URL]: jwksRoute(keys.jwk) });
    const token = await signEs256(oauthClaims(over as Record<string, unknown>), keys.priv);
    expect(await verifyOAuthBearer(token, { fetch, now: NOW })).toEqual({ ok: false, reason });
    expect(fetch.calls).toHaveLength(0);
  });

  it("no client_id is refused before the key set is fetched", async () => {
    const fetch = stubFetch({ [JWKS_URL]: jwksRoute(keys.jwk) });
    const c = oauthClaims();
    delete c.client_id;
    const token = await signEs256(c, keys.priv);
    expect(await verifyOAuthBearer(token, { fetch, now: NOW })).toEqual({ ok: false, reason: "client_id" });
    expect(fetch.calls).toHaveLength(0);
  });

  it("a token signed by a foreign key under the same kid is refused as a bad signature", async () => {
    const forger = await es256(KID);
    const fetch = stubFetch({ [JWKS_URL]: jwksRoute(keys.jwk) });
    const token = await signEs256(oauthClaims(), forger.priv);
    expect(await verifyOAuthBearer(token, { fetch, now: NOW })).toEqual({ ok: false, reason: "signature" });
  });

  it("a tampered payload under a genuine signature is refused", async () => {
    const fetch = stubFetch({ [JWKS_URL]: jwksRoute(keys.jwk) });
    const token = await signEs256(oauthClaims(), keys.priv);
    const [h, , s] = token.split(".");
    const tampered = `${h}.${b64url(JSON.stringify(oauthClaims({ sub: "11111111-1111-4111-8111-111111111111" })))}.${s}`;
    expect(await verifyOAuthBearer(tampered, { fetch, now: NOW })).toEqual({ ok: false, reason: "signature" });
  });

  it("alg none, an unknown alg, a missing kid and a malformed token are refused", async () => {
    const fetch = stubFetch({ [JWKS_URL]: jwksRoute(keys.jwk) });
    const unsigned = `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(oauthClaims()))}.AA`;
    expect(await verifyOAuthBearer(unsigned, { fetch, now: NOW })).toEqual({ ok: false, reason: "alg" });
    const odd = await signEs256(oauthClaims(), keys.priv, { alg: "ES384", kid: KID });
    expect(await verifyOAuthBearer(odd, { fetch, now: NOW })).toEqual({ ok: false, reason: "alg" });
    const noKid = await signEs256(oauthClaims(), keys.priv, { alg: "ES256" });
    expect(await verifyOAuthBearer(noKid, { fetch, now: NOW })).toEqual({ ok: false, reason: "kid" });
    for (const junk of ["", "abc", "a.b", "a.b.c.d", `${API_KEY_PREFIX}deadbeef`, "..", "e30.e30."]) {
      expect(await verifyOAuthBearer(junk, { fetch, now: NOW })).toEqual({ ok: false, reason: "malformed" });
    }
    expect(fetch.calls).toHaveLength(0);
  });

  it("the key set is fetched once per isolate, not once per call", async () => {
    const fetch = stubFetch({ [JWKS_URL]: jwksRoute(keys.jwk) });
    for (let i = 0; i < 5; i++) {
      const token = await signEs256(oauthClaims({ iat: NOW / 1000 + i }), keys.priv);
      expect((await verifyOAuthBearer(token, { fetch, now: NOW + i * 1000 })).ok).toBe(true);
    }
    expect(fetch.calls).toHaveLength(1);
  });

  it("an unknown kid refetches the key set exactly once, and a second unknown kid inside the floor does not", async () => {
    const rotated = await es256("signing-key-2");
    let served = [keys.jwk];
    const fetch = stubFetch({ [JWKS_URL]: () => ({ status: 200, body: { keys: served } }) });
    const first = await signEs256(oauthClaims(), keys.priv);
    expect((await verifyOAuthBearer(first, { fetch, now: NOW })).ok).toBe(true);
    // The provider rotates: a token under the new kid arrives while the cache
    // still holds the old set. One refetch finds it.
    served = [keys.jwk, rotated.jwk];
    const next = await signEs256(oauthClaims(), rotated.priv, { alg: "ES256", kid: "signing-key-2" });
    expect((await verifyOAuthBearer(next, { fetch, now: NOW + 40_000 })).ok).toBe(true);
    expect(fetch.calls).toHaveLength(2);
    // A flood of made-up kids inside the refetch floor costs no fetch at all.
    const junkKid = await signEs256(oauthClaims(), keys.priv, { alg: "ES256", kid: "made-up" });
    expect(await verifyOAuthBearer(junkKid, { fetch, now: NOW + 41_000 })).toEqual({ ok: false, reason: "kid" });
    expect(await verifyOAuthBearer(junkKid, { fetch, now: NOW + 42_000 })).toEqual({ ok: false, reason: "kid" });
    expect(fetch.calls).toHaveLength(2);
  });

  it("an unreachable or broken key set refuses rather than accepting", async () => {
    const fetch = stubFetch({ [JWKS_URL]: () => ({ status: 503, body: {} }) });
    const token = await signEs256(oauthClaims(), keys.priv);
    expect(await verifyOAuthBearer(token, { fetch, now: NOW })).toEqual({ ok: false, reason: "jwks" });
    const empty = stubFetch({ [JWKS_URL]: () => ({ status: 200, body: { keys: [] } }) });
    expect(await verifyOAuthBearer(token, { fetch: empty, now: NOW })).toEqual({ ok: false, reason: "kid" });
  });
});

describe("verifyOAuthBearer over the wire, the symmetric secret this project still signs with", () => {
  const anonKey = "anon-key-for-the-gateway";

  it("proves the token through GoTrue's user endpoint, and only when that user IS the subject", async () => {
    const fetch = stubFetch({ [USER_URL]: () => ({ status: 200, body: { id: SUB, email: "one@example.com" } }) });
    const token = signHs256(oauthClaims());
    const v = await verifyOAuthBearer(token, { fetch, now: NOW, anonKey });
    expect(v).toMatchObject({ ok: true, sub: SUB, clientId: CLIENT });
    expect(fetch.calls).toHaveLength(1);
    const headers = fetch.calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(headers.apikey).toBe(anonKey);
  });

  it("the user endpoint is the ONLY place the token goes — never the key set, never anywhere downstream", async () => {
    const fetch = stubFetch({ [USER_URL]: () => ({ status: 200, body: { id: SUB } }), [JWKS_URL]: jwksRoute(keys.jwk) });
    await verifyOAuthBearer(signHs256(oauthClaims()), { fetch, now: NOW, anonKey });
    expect(fetch.calls.map((c) => c.url)).toEqual([USER_URL]);
  });

  it("GoTrue refusing the token refuses it here", async () => {
    const fetch = stubFetch({ [USER_URL]: () => ({ status: 401, body: { msg: "invalid JWT" } }) });
    expect(await verifyOAuthBearer(signHs256(oauthClaims()), { fetch, now: NOW, anonKey })).toEqual({ ok: false, reason: "signature" });
  });

  it("GoTrue answering a DIFFERENT user than the claims name is a forgery, not a pass", async () => {
    const fetch = stubFetch({ [USER_URL]: () => ({ status: 200, body: { id: "11111111-1111-4111-8111-111111111111" } }) });
    expect(await verifyOAuthBearer(signHs256(oauthClaims()), { fetch, now: NOW, anonKey })).toEqual({ ok: false, reason: "signature" });
  });

  it("with no anon key in hand the symmetric path refuses rather than skipping the signature", async () => {
    const fetch = stubFetch({ [USER_URL]: () => ({ status: 200, body: { id: SUB } }) });
    expect(await verifyOAuthBearer(signHs256(oauthClaims()), { fetch, now: NOW, anonKey: "" })).toEqual({ ok: false, reason: "gotrue" });
    expect(fetch.calls).toHaveLength(0);
  });

  it("the claim gates run before the round trip: a symmetric session token costs no network", async () => {
    const fetch = stubFetch({ [USER_URL]: () => ({ status: 200, body: { id: SUB } }) });
    expect(await verifyOAuthBearer(signHs256(sessionClaims()), { fetch, now: NOW, anonKey })).toEqual({ ok: false, reason: "aud" });
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("the two documents of the handshake", () => {
  it("the metadata names this server as the resource, exactly as pasted, and ONE authorization server", () => {
    const m = protectedResourceMetadata();
    expect(m.resource).toBe(MCP_URL);
    expect(m.resource.endsWith("/")).toBe(false);
    expect(m.authorization_servers).toEqual([AUTH_ISSUER]);
    expect(new URL(AUTH_ISSUER).origin).toBe(new URL(MCP_URL).origin);
    expect(m.bearer_methods_supported).toEqual(["header"]);
    expect(m.scopes_supported).toEqual([OAUTH_SCOPE]);
    expect(OAUTH_SCOPE).toBe("email");
  });

  it("the metadata response is JSON with the CORS headers every other answer carries", async () => {
    const res = protectedResourceResponse(cors);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual(protectedResourceMetadata());
  });

  it("the 401 is a Bearer challenge that points at the metadata document and names the scope", async () => {
    const res = unauthorized(cors);
    expect(res.status).toBe(401);
    const www = res.headers.get("WWW-Authenticate") ?? "";
    expect(www.startsWith("Bearer ")).toBe(true);
    const params = Object.fromEntries([...www.slice(7).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    expect(params.error).toBe("invalid_token");
    expect(params.resource_metadata).toBe(RESOURCE_METADATA_URL);
    expect(params.resource_metadata).toBe(`${MCP_URL}${PRM_PATH}`);
    expect(params.scope).toBe(OAUTH_SCOPE);
    expect(params.error_description).toBeTruthy();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.json() as { error: string; error_description: string };
    expect(body.error).toBe("invalid_token");
    expect(body.error_description).toBe(params.error_description);
  });

  it("the challenge carries no token, no key and no query string", () => {
    const www = unauthorized(cors).headers.get("WWW-Authenticate") ?? "";
    expect(www).not.toMatch(/\?/);
    expect(www).not.toContain(API_KEY_PREFIX);
  });
});

describe("the metadata path is matched on the STRIPPED pathname", () => {
  it("sees through both production prefixes and the bare local path", () => {
    for (const p of [`/functions/v1/agent-mcp${PRM_PATH}`, `/agent-mcp${PRM_PATH}`, PRM_PATH, `/agent-mcp${PRM_PATH}/`]) {
      expect(isProtectedResourceMetadataPath(p), p).toBe(true);
    }
  });

  it("matches nothing else", () => {
    for (const p of ["/agent-mcp", "/functions/v1/agent-mcp", "/", "/agent-mcp/.well-known/other", "/agent-mcpx" + PRM_PATH, "/.well-known/oauth-authorization-server", `/other${PRM_PATH}`]) {
      expect(isProtectedResourceMetadataPath(p), p).toBe(false);
    }
  });

  it("stripping leaves the route, never an empty string", () => {
    expect(stripFunctionPrefix("/functions/v1/agent-mcp")).toBe("/");
    expect(stripFunctionPrefix("/agent-mcp")).toBe("/");
    expect(stripFunctionPrefix("/agent-mcp/x")).toBe("/x");
    expect(stripFunctionPrefix("/functions/v1/agent-mcp/x")).toBe("/x");
    expect(stripFunctionPrefix("/agent-mcpx/x")).toBe("/agent-mcpx/x");
  });
});

describe("subject to the account-linked key", () => {
  type Calls = { selects: unknown[][]; updates: unknown[][]; rpcs: { fn: string; args: Record<string, unknown> }[]; lookups: string[] };
  function fakeStore(opts: { existingHash?: string | null; email?: string | null; issued?: { issued_ok: boolean } | null; rpcError?: unknown }) {
    const calls: Calls = { selects: [], updates: [], rpcs: [], lookups: [] };
    const chain = (result: unknown) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "limit", "update"]) {
        c[m] = (...a: unknown[]) => { (m === "update" ? calls.updates : calls.selects).push([m, ...a]); return c; };
      }
      c.maybeSingle = async () => ({ data: result, error: null });
      c.then = (res: (v: unknown) => void) => res({ data: null, error: null });
      return c;
    };
    const store: KeyStore = {
      from: (table: string) => chain(table === "api_keys" && opts.existingHash ? { key_hash: opts.existingHash } : null),
      rpc: (fn, args) => { calls.rpcs.push({ fn, args }); return { maybeSingle: async () => ({ data: opts.issued ?? null, error: opts.rpcError ?? null }) }; },
      auth: { admin: { getUserById: async (id) => { calls.lookups.push(id); return { data: { user: opts.email === undefined ? { email: "one@example.com" } : { email: opts.email } }, error: null }; } } },
    };
    return { store, calls };
  }

  it("a live key is reused — nothing minted, no user lookup, the row is the identity", async () => {
    const { store, calls } = fakeStore({ existingHash: "f".repeat(64) });
    expect(await subToKeyHash(store, SUB)).toEqual({ keyHash: "f".repeat(64), minted: false });
    expect(calls.rpcs).toHaveLength(0);
    expect(calls.lookups).toHaveLength(0);
    // Filtered to THIS user's live key, never a scan.
    expect(calls.selects).toContainEqual(["eq", "user_id", SUB]);
    expect(calls.selects).toContainEqual(["is", "revoked_at", null]);
  });

  it("no live key: one is minted through the atomic RPC, its plaintext discarded, its hash returned", async () => {
    const { store, calls } = fakeStore({ existingHash: null, issued: { issued_ok: true } });
    const out = await subToKeyHash(store, SUB);
    expect(out?.minted).toBe(true);
    expect(calls.lookups).toEqual([SUB]);
    expect(calls.rpcs).toHaveLength(1);
    const { fn, args } = calls.rpcs[0];
    expect(fn).toBe("api_key_issue_agent");
    expect(args.p_user_id).toBe(SUB);
    expect(args.p_email).toBe("one@example.com");
    expect(args.p_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(out?.keyHash).toBe(args.p_key_hash);
    expect(String(args.p_key_prefix)).toHaveLength(16);
    expect(String(args.p_key_prefix).startsWith(API_KEY_PREFIX)).toBe(true);
    // The raw key never leaves: nothing returned or passed carries a full key.
    expect(JSON.stringify(out)).not.toMatch(new RegExp(`${API_KEY_PREFIX}[0-9a-f]{64}`));
    expect(JSON.stringify(args)).not.toMatch(new RegExp(`${API_KEY_PREFIX}[0-9a-f]{64}`));
  });

  it("after a mint the LIVE row is re-read, so a concurrent mint's survivor is answered rather than a just-revoked hash", async () => {
    // A store whose api_keys answers nothing before the mint and the OTHER
    // call's hash after it — the row api_key_issue_agent left live.
    const survivor = "e".repeat(64);
    let reads = 0;
    const calls: { rpcs: number } = { rpcs: 0 };
    const chain = (result: unknown) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "limit", "update"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: result, error: null });
      return c;
    };
    const store: KeyStore = {
      from: (table: string) => {
        if (table !== "api_keys") return chain(null);
        reads++;
        return chain(reads === 1 ? null : { key_hash: survivor });
      },
      rpc: () => { calls.rpcs++; return { maybeSingle: async () => ({ data: { issued_ok: true }, error: null }) }; },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: "one@example.com" } }, error: null }) } },
    };
    const out = await subToKeyHash(store, SUB);
    expect(calls.rpcs).toBe(1);
    expect(reads).toBe(2);
    expect(out).toEqual({ keyHash: survivor, minted: true });
  });

  it("two mints never share a hash", async () => {
    const a = fakeStore({ existingHash: null, issued: { issued_ok: true } });
    const b = fakeStore({ existingHash: null, issued: { issued_ok: true } });
    expect((await subToKeyHash(a.store, SUB))?.keyHash).not.toBe((await subToKeyHash(b.store, SUB))?.keyHash);
  });

  it("an account without an email, a refused mint, and an RPC error each yield null — and never a mint without an email", async () => {
    const noEmail = fakeStore({ existingHash: null, email: null, issued: { issued_ok: true } });
    expect(await subToKeyHash(noEmail.store, SUB)).toBeNull();
    expect(noEmail.calls.rpcs).toHaveLength(0);
    expect(await subToKeyHash(fakeStore({ existingHash: null, issued: { issued_ok: false } }).store, SUB)).toBeNull();
    expect(await subToKeyHash(fakeStore({ existingHash: null, issued: null, rpcError: { message: "boom" } }).store, SUB)).toBeNull();
  });

  it("the OAuth path names how a pass was activated; the one stamp writer lives in the dispatcher", () => {
    expect(oauthVia(CLIENT)).toBe(`oauth:${CLIENT}`);
    // The module names the value and never writes it: one helper in index.ts
    // (noteActivatedVia) stamps both paths, so there is no second UPDATE to
    // drift from the first.
    const oauthSrc = readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/oauth.ts"), "utf8");
    expect(oauthSrc).not.toMatch(/from\("agent_passes"\)/);
    expect(oauthSrc).not.toMatch(/stampActivatedVia/);
  });
});

describe("a bearer is a key or a token, decided by its prefix", () => {
  it("only the key prefix is a key; a JWT is not", async () => {
    expect(looksLikeApiKey(`${API_KEY_PREFIX}abc`)).toBe(true);
    expect(looksLikeApiKey(await signEs256(oauthClaims(), keys.priv))).toBe(false);
    expect(looksLikeApiKey("")).toBe(false);
    expect(decodeJwt(`${API_KEY_PREFIX}abc`)).toBeNull();
  });
});
