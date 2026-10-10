// deploy-stamp: 2026-10-09T13:00Z
// THE 14-DAY WITHDRAWAL FROM A PLAN, FOR EU AND UK BUYERS (owner decision 3,
// 2026-10-08; rules in _shared/withdrawal.ts).
//
// OFF UNLESS EU_UK_SALES IS "on", and it stays off until the owner has
// registered for VAT: until then every call answers 404 and nothing reaches
// Stripe.
//
// With it on, for the signed-in account (the verified token, never a body
// address), every plan that names this account (metadata.user_id) and began
// in the last 14 days:
//   1. each paid invoice is refunded but for the share of its period already
//      provided (the buyer asked for the service to start inside the period);
//   2. the plan is cancelled at once;
//   3. the withdrawal is acknowledged by mail, once (subscription_notices,
//      kind 'withdrawal', 20261009133000).
// A payment already refunded for a withdrawal is not refunded again (read
// from Stripe before each refund, and the refund and the cancel carry
// idempotency keys); a plan already cancelled is no longer eligible. A
// plan on the address that names no account is not touched: the answer says
// to write to support. A full refund also reaches stripe-webhook's
// charge.refunded, which revokes what the payment bought.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { AGENT_PRODUCT_NAME, isAgentPriced, subscriptionBuyer } from "../_shared/agent.ts";
import { listAll } from "../_shared/stripe-paging.ts";
import { bearerOf } from "../_shared/service-caller.ts";
import { euUkSalesOn } from "../_shared/checkout-policy.ts";
import { NOTICE_FROM, NOTICE_SENDER_DOMAIN, noticeKey, withdrawalMail } from "../_shared/subscription-notice.ts";
import { withdrawalRefundCents, withinWithdrawalPeriod } from "../_shared/withdrawal.ts";

const FN_BUILD = "withdraw-subscription.2026-10-09.1";
const PRO_PRODUCT_NAME = "Resume Booster Pro";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Statuses a withdrawal can still stop: anything Stripe may charge. */
const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

