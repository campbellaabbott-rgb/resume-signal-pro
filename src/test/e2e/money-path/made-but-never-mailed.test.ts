// @vitest-environment node
/**
 * 6: A PAID ORDER THAT WAS MADE AND NEVER MAILED, END TO END (CP-021).
 *
 * An order is made in one step and mailed in the next. The webhook and the
 * sweep save the copy and write 'content_generated'; the success page saves
 * it and writes 'generated'; then each calls send-product-email. An isolate
 * that died between the two left a made, paid order whose mail never left,
 * and nothing ever looked at it again: the retry selector never picked those
 * two statuses and the delivery health count never counted them, so the
 * heartbeat read a buyer who paid and heard nothing as a clean day.
 *
 * Every shipped handler on the path runs (harness.ts); per order this asserts
 * model calls, mails, the final status and what product_delivery_health (the
 * heartbeat's reader) counts as stuck:
 *
 *   6a a 'content_generated' order with no mail, made 20 minutes ago: counted
 *      stuck, mailed from its saved copy once by the sweep, never made again,
 *      delivered, and no longer counted;
 *   6b the same for a 'generated' order the success page made;
 *   6c one made 5 minutes ago is left alone: its writer may still be mailing;
 *   6d one with no address on the order is taken off the schedule and not
 *      counted (the buyer saw it on the page; there is nobody to mail);
 *   6e the owner's test-mode rehearsal (metadata.livemode false) is never
 *      counted as a stuck sale.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mailsTo, moneyPath, type MoneyPath } from "./harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

let p: MoneyPath;
beforeAll(async () => { p = await moneyPath(); }, 300_000);
beforeEach(async () => { await p.reset(); });
afterAll(async () => { await p?.db.close(); });

const BUYER = "buyer@example.com";

/** A past order as a writer left it: paid three hours ago, its copy saved, made `madeAgo` ago, never mailed. */
async function madeNeverMailed(id: string, status: "generated" | "content_generated", madeAgo: string, email: string | null = BUYER) {
  await p.db.query("INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES ($1, 'cover_letter')", [id]);
  await p.client.rpc("save_purchased_content", {
    p_stripe_session_id: id, p_customer_email: email ?? "", p_product_type: "cover_letter", p_product_name: "Cover Letter",
    p_generated_content: { coverLetter: `Dear team, the saved letter for ${id}.` },
  });
  await p.db.query(
    `INSERT INTO public.product_deliveries (stripe_session_id, product_type, product_name, customer_email, status, generation_success,
       content_generation_started_at, content_generation_completed_at, metadata, created_at)
     VALUES ($1, 'cover_letter', 'Cover Letter', $2, $3, true, now() - $4::interval - interval '1 minute', now() - $4::interval,
       '{"language":"en"}'::jsonb, now() - interval '3 hours')`,
    [id, email, status, madeAgo]);
}

describe("6: a paid order made and never mailed", () => {
  it("6a: a content_generated order is counted stuck, mailed from its copy once, never made again, and delivered", async () => {
    const id = "cs_live_madenevermailed6a";
    await madeNeverMailed(id, "content_generated", "20 minutes");
    expect(await p.stuck(), "a paid order whose mail never left read as a clean day").toBe(1);

    await p.sweep();
    await p.sweep();
    expect(p.modelCalls(), "the sweep paid to make a saved order again").toBe(0);
    const mails = mailsTo(p, BUYER, /Cover Letter is Ready/);
    expect(mails, "the made order was never mailed, or was mailed twice").toHaveLength(1);
    expect(mails[0].html).toContain(`the saved letter for ${id}`);
    const order = await p.order(id);
    expect(order).toMatchObject({ status: "delivered", email_success: true });
    expect(order?.email_sent_at).toBeTruthy();
    expect(await p.stuck()).toBe(0);
  });

  it("6b: a 'generated' order the success page made is mailed from its copy once", async () => {
    const id = "cs_live_madenevermailed6b";
    await madeNeverMailed(id, "generated", "20 minutes");
    expect(await p.stuck()).toBe(1);
    await p.sweep();
    await p.sweep();
    expect(p.modelCalls()).toBe(0);
    expect(mailsTo(p, BUYER, /Cover Letter is Ready/)).toHaveLength(1);
    expect((await p.order(id))?.status).toBe("delivered");
  });

  it("6c: an order made 5 minutes ago is left to the writer that may still be mailing it", async () => {
    const id = "cs_live_madenevermailed6c";
    await madeNeverMailed(id, "content_generated", "5 minutes");
    await p.sweep();
    expect(p.mails, "the sweep raced a writer still mailing it").toEqual([]);
    expect((await p.order(id))?.status).toBe("content_generated");
  });

  it("6d: one with no address is taken off the schedule and not counted, and nothing is mailed", async () => {
    const id = "cs_live_madenevermailed6d";
    await madeNeverMailed(id, "generated", "20 minutes", null);
    await p.sweep();
    expect(p.mails).toEqual([]);
    expect(p.modelCalls()).toBe(0);
    const order = await p.order(id);
    expect(order?.status).toBe("generated");
    expect(order?.next_retry_text).toBe("infinity");
    expect(await p.stuck(), "an order nobody can mail was counted as owed a mail").toBe(0);
    await p.sweep();
    expect(p.mails).toEqual([]);
  });

  it("6e: the owner's test-mode rehearsal is never counted as a stuck sale", async () => {
    await p.db.query(
      `INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status, metadata, created_at)
       VALUES ('cs_test_rehearsalorder6e', 'full_analysis', $1, 'payment_received', '{"livemode": false}'::jsonb, now() - interval '3 hours')`,
      [BUYER]);
    expect(await p.stuck(), "a test purchase counted as a buyer owed an order").toBe(0);
  });
});
