// @vitest-environment node
/**
 * 7: THE RACE, END TO END (critical-path plan 2026-10-12, scenario 3; CP-019
 * and its review note; CP-C items 1-2).
 *
 * Three makers can work one paid order: the webhook (it claims the session
 * and generates in the background), the success page's verifier (it generates
 * when the webhook was late or died) and the retry sweep (it takes a
 * 'generating' row fifteen minutes after it started). Before 20261011144000
 * nothing told them apart: a webhook whose generation outlived the sweep's
 * fifteen minutes still saved its copy and mailed the buyer after the sweep
 * had made and mailed the same order. Now the order is leased: one maker
 * holds it, the others are told "in progress", an expired lease is reclaimed
 * with a new token, and a finish without the row's token is refused.
 *
 * Every shipped handler on the path runs (harness.ts). The product is a
 * legacy one-off letter sold before the 2026-10-12 cuts, because every
 * product the webhook still generates is one of those: its generator is a
 * stand-in the test holds and releases (the race is between the delivery
 * engine's writers, not inside a generator). Per order this asserts generator
 * calls, mails and the final status:
 *
 *   7a the webhook is slow while the page and the sweep arrive: the page is
 *      told in progress, the sweep (sixteen minutes on, the lease still live)
 *      leaves the order alone, the webhook finishes: one generation, one mail;
 *   7b the webhook's lease expired before it finished: the sweep reclaims and
 *      mails; the webhook's late finish is refused and mails nobody: one
 *      mail, delivered, and the row stays the sweep's;
 *   7c a maker that died (an expired lease, no copy saved) is reclaimed by
 *      the page: it makes and mails the order once, and the sweep then finds
 *      it delivered.
 *
 * 7a and 7b fail on the build before the lease (two mails); 7c guards the
 * reclaim.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mailsTo, moneyPath, paidSession, type MoneyPath } from "./harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

let p: MoneyPath;
beforeAll(async () => { p = await moneyPath(); }, 300_000);
beforeEach(async () => { await p.reset(); });
afterAll(async () => { await p?.db.close(); });

const BUYER = "buyer@example.com";
const RESUME = "11111111-2222-4333-8444-555555555555";
const LETTER = /Cover Letter is Ready/;

/** A stand-in letter generator whose FIRST call can be held until the test lets it go. */
function letterGenerator(opts: { holdFirst: boolean }) {
  let calls = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => { release = r; });
  p.standIn("generate-cover-letter", async () => {
    calls++;
    const n = calls;
    if (opts.holdFirst && n === 1) await held;
    return new Response(JSON.stringify({ success: true, data: { coverLetter: `Dear team, this is letter ${n}.` } }),
      { status: 200, headers: { "content-type": "application/json" } });
  });
  return { calls: () => calls, release: () => release() };
}

/** A letter sold before the cuts: the résumé bound at checkout, and the paid session as Stripe reports it. */
async function legacyLetterSale(id: string) {
  await p.db.query("INSERT INTO public.temp_resume_storage (session_id, resume_text, job_description_text) VALUES ($1, $2, $3)", [RESUME, "R".repeat(400), "A posting"]);
  await p.db.query("INSERT INTO public.checkout_resume_refs (stripe_session_id, resume_session_id) VALUES ($1, $2)", [id, RESUME]);
  p.stripe.sessions[id] = paidSession(id, { product_type: "cover_letter", product_name: "Cover Letter", language: "en" }, { amount_total: 1200 });
}

/** Wait (up to two seconds) for a background maker to reach its generator. */
async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

/** The sweep's fifteen minutes pass for an order's generation. */
const ageGeneration = (id: string, minutes: number) =>
  p.db.query("UPDATE public.product_deliveries SET content_generation_started_at = now() - make_interval(mins => $2) WHERE stripe_session_id = $1", [id, minutes]);

/** The maker's lease runs out (a no-op on a base without the lease column). */
async function expireLease(id: string) {
  try { await p.db.query("UPDATE public.product_deliveries SET lease_until = now() - interval '1 minute' WHERE stripe_session_id = $1", [id]); } catch { /* no lease before 20261011144000 */ }
}

