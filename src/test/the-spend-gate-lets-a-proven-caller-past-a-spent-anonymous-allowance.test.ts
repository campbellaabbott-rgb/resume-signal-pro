// @vitest-environment node
/**
 * THE SPEND GATE LETS A PROVEN CALLER PAST A SPENT ANONYMOUS ALLOWANCE.
 *
 * WHAT WAS WRONG (review of 2026-10-04). Every free model endpoint has one
 * function-wide hourly ceiling, the only bound against a rotating address
 * pool. It counted everyone alike, so about ten addresses at twenty calls each
 * spent it and every real visitor was told "very busy" for the rest of the
 * hour -- repeatable every hour, on the owner's model budget. The pool already
 * running against /jobs uses 180-340 addresses an hour.
 *
 * WHAT IS HELD. A caller who has proven something spends an allowance of its
 * own and then a separate "proven" ceiling, so a pool that spends the
 * anonymous one cannot lock that caller out, and the worst an hour can cost is
 * still two fixed numbers:
 *   - a board pass (job-board signs one for a browser that solved Turnstile):
 *     _shared/board-pass-verify.ts is a COPY of job-board's verification, held
 *     here to job-board's own verdicts on passes job-board's own signer made;
 *     inert without TURNSTILE_SECRET_KEY, exactly like the board;
 *   - a signed-in account, confirmed by auth.getUser -- never by reading the
 *     token's claims, and never for an anonymous sign-in, which costs nothing
 *     to mint; the publishable key (role anon) is not even looked up;
 *   - an identity's own allowance is the address allowance's size, and the
 *     proven ceiling is the anonymous one's size.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boardPassId } from "../../supabase/functions/_shared/board-pass-verify";
import { GLOBAL_BUCKET, modelSpendGate, PROVEN_BUCKET } from "../../supabase/functions/_shared/model-spend-gate";
import { signBoardPass, verifyBoardPass } from "../../supabase/functions/job-board/board-pass";

const SERVICE = "service-role-key-for-the-pass-test-0123456789";
const SECRET = "turnstile-secret";
const CORS = { "Access-Control-Allow-Origin": "*" };
const LIMITS = { perAddress: 20, globalPerHour: 200 };
const USER_ID = "4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21";

let env: Record<string, string> = {};
let prevDeno: unknown;
beforeEach(() => {
  env = { SUPABASE_SERVICE_ROLE_KEY: SERVICE, TURNSTILE_SECRET_KEY: SECRET };
  prevDeno = (globalThis as Record<string, unknown>).Deno;
  (globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env[k] } };
});
afterEach(() => {
  (globalThis as Record<string, unknown>).Deno = prevDeno;
});

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.c2lnbmF0dXJl`;
const USER_TOKEN = jwt({ role: "authenticated", sub: USER_ID });
const ANON_USER_TOKEN = jwt({ role: "authenticated", sub: USER_ID, is_anonymous: true });
const ANON_KEY = jwt({ role: "anon", iss: "supabase" });

type Verdict = { data: unknown; error: unknown };
function fakeDb(answer: (a: Record<string, unknown>) => Verdict, users: Record<string, { id: string; is_anonymous?: boolean }> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const lookups: string[] = [];
  return {
    calls,
    lookups,
    rpc: async (_fn: string, a: Record<string, unknown>) => { calls.push(a); return answer(a); },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    auth: {
      getUser: async (token: string) => {
        lookups.push(token);
        const u = users[token];
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
      },
    },
  };
}
const req = (h: Record<string, string>) => new Request("https://x.test/fn", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9", ...h } });
const spentAnonymous = (a: Record<string, unknown>): Verdict => ({ data: a.p_ip !== GLOBAL_BUCKET, error: null });

describe("the gate's copy of the board pass check agrees with job-board's", () => {
  it("on passes job-board's own signer made, and on every way a pass can be wrong", async () => {
    const now = Date.now();
    const good = (await signBoardPass(SERVICE, now)).pass;
    const [v, exp, nonce, sig] = good.split(".");
    const flip = (h: string) => (h[0] === "a" ? "b" : "a") + h.slice(1);
    const cases: Array<[string, string, number]> = [
      ["valid", good, now],
      ["valid, padded with spaces", ` ${good} `, now],
      ["tampered signature", `${v}.${exp}.${nonce}.${flip(sig)}`, now],
      ["tampered nonce", `${v}.${exp}.${flip(nonce)}.${sig}`, now],
      ["tampered expiry", `${v}.${Number(exp) + 60}.${nonce}.${sig}`, now],
      ["expired", good, now + 31 * 60 * 1000],
      ["signed by another key", (await signBoardPass("another-service-key", now)).pass, now],
      ["dated too far ahead", (await signBoardPass(SERVICE, now + 60 * 60 * 1000)).pass, now],
      ["junk", "v1.not-a-pass", now],
      ["too long", `${good}${"0".repeat(80)}`, now],
    ];
    for (const [label, pass, at] of cases) {
      const theirs = await verifyBoardPass(pass.trim(), SERVICE, at);
      const ours = await boardPassId(pass, SERVICE, SECRET, at);
      expect(ours !== null, `${label}: the gate and job-board disagree`).toBe(theirs);
      if (theirs) expect(ours).toBe(pass.trim().split(".")[2].slice(0, 16));
    }
  });

  it("is inert until configured: no secret, or no service key, and no pass is valid", async () => {
    const good = (await signBoardPass(SERVICE)).pass;
    expect(await boardPassId(good, SERVICE, "")).toBeNull();
    expect(await boardPassId(good, "", SECRET)).toBeNull();
    expect(await boardPassId(42, SERVICE, SECRET)).toBeNull();
  });
});

describe("a proven caller spends its own allowance and the proven ceiling", () => {
  it("a board pass gets past a spent anonymous ceiling", async () => {
    const pass = (await signBoardPass(SERVICE)).pass;
    const db = fakeDb(spentAnonymous);
    expect(await modelSpendGate(db, req({}), "fn-a", LIMITS, CORS, { boardPass: pass })).toBeNull();
    expect(db.calls.map((c) => [c.p_ip, c.p_max_requests])).toEqual([
      ["203.0.113.9", 20],
      [`pass:${pass.split(".")[2].slice(0, 16)}`, 20],
      [PROVEN_BUCKET, 200],
    ]);
  });

  it("a board pass is nothing while TURNSTILE_SECRET_KEY is unset: the caller is anonymous", async () => {
    delete env.TURNSTILE_SECRET_KEY;
    const pass = (await signBoardPass(SERVICE)).pass;
    const r = await modelSpendGate(fakeDb(spentAnonymous), req({}), "fn-a", LIMITS, CORS, { boardPass: pass });
    expect((await r!.json()).code).toBe("rate_limited_global");
  });

  it("a signed-in account, confirmed by auth.getUser, gets past a spent anonymous ceiling", async () => {
    const db = fakeDb(spentAnonymous, { [USER_TOKEN]: { id: USER_ID } });
    expect(await modelSpendGate(db, req({ authorization: `Bearer ${USER_TOKEN}` }), "fn-a", LIMITS, CORS)).toBeNull();
    expect(db.lookups).toEqual([USER_TOKEN]);
    expect(db.calls.map((c) => c.p_ip)).toEqual(["203.0.113.9", `user:${USER_ID}`, PROVEN_BUCKET]);
    expect(`user:${USER_ID}`.length).toBeLessThanOrEqual(45);
  });

  it("a token that only CLAIMS to be signed in (auth.getUser refuses it) is anonymous", async () => {
    const db = fakeDb(spentAnonymous);
    const r = await modelSpendGate(db, req({ authorization: `Bearer ${USER_TOKEN}` }), "fn-a", LIMITS, CORS);
    expect((await r!.json()).code).toBe("rate_limited_global");
  });

  it("an anonymous sign-in is not proof of anything, whether the token or the account says so", async () => {
    const byToken = fakeDb(spentAnonymous, { [ANON_USER_TOKEN]: { id: USER_ID, is_anonymous: true } });
    expect((await (await modelSpendGate(byToken, req({ authorization: `Bearer ${ANON_USER_TOKEN}` }), "fn-a", LIMITS, CORS))!.json()).code).toBe("rate_limited_global");
    expect(byToken.lookups, "an anonymous token was looked up at all").toEqual([]);
    const byAccount = fakeDb(spentAnonymous, { [USER_TOKEN]: { id: USER_ID, is_anonymous: true } });
    expect((await (await modelSpendGate(byAccount, req({ authorization: `Bearer ${USER_TOKEN}` }), "fn-a", LIMITS, CORS))!.json()).code).toBe("rate_limited_global");
  });

  it("the publishable key (role anon) is never looked up: an anonymous visitor costs no auth round trip", async () => {
    const db = fakeDb(() => ({ data: true, error: null }));
    expect(await modelSpendGate(db, req({ authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY }), "fn-a", LIMITS, CORS)).toBeNull();
    expect(db.lookups).toEqual([]);
    expect(db.calls.map((c) => c.p_ip)).toEqual(["203.0.113.9", GLOBAL_BUCKET]);
  });

  it("an identity past its own allowance is refused as its own limit, not as the world's", async () => {
    const db = fakeDb((a) => ({ data: !String(a.p_ip).startsWith("user:"), error: null }), { [USER_TOKEN]: { id: USER_ID } });
    const r = await modelSpendGate(db, req({ authorization: `Bearer ${USER_TOKEN}` }), "fn-a", LIMITS, CORS);
    expect(r?.status).toBe(429);
    expect((await r!.json()).code).toBe("rate_limited_function");
    expect(db.calls.map((c) => c.p_ip)).not.toContain(PROVEN_BUCKET);
  });

  it("the proven ceiling is a ceiling too: the worst an hour costs stays bounded", async () => {
    const db = fakeDb((a) => ({ data: a.p_ip !== PROVEN_BUCKET, error: null }), { [USER_TOKEN]: { id: USER_ID } });
    const r = await modelSpendGate(db, req({ authorization: `Bearer ${USER_TOKEN}` }), "fn-a", LIMITS, CORS);
    expect(await r!.json()).toMatchObject({ code: "rate_limited_global", limit: 200 });
  });

  it("a purchase-gated generator has no ceiling to be proven past: identity is never looked up", async () => {
    const db = fakeDb(() => ({ data: true, error: null }), { [USER_TOKEN]: { id: USER_ID } });
    expect(await modelSpendGate(db, req({ authorization: `Bearer ${USER_TOKEN}` }), "fn-paid", { perAddress: 20 }, CORS)).toBeNull();
    expect(db.lookups).toEqual([]);
  });
});
