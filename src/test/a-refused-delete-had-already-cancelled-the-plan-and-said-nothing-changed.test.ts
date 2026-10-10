// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness).
/**
 * A REFUSED DELETE HAD ALREADY CANCELLED THE PLAN, AND SAID NOTHING CHANGED
 * (wave 3 review of payments-account; L6-30, L3-13).
 *
 * WHAT WAS WRONG. delete-account cancelled every plan, immediately and for
 * good, BEFORE it removed the CV files. When storage then failed it answered
 * 503 files_not_deleted, and a second plan whose cancel failed answered
 * subscription_cancel_failed after the first had gone. The account page
 * mapped both to "Nothing was deleted: we couldn't finish cancelling your
 * subscription..." while the plan was already cancelled, and its header said
 * either failure stopped the delete "with nothing deleted".
 *
 * WHAT HOLDS NOW, against the shipped handler with Stripe, storage and auth
 * faked: the plans are read first, the files removed next, and the plans
 * cancelled last, just before the user goes; a storage failure cancels
 * nothing; a cancel that fails partway says how many went, and the page's
 * message for that answer says a plan was cancelled, never that nothing
 * changed.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { deleteRefusalKey } from "@/lib/account-delete";
import en from "../i18n/locales/en.json";

const USER_ID = "00000000-0000-4000-8000-0000000de1e9";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, amr: [{ method: "password" }] })}.sig`;

const state = {
  subs: [] as Array<{ id: string; customer: string; status: string; metadata: Record<string, string> }>,
  files: [] as string[],
  order: [] as string[],
  cancelled: [] as string[],
  deleted: [] as string[],
  readFails: false,
  storageFails: false,
  cancelFailsOn: null as string | null,
};

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const s = () => globalThis.__refusedDel;
    this.customers = { list: async () => { if (s().readFails) throw new Error("stripe down"); return { data: [{ id: "cus_1" }], has_more: false }; } };
    this.subscriptions = {
      list: async () => ({ data: s().subs, has_more: false }),
      cancel: async (id) => {
        if (s().cancelFailsOn === id) throw new Error("cancel refused");
        s().cancelled.push(id); s().order.push("cancel:" + id); return {};
      },
    };
  }
}`;

let handler: EdgeHandler;
const db = new FakeDb();

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", STRIPE_SECRET_KEY: "sk_test" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__refusedDel = state;
  g.__refusedClient = () => ({
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID, email: "leaving@example.com", identities: [] } }, error: null }),
      admin: { deleteUser: async (id: string) => { state.deleted.push(id); state.order.push("deleteUser"); return { error: null }; } },
    },
    storage: {
      from: () => ({
        list: async (prefix: string) => state.storageFails
          ? { data: null, error: { message: "storage down" } }
          : { data: state.files.filter((f) => f.startsWith(`${prefix}/`)).map((f) => ({ name: f.slice(prefix.length + 1) })), error: null },
        remove: async (paths: string[]) => { state.files = state.files.filter((f) => !paths.includes(f)); state.order.push("remove"); return { data: null, error: null }; },
      }),
    },
  });
  handler = await loadEdgeHandler("delete-account", {
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__refusedClient(...a); }",
  });
}, 120_000);

beforeEach(() => {
  Object.assign(state, {
    subs: [
      { id: "sub_pro", customer: "cus_1", status: "active", metadata: { user_id: USER_ID } },
      { id: "sub_agent", customer: "cus_1", status: "trialing", metadata: { user_id: USER_ID } },
    ],
    files: [`${USER_ID}/Jane_CV.pdf`],
    order: [], cancelled: [], deleted: [], readFails: false, storageFails: false, cancelFailsOn: null,
  });
});

const del = async () => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/delete-account", { method: "POST", headers: { authorization: `Bearer ${JWT}` } }));
  expect(buildIsAtLeast(res.headers.get("x-fn-build"), "delete-account", "2026-10-09"), String(res.headers.get("x-fn-build"))).toBe(true);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const said = (body: Record<string, unknown>) => (en.accountPage as unknown as Record<string, string>)[deleteRefusalKey(body).replace("accountPage.", "")];

describe("deleting an account, in the order that cannot strand a cancelled plan", () => {
  it("removes the files before it cancels anything, and cancels just before the user goes", async () => {
    const r = await del();
    expect(r.status).toBe(200);
    expect(state.order).toEqual(["remove", "cancel:sub_pro", "cancel:sub_agent", "deleteUser"]);
  });

  it("a storage failure cancels no plan, and the page says the account was not deleted", async () => {
    state.storageFails = true;
    const r = await del();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("files_not_deleted");
    expect(state.cancelled, "a plan was cancelled for a delete that did not happen").toEqual([]);
    expect(state.deleted).toEqual([]);
    expect(said(r.body)).toBe(en.accountPage.deleteRetry);
    expect(en.accountPage.deleteRetry).toMatch(/not deleted/);
  });

  it("a cancel that fails partway says how many went, and the page says a plan was cancelled, not that nothing changed", async () => {
    state.cancelFailsOn = "sub_agent";
    const r = await del();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: "subscription_cancel_failed", subscriptionsCancelled: 1 });
    expect(state.cancelled).toEqual(["sub_pro"]);
    expect(state.deleted).toEqual([]);
    expect(deleteRefusalKey(r.body)).toBe("accountPage.deletePlanCancelled");
    expect(said(r.body)).toMatch(/cancelled a subscription/);
    expect(said(r.body)).not.toMatch(/nothing was deleted/i);
  });

  it("a Stripe read failure changes nothing at all", async () => {
    state.readFails = true;
    const r = await del();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("billing_unreadable");
    expect(state.order).toEqual([]);
    expect(said(r.body)).toBe(en.accountPage.deleteRetry);
  });
});

describe("no refusal message claims nothing changed", () => {
  it("the retry message names the account, not 'nothing', since the CV may already be gone", () => {
    expect(en.accountPage.deleteRetry).not.toMatch(/^Nothing was deleted/);
    expect(deleteRefusalKey({ code: "subscription_unlinked" })).toBe("accountPage.deleteUnlinkedPlan");
    expect(deleteRefusalKey({ error: "Deletion failed", subscriptionsCancelled: 2 } as never)).toBe("accountPage.deletePlanCancelled");
    expect(deleteRefusalKey(null)).toBe("accountPage.deleteFailed");
  });
});