describe("7: the race between the webhook, the page and the sweep", () => {
  it("7a: while the webhook holds the order, the page is told in progress and the sweep leaves it alone; one generation, one mail", async () => {
    const id = "cs_live_race7a";
    const gen = letterGenerator({ holdFirst: true });
    await legacyLetterSale(id);

    const ev = await p.event("checkout.session.completed", p.stripe.sessions[id], { settle: false });
    expect(ev.status).toBe(200);
    await until(() => gen.calls() === 1, "the webhook's generator call");
    expect((await p.order(id))?.status).toBe("generating");

    const page = await p.call("verify-product-purchase", { sessionId: id, generateContent: true }, {}, { settle: false });
    expect(page.status).toBe(200);
    expect(page.json.inProgress, "the page made a second copy while the webhook was making one").toBe(true);
    expect(gen.calls()).toBe(1);

    await ageGeneration(id, 16);
    await p.sweep({ settle: false });
    expect(gen.calls(), "the sweep made an order another maker was still making").toBe(1);
    expect(p.mails, "something mailed the buyer before the order was made").toEqual([]);

    gen.release();
    await p.settle();
    expect(mailsTo(p, BUYER, LETTER), "the buyer was mailed twice, or never").toHaveLength(1);
    expect(mailsTo(p, BUYER, LETTER)[0].html).toContain("this is letter 1");
    expect((await p.order(id))?.status).toBe("delivered");
    expect(gen.calls()).toBe(1);
  });

  it("7b: the webhook's lease expired before it finished: the sweep reclaims and mails, and the late finish mails nobody", async () => {
    const id = "cs_live_race7b";
    const gen = letterGenerator({ holdFirst: true });
    await legacyLetterSale(id);

    await p.event("checkout.session.completed", p.stripe.sessions[id], { settle: false });
    await until(() => gen.calls() === 1, "the webhook's generator call");

    await ageGeneration(id, 16);
    await expireLease(id);
    const sweep = await p.sweep({ settle: false }) as { results?: Array<{ status: string; success: boolean }> };
    expect(sweep.results?.[0], "the sweep did not reclaim the dead maker's order").toMatchObject({ status: "delivered", success: true });
    expect(gen.calls()).toBe(2);
    expect(mailsTo(p, BUYER, LETTER)).toHaveLength(1);
    expect(mailsTo(p, BUYER, LETTER)[0].html).toContain("this is letter 2");
    expect((await p.order(id))?.status).toBe("delivered");

    gen.release();
    await p.settle();
    expect(mailsTo(p, BUYER, LETTER), "the maker that lost its lease still mailed the buyer").toHaveLength(1);
    const order = await p.order(id);
    expect(order?.status).toBe("delivered");
    expect(order?.lease_token).toBeNull();
    expect(gen.calls()).toBe(2);
  });

  it("7c: a maker that died is reclaimed by the page, which makes and mails the order once; the sweep then finds it delivered", async () => {
    const id = "cs_live_race7c";
    const gen = letterGenerator({ holdFirst: false });
    await legacyLetterSale(id);
    await p.db.query("INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES ($1, 'cover_letter')", [id]);
    await p.db.query(
      `INSERT INTO public.product_deliveries (stripe_session_id, product_type, product_name, customer_email, status, amount_cents,
         content_generation_started_at, lease_token, lease_until, metadata, created_at)
       VALUES ($1, 'cover_letter', 'Cover Letter', $2, 'generating', 1200, now() - interval '12 minutes', gen_random_uuid(),
         now() - interval '2 minutes', $3::jsonb, now() - interval '13 minutes')`,
      [id, BUYER, JSON.stringify({ resume_session_id: RESUME, language: "en" })]);

    const page = await p.call("verify-product-purchase", { sessionId: id, generateContent: true });
    expect(page.status).toBe(200);
    expect(page.json.inProgress, "the page waited on a maker that died").toBe(false);
    expect(page.json.generatedContent).toMatchObject({ coverLetter: "Dear team, this is letter 1." });
    expect(gen.calls()).toBe(1);
    expect(mailsTo(p, BUYER, LETTER)).toHaveLength(1);
    expect((await p.order(id))?.status).toBe("delivered");

    await p.sweep();
    expect(gen.calls()).toBe(1);
    expect(mailsTo(p, BUYER, LETTER)).toHaveLength(1);
  });
});
