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
 * AND IT IS NOT OWED FOREVER. A buyer's notice the mail service refuses
 * outright (send-product-email answers 400 or 422: an address it will never
 * take) is given up on that run, and one refused on six runs is given up
 * then. Any other answer is about the run, not the message: a 401 or 403
 * (its service-role check refusing the caller), a 404, a 429 or a 5xx leaves
 * the notice owed (recheck of 2026-11-16: every 4xx used to give it up). The
 * owner is told once, by a mail of its own, that the buyer was not asked.
 * The read takes the orders whose owed notice was tried longest ago first
 * (notice_tried_at), so five stuck orders cannot keep a sixth's alarm unread.
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
const unmakeable = async (id: string, email = BUYER) => {
  await p.db.query(
    `INSERT INTO public.product_deliveries (stripe_session_id, customer_email, product_type, product_name, status, next_retry_at, metadata)
     VALUES ($1, $2, 'cover_letter', 'Cover Letter', 'generation_failed', now() - interval '1 minute', '{}'::jsonb)`,
    [id, email],
  );
};
const unreachable = () => mailsTo(p, OWNER, /could not be told/);
const buyerTries = () => p.routed.filter((f) => f === "send-product-email").length;

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

describe("a buyer's notice that can never be sent", () => {
  it("an address the mail service refuses outright is given up on the spending run, and the owner is told the buyer was not asked", async () => {
    const id = "cs_live_needsinputbadaddr";
    await unmakeable(id, "buyer@nowhere");
    await p.sweep();
    const tried = buyerTries();
    expect(tried, "the buyer's notice was never tried").toBeGreaterThan(0);
    expect(await owed(id), "a notice the mail service will never take is still owed").toBeNull();
    const told = [...alarms(), ...unreachable()];
    expect(told, "the owner was not told").toHaveLength(1);
    expect(told[0].html).toMatch(/was not told what is missing/);
    expect(told[0].html).toContain("buyer@nowhere");
    expect(String((await p.order(id))?.notice_given_up ?? "")).toMatch(/refused/);

    await p.sweep();
    await p.sweep();
    expect(buyerTries(), "a later run tried the refused address again").toBe(tried);
    expect([...alarms(), ...unreachable()]).toHaveLength(1);
  });

  it("refused on six runs, it is given up then, and the owner is told once that the buyer could not be mailed", async () => {
    const id = "cs_live_needsinputsixruns";
    await unmakeable(id);
    p.refuse.when = (m) => m.to.includes(BUYER);
    await p.sweep();
    expect(alarms(), "the spent-order alarm").toHaveLength(1);
    expect(await owed(id)).toBe("buyer");
    for (let run = 2; run <= 5; run++) {
      await p.sweep();
      expect(await owed(id), `run ${run}`).toBe("buyer");
    }
    await p.sweep();
    expect(await owed(id), "a buyer notice refused six times is still owed").toBeNull();
    expect(unreachable(), "the owner never heard the buyer could not be mailed").toHaveLength(1);
    expect(unreachable()[0].html).toMatch(/was not told what is missing/);
    expect(unreachable()[0].html).toContain(BUYER);
    expect(Number((await p.order(id))?.notice_tries)).toBe(6);

    const tried = buyerTries();
    await p.sweep();
    expect(buyerTries(), "a given-up notice was tried again").toBe(tried);
    expect(unreachable()).toHaveLength(1);
    expect(alarms()).toHaveLength(1);
  });

  it("five stuck orders do not keep a sixth's alarm unread: the notice tried longest ago is read first", async () => {
    for (let i = 1; i <= 5; i++) {
      await p.db.query(
        `INSERT INTO public.product_deliveries (stripe_session_id, customer_email, product_type, product_name, status, generation_success, generation_error, last_retry_error, max_retries, next_retry_at, metadata, notice_owed, notice_tries, notice_tried_at)
         VALUES ($1, $2, 'cover_letter', 'Cover Letter', 'generation_failed', false, 'resume_missing: none', 'resume_missing: none', 0, NULL, '{}'::jsonb, 'buyer', 1, now() - interval '1 hour')`,
        [`cs_live_stuckorder00000${i}`, `stuck${i}@example.com`],
      );
    }
    const id = "cs_live_waitingalarm00001";
    await p.db.query(
      `INSERT INTO public.product_deliveries (stripe_session_id, customer_email, product_type, product_name, status, generation_success, generation_error, last_retry_error, retry_count, max_retries, next_retry_at, metadata, notice_owed, notice_tries, notice_tried_at)
       VALUES ($1, $2, 'cover_letter', 'Cover Letter', 'generation_failed', false, 'Generation failed', 'Generation failed', 8, 8, NULL, '{}'::jsonb, 'owner', 0, now() - interval '2 hours')`,
      [id, BUYER],
    );
    p.refuse.when = (m) => m.to.some((t) => /^stuck/.test(t));
    await p.sweep();
    expect(alarms().filter((m) => m.html.includes(id)), "the sixth order's alarm waited behind five stuck orders").toHaveLength(1);
    expect(await owed(id)).toBeNull();
  });
});

describe("an answer about the run, not the message, never gives the buyer's notice up", () => {
  /**
   * send-product-email answering this status to every call, as a rotated
   * service key (401), a caller check that changed (403), a function not
   * deployed (404) or a rate limit (429) would. The sweep calls the global
   * fetch the harness installed, so the answer is given in front of it.
   */
  const answering = (status: number) => {
    const g = globalThis as { fetch: typeof fetch };
    const routerFetch = g.fetch;
    g.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/\/functions\/v1\/send-product-email(?:[?#/]|$)/.test(url)) {
        p.routed.push("send-product-email");
        return new Response(JSON.stringify({ error: `answered ${status} (test)` }), { status });
      }
      return routerFetch(input, init);
    }) as typeof fetch;
    return () => { g.fetch = routerFetch; };
  };

  for (const status of [401, 403, 404, 429]) {
    it(`a ${status} leaves the notice owed, and the run after it asks the buyer once`, async () => {
      const id = `cs_live_needsinputans${status}`;
      await unmakeable(id);
      const restore = answering(status);
      try {
        await p.sweep();
      } finally {
        restore();
      }
      expect(buyerTries(), "the buyer's notice was never tried").toBeGreaterThan(0);
      const order = await p.order(id);
      expect(order?.notice_given_up ?? null, `a ${status} gave the buyer's notice up`).toBeNull();
      expect(order?.notice_owed, `a ${status} left the buyer's notice unowed`).toBe("buyer");
      expect(unreachable(), "the owner was told the buyer could not be mailed").toHaveLength(0);

      await p.sweep();
      const asked = mailsTo(p, BUYER);
      expect(asked, "the owed notice was not sent once send-product-email answered").toHaveLength(1);
      expect(asked[0].html).toContain(id);
      expect(await owed(id)).toBeNull();
      expect(alarms()).toHaveLength(1);
    });
  }

  it("a 422 is a refusal of the message, given up on that run like a 400", async () => {
    const id = "cs_live_needsinputans422";
    await unmakeable(id);
    const restore = answering(422);
    try {
      await p.sweep();
    } finally {
      restore();
    }
    expect(await owed(id)).toBeNull();
    expect(String((await p.order(id))?.notice_given_up ?? "")).toMatch(/refused/);
    const tried = buyerTries();
    await p.sweep();
    expect(buyerTries(), "a later run tried a notice given up on a 422").toBe(tried);
  });
});
