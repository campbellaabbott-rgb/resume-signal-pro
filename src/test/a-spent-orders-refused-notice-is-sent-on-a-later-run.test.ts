// @vitest-environment node
/**
 * A SPENT ORDER'S REFUSED NOTICE IS SENT ON A LATER RUN (RC-S13-110; bug
 * round 2026-11-12).
 *
 * WHAT WAS WRONG. When the retry sweep spends a paid order it mails the owner
 * once ("ran out of retries"), and for an order no retry can cure it asks the
 * buyer once for what is missing. When the mail provider refused either mail,
 * the sweep gave the door back "so the next run tries again" (CP-027), but no
 * later run ever looked: the alarm is sent only by the run that spends the
 * row, and the sweep's selector reads only rows with tries left. A refused
 * alarm about a paid order nobody received was lost.
 *
 * NOW the order carries what is still owed (product_deliveries.notice_owed,
 * 20261112130000: owner, buyer or both). Every run first reads the orders that
 * owe a notice, sends it through the same door, and clears the marker once it
 * is sent; a notice refused again stays owed. Nothing is made again.
 *
 * The money path runs (e2e/money-path/harness.ts): the shipped sweep, the
 * shipped send-product-email, Postgres with the live update_delivery_retry
 * and mail_door_take and this round's migration, and a Resend that refuses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mailsTo, moneyPath, OWNER, type MoneyPath } from "./e2e/money-path/harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

let p: MoneyPath;
beforeAll(async () => { p = await moneyPath(); }, 300_000);
beforeEach(async () => { await p.reset(); });
afterAll(async () => { await p?.db.close(); });

const BUYER = "buyer@example.com";
const alarms = () => mailsTo(p, OWNER, /ran out of retries/);
const owed = async (id: string) => (await p.order(id))?.notice_owed ?? null;

/** A cover letter made and saved, whose mail failed, bought more than a day ago: its next failure spends it. */
const madeButUnmailed = async (id: string) => {
  await p.db.query(
    `INSERT INTO public.product_deliveries (stripe_session_id, customer_email, product_type, product_name, status, created_at, next_retry_at, metadata)
     VALUES ($1, $2, 'cover_letter', 'Cover Letter', 'email_failed', now() - interval '25 hours', now() - interval '1 minute', '{}'::jsonb)`,
    [id, BUYER],
  );
  await p.db.query(
    `INSERT INTO public.purchased_content (stripe_session_id, customer_email, product_type, product_name, generated_content)
     VALUES ($1, $2, 'cover_letter', 'Cover Letter', '{"coverLetter": "Dear hiring manager"}'::jsonb)`,
    [id, BUYER],
  );
};

/** A cover letter with no résumé linked and nothing saved: no retry can make it. */
const unmakeable = async (id: string) => {
  await p.db.query(
    `INSERT INTO public.product_deliveries (stripe_session_id, customer_email, product_type, product_name, status, next_retry_at, metadata)
     VALUES ($1, $2, 'cover_letter', 'Cover Letter', 'generation_failed', now() - interval '1 minute', '{}'::jsonb)`,
    [id, BUYER],
  );
};

describe("the owner's alarm", () => {
  it("refused when the order is spent: owed on the order, sent by the next run, once, and cleared", async () => {
    const id = "cs_live_spentalarmrefused1";
    await madeButUnmailed(id);
    p.refuse.when = () => true;
    await p.sweep();
    const spent = await p.order(id);
    expect(Number(spent?.retry_count)).toBeGreaterThanOrEqual(Number(spent?.max_retries));
    expect(p.refused.filter((m) => m.to.includes(OWNER) && /ran out of retries/.test(m.subject)).length, "the alarm was never tried").toBeGreaterThan(0);
    expect(alarms()).toHaveLength(0);
    expect(await owed(id), "a refused alarm left no trace on the order").toBe("owner");

    // The provider recovers. The order has no tries left, so only the owed notice can bring the alarm.
    p.refuse.when = () => false;
    await p.sweep();
    expect(alarms(), "a refused alarm was never sent again").toHaveLength(1);
    expect(alarms()[0].html).toContain(id);
    expect(alarms()[0].html).toContain(BUYER);
    expect(await owed(id)).toBeNull();

    await p.sweep();
    expect(alarms(), "an alarm already sent was sent again").toHaveLength(1);
    expect(mailsTo(p, BUYER), "the owed notice made or mailed the order again").toHaveLength(0);
  });

  it("refused again: still owed, and sent once the provider takes it", async () => {
    const id = "cs_live_spentalarmtwice01";
    await madeButUnmailed(id);
    p.refuse.when = () => true;
    await p.sweep();
    await p.sweep();
    expect(await owed(id)).toBe("owner");
    expect(alarms()).toHaveLength(0);
    p.refuse.when = () => false;
    await p.sweep();
    expect(alarms()).toHaveLength(1);
    expect(await owed(id)).toBeNull();
  });

  it("an alarm the provider took on the first run owes nothing", async () => {
    const id = "cs_live_spentalarmsent001";
    await madeButUnmailed(id);
    p.refuse.when = (m) => m.to.includes(BUYER);
    await p.sweep();
    expect(alarms()).toHaveLength(1);
    expect(await owed(id)).toBeNull();
    await p.sweep();
    expect(alarms()).toHaveLength(1);
  });
});

describe("the buyer's notice for an order no retry can make", () => {
  it("both refused: both owed; the next run asks the buyer once and tells the owner once that they were asked", async () => {
    const id = "cs_live_needsinputrefuse1";
    await unmakeable(id);
    p.refuse.when = () => true;
    await p.sweep();
    expect(String((await p.order(id))?.generation_error)).toMatch(/^resume_missing:/);
    expect(await owed(id)).toBe("both");

    p.refuse.when = () => false;
    await p.sweep();
    const asked = mailsTo(p, BUYER);
    expect(asked, "the buyer was never asked for what is missing").toHaveLength(1);
    expect(asked[0].html).toContain(id);
    expect(alarms()).toHaveLength(1);
    expect(alarms()[0].html).toMatch(/they were asked for it/);
    expect(await owed(id)).toBeNull();
    expect(p.modelCalls()).toBe(0);

    await p.sweep();
    expect(mailsTo(p, BUYER)).toHaveLength(1);
    expect(alarms()).toHaveLength(1);
  });

  it("only the buyer's refused: only the buyer's owed, and the owner is not told twice", async () => {
    const id = "cs_live_needsinputbuyer1";
    await unmakeable(id);
    p.refuse.when = (m) => m.to.includes(BUYER);
    await p.sweep();
    expect(alarms()).toHaveLength(1);
    expect(await owed(id)).toBe("buyer");
    p.refuse.when = () => false;
    await p.sweep();
    expect(mailsTo(p, BUYER)).toHaveLength(1);
    expect(alarms()).toHaveLength(1);
    expect(await owed(id)).toBeNull();
  });
});
