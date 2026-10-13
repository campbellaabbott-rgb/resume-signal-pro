// @vitest-environment node
/**
 * THE RETRY SWEEP AND THE SUCCESS-PAGE VERIFIER, FOR ORDERS NO RETRY CAN MAKE.
 *
 *   S12-061  the spent-order alarm sent the owner to admin-regenerate-delivery
 *            for every product; that tool only makes a Premium Package. It
 *            now names what to do for the product that failed.
 *   S12-054  an Apply Assistant bought with no posting could never be made:
 *            the sweep failed it eight times over a day while the success page
 *            told the buyer to close the tab and wait for a mail. Now the
 *            first sweep spends it, the buyer is asked for the posting once,
 *            the owner is told once, and the verifier says what is missing.
 *   CP-C 4   the same for an order with no résumé, or whose résumé is gone.
 *   S12-104  a refused purchase-link mail (Full Analysis, Freelance Boost)
 *            is resent by the sweep, and only the link.
 *   CP-030   a row stranded after its copy was saved is mailed from that
 *            copy, never generated again.
 *   CP-027   the alarm's door is given back when no sender accepted it.
 *   CP-031   two rows a run, not five.
 *   S12-169  the verifier records a retired product's sale, never makes it.
 *   CP-033   the verifier reads a cs_test_ session with the test key, and
 *            tags a test purchase it claims first.
 *   CP-021   a made order whose mail never left: the sweep mails it from its
 *            saved copy and never makes it again, an order with no address
 *            leaves the schedule; and the verifier mails what IT made even
 *            when another deliverer claimed the session first (it used to
 *            save it and mail nobody), a refused mail due for the sweep now.
 *
 * The shipped handlers, with Stripe, the database and every network call faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const RESUME_ID = "11111111-2222-4333-8444-555555555555";
const env: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_live_harness",
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key",
  SUPABASE_ANON_KEY: "anon_harness",
  RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com",
};

const world = { sessions: {} as Record<string, Record<string, unknown>>, keys: [] as string[] };
const STRIPE_STUB = `
export default class Stripe {
  constructor(key) {
    const w = () => globalThis.__sweepWorld;
    this.checkout = { sessions: { retrieve: async (id) => { w().keys.push(key); const s = w().sessions[id]; if (!s) throw new Error("No such checkout.session"); return s; } } };
  }
}`;

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__sweepClient; export class SupabaseClient {}",
};

let sweeper: EdgeHandler;
let verify: EdgeHandler;
let db: FakeDb;
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const calls: Array<{ fn: string; body: any }> = [];
const ownerMails: Array<{ from: string; to: string[]; subject: string; html: string }> = [];
let productMailStatus = 200;
let ownerStatus: (from: string) => number = () => 200;
let tempResume: { resume_text: string; job_description_text: string | null } | null = { resume_text: "R".repeat(400), job_description_text: "A posting" };
let limitAsked: unknown = null;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.__sweepWorld = world;
  g.__sweepClient = {
    from: (t: string) => {
      const q = db.from(t) as unknown as Record<string, unknown> & { preds: Array<(r: Record<string, unknown>) => boolean> };
      q.not = (col: string) => { q.preds.push((r) => r[col] != null); return q; };
      return q;
    },
    rpc: (n: string, a: Record<string, unknown> = {}) => { rpcCalls.push({ name: n, args: a }); return db.rpc(n, a); },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === "https://api.resend.com/emails") {
      ownerMails.push(body);
      return new Response(JSON.stringify({ id: "re_owner" }), { status: ownerStatus(body.from) });
    }
    const m = /\/functions\/v1\/([a-z-]+)/.exec(url);
    if (m) {
      calls.push({ fn: m[1], body });
      if (m[1] === "send-product-email") return new Response("{}", { status: productMailStatus });
      return new Response(JSON.stringify({ success: true, data: { made: m[1] }, jobMetadata: {}, tailoredResume: {} }), { status: 200 });
    }
    throw new Error(`unexpected network call: ${url}`);
  };
  sweeper = await loadEdgeHandler("retry-failed-deliveries", STUBS);
  verify = await loadEdgeHandler("verify-product-purchase", STUBS);
}, 120_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  rpcCalls.length = 0;
  calls.length = 0;
  ownerMails.length = 0;
  productMailStatus = 200;
  ownerStatus = () => 200;
  tempResume = { resume_text: "R".repeat(400), job_description_text: "A posting" };
  limitAsked = null;
  world.sessions = {};
  world.keys = [];
  delete env.STRIPE_TEST_SECRET_KEY;
  db.rpcs = {
    check_rate_limit: () => ({ data: true, error: null }),
    get_failed_deliveries_for_retry: (a) => {
      limitAsked = a.p_limit;
      return { data: db.rows("product_deliveries").filter((r) => ["payment_received", "generation_failed", "email_failed", "generating"].includes(String(r.status)) && r.next_retry_at !== "infinity" && Number(r.retry_count ?? 0) < Number(r.max_retries ?? 8)).slice(0, Number(a.p_limit)), error: null };
    },
    get_temp_resume: () => ({ data: tempResume ? [tempResume] : [], error: null }),
    get_purchased_content_by_session: (a) => ({ data: db.rows("purchased_content").filter((r) => r.stripe_session_id === a.p_session_id), error: null }),
    save_purchased_content: (a) => { db.rows("purchased_content").push({ stripe_session_id: a.p_stripe_session_id, generated_content: a.p_generated_content }); return { data: "pc", error: null }; },
    update_delivery_retry: (a) => {
      const row = db.rows("product_deliveries").find((r) => r.id === a.p_id);
      if (row) Object.assign(row, { status: a.p_status, last_retry_error: a.p_error, retry_count: Number(row.retry_count ?? 0) + 1, next_retry_at: "later" });
      return { data: true, error: null };
    },
    mail_door_take: (a) => {
      const rows = db.rows("mail_door_counts");
      const hit = rows.find((r) => r.door === a.p_door && r.bucket === a.p_bucket);
      if (hit) { hit.hits = Number(hit.hits) + 1; return { data: Number(hit.hits) <= Number(a.p_max), error: null }; }
      rows.push({ door: a.p_door, bucket: a.p_bucket, hits: 1 });
      return { data: true, error: null };
    },
    log_delivery_step: (a) => {
      let row = db.rows("product_deliveries").find((r) => r.stripe_session_id === a.p_stripe_session_id);
      if (!row) { row = { id: `pd-${a.p_stripe_session_id}`, stripe_session_id: a.p_stripe_session_id, status: a.p_step, retry_count: 0, max_retries: 8 }; db.rows("product_deliveries").push(row); }
      if (a.p_step === "generation_completed") Object.assign(row, { status: a.p_success ? "generated" : "generation_failed", generation_error: a.p_error ?? null });
      else if (a.p_step === "payment_received") Object.assign(row, { status: "payment_received", product_type: (a.p_metadata as Record<string, unknown>)?.product_type, metadata: a.p_metadata });
      else if (a.p_step === "generation_started") Object.assign(row, { status: "generating" });
      else if (a.p_step === "email_sent") Object.assign(row, a.p_success === false ? { status: "email_failed", email_error: a.p_error } : { status: "delivered", email_sent_at: "now" });
      return { data: row.id, error: null };
    },
  };
});

const sweep = async () => (await sweeper(new Request("https://harness.supabase.co/functions/v1/retry-failed-deliveries", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }))).json();
const due = (row: Record<string, unknown>) => db.rows("product_deliveries").push({ retry_count: 0, max_retries: 8, status: "generation_failed", customer_email: "buyer@example.com", product_name: null, metadata: {}, ...row });
const row = (id: string) => db.rows("product_deliveries").find((r) => r.id === id)!;

describe("the spent-order alarm names what to do for THIS product (S12-061)", () => {
  const spendOnce = async (productType: string) => {
    // A Stripe session id is alphanumeric after its prefix (the purchase-link reader's rule).
    due({ id: `pd-${productType}`, stripe_session_id: `cs_live_${productType.replace(/_/g, "")}spent`, product_type: productType, status: "email_failed", retry_count: 7, max_retries: 8 });
    productMailStatus = 500;
    await sweep();
    return ownerMails.find((m) => /ran out of retries/.test(m.subject));
  };

  it("a Full Analysis points to its purchase link, never to the Premium tool or a refund", async () => {
    const mail = await spendOnce("full_analysis");
    expect(mail?.html).toContain("https://resumebooster.work/success?session_id=cs_live_fullanalysisspent");
    expect(mail?.html, "the alarm sent the owner to a tool that makes a Premium Package").not.toContain("admin-regenerate-delivery");
    expect(mail?.html).not.toMatch(/refund/i);
  });

  it("a Freelance Boost points to its intake link", async () => {
    const mail = await spendOnce("freelance_boost");
    expect(mail?.html).toContain("https://resumebooster.work/freelance-boost?session_id=cs_live_freelanceboostspent");
    expect(mail?.html).not.toContain("admin-regenerate-delivery");
  });

  it("only a Premium Package is sent to admin-regenerate-delivery", async () => {
    const mail = await spendOnce("premium_package");
    expect(mail?.html).toContain("admin-regenerate-delivery");
  });

  it("an alarm every sender refuses gives its door back, so the next run sends it (CP-027)", async () => {
    ownerStatus = () => 503;
    await spendOnce("cover_letter");
    expect(ownerMails.map((m) => m.from), "the onboarding sender was not tried").toEqual([
      "Resume Booster Alerts <alerts@resumebooster.work>", "Resume Booster Alerts <onboarding@resend.dev>",
    ]);
    expect(ownerMails[1].to, "Resend's onboarding sender reaches only the account's own address").toEqual(["owner@example.com"]);
    expect(db.rows("mail_door_counts").filter((r) => r.door === "owner-alert:delivery"), "a refused alarm kept its door").toHaveLength(0);
  });
});

describe("what no retry can cure is spent at once, and the buyer is asked for what is missing (S12-054, CP-C item 4)", () => {
  it("an Apply Assistant with no posting: spent on the first sweep, the buyer asked once, the owner told once", async () => {
    tempResume = { resume_text: "R".repeat(400), job_description_text: null };
    due({ id: "pd-aa", stripe_session_id: "cs_live_aa_no_posting", product_type: "apply_assistant", product_name: "Apply Assistant", metadata: { resume_session_id: RESUME_ID, language: "fr" } });
    await sweep();
    const r = row("pd-aa");
    expect(r.max_retries, "the row was left to fail seven more times").toBe(0);
    expect(String(r.generation_error)).toMatch(/^job_posting_required:/);
    expect(calls.filter((c) => c.fn.startsWith("generate-")), "a generator was paid for an order it cannot make").toEqual([]);
    const asked = calls.filter((c) => c.fn === "send-product-email");
    expect(asked.map((c) => c.body)).toEqual([expect.objectContaining({ kind: "needs_input", reason: "job_posting_required", email: "buyer@example.com", language: "fr", sessionId: "cs_live_aa_no_posting" })]);
    const alarm = ownerMails.filter((m) => /ran out of retries/.test(m.subject));
    expect(alarm).toHaveLength(1);
    expect(alarm[0].html).toContain("generate-apply-package");
    expect(alarm[0].html).toContain("they were asked for it");
    // The row is out of the selection now; another run changes nothing.
    await sweep();
    expect(calls.filter((c) => c.fn === "send-product-email")).toHaveLength(1);
  });

  it("no résumé linked, and a résumé that is gone, are each spent once with the buyer asked", async () => {
    due({ id: "pd-none", stripe_session_id: "cs_live_no_resume", product_type: "cover_letter", metadata: {} });
    await sweep();
    expect(String(row("pd-none").generation_error)).toMatch(/^resume_missing:/);
    tempResume = null;
    due({ id: "pd-gone", stripe_session_id: "cs_live_resume_gone", product_type: "cover_letter", metadata: { resume_session_id: RESUME_ID } });
    await sweep();
    expect(String(row("pd-gone").generation_error)).toMatch(/^resume_expired:/);
    expect(calls.filter((c) => c.fn === "send-product-email").map((c) => c.body.reason)).toEqual(["resume_missing", "resume_expired"]);
  });

  it("a buyer mail that was refused gives its door back for the next run", async () => {
    productMailStatus = 502;
    due({ id: "pd-none2", stripe_session_id: "cs_live_no_resume2", product_type: "cover_letter", metadata: {} });
    await sweep();
    expect(calls.filter((c) => c.fn === "send-product-email" && c.body.kind === "needs_input"), "the buyer was never asked").toHaveLength(1);
    expect(db.rows("mail_door_counts").filter((r) => r.door === "buyer-needs-input"), "a refused buyer mail kept its door").toHaveLength(0);
  });
});

describe("the link back to a product made on its own page is resent, and only the link (S12-104)", () => {
  it("a refused Full Analysis link is resent, then waits off the schedule for the buyer's own page", async () => {
    due({ id: "pd-fa", stripe_session_id: "cs_live_fa_link", product_type: "full_analysis", product_name: "Full Resume Analysis", status: "email_failed", metadata: { language: "pt" } });
    await sweep();
    expect(calls.map((c) => [c.fn, c.body.productType, c.body.generatedContent, c.body.language])).toEqual([["send-product-email", "full_analysis", undefined, "pt"]]);
    expect(row("pd-fa")).toMatchObject({ status: "payment_received", next_retry_at: "infinity", email_success: true });
  });

  it("a link that fails again stays email_failed for the next try", async () => {
    productMailStatus = 500;
    due({ id: "pd-fb", stripe_session_id: "cs_live_fb_link", product_type: "freelance_boost", status: "email_failed" });
    await sweep();
    expect(row("pd-fb").status).toBe("email_failed");
    expect(String(row("pd-fb").last_retry_error)).toMatch(/500/);
  });

  it("an order the page delivered meanwhile is not reopened by the resend", async () => {
    due({ id: "pd-fa2", stripe_session_id: "cs_live_fa_link2", product_type: "full_analysis", status: "email_failed" });
    db.rpcs.get_failed_deliveries_for_retry = () => {
      const picked = db.rows("product_deliveries").map((r) => ({ ...r }));
      row("pd-fa2").status = "delivered"; // analyze-resume closes it while the sweep runs
      return { data: picked, error: null };
    };
    await sweep();
    expect(row("pd-fa2").status).toBe("delivered");
  });
});

describe("the sweep's batch and its saved copies", () => {
  it("asks for two rows a run (CP-031)", async () => {
    await sweep();
    expect(limitAsked).toBe(2);
  });

  it("a stranded row whose copy was saved is mailed from that copy, never generated again (CP-030)", async () => {
    due({ id: "pd-saved", stripe_session_id: "cs_live_saved_copy", product_type: "cover_letter", status: "generating", metadata: { resume_session_id: RESUME_ID } });
    db.rows("purchased_content").push({ stripe_session_id: "cs_live_saved_copy", generated_content: { coverLetter: "Dear team" } });
    await sweep();
    expect(calls.filter((c) => c.fn.startsWith("generate-"))).toEqual([]);
    expect(calls.find((c) => c.fn === "send-product-email")?.body.generatedContent).toEqual({ coverLetter: "Dear team" });
    expect(row("pd-saved").status).toBe("delivered");
  });
});

describe("the verifier says what an order needs, and never makes a retired product (S12-054, S12-169)", () => {
  const post = async (body: Record<string, unknown>) => {
    const res = await verify(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.20" }, body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() };
  };
  const paid = (id: string, metadata: Record<string, string>) => ({
    id, payment_status: "paid", mode: "payment", amount_total: 700, currency: "usd", customer_email: null,
    customer_details: { email: "buyer@example.com" }, metadata,
  });

  it("a past Apply Assistant with no posting is answered needsJobPosting, never 'still being made'", async () => {
    const id = "cs_live_legacy_aa";
    tempResume = { resume_text: "R".repeat(400), job_description_text: null };
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    db.rows("used_stripe_sessions").push({ session_id: id, product_type: "apply_assistant" });
    db.rows("product_deliveries").push({ id: "pd-legacy", stripe_session_id: id, product_type: "apply_assistant", status: "generation_failed", retry_count: 1, max_retries: 8, next_retry_at: "2099-01-01T00:00:00Z" });
    world.sessions[id] = paid(id, { product_type: "apply_assistant" });
    const r = await post({ sessionId: id, generateContent: true });
    expect(r.status).toBe(200);
    expect(r.json.needsJobPosting).toBe(true);
    expect(r.json.hasResumeData, "the page would promise the sweep makes it").toBe(false);
    expect(calls.filter((c) => c.fn.startsWith("generate-"))).toEqual([]);
    const pd = row("pd-legacy");
    expect(String(pd.generation_error)).toMatch(/^job_posting_required/);
    expect(pd.next_retry_at, "the sweep would not ask the buyer for a day").not.toBe("2099-01-01T00:00:00Z");
  });

  it("an Apply Assistant paid after the switch, claimed here first, is recorded undeliverable and answered retired", async () => {
    const id = "cs_live_aa_retired_page_first";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    world.sessions[id] = paid(id, { product_type: "apply_assistant" });
    const r = await post({ sessionId: id, generateContent: true });
    expect(r.json.retired).toBe(true);
    expect(r.json.generatedContent).toBeNull();
    expect(calls.filter((c) => c.fn.startsWith("generate-") || c.fn === "send-product-email")).toEqual([]);
    const pd = db.rows("product_deliveries").find((d) => d.stripe_session_id === id);
    expect(pd).toMatchObject({ status: "generation_failed", max_retries: 0 });
    expect(String(pd?.generation_error)).toMatch(/^undeliverable_retired:/);
  });

  it("a past Apply Assistant with its saved copy is still shown (past buyers keep what they bought)", async () => {
    const id = "cs_live_aa_kept";
    db.rows("used_stripe_sessions").push({ session_id: id, product_type: "apply_assistant" });
    db.rows("product_deliveries").push({ id: "pd-kept", stripe_session_id: id, product_type: "apply_assistant", status: "delivered" });
    db.rows("purchased_content").push({ stripe_session_id: id, generated_content: { tailoredResume: { summary: "kept" } } });
    world.sessions[id] = paid(id, { product_type: "apply_assistant" });
    const r = await post({ sessionId: id, generateContent: true });
    expect(r.json.retired).toBeUndefined();
    expect(r.json.generatedContent).toEqual({ tailoredResume: { summary: "kept" } });
  });

  it("a cs_test_ session is read with the test key when one is set, and with the live key otherwise (CP-033)", async () => {
    const id = "cs_test_rehearsal_verify";
    world.sessions[id] = paid(id, { product_type: "scan_pack", credits: "10" });
    env.STRIPE_TEST_SECRET_KEY = "sk_test_rehearsal";
    await post({ sessionId: id });
    expect(world.keys.at(-1)).toBe("sk_test_rehearsal");
    delete env.STRIPE_TEST_SECRET_KEY;
    await post({ sessionId: id });
    expect(world.keys.at(-1)).toBe("sk_live_harness");
    world.sessions.cs_live_x1 = paid("cs_live_x1", { product_type: "scan_pack" });
    env.STRIPE_TEST_SECRET_KEY = "sk_test_rehearsal";
    await post({ sessionId: "cs_live_x1" });
    expect(world.keys.at(-1), "a live session was read with the test key").toBe("sk_live_harness");
  });
});

describe("an order made and never mailed is mailed, by the sweep and by the verifier that made it (CP-021)", () => {
  it("the sweep asks for made-but-unmailed orders and mails one from its saved copy, never making it again", async () => {
    let asked: Record<string, unknown> | null = null;
    db.rpcs.get_failed_deliveries_for_retry = (a) => { asked = a; return { data: db.rows("product_deliveries").filter((r) => r.status === "content_generated"), error: null }; };
    due({ id: "pd-made", stripe_session_id: "cs_live_made_unmailed", product_type: "cover_letter", status: "content_generated", metadata: { resume_session_id: RESUME_ID, language: "de" } });
    db.rows("purchased_content").push({ stripe_session_id: "cs_live_made_unmailed", generated_content: { coverLetter: "Sehr geehrte" } });
    await sweep();
    expect(asked, "the sweep never asked for the made-but-unmailed orders").toMatchObject({ p_include_unmailed: true });
    expect(calls.filter((c) => c.fn.startsWith("generate-")), "a saved order was made again").toEqual([]);
    const mailed = calls.filter((c) => c.fn === "send-product-email");
    expect(mailed.map((c) => [c.body.generatedContent, c.body.language])).toEqual([[{ coverLetter: "Sehr geehrte" }, "de"]]);
    expect(row("pd-made").status).toBe("delivered");
  });

  it("a made order with no address leaves the schedule and nothing is mailed or made", async () => {
    db.rpcs.get_failed_deliveries_for_retry = () => ({ data: db.rows("product_deliveries").filter((r) => r.status === "generated" && r.next_retry_at !== "infinity"), error: null });
    due({ id: "pd-noaddr", stripe_session_id: "cs_live_made_noaddr", product_type: "cover_letter", status: "generated", customer_email: null, metadata: { resume_session_id: RESUME_ID } });
    await sweep();
    expect(calls).toEqual([]);
    expect(row("pd-noaddr")).toMatchObject({ status: "generated", next_retry_at: "infinity" });
  });

  const post = async (body: Record<string, unknown>) => {
    const res = await verify(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.21" }, body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() };
  };
  const paidLetter = (id: string, extra: Record<string, unknown> = {}) => ({
    id, payment_status: "paid", mode: "payment", amount_total: 400, currency: "usd", customer_email: null,
    customer_details: { email: "buyer@example.com" }, metadata: { product_type: "cover_letter", product_name: "Cover Letter" }, ...extra,
  });
  /** The webhook claimed the session and its own try failed: the order waits as generation_failed. */
  const webhookFailed = (id: string) => {
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    db.rows("used_stripe_sessions").push({ session_id: id, product_type: "cover_letter" });
    db.rows("product_deliveries").push({ id: `pd-${id}`, stripe_session_id: id, product_type: "cover_letter", customer_email: "buyer@example.com", status: "generation_failed", retry_count: 1, max_retries: 8, next_retry_at: "2099-01-01T00:00:00Z" });
    world.sessions[id] = paidLetter(id);
  };

  it("the success page makes it after the webhook failed, and mails it once (it used to save it and mail nobody)", async () => {
    const id = "cs_live_page_made_it";
    webhookFailed(id);
    const r = await post({ sessionId: id, generateContent: true });
    expect(r.status).toBe(200);
    expect(r.json.isFirstUse).toBe(false);
    expect(calls.filter((c) => c.fn.startsWith("generate-")).map((c) => c.fn)).toEqual(["generate-cover-letter"]);
    const mailed = calls.filter((c) => c.fn === "send-product-email");
    expect(mailed, "the copy the page made was mailed by nobody").toHaveLength(1);
    expect(mailed[0].body).toMatchObject({ email: "buyer@example.com", productType: "cover_letter", sessionId: id, generatedContent: { made: "generate-cover-letter" } });
    expect(r.json.emailSent).toBe(true);
    expect(row(`pd-${id}`).status).toBe("delivered");

    // Asked again, the page shows the saved copy and mails nothing more.
    calls.length = 0;
    const again = await post({ sessionId: id, generateContent: true });
    expect(again.json.generatedContent).toEqual({ made: "generate-cover-letter" });
    expect(calls, "a second visit made it or mailed it again").toEqual([]);
  });

  it("a refused mail leaves the order email_failed and due for the sweep now, not on an older schedule", async () => {
    const id = "cs_live_page_made_refused";
    webhookFailed(id);
    productMailStatus = 502;
    await post({ sessionId: id, generateContent: true });
    const pd = row(`pd-${id}`);
    expect(pd.status).toBe("email_failed");
    expect(pd.next_retry_at, "the sweep would wait on the old schedule").not.toBe("2099-01-01T00:00:00Z");
    expect(Date.parse(String(pd.next_retry_at))).toBeLessThanOrEqual(Date.now());
  });

  it("a test-mode purchase the page claims first is tagged, so health leaves it out (CP-033)", async () => {
    const id = "cs_test_page_claims_first";
    world.sessions[id] = paidLetter(id, { livemode: false });
    env.STRIPE_TEST_SECRET_KEY = "sk_test_rehearsal";
    await post({ sessionId: id });
    const pd = db.rows("product_deliveries").find((d) => d.stripe_session_id === id);
    expect((pd?.metadata as Record<string, unknown> | undefined)?.livemode).toBe(false);
  });
});
