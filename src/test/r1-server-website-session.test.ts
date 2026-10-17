// @vitest-environment node
/**
 * R1: A WEBSITE SESSION, AND NOT A TOKEN MINTED FOR SOMETHING ELSE.
 *
 * supabase/functions/_shared/website-session.ts decides whether a bearer token
 * may act as the signed-in person on the website. Run here directly, with the
 * auth server faked: the publishable key and a connector's token (client_id,
 * or an audience other than "authenticated") are refused BEFORE the auth
 * server is asked, a token the auth server refuses is refused, and only then
 * is a session handed back. The refusal is a 401 that carries the caller's
 * headers (CORS and the build stamp).
 */
import { describe, expect, it } from "vitest";
import {
  jwtClaims,
  requireWebsiteSession,
  websiteClaimsRefusal,
  websiteSessionOf,
  type WebsiteAuth,
} from "../../supabase/functions/_shared/website-session";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tok = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.sig`;
const USER = "8d3e2a1b-1111-4222-8333-944445555666";
const good = { sub: USER, role: "authenticated", aud: "authenticated", email: "a@example.com", session_id: "5d3e2a1b-1111-4222-8333-944445555666" };

function fakeAuth(answer: (jwt: string) => { data?: { user?: unknown } | null; error?: unknown }) {
  const asked: string[] = [];
  const auth: WebsiteAuth = { getUser: async (jwt) => { asked.push(jwt); return answer(jwt); } };
  return { auth, asked };
}

const req = (authorization?: string) =>
  new Request("https://f.test/functions/v1/x", { method: "POST", headers: authorization ? { authorization } : {} });

describe("the claims a website session may carry", () => {
  it("decodes a token's payload and nothing else", () => {
    expect(jwtClaims(tok(good))).toMatchObject({ sub: USER, role: "authenticated" });
    expect(jwtClaims("a.b")).toBeNull();
    expect(jwtClaims("x.!!!.y")).toBeNull();
    expect(jwtClaims(`${b64url({})}.${b64url([1, 2])}.s`)).toBeNull();
    expect(jwtClaims(undefined)).toBeNull();
  });

  it("refuses the publishable key, a connector's client_id (any value), and any audience but authenticated", () => {
    expect(websiteClaimsRefusal(jwtClaims(tok(good)))).toBeNull();
    expect(websiteClaimsRefusal(jwtClaims(tok({ ...good, aud: ["authenticated"] })))).toBeNull();
    expect(websiteClaimsRefusal(jwtClaims(tok({ role: "anon", iss: "supabase" })))?.reason).toBe("not_signed_in");
    expect(websiteClaimsRefusal(jwtClaims(tok({ ...good, sub: undefined })))?.reason).toBe("not_signed_in");
    expect(websiteClaimsRefusal(jwtClaims(tok({ ...good, client_id: "mcp" })))?.reason).toBe("connector_token");
    expect(websiteClaimsRefusal(jwtClaims(tok({ ...good, client_id: null })))?.reason).toBe("connector_token");
    expect(websiteClaimsRefusal(jwtClaims(tok({ ...good, client_id: "" })))?.reason).toBe("connector_token");
    expect(websiteClaimsRefusal(jwtClaims(tok({ ...good, aud: "https://resumebooster.work/mcp" })))?.reason).toBe("wrong_audience");
    expect(websiteClaimsRefusal(jwtClaims(tok({ ...good, aud: ["authenticated", "mcp"] })))?.reason).toBe("wrong_audience");
    expect(websiteClaimsRefusal(jwtClaims(tok({ ...good, aud: undefined })))?.reason).toBe("wrong_audience");
    expect(websiteClaimsRefusal(null)?.reason).toBe("invalid_session");
  });
});

describe("requireWebsiteSession", () => {
  const cors = { "x-fn-build": "auth-signed-in.2026-10-14.1", "Access-Control-Allow-Origin": "https://resumebooster.work" };

  it("hands back the user, the token and its claims when the auth server accepts the token", async () => {
    const { auth, asked } = fakeAuth(() => ({ data: { user: { id: USER, email: "a@example.com" } }, error: null }));
    const s = await requireWebsiteSession(req(`Bearer ${tok(good)}`), { auth, headers: cors });
    expect(s).not.toBeInstanceOf(Response);
    if (s instanceof Response) return;
    expect(s.user.id).toBe(USER);
    expect(s.jwt).toBe(tok(good));
    expect(s.claims.session_id).toBe(good.session_id);
    expect(asked).toEqual([tok(good)]);
  });

  it("refuses without asking the auth server: no token, another scheme, the publishable key, a connector's token", async () => {
    const { auth, asked } = fakeAuth(() => ({ data: { user: { id: USER } }, error: null }));
    const cases: Array<[string | undefined, string]> = [
      [undefined, "no_session"],
      [`Basic ${tok(good)}`, "no_session"],
      [`Bearer ${tok({ role: "anon", iss: "supabase" })}`, "not_signed_in"],
      [`Bearer ${tok({ ...good, client_id: "chatgpt" })}`, "connector_token"],
      [`Bearer ${tok({ ...good, aud: "mcp" })}`, "wrong_audience"],
      ["Bearer not-a-jwt", "invalid_session"],
    ];
    for (const [authorization, reason] of cases) {
      const r = await requireWebsiteSession(req(authorization), { auth, headers: cors });
      expect(r, reason).toBeInstanceOf(Response);
      const res = r as Response;
      expect(res.status, reason).toBe(401);
      expect(await res.json()).toMatchObject({ reason });
      expect(res.headers.get("x-fn-build")).toBe("auth-signed-in.2026-10-14.1");
      expect(res.headers.get("access-control-allow-origin")).toBe("https://resumebooster.work");
    }
    expect(asked).toEqual([]);
  });

  it("refuses a token the auth server refuses, one it answers for another user, and an auth server that throws", async () => {
    for (const answer of [
      () => ({ data: { user: null }, error: { message: "session_not_found" } }),
      () => ({ data: { user: { id: "someone-else" } }, error: null }),
      () => { throw new Error("network"); },
    ]) {
      const { auth } = fakeAuth(answer as never);
      const r = await websiteSessionOf(new Headers({ authorization: `Bearer ${tok(good)}` }), auth);
      expect(r).toMatchObject({ ok: false, reason: "invalid_session" });
    }
  });

  it("with no client handed in, asks GET /auth/v1/user with the publishable key, and refuses when it is not configured", async () => {
    const g = globalThis as Record<string, unknown>;
    const realFetch = globalThis.fetch;
    const prevDeno = g.Deno;
    const seen: Array<{ url: string; apikey: string | null; authorization: string | null }> = [];
    try {
      g.Deno = { env: { get: (k: string) => ({ SUPABASE_URL: "https://p.supabase.co/", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k] } };
      g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        seen.push({ url: String(input), apikey: h.get("apikey"), authorization: h.get("authorization") });
        return new Response(JSON.stringify({ id: USER, email: "a@example.com" }), { status: 200 });
      };
      const ok = await websiteSessionOf(new Headers({ authorization: `Bearer ${tok(good)}` }));
      expect(ok).toMatchObject({ ok: true });
      expect(seen).toEqual([{ url: "https://p.supabase.co/auth/v1/user", apikey: "anon-key", authorization: `Bearer ${tok(good)}` }]);
      g.Deno = { env: { get: () => undefined } };
      expect(await websiteSessionOf(new Headers({ authorization: `Bearer ${tok(good)}` }))).toMatchObject({ ok: false, reason: "invalid_session" });
      expect(seen).toHaveLength(1);
    } finally {
      g.fetch = realFetch;
      g.Deno = prevDeno;
    }
  });
});
