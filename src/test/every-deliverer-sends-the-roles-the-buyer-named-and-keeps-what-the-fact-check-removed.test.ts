// @vitest-environment node
/**
 * EVERY DELIVERER SENDS THE ROLES THE BUYER NAMED, KEEPS WHAT THE FACT CHECK
 * REMOVED, AND TELLS THE PAGE A STREAMED PRODUCT IS BEING MADE
 * (S11-074, S11-055, S11-054).
 *
 * S11-074. ATS Defense sold "multi-role targeting (up to 3 roles)", and the
 *   webhook, the success page's verifier and the retry sweep each sent
 *   targetRoles: []. The roles the checkout wrote (metadata target_roles, or
 *   the Pro grant's target_roles) now reach generate-ats-defense on every path.
 * S11-055. The three saved apply-kit objects dropped groundingReport, so the
 *   saved copy no longer said which skills the fact check removed.
 * S11-054. The verifier computed "in progress" only when the page asked it to
 *   generate, and the page never asked for the streamed products: it made a
 *   second copy while the webhook was making the first.
 *
 * Run against the shipped handlers with only their network faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// The Apply Assistant is retired (wave 4): the saved-kit cases run its dormant
// delivery path with the switch on (helpers/apply-agent-switch-on.ts).
import { APPLY_ASSISTANT_SWITCH_ON } from "./helpers/apply-agent-switch-on";
import { FakeDb, loadEdgeHandler, type EdgeHandler, fakeLeaseRpcs } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const RESUME_ID = "11111111-2222-4333-8444-555555555555";
const SERVICE = "service_harness_key_0123456789abcdef0123456789";

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() {
    const w = () => globalThis.__rolesWorld;
    this.webhooks = { constructEventAsync: async (b) => JSON.parse(b) };
    this.customers = { list: async () => ({ data: [], has_more: false }), retrieve: async (id) => ({ id, email: null }) };
    this.subscriptions = { list: async () => ({ data: [], has_more: false }) };
    this.checkout = { sessions: { retrieve: async (id) => { const s = w().sessions[id]; if (!s) throw new Error("No such checkout.session"); return s; } } };
  } }`,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__rolesClient; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: { id: 'x' }, error: null }) }; } }",
};
const env: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: "whsec_harness", STRIPE_SECRET_KEY: "sk_test_harness", SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness", RESEND_API_KEY: "re_harness",
};

let webhook: EdgeHandler;
let sweeper: EdgeHandler;
let verify: EdgeHandler;
const pending: Promise<unknown>[] = [];
const db = new FakeDb({ used_stripe_sessions: ["session_id"], purchased_content: ["stripe_session_id"] });
const fetches: Array<{ url: string; body: Record<string, unknown> | null }> = [];
const world = { sessions: {} as Record<string, unknown> };
const KIT = { success: true, jobMetadata: { company: "Globex", roleTitle: "Engineer" }, tailoredResume: { contact: {}, summary: "", experience: [], education: [], skills: [], certifications: [] }, skillGaps: [], checklist: [], modelUsed: "m", groundingReport: { verified: true, removedSkills: ["Kubernetes"], removedCertifications: [], removedContact: [] } };

const client = {
  from: (t: string) => {
    const q = db.from(t) as unknown as Record<string, unknown> & { preds: Array<(r: Record<string, unknown>) => boolean> };
    q.not = (col: string) => { q.preds.push((r) => r[col] != null); return q; };
    return q;
  },
  rpc: (name: string, args: Record<string, unknown> = {}) => db.rpc(name, args),
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.__rolesClient = client;
  g.__rolesWorld = world;
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    fetches.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/functions/v1/send-product-email")) return new Response("{}", { status: 200 });
    if (url.includes("/functions/v1/generate-apply-package")) return new Response(JSON.stringify(KIT), { status: 200 });
    if (url.includes("/functions/v1/generate-cover-letter")) return new Response(JSON.stringify({ success: true, data: { coverLetter: "Dear team" } }), { status: 200 });
    if (url.includes("/functions/v1/generate-")) return new Response(JSON.stringify({ success: true, data: { beforeScore: { overall: 40 } } }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  webhook = await loadEdgeHandler("stripe-webhook", { ...STUBS, ...APPLY_ASSISTANT_SWITCH_ON });
  sweeper = await loadEdgeHandler("retry-failed-deliveries", STUBS);
  verify = await loadEdgeHandler("verify-product-purchase", { ...STUBS, ...APPLY_ASSISTANT_SWITCH_ON });
}, 180_000);

beforeEach(() => {
  db.tables = {};
  db.writes = [];
  fetches.length = 0;
  world.sessions = {};
  db.rpcs = {
    // The lease a maker takes before it generates (20261011144000).
    ...fakeLeaseRpcs(db),
    log_webhook_event: () => ({ data: null, error: null }),
    get_temp_resume: () => ({ data: [{ resume_text: "A".repeat(400), job_description_text: "Senior engineer posting at Globex" }], error: null }),
    save_purchased_content: (a) => { db.rows("purchased_content").push({ stripe_session_id: a.p_stripe_session_id, generated_content: a.p_generated_content }); return { data: "pc", error: null }; },
    update_delivery_retry: () => ({ data: true, error: null }),
    get_purchased_content_by_session: (a) => ({ data: db.rows("purchased_content").filter((r) => r.stripe_session_id === a.p_session_id), error: null }),
    check_rate_limit: () => ({ data: true, error: null }),
    log_delivery_step: (a) => { db.rows("delivery_steps").push(a); return { data: "pd-x", error: null }; },
    agent_prepare_now: () => ({ data: false, error: null }),
    mail_door_take: () => ({ data: true, error: null }),
  };
});

const settle = async () => { while (pending.length) await pending.shift(); };
const event = async (object: Record<string, unknown>) => {
  const res = await webhook(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
    body: JSON.stringify({ id: `evt_${String(object.id)}`, type: "checkout.session.completed", data: { object } }),
  }));
  await settle();
  return res.status;
};
const paid = (id: string, metadata: Record<string, string>) => ({
  id, mode: "payment", payment_status: "paid", amount_total: 1500, currency: "usd", customer_email: null,
  customer_details: { email: "buyer@example.com" }, metadata,
});
const atsCall = () => fetches.find((f) => f.url.includes("/functions/v1/generate-ats-defense"))?.body;
const ask = async (sessionId: string, generateContent: boolean) =>
  (await verify(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
    body: JSON.stringify({ sessionId, generateContent }),
  }))).json() as Promise<Record<string, unknown>>;

describe("ATS Defense targets the roles the buyer named (S11-074)", () => {
  it("the webhook sends them to the generator and keeps them on the row for the sweep", async () => {
    const id = "cs_live_ats_roles_webhook";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    await event(paid(id, { product_type: "ats_defense", product_name: "ATS Defense Complete", target_roles: "Data Analyst | BI Developer" }));
    expect(atsCall()?.targetRoles, "the webhook dropped the roles").toEqual(["Data Analyst", "BI Developer"]);
    const row = db.rows("product_deliveries").find((r) => r.stripe_session_id === id);
    expect((row?.metadata as Record<string, unknown>)?.target_roles).toBe("Data Analyst | BI Developer");
  });

  it("the retry sweep sends the roles the row kept", async () => {
    db.rows("product_deliveries").push({ id: "pd-ats", stripe_session_id: "cs_live_ats_roles_sweep", product_type: "ats_defense", status: "generation_failed", customer_email: "b@example.com", retry_count: 1, max_retries: 8, metadata: { resume_session_id: RESUME_ID, target_roles: "Product Manager | Product Owner" } });
    db.rpcs.get_failed_deliveries_for_retry = () => ({ data: db.rows("product_deliveries"), error: null });
    await sweeper(new Request("https://harness.supabase.co/functions/v1/retry-failed-deliveries", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }));
    expect(atsCall()?.targetRoles, "the sweep dropped the roles").toEqual(["Product Manager", "Product Owner"]);
  });

  it("the verifier sends them when it makes the report, and answers them to the page", async () => {
    const id = "cs_live_ats_roles_verify";
    world.sessions[id] = paid(id, { product_type: "ats_defense", product_name: "ATS Defense Complete", target_roles: "Nurse | Charge Nurse" });
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    const answer = await ask(id, true);
    expect(atsCall()?.targetRoles, "the verifier dropped the roles").toEqual(["Nurse", "Charge Nurse"]);
    expect(answer.targetRoles).toEqual(["Nurse", "Charge Nurse"]);
  });

  it("a Pro member's included report targets the roles on the grant", async () => {
    db.rows("pro_grants").push({ id: "g-ats-1", email: "pro@example.com", user_id: null, product_id: "atsDefense", product_type: "ats_defense", product_name: "ATS Defense Complete", resume_session_id: RESUME_ID, consumed_at: "2026-10-11T00:00:00Z", target_roles: "Teacher | Tutor" });
    db.rows("used_stripe_sessions").push({ session_id: "pro_g-ats-1", product_type: "ats_defense" });
    const answer = await ask("pro_g-ats-1", true);
    expect(answer.targetRoles, "the grant's roles were not read").toEqual(["Teacher", "Tutor"]);
  });
});

describe("the saved apply kit keeps what the fact check removed (S11-055)", () => {
  it("the webhook's saved copy carries the grounding report", async () => {
    const id = "cs_live_kit_webhook";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    await event(paid(id, { product_type: "apply_assistant", product_name: "Apply Assistant" }));
    const saved = db.rows("purchased_content").find((r) => r.stripe_session_id === id)?.generated_content as Record<string, unknown> | undefined;
    expect(saved?.groundingReport, "the webhook's saved kit dropped the grounding report").toMatchObject({ removedSkills: ["Kubernetes"] });
  });

  it("the verifier's saved copy carries it", async () => {
    const id = "cs_live_kit_verify";
    world.sessions[id] = paid(id, { product_type: "apply_assistant", product_name: "Apply Assistant" });
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    await ask(id, true);
    const saved = db.rows("purchased_content").find((r) => r.stripe_session_id === id)?.generated_content as Record<string, unknown> | undefined;
    expect(saved?.groundingReport, "the verifier's saved kit dropped the grounding report").toMatchObject({ removedSkills: ["Kubernetes"] });
  });

  it("the sweep's saved copy carries it", async () => {
    db.rows("product_deliveries").push({ id: "pd-kit", stripe_session_id: "cs_live_kit_sweep", product_type: "apply_assistant", status: "generation_failed", customer_email: "b@example.com", retry_count: 1, max_retries: 8, metadata: { resume_session_id: RESUME_ID } });
    db.rpcs.get_failed_deliveries_for_retry = () => ({ data: db.rows("product_deliveries"), error: null });
    await sweeper(new Request("https://harness.supabase.co/functions/v1/retry-failed-deliveries", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }));
    const saved = db.rows("purchased_content").find((r) => r.stripe_session_id === "cs_live_kit_sweep")?.generated_content as Record<string, unknown> | undefined;
    expect(saved?.groundingReport, "the sweep's saved kit dropped the grounding report").toMatchObject({ removedSkills: ["Kubernetes"] });
  });
});

describe("a premium package the webhook is still making (S11-054)", () => {
  it("is answered in progress, whatever the page asked, and is not made a second time", async () => {
    const id = "cs_live_premium_in_progress";
    world.sessions[id] = paid(id, { product_type: "premium_package", product_name: "Premium Package" });
    db.rows("used_stripe_sessions").push({ session_id: id, product_type: "premium_package" });
    db.rows("product_deliveries").push({ id: "pd-prem", stripe_session_id: id, product_type: "premium_package", status: "generating", content_generation_started_at: new Date().toISOString() });
    const answer = await ask(id, false);
    expect(answer.inProgress, "the page was not told the webhook is making it").toBe(true);
    expect(fetches.filter((f) => f.url.includes("/functions/v1/generate-"))).toEqual([]);
  });
});

// Review of S11-054: "in progress" is for the products the page shows from the
// saved copy; and a résumé that is bound but unreadable is not one the sweep
// can make the product from.
describe("what the verifier tells the page (review of S11-054)", () => {
  it.each(["interview_coach", "career_path_simulator"])("%s being made elsewhere is not answered in progress: the page's widget makes its own", async (type) => {
    const id = `cs_live_${type}_in_progress`;
    world.sessions[id] = paid(id, { product_type: type, product_name: type });
    db.rows("used_stripe_sessions").push({ session_id: id, product_type: type });
    db.rows("product_deliveries").push({ id: `pd-${type}`, stripe_session_id: id, product_type: type, status: "generating", content_generation_started_at: new Date().toISOString() });
    const answer = await ask(id, false);
    expect(answer.inProgress, "the page was told to wait for a widget").toBe(false);
  });

  it("a bound résumé the verifier could read is answered hasResumeData; one it could not read is not", async () => {
    const failing = "cs_live_premium_bound_read";
    world.sessions[failing] = paid(failing, { product_type: "premium_package", product_name: "Premium Package" });
    db.rows("checkout_resume_refs").push({ stripe_session_id: failing, resume_session_id: RESUME_ID });
    expect((await ask(failing, true)).hasResumeData).toBe(true);

    const gone = "cs_live_premium_bound_gone";
    world.sessions[gone] = paid(gone, { product_type: "premium_package", product_name: "Premium Package" });
    db.rows("checkout_resume_refs").push({ stripe_session_id: gone, resume_session_id: RESUME_ID });
    db.rpcs.get_temp_resume = () => ({ data: [], error: null });
    const answer = await ask(gone, true);
    expect(answer.generatedContent ?? null).toBe(null);
    expect(answer.hasResumeData, "an unreadable résumé was reported as one the sweep can build from").toBe(false);
  });

  it("the verifier's saved-copy products are the success page's SERVER_RENDERED", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { SERVER_RENDERED } = await import("../pages/ProductSuccess");
    const { PRODUCTS } = await import("../config/products");
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/verify-product-purchase/index.ts"), "utf8");
    const generated = [...(/const GENERATED_PRODUCT_TYPES = \[([^\]]*)\]/.exec(src)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const excluded = [...(/const SAVED_COPY_PRODUCT_TYPES = GENERATED_PRODUCT_TYPES\.filter\(\(t\) => ([^;]*)\);/.exec(src)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const savedCopy = generated.filter((t) => !excluded.includes(t)).sort();
    const page = [...SERVER_RENDERED].map((k) => (PRODUCTS as Record<string, { id: string }>)[k].id).sort();
    expect(savedCopy).toEqual(page);
    expect(src).toMatch(/!generatedContent && !isFirstUse && SAVED_COPY_PRODUCT_TYPES\.includes\(productType \?\? ''\)/);
  });
});