const refId = (v: unknown): string | null =>
  typeof v === "string" && v ? v : (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const env = (k: string) => Deno.env.get(k);
  if (!euUkSalesOn(env)) return json({ error: "not_available" }, 404);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const admin = createClient(env("SUPABASE_URL") ?? "", env("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const token = bearerOf(req.headers) ?? "";
    const { data: userData } = token && token !== (env("SUPABASE_ANON_KEY") ?? "")
      ? await admin.auth.getUser(token).catch(() => ({ data: null }))
      : { data: null };
    const user = (userData as { user?: { id?: string; email?: string | null } | null } | null)?.user ?? null;
    const email = String(user?.email ?? "").trim().toLowerCase();
    if (!user?.id || !email.includes("@")) return json({ error: "Sign in to withdraw from a plan.", signInRequired: true }, 401);

    const stripeKey = env("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Withdrawal is unavailable right now. Nothing was changed." }, 503);
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    const nowSec = Math.floor(Date.now() / 1000);
    const customers = await listAll<Stripe.Customer>((after) => stripe.customers.list({ email, limit: 100, ...(after ? { starting_after: after } : {}) }));
    const live: Stripe.Subscription[] = [];
    for (const c of customers) {
      const subs = await listAll<Stripe.Subscription>((after) => stripe.subscriptions.list({ customer: c.id, status: "all", limit: 100, ...(after ? { starting_after: after } : {}) }));
      live.push(...subs.filter((s) => LIVE.has(s.status)));
    }
    const uid = user.id.toLowerCase();
    const eligible = live.filter((s) => subscriptionBuyer(s) === uid && withinWithdrawalPeriod(Number(s.start_date ?? s.created), nowSec));
    const unlinked = live.some((s) => !subscriptionBuyer(s) && withinWithdrawalPeriod(Number(s.start_date ?? s.created), nowSec));
    if (!eligible.length) {
      return json({ withdrawn: [], reason: unlinked ? "plan_not_linked" : "none_eligible" });
    }

    const withdrawn: Array<{ subscription: string; refunded: number; currency: string }> = [];
    for (const s of eligible) {
      // 1. Refund each paid invoice but for the days already provided.
      let refunded = 0;
      let currency = s.currency ?? "usd";
      const invoices = await listAll<Stripe.Invoice>((after) => stripe.invoices.list({ subscription: s.id, status: "paid", limit: 100, ...(after ? { starting_after: after } : {}) }));
      for (const inv of invoices) {
        const line = inv.lines?.data?.[0] as { period?: { start?: number; end?: number } } | undefined;
        const amount = withdrawalRefundCents(inv.amount_paid ?? 0, Number(line?.period?.start ?? inv.period_start), Number(line?.period?.end ?? inv.period_end), nowSec);
        if (amount <= 0) continue;
        const payments = await stripe.invoicePayments.list({ invoice: inv.id, status: "paid", limit: 1 });
        const intent = refId((payments.data?.[0]?.payment as { payment_intent?: unknown } | undefined)?.payment_intent);
        if (!intent) throw new Error(`invoice ${inv.id} has no paid payment intent`);
        // A retry after a refund that went through (and a cancel that did
        // not) finds that refund here and adds none: the amount shrinks by
        // the hour, so an idempotency key alone could not catch it.
        const earlier = await stripe.refunds.list({ payment_intent: intent, limit: 100 });
        const done = (earlier.data ?? []).find((r) => r.metadata?.withdrawal === "14_day" && r.status !== "failed" && r.status !== "canceled");
        if (done) {
          refunded += done.amount ?? 0;
        } else {
          await stripe.refunds.create(
            { payment_intent: intent, amount, reason: "requested_by_customer", metadata: { withdrawal: "14_day", subscription: s.id } },
            { idempotencyKey: `withdrawal-refund:${s.id}:${inv.id}:${amount}` },
          );
          refunded += amount;
        }
        currency = inv.currency ?? currency;
      }
      // 2. Cancel at once: no further charge.
      await stripe.subscriptions.cancel(
        s.id,
        { cancellation_details: { comment: "EU/UK 14-day withdrawal" } },
        { idempotencyKey: `withdrawal-cancel:${s.id}` },
      );
      withdrawn.push({ subscription: s.id, refunded, currency });

      // 3. The acknowledgement, once (a claim first, as the other notices).
      const { error: claimError } = await admin.from("subscription_notices").insert({ subscription_id: s.id, kind: "withdrawal", email });
      if (!claimError) {
        const mail = withdrawalMail({
          planName: isAgentPriced(s.items?.data as ReadonlyArray<{ price?: unknown }> | undefined) ? AGENT_PRODUCT_NAME : PRO_PRODUCT_NAME,
          withdrawnAt: new Date(nowSec * 1000).toISOString(),
          refund: refunded > 0 ? { amount: refunded, currency } : null,
          accountUrl: "https://resumebooster.work/account",
        });
        const { error: enqueueError } = await admin.rpc("enqueue_email_delayed", {
          queue_name: "transactional_emails",
          payload: {
            message_id: crypto.randomUUID(),
            idempotency_key: noticeKey(s.id, "withdrawal"),
            to: email,
            from: NOTICE_FROM,
            sender_domain: NOTICE_SENDER_DOMAIN,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            purpose: "transactional",
            label: "subscription-withdrawal",
            queued_at: new Date().toISOString(),
          },
          delay_seconds: 0,
        });
        if (enqueueError) {
          await admin.from("subscription_notices").delete().eq("subscription_id", s.id).eq("kind", "withdrawal");
          console.error("[WITHDRAW-SUBSCRIPTION] acknowledgement not queued:", enqueueError.message?.slice(0, 160));
        }
      } else if (claimError.code !== "23505") {
        console.error("[WITHDRAW-SUBSCRIPTION] acknowledgement not claimed:", claimError.message?.slice(0, 160));
      }
    }

    console.log(`[WITHDRAW-SUBSCRIPTION] ${withdrawn.length} plan(s) withdrawn for ${uid}`);
    return json({ withdrawn });
  } catch (e) {
    console.error("[WITHDRAW-SUBSCRIPTION] Error:", e instanceof Error ? e.message : String(e));
    return json({ error: "We could not complete the withdrawal. Please try again in a minute." }, 503);
  }
});
