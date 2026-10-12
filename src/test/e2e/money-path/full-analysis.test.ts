// @vitest-environment node
/**
 * SCENARIO 1: THE $5 FULL ANALYSIS, BOUGHT BY A GUEST, END TO END.
 *
 * The one product a stranger can buy without an account, and the one the
 * owner keeps on sale. It has never been observed delivering end to end.
 * Here it is bought for real against every shipped handler on its path
 * (harness.ts): the signed Stripe event, the webhook's claim and its
 * purchase-link mail rendered by send-product-email, the buyer's page
 * running analyze-resume against the model, the analysis mail, the refund.
 *
 * Per order, the assertions are the plan's: model calls, mails, status.
 *
 *   1a  bought and delivered: one claim, one link mail (recorded on the row),
 *       one model call, one analysis mail, 'delivered'; a refund makes it
 *       'refunded', the page then answers 402, and a late failure write never
 *       reopens it (20261011140000);
 *   1b  Resend refuses the link mail: the order records email_failed, and once
 *       its next try is due the sweep resends the link (only the link), and
 *       the order goes back to waiting for the buyer's page (S12-104);
 *   1c  paid by a delayed method: nothing is claimed while it is unpaid, and
 *       async_payment_succeeded claims it and mails the link (CP-029).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mailsTo, moneyPath, OWNER, paidSession, type MoneyPath } from "./harness";
import { RESUME } from "../../helpers/analyze-resume-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

let p: MoneyPath;
beforeAll(async () => { p = await moneyPath(); }, 300_000);
beforeEach(async () => { await p.reset(); });
afterAll(async () => { await p?.db.close(); });

const BUYER = "buyer@example.com";
const fullAnalysis = (id: string, over: Record<string, unknown> = {}) =>
  paidSession(id, { product_type: "full_analysis", product_name: "Full Resume Analysis", originalCurrency: "usd", baseAmountUSD: "5" }, over);
const linkMails = () => mailsTo(p, BUYER, /Full Resume Analysis: open your purchase/);
const analysisMails = () => p.mails.filter((m) => m.to.includes(BUYER) && !/open your purchase/.test(m.subject));

describe("1a: a guest buys the Full Analysis, receives it, and a refund takes it back", () => {
  it("one claim, one recorded link mail, one model call, one analysis mail, delivered; then refunded, refused and never reopened", async () => {
    const id = "cs_live_fullanalysisguest01";
    p.stripe.sessions[id] = fullAnalysis(id);

    // Stripe tells us it was paid.
    expect((await p.event("checkout.session.completed", p.stripe.sessions[id])).status).toBe(200);
    const claims = (await p.db.query<{ product_type: string }>("SELECT product_type FROM public.used_stripe_sessions WHERE session_id = $1", [id])).rows;
    expect(claims.map((c) => c.product_type)).toEqual(["full_analysis"]);
    expect(linkMails(), "the buyer who closed the tab has no way back").toHaveLength(1);
    expect(linkMails()[0].html).toContain(`https://resumebooster.work/success?session_id=${id}`);
    let order = await p.order(id);
    expect(order).toMatchObject({ status: "payment_received", email_success: true });
    expect(order?.email_sent_at, "the link mail was sent and the order does not know it").toBeTruthy();
    expect(p.modelCalls(), "the webhook paid for a model call it has nothing to make").toBe(0);

    // The buyer's page runs the analysis it paid for.
    const page = await p.call("analyze-resume", { resumeText: RESUME, sessionId: id });
    expect(page.status, JSON.stringify(page.json).slice(0, 200)).toBe(200);
    expect(page.json.optimizedBullets).toBeTruthy();
    expect(p.modelCalls()).toBe(1);
    expect(analysisMails(), "no mail carried the finished analysis").toHaveLength(1);
    order = await p.order(id);
    expect(order?.status).toBe("delivered");

    // Asking again returns the same analysis, with no second model call or mail.
    const again = await p.call("analyze-resume", { resumeText: RESUME, sessionId: id });
    expect(again.status).toBe(200);
    expect(again.json.shareId).toBe(page.json.shareId);
    expect(p.modelCalls()).toBe(1);
    expect(linkMails()).toHaveLength(1);

    // The owner refunds it in Stripe (decision 2026-10-12: by hand only).
    p.stripe.charges.ch_fa1 = { id: "ch_fa1", amount: 500, amount_refunded: 500, refunded: true, currency: "usd", payment_intent: p.stripe.sessions[id].payment_intent };
    expect((await p.event("charge.refunded", p.stripe.charges.ch_fa1)).status).toBe(200);
    order = await p.order(id);
    expect(order?.status).toBe("refunded");
    expect(mailsTo(p, OWNER, /Refund issued/)).toHaveLength(1);
    expect((await p.call("analyze-resume", { resumeText: RESUME, sessionId: id })).status).toBe(402);

    // A late failure write from any writer never reopens it (20261011140000).
    await p.client.rpc("update_delivery_retry", { p_id: order!.id, p_status: "email_failed", p_error: "send-product-email answered 502", p_increment_retry: true });
    await p.client.from("product_deliveries").update({ status: "delivered" }).eq("id", order!.id);
    order = await p.order(id);
    expect(order?.status, "a refunded order was put back in play").toBe("refunded");
    expect(order?.next_retry_text).toBe("infinity");
    expect((await p.sweep()).count ?? 0, "the sweep picked up a refunded order").toBe(0);
    expect(p.modelCalls()).toBe(1);
  });
});

describe("1b: Resend refuses the purchase link", () => {
  it("the order records it, the sweep resends only the link once it is due, and the order waits for the buyer's page again", async () => {
    const id = "cs_live_fullanalysislink01";
    p.stripe.sessions[id] = fullAnalysis(id, { metadata: { product_type: "full_analysis", product_name: "Full Resume Analysis", language: "pt" } });
    p.refuse.when = (m) => m.to.includes(BUYER);
    await p.event("checkout.session.completed", p.stripe.sessions[id]);
    expect(p.refused).toHaveLength(1);
    let order = await p.order(id);
    expect(order?.status, "a refused link mail left no trace on the order").toBe("email_failed");
    expect(String(order?.last_retry_error)).toMatch(/send-product-email answered 500/);

    // Resend recovers; the next try comes due; the sweep runs.
    p.refuse.when = () => false;
    await p.sweep();
    expect(linkMails().length + mailsTo(p, BUYER, /abra sua compra/).length, "the sweep resent before the try was due").toBe(0);
    await p.dueNow(id);
    await p.sweep();
    const resent = mailsTo(p, BUYER, /abra sua compra/);
    expect(resent, "the link was never resent").toHaveLength(1);
    expect(resent[0].html).toContain(`https://resumebooster.work/success?session_id=${id}`);
    expect(p.modelCalls(), "the sweep made something for a product made on its own page").toBe(0);
    order = await p.order(id);
    expect(order).toMatchObject({ status: "payment_received", email_success: true });
    expect(order?.next_retry_text).toBe("infinity");

    // The buyer comes back through the link and the order is delivered.
    expect((await p.call("analyze-resume", { resumeText: RESUME, sessionId: id })).status).toBe(200);
    expect((await p.order(id))?.status).toBe("delivered");
  });
});

describe("1c: a delayed payment method", () => {
  it("nothing is claimed while it is unpaid; async_payment_succeeded claims it and mails the link once", async () => {
    const id = "cs_live_fullanalysisdelay1";
    p.stripe.sessions[id] = fullAnalysis(id, { payment_status: "unpaid" });
    await p.event("checkout.session.completed", p.stripe.sessions[id]);
    expect((await p.db.query("SELECT 1 FROM public.used_stripe_sessions WHERE session_id = $1", [id])).rows).toHaveLength(0);
    expect(linkMails()).toHaveLength(0);
    p.stripe.sessions[id] = fullAnalysis(id);
    expect((await p.event("checkout.session.async_payment_succeeded", p.stripe.sessions[id])).status).toBe(200);
    expect(linkMails(), "a delayed payment that landed was never claimed or mailed").toHaveLength(1);
    expect((await p.order(id))?.status).toBe("payment_received");
    expect((await p.call("analyze-resume", { resumeText: RESUME, sessionId: id })).status).toBe(200);
    expect((await p.order(id))?.status).toBe("delivered");
  });
});
