// @vitest-environment node
/**
 * THE OWNER'S RE-DELIVERY AND THE ACCOUNT DELETION REFUSE A CALLER WITHOUT
 * THE KEY (S11-128).
 *
 * Both gates are right today, and nothing held them. admin-regenerate-delivery
 * (the owner's tool that remakes a buyer's Premium Package with a model and
 * mails it) opens only to the owner's x-admin-key, but every handler test sent
 * the right key. delete-account deletes the signed-in person, but every
 * handler test sent a signed-in session. A gate that stopped comparing, or
 * compared only a prefix, or let an unset secret match an empty header, or a
 * deletion that took the publishable key every visitor holds as a session,
 * would have passed the suite.
 *
 * Held on the shipped handlers with the model, the mail, Stripe, storage and
 * the database faked:
 *   - admin-regenerate-delivery with no key, a wrong key, the key with a
 *     character more or less, or with ADMIN_API_KEY unset, answers 401 and
 *     makes no model call, sends no mail, starts no background task and
 *     writes nothing; the right key opens it, and then the model is asked;
 *   - delete-account with no Authorization, with the anon key, with the anon
 *     key as apikey only, or with a token that is no JWT, answers 401 and
 *     deletes nobody, cancels nothing, removes no file and erases nothing;
 *     the person's own session deletes the account.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ADMIN = "admin-key-for-the-harness-0123456789abcdef";
const USER_ID = "00000000-0000-4000-8000-0000000de1e9";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const USER_JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password" }] })}.sig`;
const ANON_KEY = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", ref: "harness", role: "anon" })}.sig`;
const SOURCE = "JANE DOE\njane@example.com\nSenior Engineer\n- Led payments work in TypeScript and Postgres.";

const env: Record<string, string | undefined> = {};
const asked: string[] = [];
const sent: unknown[] = [];
const background: Promise<unknown>[] = [];
const g = globalThis as Record<string, unknown>;

beforeAll(() => {
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { background.push(p); } };
  g.__keySent = sent;
  g.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    asked.push(u);
    if (!u.includes("ai.gateway.lovable.dev")) return new Response(JSON.stringify({ error: "not faked" }), { status: 500 });
    // The model, for the positive control: a grounded résumé, then a grounded letter.
    const letter = JSON.parse(String(init?.body ?? "{}")).max_completion_tokens === 4000;
    const content = letter
      ? JSON.stringify({ coverLetter: "Dear Hiring Manager,\n\nI led payments work in TypeScript.\n\nJane", openingLine: "", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "Senior Engineer application" })
      : JSON.stringify({ rewrittenResume: SOURCE, professionalSummary: "Payments engineer.", keyChanges: [], addedKeywords: [], highlights: [] });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
  };
});
beforeEach(() => {
  asked.length = 0;
  sent.length = 0;
  background.length = 0;
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("admin-regenerate-delivery", () => {
  let regenerate: EdgeHandler;
  let db: FakeDb;

  beforeAll(async () => {
    g.__keyDb = () => db;
    regenerate = await loadEdgeHandler("admin-regenerate-delivery", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__keyDb();",
      "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__keySent.push(m); return { data: { id: 'em_1' }, error: null }; } }; } }",
    });
  }, 120_000);

  beforeEach(() => {
    db = new FakeDb();
    Object.assign(env, {
      SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-harness", RESEND_API_KEY: "re_harness",
      LOVABLE_API_KEY: "lovable-harness", ADMIN_API_KEY: ADMIN,
    });
  });

  const ask = (headers: Record<string, string>) => regenerate(new Request("https://harness.supabase.co/functions/v1/admin-regenerate-delivery", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email: "buyer@example.com", resumeText: SOURCE, jobTitle: "Senior Engineer", jobCompany: "Initech" }),
  }));

  const refusedCleanly = async (res: Response, label: string) => {
    expect(res.status, `${label}: the owner's tool opened`).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    await Promise.all(background);
    expect(asked, `${label}: a model or a mail service was called`).toEqual([]);
    expect(sent, `${label}: a mail was sent`).toEqual([]);
    expect(background, `${label}: a background task started`).toEqual([]);
    expect(db.writes, `${label}: something was written`).toEqual([]);
  };

  it("refuses no key, a wrong key, and the key with a character more or less", async () => {
    const tries: Array<[string, Record<string, string>]> = [
      ["no key", {}],
      ["an empty key", { "x-admin-key": "" }],
      ["a wrong key", { "x-admin-key": "admin-key-for-the-harness-0123456789abcdeX" }],
      ["the key with a character more", { "x-admin-key": `${ADMIN}0` }],
      ["the key behind a prefix", { "x-admin-key": `0${ADMIN}` }],
      ["the key one character short", { "x-admin-key": ADMIN.slice(0, -1) }],
      ["the key as a bearer token", { authorization: `Bearer ${ADMIN}` }],
    ];
    for (const [label, headers] of tries) await refusedCleanly(await ask(headers), label);
  });

  it("refuses everyone while ADMIN_API_KEY is unset, an empty header included", async () => {
    for (const unset of [undefined, ""]) {
      env.ADMIN_API_KEY = unset;
      for (const headers of [{}, { "x-admin-key": "" }, { "x-admin-key": ADMIN }]) {
        await refusedCleanly(await ask(headers), `secret ${JSON.stringify(unset)}, header ${JSON.stringify(headers)}`);
      }
    }
  });

  it("opens to the right key, and then the model is asked and the buyer mailed", async () => {
    const res = await ask({ "x-admin-key": ADMIN });
    expect(res.status).toBe(200);
    await Promise.all(background);
    expect(asked.some((u) => u.includes("ai.gateway.lovable.dev")), "the positive control never reached the model").toBe(true);
    expect(sent, "the positive control never mailed").toHaveLength(1);
    expect(db.writes.length, "the positive control wrote nothing").toBeGreaterThan(0);
  });
});

describe("delete-account", () => {
  let del: EdgeHandler;
  const db = new FakeDb();
  const state = { deleted: [] as string[], stripe: [] as string[], removed: [] as string[], erased: 0, getUser: 0 };

  beforeAll(async () => {
    g.__delClient = () => ({
      from: (t: string) => db.from(t),
      rpc: (n: string, a: Record<string, unknown>) => {
        if (n === "account_erase_personal_data") state.erased++;
        return db.rpc(n, a);
      },
      auth: {
        // An auth server that answers the person for any token it is asked about: the gate is the function's.
        getUser: async () => { state.getUser++; return { data: { user: { id: USER_ID, email: "leaving@example.com", identities: [] } }, error: null }; },
        admin: { deleteUser: async (id: string) => { state.deleted.push(id); return { error: null }; } },
      },
      storage: {
        from: () => ({
          list: async () => ({ data: [{ name: "Jane_CV.pdf" }], error: null }),
          remove: async (paths: string[]) => { state.removed.push(...paths); return { data: null, error: null }; },
        }),
      },
    });
    g.__delStripe = state;
    del = await loadEdgeHandler("delete-account", {
      "https://esm.sh/stripe@18.5.0": `export default class Stripe {
        constructor() {
          const s = () => globalThis.__delStripe;
          this.customers = { list: async () => { s().stripe.push("customers.list"); return { data: [], has_more: false }; } };
          this.subscriptions = {
            search: async () => { s().stripe.push("subscriptions.search"); return { data: [], has_more: false }; },
            list: async () => { s().stripe.push("subscriptions.list"); return { data: [], has_more: false }; },
            cancel: async (id) => { s().stripe.push("cancel:" + id); return {}; },
          };
          this.checkout = { sessions: { expire: async () => ({}) } };
        }
      }`,
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__delClient(...a); }",
    });
  }, 120_000);

  beforeEach(() => {
    Object.assign(state, { deleted: [], stripe: [], removed: [], erased: 0, getUser: 0 });
    Object.assign(env, { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: "service", STRIPE_SECRET_KEY: "sk_test" });
    db.rpcs.account_erase_personal_data = () => ({ data: { keys_revoked: 0 }, error: null });
  });

  const ask = (headers: Record<string, string>) => del(new Request("https://harness.supabase.co/functions/v1/delete-account", { method: "POST", headers }));

  it("refuses a caller with no session, the anon key, or a token that is no JWT, and deletes nobody", async () => {
    const tries: Array<[string, Record<string, string>]> = [
      ["no Authorization", {}],
      ["the anon key as the bearer", { authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY }],
      ["the anon key as apikey only", { apikey: ANON_KEY }],
      ["an empty bearer", { authorization: "Bearer " }],
      ["a token that is no JWT", { authorization: "Bearer not-a-jwt" }],
    ];
    for (const [label, headers] of tries) {
      const res = await ask(headers);
      expect(res.status, `${label}: the deletion ran`).toBe(401);
      expect(state.deleted, `${label}: an account was deleted`).toEqual([]);
      expect(state.stripe, `${label}: Stripe was asked about a plan`).toEqual([]);
      expect(state.removed, `${label}: a file was removed`).toEqual([]);
      expect(state.erased, `${label}: personal data was erased`).toBe(0);
    }
    expect(state.getUser, "a token that cannot be a session cost an auth round trip").toBe(0);
  });

  it("deletes the account for the person's own session", async () => {
    const res = await ask({ authorization: `Bearer ${USER_JWT}`, apikey: ANON_KEY });
    expect(res.status).toBe(200);
    expect(state.deleted, "the positive control never reached deleteUser").toEqual([USER_ID]);
  });
});
