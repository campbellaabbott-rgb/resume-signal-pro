// @vitest-environment node
/**
 * A FULL ANALYSIS MAIL THE PROVIDER REFUSED IS RESENT, NOT REPORTED SENT
 * (S14X-220; bug round 2026-11-12).
 *
 * WHAT WAS WRONG. analyze-resume handed the finished analysis's mail to the
 * background (EdgeRuntime.waitUntil), answered emailSent: true whenever the
 * order had an address, before any mail was tried, and had already closed the
 * order 'delivered'. A mail the provider refused was logged and forgotten:
 * the page said "has been emailed to you", the order said delivered, and no
 * sweep would ever look at it again (a delivered order moves only to
 * refunded, 20261011140000).
 *
 * NOW the mail is sent before the order is closed, and waited for (8 s at
 * most). Sent: the order is 'delivered' with its mail recorded, and the page
 * hears emailSent: true. Refused: the page hears emailSent: false (and says
 * nothing about a mail), the order is 'email_failed' with a try due in 15
 * minutes, and the retry sweep resends the finished analysis through
 * send-analysis-email from its stored copy, never the purchase link and
 * never a new model call, and closes the order 'delivered'.
 *
 * The money path runs end to end (e2e/money-path/harness.ts): the signed
 * webhook, analyze-resume against the model, send-analysis-email rendering
 * through a Resend that can refuse, the retry sweep, and Postgres with the
 * rule that keeps a closed order closed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { moneyPath, paidSession, type MoneyPath } from "./e2e/money-path/harness";
import { RESUME } from "./helpers/analyze-resume-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

let p: MoneyPath;
beforeAll(async () => { p = await moneyPath(); }, 300_000);
beforeEach(async () => { await p.reset(); });
afterAll(async () => { await p?.db.close(); });

const BUYER = "buyer@example.com";
const fullAnalysis = (id: string) =>
  paidSession(id, { product_type: "full_analysis", product_name: "Full Resume Analysis", originalCurrency: "usd", baseAmountUSD: "5" });
const isLinkMail = (subject: string) => /open your purchase/.test(subject);
const analysisMails = () => p.mails.filter((m) => m.to.includes(BUYER) && !isLinkMail(m.subject));
const linkMails = () => p.mails.filter((m) => m.to.includes(BUYER) && isLinkMail(m.subject));

const bought = async (id: string) => {
  p.stripe.sessions[id] = fullAnalysis(id);
  expect((await p.event("checkout.session.completed", p.stripe.sessions[id])).status).toBe(200);
  expect(linkMails()).toHaveLength(1);
};

describe("the analysis mail is sent before the order is closed", () => {
  it("a mail the provider accepted: emailSent true, the order delivered with its mail recorded", async () => {
    const id = "cs_live_fullanalysismailok1";
    await bought(id);
    const page = await p.call("analyze-resume", { resumeText: RESUME, sessionId: id });
    expect(page.status).toBe(200);
    expect(page.json.emailSent).toBe(true);
    expect(analysisMails()).toHaveLength(1);
    const order = await p.order(id);
    expect(order).toMatchObject({ status: "delivered", email_success: true });
    expect(order?.email_sent_at, "the analysis mail went and the order does not know it").toBeTruthy();
  });

  it("a mail the provider refused: emailSent false, the order email_failed and due again in 15 minutes", async () => {
    const id = "cs_live_fullanalysismailno1";
    await bought(id);
    p.refuse.when = (m) => m.to.includes(BUYER) && !isLinkMail(m.subject);
    const page = await p.call("analyze-resume", { resumeText: RESUME, sessionId: id });
    expect(page.status).toBe(200);
    expect(page.json.emailSent, "the page was told a refused mail was sent").toBe(false);
    expect(p.refused).toHaveLength(1);
    const order = await p.order(id);
    expect(order?.status, "a refused analysis mail closed the order as delivered, where no sweep looks again").toBe("email_failed");
    expect(order?.email_success).toBe(false);
    const due = Date.parse(String(order?.next_retry_text));
    expect(due - Date.now()).toBeGreaterThan(10 * 60_000);
    expect(due - Date.now()).toBeLessThan(20 * 60_000);
    expect(Number(order?.retry_count)).toBeLessThan(Number(order?.max_retries));
  });
});

describe("the sweep resends the finished analysis, from its stored copy", () => {
  it("not before it is due; then one analysis mail, no link mail, no model call, and the order delivered", async () => {
    const id = "cs_live_fullanalysisresend1";
    await bought(id);
    p.refuse.when = (m) => m.to.includes(BUYER) && !isLinkMail(m.subject);
    const page = await p.call("analyze-resume", { resumeText: RESUME, sessionId: id });
    expect(page.json.emailSent).toBe(false);
    p.refuse.when = () => false;

    await p.sweep();
    expect(analysisMails(), "the sweep resent before the try was due").toHaveLength(0);

    await p.dueNow(id);
    p.routed.length = 0;
    await p.sweep();
    expect(p.routed, "the sweep did not resend through send-analysis-email").toContain("send-analysis-email");
    const resent = analysisMails();
    expect(resent, "the finished analysis was never resent").toHaveLength(1);
    // send-analysis-email links the buyer's purchase when it can read the
    // redemption behind the share id, and the share link otherwise; either
    // way, this order's own analysis.
    const ownLinks = [`https://resumebooster.work/success?session_id=${id}`, `https://resumebooster.work/success?share=${page.json.shareId}`];
    expect(ownLinks.some((l) => resent[0].html.includes(l)), "the resent mail does not link this order's analysis").toBe(true);
    expect(linkMails(), "the sweep sent the purchase link for an analysis that exists").toHaveLength(1);
    expect(p.modelCalls(), "the sweep paid for a second analysis").toBe(1);
    const order = await p.order(id);
    expect(order).toMatchObject({ status: "delivered", email_success: true });
    expect(order?.email_sent_at).toBeTruthy();

    // Delivered is closed: another sweep sends nothing.
    await p.sweep();
    expect(analysisMails()).toHaveLength(1);
  });

  it("refused again: the order keeps its place on the schedule with the failure counted", async () => {
    const id = "cs_live_fullanalysisagain1";
    await bought(id);
    p.refuse.when = (m) => m.to.includes(BUYER) && !isLinkMail(m.subject);
    await p.call("analyze-resume", { resumeText: RESUME, sessionId: id });
    const tries = (o: Record<string, unknown> | null | undefined) => Number(o?.retry_count ?? 0) + Number(o?.transient_failures ?? 0);
    const before = tries(await p.order(id));
    await p.dueNow(id);
    await p.sweep();
    const order = await p.order(id);
    expect(order?.status).toBe("email_failed");
    // A provider's 5xx is an outage (delivery_error_is_transient): counted, not a try spent.
    expect(tries(order), "the refused resend was not counted against the order").toBe(before + 1);
    expect(order?.next_retry_text).not.toBe("infinity");
    expect(analysisMails()).toHaveLength(0);
    expect(linkMails()).toHaveLength(1);
  });

  it("an analysis its buyer deleted before the resend: nothing is mailed and the order closes delivered", async () => {
    const id = "cs_live_fullanalysisgone01";
    await bought(id);
    p.refuse.when = (m) => m.to.includes(BUYER) && !isLinkMail(m.subject);
    const page = await p.call("analyze-resume", { resumeText: RESUME, sessionId: id });
    p.refuse.when = () => false;
    await p.db.query("DELETE FROM public.resume_analyses WHERE share_id = $1", [page.json.shareId]);
    await p.dueNow(id);
    await p.sweep();
    expect(analysisMails()).toHaveLength(0);
    expect(linkMails()).toHaveLength(1);
    const order = await p.order(id);
    expect(order?.status).toBe("delivered");
    expect(String(order?.last_retry_error)).toMatch(/no longer stored/);
  });
});
