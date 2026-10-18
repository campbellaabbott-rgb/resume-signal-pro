// @vitest-environment node
/**
 * A CONNECTED APP'S TOKEN NEVER BUYS, MINTS A GRANT OR OPENS BILLING
 * (critical-path CP-D: "create-checkout and create-product-checkout adopt
 * requireWebsiteSession"; S9-001).
 *
 * Once the OAuth server signs tokens for the AI connectors, the same auth
 * server accepts them: a connector's token carries a client_id claim (or,
 * after the hook binds it, an audience that is the MCP URL). The checkouts
 * asked the auth server who a bearer was and acted as that person, so such a
 * token could have minted a Pro member's grant, bought on their account or
 * opened their billing portal. Each money function now reads the claims the
 * way R1's website-session module does and answers 401 before it asks the
 * auth server, mints, records or calls Stripe.
 *
 * Every token below is one the fake auth server ACCEPTS as the member, so a
 * refusal is the function's own. The controls send a website-shaped token
 * for the same member and see the grant and the portal: the refusal is
 * judged by claims, never by the token's shape.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { checkoutCaller, websiteTokenRefusal } from "../../supabase/functions/_shared/checkout-buyer";

const MEMBER = { id: "00000000-0000-4000-8000-00000000e001", email: "member@example.com" };
const DAY = 86_400_000;
const soon = () => new Date(Date.now() + 20 * DAY).toISOString();

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** An unsigned token with these claims: the fake auth server, not a signature, says who it is. */
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.c2ln`;
const base = { sub: MEMBER.id, email: MEMBER.email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 };

const WEBSITE = jwt(base);
const CONNECTOR = jwt({ ...base, client_id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d" });
const OTHER_AUDIENCE = jwt({ ...base, aud: "https://p.supabase.co/functions/v1/agent-mcp" });

let h: Record<string, EdgeHandler>;
let world: W4bWorld;
let asked: string[];

beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["create-checkout", "create-product-checkout", "create-subscription-checkout", "create-portal-session"]);
}, 240_000);

beforeEach(() => {
  world = freshWorld({ [WEBSITE]: MEMBER, [CONNECTOR]: MEMBER, [OTHER_AUDIENCE]: MEMBER });
  world.db.rpcs.pro_entitlement_rows = (a) => ({
    data: a.p_user_id === MEMBER.id ? [{ tier: "pro", status: "active", current_period_end: soon(), bound: true }] : [],
    error: null,
  });
  // Record every token the auth server is asked about.
  const client = (globalThis as unknown as Record<string, { auth: { getUser: (t?: string) => Promise<unknown> } }>).__w4bClient;
  const getUser = client.auth.getUser;
  asked = [];
  client.auth.getUser = async (t?: string) => { asked.push(String(t)); return getUser(t); };
  world.stripe.customers[MEMBER.email] = [{ id: "cus_member" }];
  world.stripe.subs.cus_member = [{ id: "sub_member", status: "active", current_period_end: Math.floor((Date.now() + 9 * DAY) / 1000), metadata: { user_id: MEMBER.id }, items: { data: [{ price: { unit_amount: 4500 } }] } }];
});

const nothingHappened = () => {
  expect(world.stripe.touched, "Stripe was called").toEqual([]);
  expect(world.db.writes, "something was written").toEqual([]);
  expect(asked, "the auth server was asked to vouch for it").toEqual([]);
};

// create-product-checkout sells nothing since 2026-10-17 (every row is cut or
// retired), so every token is answered by the 410 before it is read: judged
// on its own below.
const CALLS: Array<[string, Record<string, unknown>]> = [
  ["create-checkout", { currency: "usd" }],
  ["create-subscription-checkout", {}],
  ["create-portal-session", {}],
];

describe("a token issued to a connected app is refused by every money function", () => {
  for (const [fn, body] of CALLS) {
    it(`${fn}: a connector's token (client_id) is a 401 and nothing is minted, recorded or charged`, async () => {
      const res = await post(h[fn], fn, body, { bearer: CONNECTOR });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ reason: "connector_token", signInRequired: true });
      nothingHappened();
    });

    it(`${fn}: a token issued for another audience is a 401 too`, async () => {
      const res = await post(h[fn], fn, body, { bearer: OTHER_AUDIENCE });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ reason: "wrong_audience" });
      nothingHappened();
    });
  }
});

describe("create-product-checkout sells nothing to anyone (owner decision 2026-10-17)", () => {
  for (const [name, bearer] of [["a connector's token", CONNECTOR], ["the member's website session", WEBSITE]] as const) {
    it(`${name} asking for Freelance Boost gets the 410: no grant (it is not part of Pro), no token read, no Stripe`, async () => {
      const res = await post(h["create-product-checkout"], "create-product-checkout", { productId: "freelanceBoost" }, { bearer });
      expect(res.status).toBe(410);
      expect(await res.json()).toMatchObject({ retired: true, cut: true, product: "freelance_boost" });
      nothingHappened();
    });
  }
});

describe("the same member's website session still works (the controls)", () => {
  it("create-checkout mints the member's included Full Analysis", async () => {
    const body = await (await post(h["create-checkout"], "create-checkout", { currency: "usd" }, { bearer: WEBSITE })).json();
    expect(body.proIncluded).toBe(true);
  });

  it("create-portal-session opens the member's billing portal", async () => {
    const res = await post(h["create-portal-session"], "create-portal-session", {}, { bearer: WEBSITE });
    expect((await res.json()).url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    expect(world.stripe.portals).toHaveLength(1);
  });

  it("the publishable key and a non-JWT bearer are judged as before: anonymous, never refused", async () => {
    const hdr = (t: string) => new Headers({ authorization: `Bearer ${t}` });
    const anonKey = jwt({ role: "anon", iss: "supabase" });
    expect(websiteTokenRefusal(hdr(anonKey))).toBeNull();
    expect(websiteTokenRefusal(hdr("not-a-jwt"))).toBeNull();
    expect(websiteTokenRefusal(hdr(WEBSITE))).toBeNull();
    expect(websiteTokenRefusal(new Headers())).toBeNull();
    const auth = { getUser: async () => ({ data: { user: null }, error: { status: 403 } }) };
    expect(await checkoutCaller(auth, hdr(anonKey), "pk")).toEqual({ kind: "anonymous" });
    expect((await checkoutCaller(auth, hdr(CONNECTOR), "pk")).kind).toBe("refused");
  });
});
