// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness).
/**
 * DELETING AN ACCOUNT LEFT ITS PLAN BILLING AND ITS CV STORED.
 *
 * WHAT WAS WRONG (platform sweep 2026-10-04, L6-30 and L3-13). delete-account
 * called deleteUser and nothing else: a $45 or $99 subscription kept charging
 * an account that no longer had a session to reach the billing portal with,
 * and the CV files under resumes/{user id}/ stayed in storage for good, out of
 * reach of every owner-only policy.
 *
 * WHAT HOLDS NOW, against the shipped handler with Stripe, storage and auth
 * faked: the account's plans are cancelled and its files removed BEFORE the
 * user is deleted, and if either cannot be done the user is not deleted; a plan on
 * the address that names no account is cancelled only for a proven mailbox
 * (anyone can register a subscriber's address while sign-ups auto-confirm),
 * and a plan that names another account is never touched.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const USER_ID = "00000000-0000-4000-8000-0000000de1e7";
const OTHER_ID = "00000000-0000-4000-8000-0000000de1e8";
const EMAIL = "leaving@example.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const PASSWORD_JWT = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, amr: [{ method: "password" }] })}.sig`;
const GOOGLE_JWT = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, amr: [{ method: "oauth" }] })}.sig`;

type Sub = { id: string; customer: string; status: string; metadata: Record<string, string> };
const state = {
  subs: [] as Sub[],
  cancelled: [] as string[],
  files: [] as string[],
  removed: [] as string[],
  deleted: [] as string[],
  order: [] as string[],
  stripeFails: false,
  storageFails: false,
  identities: [] as Array<Record<string, unknown>>,
};

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const s = () => globalThis.__delState;
    this.customers = { list: async () => ({ data: [{ id: "cus_1" }], has_more: false }) };
    this.subscriptions = {
      list: async () => { if (s().stripeFails) throw new Error("stripe down"); return { data: s().subs, has_more: false }; },
      cancel: async (id) => { s().cancelled.push(id); s().order.push("cancel"); return {}; },
    };
  }
}`;

let handler: EdgeHandler;
let db: FakeDb;

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", STRIPE_SECRET_KEY: "sk_test" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__delState = state;
  g.__delClient = (_url: string, key: string, opts?: { global?: { headers?: Record<string, string> } }) => {
    const jwt = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer\s+/i, "");
    return {
      from: (t: string) => db.from(t),
      rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
      auth: {
        getUser: async () => (jwt === PASSWORD_JWT || jwt === GOOGLE_JWT
          ? { data: { user: { id: USER_ID, email: EMAIL, identities: state.identities } }, error: null }
          : { data: { user: null }, error: { message: "no" } }),
        admin: { deleteUser: async (id: string) => { state.deleted.push(id); state.order.push("deleteUser"); return { error: null }; } },
      },
      storage: {
        from: (bucket: string) => ({
          list: async (prefix: string) => {
            if (state.storageFails) return { data: null, error: { message: "storage down" } };
            return { data: bucket === "resumes" ? state.files.filter((f) => f.startsWith(`${prefix}/`)).map((f) => ({ name: f.slice(prefix.length + 1) })) : [], error: null };
          },
          remove: async (paths: string[]) => {
            state.removed.push(...paths);
            state.files = state.files.filter((f) => !paths.includes(f));
            state.order.push("remove");
            return { data: null, error: null };
          },
        }),
      },
      _key: key,
    };
  };
  handler = await loadEdgeHandler("delete-account", {
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__delClient(...a); }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  Object.assign(state, {
    subs: [], cancelled: [], removed: [], deleted: [], order: [], stripeFails: false, storageFails: false, identities: [],
    files: [`${USER_ID}/Jane_CV.pdf`, `${USER_ID}/Jane_CV_2026.pdf`, `${OTHER_ID}/Someone_else.pdf`],
  });
});

const del = async (jwt = PASSWORD_JWT) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/delete-account", { method: "POST", headers: { authorization: `Bearer ${jwt}` } }));
  return { status: res.status, json: await res.json() as Record<string, unknown> };
};

describe("deleting an account", () => {
  it("cancels the plan the account pays for and removes every CV it stored, before the user goes", async () => {
    state.subs = [{ id: "sub_mine", customer: "cus_1", status: "active", metadata: { user_id: USER_ID } }];
    const r = await del();
    expect(r.status).toBe(200);
    expect(state.cancelled).toEqual(["sub_mine"]);
    expect(state.removed.sort()).toEqual([`${USER_ID}/Jane_CV.pdf`, `${USER_ID}/Jane_CV_2026.pdf`]);
    expect(state.files, "another account's file was touched").toEqual([`${OTHER_ID}/Someone_else.pdf`]);
    expect(state.deleted).toEqual([USER_ID]);
    // Plans first, then the CV: a-refused-delete-left-the-agent-billing-and-applying-with-its-cv-gone.test.ts.
    expect(state.order).toEqual(["cancel", "remove", "deleteUser"]);
  });

  it("deletes nothing when Stripe cannot be read, so no plan is left billing a deleted account", async () => {
    state.stripeFails = true;
    const r = await del();
    expect(r.status).toBe(503);
    expect(state.deleted).toEqual([]);
    expect(state.removed).toEqual([]);
  });

  it("deletes nothing when the files cannot be removed", async () => {
    state.storageFails = true;
    const r = await del();
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("files_not_deleted");
    expect(state.deleted).toEqual([]);
  });

  it("a plan on the address that names no account: refused for an unproven password session, nothing cancelled or deleted", async () => {
    state.subs = [{ id: "sub_guest", customer: "cus_1", status: "active", metadata: {} }];
    const r = await del();
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("subscription_unlinked");
    expect(state.cancelled).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it("the same plan is cancelled for a session that proved the mailbox", async () => {
    state.subs = [{ id: "sub_guest", customer: "cus_1", status: "trialing", metadata: {} }];
    state.identities = [{ provider: "google", identity_data: { email: EMAIL, email_verified: true } }];
    const r = await del(GOOGLE_JWT);
    expect(r.status).toBe(200);
    expect(state.cancelled).toEqual(["sub_guest"]);
  });

  it("a plan that names another account is never cancelled by this one's delete", async () => {
    state.subs = [{ id: "sub_theirs", customer: "cus_1", status: "active", metadata: { user_id: OTHER_ID } }];
    const r = await del();
    expect(r.status).toBe(200);
    expect(state.cancelled).toEqual([]);
    expect(state.deleted).toEqual([USER_ID]);
  });
});
