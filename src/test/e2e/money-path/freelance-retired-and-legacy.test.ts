// @vitest-environment node
/**
 * THE REST OF THE MONEY PATH AFTER THE 2026-10-12 CUTS, END TO END.
 *
 * What is still sold besides the Full Analysis is Freelance Boost (made on
 * its intake page) and Pro; what was sold before keeps its saved copies for
 * 90 days; what wave 4 retired must take no money it cannot deliver. Each
 * scenario runs every shipped handler on its path (harness.ts) and asserts
 * model calls, mails and status per order:
 *
 *   2  a Freelance Boost sale: one purchase-link mail, in the language the
 *      checkout recorded, recorded on the order, no model call (S12-114,
 *      S12-104);
 *   3  an Apply Assistant paid after it stopped being sold: nothing made,
 *      nothing mailed to the buyer as delivered, the order undeliverable, the
 *      owner told once, however often Stripe redelivers; the success page
 *      answers retired (S12-169);
 *   4  a past Apply Assistant with no job posting: the first sweep spends it,
 *      the buyer is asked for the posting once, the owner is told once, no
 *      model call; the success page says the posting is needed (S12-054);
 *   5  a past order whose copy was saved before its isolate died is mailed
 *      from that copy by the sweep, once, never made again (CP-030), and a
 *      delivered order is never made or mailed again (20261011140000).
 *
 * The cut products' checkouts answering 410 are create-product-checkout's
 * (the checkout-catalogue group); their scenarios are added at integration.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mailsTo, moneyPath, OWNER, paidSession, type MoneyPath } from "./harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

let p: MoneyPath;
beforeAll(async () => { p = await moneyPath(); }, 300_000);
beforeEach(async () => { await p.reset(); });
afterAll(async () => { await p?.db.close(); });

const BUYER = "buyer@example.com";

/** A résumé (and posting) stored and bound to a checkout, as the checkouts do. */
async function bindResume(sessionId: string, jobDescription: string | null) {
  const { rows } = await p.db.query<{ session_id: string }>(
    "INSERT INTO public.temp_resume_storage (resume_text, job_description_text) VALUES ($1, $2) RETURNING session_id::text",
    ["Jane Doe. Senior software engineer. ".repeat(20), jobDescription]);
  await p.db.query("INSERT INTO public.checkout_resume_refs (stripe_session_id, resume_session_id) VALUES ($1, $2::uuid)", [sessionId, rows[0].session_id]);
  return rows[0].session_id;
}

describe("2: a Freelance Boost sale", () => {
  it("one purchase-link mail in the buyer's language, recorded on the order, and nothing made", async () => {
    const id = "cs_live_freelanceboostde01";
    p.stripe.sessions[id] = paidSession(id, { product_type: "freelance_boost", product_name: "Freelance Boost", language: "de" }, { amount_total: 2900 });
    expect((await p.event("checkout.session.completed", p.stripe.sessions[id])).status).toBe(200);
    const mails = mailsTo(p, BUYER);
    expect(mails.map((m) => m.subject), "the buyer's link was English, or missing").toEqual(["💼 Freelance Boost: Kauf öffnen"]);
    expect(mails[0].html).toContain(`https://resumebooster.work/freelance-boost?session_id=${id}`);
    expect(p.modelCalls()).toBe(0);
    const order = await p.order(id);
    expect(order).toMatchObject({ status: "payment_received", email_success: true });
    expect(order?.next_retry_text).toBe("infinity");
  });
});

describe("3: an Apply Assistant paid after it stopped being sold", () => {
  it("nothing made, the order undeliverable, the owner told once, the page answered retired", async () => {
    const id = "cs_live_applyassistretired1";
    await bindResume(id, "Senior engineer posting");
    p.stripe.sessions[id] = paidSession(id, { product_type: "apply_assistant", product_name: "Apply Assistant" }, { amount_total: 700 });
    for (let i = 0; i < 2; i++) expect((await p.event("checkout.session.completed", p.stripe.sessions[id])).status).toBe(200);
    expect(p.modelCalls(), "a retired product was made").toBe(0);
    expect(p.routed.filter((fn) => fn.startsWith("generate-"))).toEqual([]);
    expect(mailsTo(p, BUYER), "the buyer was mailed a product that does not exist").toEqual([]);
    const order = await p.order(id);
    expect(order).toMatchObject({ status: "generation_failed", max_retries: 0 });
    expect(String(order?.generation_error)).toMatch(/^undeliverable_retired:/);
    expect(mailsTo(p, OWNER, /retired product/i), "the owner heard nothing, or heard twice").toHaveLength(1);
    expect(mailsTo(p, OWNER, /retired product/i)[0].from).toContain("@resumebooster.work");
    // The sweep leaves it alone.
    await p.sweep();
    expect(p.modelCalls()).toBe(0);
    // The success page says so instead of "still being made".
    const page = await p.call("verify-product-purchase", { sessionId: id, generateContent: true });
    expect(page.status).toBe(200);
    expect(page.json).toMatchObject({ retired: true, generatedContent: null });
  });
});

