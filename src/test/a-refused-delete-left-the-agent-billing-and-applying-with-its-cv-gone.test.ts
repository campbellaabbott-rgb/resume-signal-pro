// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness).
/**
 * A REFUSED DELETE LEFT THE AGENT BILLING AND APPLYING WITH ITS CV GONE (wave
 * 3 review of payments-account; L6-30, L3-13).
 *
 * WHAT WAS WRONG. delete-account removed every file under resumes/{uid}/
 * before it cancelled the plans. When a cancel then failed it answered 503
 * with the user not deleted: the account, its billing plan and its running
 * apply agent all stayed, while the CV the mandate pointed at was gone.
 * apply-broker signs mandate.resume_file_url, only warns when the file is
 * missing, and hands the worker resumeUrl null, so the still-billing agent
 * could submit applications with no CV. The page's "we couldn't finish
 * removing your stored CV" did not say the CV was already gone.
 *
 * WHAT HOLDS NOW, against the shipped handler with Stripe, storage and auth
 * faked: the plans are cancelled before anything else; a failed cancel leaves
 * the CV where it was; the agent is switched off (agent_mandates.active, the
 * broker's stop) before the CV goes, and a switch that fails keeps the CV;
 * every refusal after the CV went says so, and the page reads it out.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { deleteRefusalKeys } from "@/lib/account-delete";
import en from "../i18n/locales/en.json";

const USER_ID = "00000000-0000-4000-8000-0000000de1ea";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, amr: [{ method: "password" }] })}.sig`;
const CV = `${USER_ID}/Jane_CV.pdf`;

const state = {
  files: [] as string[],
  cancelled: [] as string[],
  deleted: [] as string[],
  cancelFails: false,
  deleteFails: false,
};

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const s = () => globalThis.__cvGone;
    this.customers = { list: async () => ({ data: [{ id: "cus_1" }], has_more: false }) };
    this.subscriptions = {
      list: async () => ({ data: [{ id: "sub_agent", customer: "cus_1", status: "active", metadata: { user_id: "${USER_ID}" } }], has_more: false }),
      cancel: async (id) => { if (s().cancelFails) throw new Error("cancel refused"); s().cancelled.push(id); return {}; },
    };
  }
}`;

let handler: EdgeHandler;
let db: FakeDb;

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", STRIPE_SECRET_KEY: "sk_test" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__cvGone = state;
  g.__cvGoneClient = () => ({
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID, email: "leaving@example.com", identities: [] } }, error: null }),
      admin: {
        deleteUser: async (id: string) => {
          if (state.deleteFails) return { error: { message: "auth down" } };
          state.deleted.push(id);
          return { error: null };
        },
      },
    },
    storage: {
      from: () => ({
        list: async (prefix: string) => ({ data: state.files.filter((f) => f.startsWith(`${prefix}/`)).map((f) => ({ name: f.slice(prefix.length + 1) })), error: null }),
        remove: async (paths: string[]) => { state.files = state.files.filter((f) => !paths.includes(f)); return { data: null, error: null }; },
      }),
    },
  });
  handler = await loadEdgeHandler("delete-account", {
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__cvGoneClient(...a); }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  db.rows("agent_mandates").push({ user_id: USER_ID, active: true, resume_file_url: CV });
  Object.assign(state, { files: [CV], cancelled: [], deleted: [], cancelFails: false, deleteFails: false });
});

const del = async () => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/delete-account", { method: "POST", headers: { authorization: `Bearer ${JWT}` } }));
  expect(buildIsAtLeast(res.headers.get("x-fn-build"), "delete-account", "2026-10-09", 3), String(res.headers.get("x-fn-build"))).toBe(true);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const agentActive = () => db.rows("agent_mandates")[0]?.active;
const page = (body: Record<string, unknown>) =>
  deleteRefusalKeys(body).map((k) => (en.accountPage as unknown as Record<string, string>)[k.replace("accountPage.", "")]);

describe("a delete refused partway", () => {
  it("a failed cancel leaves the CV the agent sends where it was", async () => {
    state.cancelFails = true;
    const r = await del();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("subscription_cancel_failed");
    expect(state.files, "the CV was deleted while the plan and the agent stayed").toEqual([CV]);
    expect(state.deleted).toEqual([]);
  });

  it("the agent is switched off before its CV goes", async () => {
    state.deleteFails = true;
    const r = await del();
    expect(r.status).toBe(500);
    expect(state.files).toEqual([]);
    expect(agentActive(), "the agent still ran with its CV gone").toBe(false);
    expect(r.body).toMatchObject({ agentStopped: true, cvRemoved: true, subscriptionsCancelled: 1 });
    const said = page(r.body);
    expect(said).toContain(en.accountPage.deleteCvRemoved);
    expect(said).toContain(en.accountPage.deleteAgentStopped);
  });

  it("an agent that cannot be switched off keeps its CV", async () => {
    db.faults.push({ table: "agent_mandates", op: "update", error: { message: "db down" } as never });
    const r = await del();
    expect(r.status).toBe(503);
    expect(state.files).toEqual([CV]);
    expect(state.deleted).toEqual([]);
  });
});