describe("4: a past Apply Assistant bought with no job posting", () => {
  it("the first sweep spends it, the buyer is asked once, the owner told once, no model call; the page says the posting is needed", async () => {
    const id = "cs_live_applyassistlegacy1";
    const resumeId = await bindResume(id, null);
    p.stripe.sessions[id] = paidSession(id, { product_type: "apply_assistant", product_name: "Apply Assistant" }, { amount_total: 700 });
    // As the webhook left it before wave 4: claimed, failed once, due now.
    await p.db.query("INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES ($1, 'apply_assistant')", [id]);
    await p.db.query(
      `INSERT INTO public.product_deliveries (stripe_session_id, product_type, product_name, customer_email, status, retry_count, next_retry_at, metadata, created_at)
       VALUES ($1, 'apply_assistant', 'Apply Assistant', $2, 'generation_failed', 1, now() - interval '1 minute', $3::jsonb, now() - interval '30 minutes')`,
      [id, BUYER, JSON.stringify({ resume_session_id: resumeId, language: "en" })]);

    const page = await p.call("verify-product-purchase", { sessionId: id, generateContent: true });
    expect(page.json.needsJobPosting, "the page was told the sweep would make it").toBe(true);
    expect(page.json.hasResumeData).toBe(false);

    await p.sweep();
    await p.sweep();
    const order = await p.order(id);
    expect(order?.max_retries, "the order was left to fail all day").toBe(0);
    expect(String(order?.generation_error)).toMatch(/^job_posting_required:/);
    expect(p.modelCalls()).toBe(0);
    const asked = mailsTo(p, BUYER, /we need one more thing from you/);
    expect(asked, "the buyer was never asked for the posting, or was asked twice").toHaveLength(1);
    expect(asked[0].html).toContain("Reply to this email with the job posting");
    const alarm = mailsTo(p, OWNER, /ran out of retries/);
    expect(alarm).toHaveLength(1);
    expect(alarm[0].html).toContain("generate-apply-package");
    expect(alarm[0].html, "the alarm sent the owner to the Premium tool").not.toContain("admin-regenerate-delivery");
  });
});

describe("5: what was saved is mailed once, and what was delivered is closed", () => {
  it("a stranded order with a saved copy is mailed from it once by the sweep, and never made again", async () => {
    const id = "cs_live_savedcopystranded1";
    const resumeId = await bindResume(id, "A posting");
    p.stripe.sessions[id] = paidSession(id, { product_type: "cover_letter", product_name: "Cover Letter" }, { amount_total: 400 });
    await p.db.query("INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES ($1, 'cover_letter')", [id]);
    await p.client.rpc("save_purchased_content", {
      p_stripe_session_id: id, p_customer_email: BUYER, p_product_type: "cover_letter", p_product_name: "Cover Letter",
      p_generated_content: { coverLetter: "Dear team, the saved letter." },
    });
    await p.db.query(
      `INSERT INTO public.product_deliveries (stripe_session_id, product_type, product_name, customer_email, status, content_generation_started_at, metadata, created_at)
       VALUES ($1, 'cover_letter', 'Cover Letter', $2, 'generating', now() - interval '20 minutes', $3::jsonb, now() - interval '25 minutes')`,
      [id, BUYER, JSON.stringify({ resume_session_id: resumeId })]);
    await p.sweep();
    await p.sweep();
    expect(p.modelCalls(), "the sweep paid to make it again").toBe(0);
    const mails = mailsTo(p, BUYER, /Cover Letter is Ready/);
    expect(mails).toHaveLength(1);
    expect(mails[0].html).toContain("the saved letter");
    expect((await p.order(id))?.status).toBe("delivered");

    // Closed stays closed: a late writer cannot put it back in play.
    const order = await p.order(id);
    await p.client.rpc("update_delivery_retry", { p_id: order!.id, p_status: "generation_failed", p_error: "late", p_increment_retry: true });
    await p.sweep();
    expect((await p.order(id))?.status).toBe("delivered");
    expect(mailsTo(p, BUYER, /Cover Letter is Ready/), "a delivered order was mailed again").toHaveLength(1);
  });
});
