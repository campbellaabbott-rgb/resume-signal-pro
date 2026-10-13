// force-deploy: 2026-07-30T22:29:25Z
// deploy-stamp: 2026-10-10T15:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
// Price identity for the $99 apply agent, and the entitlement writer.
// Static import: the dynamic one inside the handler typechecked as `any`,
// which is how a rename would have reached production silently.
import { AGENT_PRICE_CENTS, AGENT_PRODUCT_NAME, checkAgentByEmail, isAgentPriced, subscriptionBuyer } from "../_shared/agent.ts";
// The six-hour pass: identified by product_type ONLY (Freelance Boost bills
// the same amount), granted through one idempotent RPC with every number
// copied in from this module — never spelled here, never matched on.
import {
  PASS_APPLICATIONS,
  PASS_PRICE_CENTS,
  PASS_PRODUCT_TYPE,
  PASS_QUOTA_PER_DAY,
  PASS_RATE_PER_MIN,
  PASS_SESSION_HOURS,
  PASS_SHELF_LIFE_DAYS,
} from "../_shared/pass.ts";
// One settlement rule for every one-time product: 'paid', or a $0 payment-mode
// session a 100%-off code completed (the owner's comps and e2e runs).
import { checkoutSessionSettled } from "../_shared/pass-settlement.ts";
// The Pro cache, written when a Pro payment lands and on every subscription
// change -- nothing wrote it before, so a new subscriber read as inactive.
import { checkProByEmail, PRO_PRODUCT_NAME } from "../_shared/pro.ts";
// The mail a new subscriber is owed: terms, cancellation, the trial's end.
import { noticeMail, sendLegalNotice, WITHDRAWAL_CANCEL_COMMENT, WITHDRAWAL_DAYS, type NoticeFacts, type NoticeKind } from "../_shared/subscription-notice.ts";
import { CUSTOMER_REPLY_TO } from "../_shared/customer-mail.ts";
import { euUkSalesOn } from "../_shared/checkout-policy.ts";
import { inWithdrawalTerritory } from "../_shared/withdrawal.ts";
// Who paid, as Stripe recorded it: customer_details first (anonymous buyers).
import { buyerEmailOf } from "../_shared/buyer-email.ts";
// The full analysis is delivered by analyze-resume on the success page; the
// webhook only has to recognise it, by the same constant analyze-resume gates on.
import { FULL_ANALYSIS_PRODUCT_TYPE } from "../_shared/full-analysis.ts";
// What of an event is stored: never the résumé text old sessions carry.
import { withoutResumeText } from "../_shared/webhook-payload.ts";
// Which résumé a product is delivered from: kept on our side, never in Stripe.
import { resumeSessionForCheckout } from "../_shared/checkout-resume-ref.ts";
// The roles an ATS Defense buyer named at checkout (S11-074).
import { targetRolesOf } from "../_shared/target-roles.ts";
// What wave 4 retired (2026-10-11): the Agent plan, the Agent Pass and the $7
// Apply Assistant. Read here so a session opened before the switch and paid
// after it is recorded and told, never granted or generated (S12-169), and a
// plan sold before it is never renewed for a dead product (S12-079).
import { AGENT_PRODUCTS_ON_SALE, APPLY_AGENT_ON, APPLY_ASSISTANT_ON_SALE } from "../_shared/apply-agent-switch.ts";
// One way out for a mail to a buyer, with its log row (R1's transport).
import { sendMail } from "../_shared/send-mail.ts";

// Provable from outside without a purchase or a signature: every response,
// the 405 a GET receives included, carries this in x-fn-build.
const FN_BUILD = "stripe-webhook.2026-10-11.22";
const BUILD_HEADER = { "x-fn-build": FN_BUILD };

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

// OPTIMIZATION: Module-level singletons for reuse across warm invocations
let stripeInstance: Stripe | null = null;
let testStripeInstance: Stripe | null = null;
// deno-lint-ignore no-explicit-any
let supabaseInstance: SupabaseClient<any, any, any> | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2025-12-15.clover" });
  }
  return stripeInstance;
}

/**
 * THE TEST-MODE CLIENT, for an event signed with STRIPE_TEST_WEBHOOK_SECRET
 * (critical-path CP-033: the owner's test-mode rehearsal before a live
 * purchase). Only a key that is really a test key is used; without one a
 * test event is acknowledged and nothing is delivered.
 */
function getTestStripe(): Stripe | null {
  const key = Deno.env.get("STRIPE_TEST_SECRET_KEY") ?? "";
  if (!key.startsWith("sk_test_")) return null;
  if (!testStripeInstance) testStripeInstance = new Stripe(key, { apiVersion: "2025-12-15.clover" });
  return testStripeInstance;
}

/**
 * THE OWNER'S ALERTS LEAVE FROM OUR OWN DOMAIN, AND A REFUSAL IS READ
 * (critical-path CP-027). They went out from Resend's test sender, and the
 * SDK answers a refusal as {error} rather than throwing, so a refused alert
 * was logged as nothing at all. Our verified domain first; Resend's onboarding
 * sender to ADMIN_EMAIL (the only address it can reach) when that is refused.
 */
const OWNER_ALERT_SENDERS = [
  "Resume Booster Alerts <alerts@resumebooster.work>",
  "Resume Booster Alerts <onboarding@resend.dev>",
];
async function sendOwnerMail(subject: string, html: string): Promise<{ ok: boolean; error: string | null }> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("ADMIN_EMAIL") || Deno.env.get("OWNER_NOTIFY_EMAIL") || "resumeboostersupp@gmail.com";
  if (!resendKey) {
    console.error(`[STRIPE-WEBHOOK] owner alert not sent (RESEND_API_KEY is not set): ${subject.slice(0, 120)}`);
    return { ok: false, error: "RESEND_API_KEY is not set" };
  }
  const resend = new Resend(resendKey);
  let last = "no sender tried";
  for (const from of OWNER_ALERT_SENDERS) {
    try {
      const sent = await resend.emails.send({ from, to: [to], subject, html }) as { error?: { message?: string } | null } | undefined;
      if (!sent?.error) return { ok: true, error: null };
      last = `${from}: ${sent.error.message ?? "refused"}`;
    } catch (e) {
      last = `${from}: ${String(e).slice(0, 200)}`;
    }
  }
  console.error(`[STRIPE-WEBHOOK] owner alert refused by every sender (${last}): ${subject.slice(0, 120)}`);
  return { ok: false, error: last };
}

/** Stripe's copy of something a buyer typed is printed as text, never markup. */
const escapeText = (v: unknown) =>
  String(v ?? "N/A").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]!));

/**
 * ONE OWNER ALERT PER THING, AND ONLY ONCE IT LEFT. The door (mail_door_take,
 * 30 days) is taken before the send so two deliveries of one event cannot both
 * mail, and given back when no sender accepted it, so the next delivery
 * tries again. Never throws.
 */
// deno-lint-ignore no-explicit-any
async function ownerAlertOnce(supabase: SupabaseClient<any, any, any>, door: string, bucket: string, subject: string, html: string): Promise<boolean> {
  const slot = bucket.slice(0, 64);
  try {
    const { data: first, error } = await supabase.rpc("mail_door_take", {
      p_door: door, p_bucket: slot, p_max: 1, p_window_minutes: 43200,
    });
    if (error || first !== true) return false;
    const sent = await sendOwnerMail(subject, html);
    if (!sent.ok) await supabase.from("mail_door_counts").delete().eq("door", door).eq("bucket", slot);
    return sent.ok;
  } catch (e) {
    console.error("[STRIPE-WEBHOOK] owner alert failed:", String(e).slice(0, 200));
    return false;
  }
}

// deno-lint-ignore no-explicit-any
function getSupabase(): SupabaseClient<any, any, any> {
  if (!supabaseInstance) {
    supabaseInstance = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
  }
  return supabaseInstance;
}

// Send email alert for payment failures (non-blocking)
function sendFailureAlertBackground(details: {
  type: string;
  amount: number;
  currency: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  customerEmail?: string | null;
  paymentIntentId: string;
  /** Subject line lead; a refund is not a failed payment. */
  subjectLead?: string;
}) {
  EdgeRuntime.waitUntil((async () => {
    const formattedAmount = (details.amount / 100).toFixed(2);
    // Every value below is Stripe's copy of something a buyer typed (a billing
    // address, a decline message), so it is printed as text, never markup.
    const esc = (v: string | null | undefined) => escapeText(v);
    await sendOwnerMail(
      `⚠️ ${details.subjectLead ?? "Payment Failed"} - $${formattedAmount} ${details.currency.toUpperCase()}`,
      `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #dc2626;">${esc(details.subjectLead ?? "Payment Failure")} Alert</h2>
            <p><strong>${esc(details.type)}</strong></p>
            <p>Amount: $${formattedAmount} ${esc(details.currency.toUpperCase())}</p>
            <p>Customer: ${esc(details.customerEmail || null)}</p>
            <p>Code: ${esc(details.failureCode || null)}</p>
            <p>Message: ${esc(details.failureMessage || null)}</p>
            <a href="https://dashboard.stripe.com/payments/${encodeURIComponent(details.paymentIntentId)}">View in Stripe</a>
          </div>
        `,
    );
  })());
}

/**
 * A CUSTOMER DELETED IN STRIPE (the owner's fraud tool) ENDS ITS PLANS HERE
 * TOO (S12-100). Both caches keep stripe_customer_id, so every row of that
 * customer is lapsed: status canceled, no period left. The id itself is kept
 * (a later lookup still knows whose row it was). Manual grants carry no
 * customer id and are never touched. Never throws.
 */
async function lapseDeletedCustomer(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  customerId: string,
): Promise<{ pro: number; agent: number }> {
  const out = { pro: 0, agent: 0 };
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) return out;
  const lapsed = { status: "canceled", current_period_end: null, updated_at: new Date().toISOString() };
  for (const [table, key] of [["pro_subscribers", "pro"], ["agent_subscribers", "agent"]] as const) {
    try {
      const { data, error } = await supabase.from(table).update(lapsed).eq("stripe_customer_id", customerId).select("email");
      if (error) logStep("Could not lapse a deleted customer's rows", { table, error: error.message });
      else out[key] = Array.isArray(data) ? data.length : 0;
    } catch (e) {
      logStep("Could not lapse a deleted customer's rows", { table, error: String(e).slice(0, 200) });
    }
  }
  return out;
}

/**
 * WHY A RETIRED PRODUCT'S SALE CANNOT BE DELIVERED, or null when it can.
 * The switches are wave 4's (apply-agent-switch.ts): while they are off, a
 * checkout opened before the switch and paid after it (Stripe keeps a session
 * open for 24 hours) is recorded as undeliverable_retired and the owner is
 * told, instead of a pass being granted, a plan seeded or an Apply Assistant
 * generated and marked delivered (S12-169). No refund is made by code
 * (owner decision 2026-10-12: all sales are final); the owner settles it.
 */
function retiredReasonOf(productType: string | null | undefined, session: { mode?: string | null; amount_total?: number | null }): string | null {
  if (productType === "apply_assistant" && !APPLY_ASSISTANT_ON_SALE) {
    return "the Apply Assistant is no longer sold; nothing was generated";
  }
  if (productType === PASS_PRODUCT_TYPE && !AGENT_PRODUCTS_ON_SALE) {
    return "the Agent Pass is no longer sold and the apply agent is switched off; no pass was granted";
  }
  if (isRetiredAgentPlan(productType, session)) {
    return "the Apply Agent plan is no longer sold and the agent is switched off; the plan was set to end at its period end without renewing";
  }
  return null;
}

/** The owner hears once per session that a retired product was paid for. */
async function alertRetiredSale(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  session: Stripe.Checkout.Session,
  productType: string | null | undefined,
  customerEmail: string | null,
  reason: string,
): Promise<void> {
  await ownerAlertOnce(
    supabase, "owner-alert:retired-sale", session.id,
    `Paid for a retired product: ${String(productType ?? "unknown").slice(0, 40)} (${session.id.slice(0, 24)})`,
    `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111">
      <p>A checkout for a product wave 4 retired was paid after it stopped being sold (a session stays open for 24 hours).</p>
      <p>Product: <b>${escapeText(productType)}</b><br>Buyer: ${escapeText(customerEmail ?? "(no address)")}<br>Amount: ${escapeText(((session.amount_total ?? 0) / 100).toFixed(2))} ${escapeText((session.currency ?? "usd").toUpperCase())}<br>Checkout session: ${escapeText(session.id)}</p>
      <p>${escapeText(reason)}. Nothing was refunded. Settle it by hand${productType === "apply_assistant" ? " (an Apply Assistant can be made with generate-apply-package)" : ""}.</p>
    </div>`,
  );
}

/** The $99 Agent plan's checkout, while it is not sold. */
function isRetiredAgentPlan(productType: string | null | undefined, session: { mode?: string | null; amount_total?: number | null }): boolean {
  if (AGENT_PRODUCTS_ON_SALE || session.mode !== "subscription") return false;
  return productType === "apply_agent" || (session.amount_total ?? 0) === AGENT_PRICE_CENTS;
}

const RETIRED_NOTICE_FROM = "Resume Booster <billing@resumebooster.work>";

/**
 * A RETIRED AGENT PLAN ENDS AT ITS PERIOD END, AND ITS SUBSCRIBER IS TOLD SO
 * (S12-079). While the Agent plan is not sold and the agent is off, a trial
 * would convert into a $99 charge for a product that does nothing, and the
 * trial reminder used to announce that charge. Instead:
 *   - a trialing or active plan is set to cancel at its period end (a trial
 *     then ends without any charge; a paid month runs out and never renews);
 *   - the subscriber gets one plain notice of that, never the charge reminder;
 *   - the owner is told once per plan, with what Stripe says (a past_due plan
 *     is left to the owner: wave 4 README step 4).
 * Idempotent: the update triggers customer.subscription.updated, which finds
 * the plan already ending and the doors already taken. A Stripe update that
 * fails throws, so the handler answers 500 and Stripe redelivers.
 */
async function retireAgentPlan(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  sub: Stripe.Subscription,
  email: string | null,
  eventType: string,
): Promise<"ended" | "already_ending" | "owner_decides" | "closed"> {
  if (sub.status === "canceled" || sub.status === "incomplete_expired") return "closed";
  const periodEndSec = Number(
    (sub as unknown as { current_period_end?: number }).current_period_end
      ?? (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end
      ?? sub.trial_end ?? 0,
  );
  const endsOn = periodEndSec > 0 ? new Date(periodEndSec * 1000).toISOString().slice(0, 10) : null;
  const trialing = sub.status === "trialing";
  let outcome: "ended" | "already_ending" | "owner_decides" = "owner_decides";
  if (sub.status === "trialing" || sub.status === "active") {
    if (sub.cancel_at_period_end || sub.cancel_at) {
      outcome = "already_ending";
    } else {
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      outcome = "ended";
    }
  }
  logStep("Retired agent plan", { sub: sub.id, status: sub.status, outcome, eventType });

  if (outcome !== "owner_decides" && email) {
    const slot = sub.id.slice(0, 64);
    const { data: first } = await supabase.rpc("mail_door_take", {
      p_door: "agent-retired-notice", p_bucket: slot, p_max: 1, p_window_minutes: 43200,
    });
    if (first === true) {
      const when = endsOn ? ` on ${endsOn}` : " at the end of the current period";
      const lead = trialing
        ? `Your free trial ends${when}, and it will not turn into a paid plan: you will not be charged.`
        : `Your current month runs until${endsOn ? ` ${endsOn}` : " the end of the period"}, and the plan will not renew: you will not be charged again.`;
      const text = [
        "The Resume Booster Apply Agent is no longer sold, and the agent that prepared applications is switched off.",
        lead,
        "You can still apply yourself, free: connect Claude or ChatGPT at https://resumebooster.work/agents. Your AI reads the posting and drafts open answers from your CV; you check everything and press submit.",
        "Questions? Reply to this email.",
      ].join("\n\n");
      const html = text.split("\n\n").map((p) => `<p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111">${escapeText(p)}</p>`).join("");
      const sent = await sendMail({
        cls: "transactional", kind: "agent-plan-retired", to: email, from: RETIRED_NOTICE_FROM,
        subject: "Your Apply Agent plan ends without a charge", html, text,
        replyTo: CUSTOMER_REPLY_TO, idempotencyKey: `agent-retired:${sub.id}`,
      }, { admin: supabase });
      if (!sent.ok && !sent.suppressed) {
        await supabase.from("mail_door_counts").delete().eq("door", "agent-retired-notice").eq("bucket", slot);
        throw new Error(`retired-plan notice not sent (${sent.status}): ${sent.error ?? "refused"}`);
      }
    }
  }

  await ownerAlertOnce(
    supabase, "owner-alert:agent-retired", sub.id,
    `Retired Apply Agent plan ${outcome === "owner_decides" ? "needs your decision" : "set to end"}: ${sub.id}`,
    `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111">
      <p>A $99 Apply Agent plan is still live in Stripe while the agent is retired (wave 4).</p>
      <p>Subscription: ${escapeText(sub.id)}<br>Status: ${escapeText(sub.status)}<br>Subscriber: ${escapeText(email ?? "(no address)")}<br>Period ends: ${escapeText(endsOn ?? "unknown")}</p>
      <p>${outcome === "owner_decides"
        ? "It is not trialing or active (for example past_due), so nothing was changed: decide it in Stripe (wave 4 README, owner step 4)."
        : "It was set to cancel at its period end, so it will not renew, and the subscriber was told. Nothing was refunded; anything already paid is yours to settle."}</p>
    </div>`,
  );
  return outcome;
}

/**
 * Re-read Stripe and rewrite the agent entitlement cache for one customer.
 *
 * Shared by the four lifecycle events that can change entitlement (see the
 * cases at the bottom of the switch). Resolving an email is the whole job: a
 * subscription event carries only a customer reference, and an invoice's
 * `customer_email` can be null, so both fall back to retrieving the customer.
 *
 * DELIBERATELY NON-FATAL, exactly like the seeding path at checkout: throwing
 * here would 500 the webhook and make Stripe retry a delivery that already
 * succeeded, and the /account page still repairs the row on next load. This
 * removes the dependence on that visit; it is not the only route.
 */
async function refreshAgentEntitlement(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  knownEmail: string | null,
  customerRef: string | { id?: string } | null,
  eventType: string,
): Promise<void> {
  try {
    let email = knownEmail ?? "";
    if (!email) {
      const customerId = typeof customerRef === "string" ? customerRef : customerRef?.id;
      if (!customerId) {
        logStep("Agent entitlement refresh skipped (no customer on event)", { eventType });
        return;
      }
      const customer = await stripe.customers.retrieve(customerId);
      // A deleted customer comes back as { deleted: true } with no email, so
      // there is no address to re-read Stripe for. Its cached rows used to be
      // left as they were, and an active row kept the agent sending until the
      // cached period ended (S12-100): they are lapsed by the customer id
      // instead, the one thing the event still names.
      if ((customer as { deleted?: boolean }).deleted) {
        const lapsed = await lapseDeletedCustomer(supabase, customerId);
        logStep("Agent entitlement lapsed (customer deleted)", { eventType, customerId, ...lapsed });
        return;
      }
      email = (customer as Stripe.Customer).email ?? "";
    }
    if (!email) {
      logStep("Agent entitlement refresh skipped (customer has no email)", { eventType });
      return;
    }
    const refreshed = await checkAgentByEmail(stripe, supabase, email);
    logStep("Agent entitlement refreshed", {
      eventType, email, active: refreshed.active, status: refreshed.status,
      currentPeriodEnd: refreshed.currentPeriodEnd,
    });
  } catch (err) {
    logStep("Agent entitlement refresh failed (Account page will repair)", {
      eventType, error: String(err),
    });
  }
}

/**
 * Re-read Stripe and rewrite the PRO cache (pro_subscribers) for one address.
 *
 * NOTHING WROTE THIS TABLE ON PAYMENT OR RENEWAL (platform sweep L6-28,
 * register 1.20). The only writers were check-subscription and the checkout's
 * own pre-check, which cached a first-time buyer as inactive minutes before
 * they paid; create-product-checkout reads the table to decide whether a tool
 * is included, so a new $45 subscriber was charged for included tools until a
 * page view happened to refresh it. Now the checkout completion and every
 * subscription lifecycle event refresh it, whatever the plan's price (the
 * Pro check counts every live subscription, the agent's included, which is
 * what check-subscription has always answered).
 *
 * Non-fatal for the same reason as the agent refresh above.
 */
async function refreshProEntitlement(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  knownEmail: string | null,
  customerRef: string | { id?: string } | null,
  eventType: string,
): Promise<void> {
  try {
    let email = knownEmail ?? "";
    if (!email) {
      const customerId = typeof customerRef === "string" ? customerRef : customerRef?.id;
      if (!customerId) return;
      const customer = await stripe.customers.retrieve(customerId);
      if ((customer as { deleted?: boolean }).deleted) {
        // No address left to re-read: lapse the cached rows by customer id (S12-100).
        const lapsed = await lapseDeletedCustomer(supabase, customerId);
        logStep("Pro entitlement lapsed (customer deleted)", { eventType, customerId, ...lapsed });
        return;
      }
      email = (customer as Stripe.Customer).email ?? "";
    }
    if (!email) return;
    const refreshed = await checkProByEmail(stripe, supabase, email);
    logStep("Pro entitlement refreshed", { eventType, active: refreshed.active, status: refreshed.status });
  } catch (err) {
    logStep("Pro entitlement refresh failed (check-subscription will repair)", { eventType, error: String(err) });
  }
}

/**
 * What a delivery row starts as, by product, so the sweeper and the delivery
 * monitor only ever see rows something can still deliver (platform sweep
 * L6-27, register 2.16).
 *
 *   - Subscriptions are entitlements: the subscription IS the delivery, and
 *     the row is written delivered. A $45 Pro session used to fall through to
 *     "No resume session ID" and be stamped generation_failed by the sweeper,
 *     a guaranteed false failure on every sale.
 *   - The full analysis (analyze-resume, on the success page) and the two
 *     Freelance Boost tiers (generate-freelance-boost, against an intake the
 *     buyer completes after paying) are delivered elsewhere, and their
 *     deliverer closes the row; nothing the sweeper can do helps them, so the
 *     row is never scheduled (next_retry_at infinity). Not max_retries 0,
 *     which product_delivery_health would count as an exhausted failure even
 *     after the row is closed. Left open past two hours it still reads as a
 *     stuck delivery there -- the signal a human should see.
 *   - Scan products record how many credits were bought, so a retry re-credits
 *     what was paid for, not a hard-coded ten (L6-13).
 */
const ENTITLEMENT_PRODUCT_TYPES = ["pro_subscription", "apply_agent"];
const DELIVERED_ELSEWHERE_PRODUCT_TYPES = [FULL_ANALYSIS_PRODUCT_TYPE, "freelance_boost", "freelance_transition_pro"];
const SCAN_CREDIT_PRODUCT_TYPES = ["scan_pack", "scan_credits", "career_bundle"];

/** Credits a scan-product session bought, capped at 500 as add_scan_credits always has been here. */
function creditsBoughtBy(session: Stripe.Checkout.Session): number {
  const productType = session.metadata?.product_type;
  const fallback = productType === "career_bundle" ? 75 : 10;
  const parsed = parseInt(session.metadata?.credits || "", 10);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, 500);
}

/**
 * GRANT THE SIX-HOUR PASS — the one write that turns a paid session into an
 * entitlement row, and the place the price-amount lesson is applied.
 *
 * The pass is recognised by metadata.product_type and nothing else. The $99
 * plan matches on unit_amount because it has no Price ID, and that rule
 * already means any $99 subscription on the account reads as the agent;
 * the pass bills the same amount as Freelance Boost, so an amount match here
 * would be a live collision, not a hypothetical.
 *
 * Bound to user_id (client_reference_id, with metadata.user_id as the
 * second copy create-pass-checkout wrote), never to the email: applications
 * key to agent_mandates.user_id and agent_queue.user_id, and an address is a
 * claim. A session carrying neither is refused and logged — money was taken,
 * so nothing here is allowed to be quiet.
 *
 * Idempotency is the pass row itself: stripe_session_id UNIQUE (a webhook
 * retry, or the success page racing this delivery) and
 * stripe_payment_intent_id UNIQUE (Stripe's "two separate Event objects"
 * case). NOT webhook_events (its RPC records, it does not deduplicate) and
 * NOT used_stripe_sessions (purged after thirty days).
 *
 * Returns what happened; it writes no delivery row itself. The handler hands
 * the result to triggerProductDelivery, whose pass branch closes the ONE
 * product_deliveries row per session as delivered or — for a refused grant
 * (the partial UNIQUE: this user already holds an open pass, two checkouts
 * paid before either was granted) or an errored one — as generation_failed
 * under the pass's product_type, so the existing paid-but-undelivered
 * projection surfaces it for a human. The success page repeats the same
 * idempotent grant from the session id, so a transient error still delivers.
 */
// deno-lint-ignore no-explicit-any
async function grantAgentPass(session: Stripe.Checkout.Session, supabase: SupabaseClient<any, any, any>) {
  const userId = session.client_reference_id ?? session.metadata?.user_id ?? "";
  const customerEmail = session.customer_details?.email ?? session.customer_email ?? session.metadata?.customer_email ?? null;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    logStep("Agent pass refused: no user id on the session", { sessionId: session.id, customerEmail });
    return { granted: false, reason: "no_user_id: the pass is bound to an account, not an address", passId: null };
  }
  const intent = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? "";
  const { data, error } = await supabase.rpc("agent_pass_grant", {
    p_user_id: userId,
    p_stripe_session_id: session.id,
    p_payment_intent_id: intent,
    // What was actually charged (a promotion code lowers it); the constant
    // only fills a session Stripe answered without a total.
    p_amount_cents: session.amount_total ?? PASS_PRICE_CENTS,
    p_session_hours: PASS_SESSION_HOURS,
    p_applications_total: PASS_APPLICATIONS,
    p_rate_per_min: PASS_RATE_PER_MIN,
    p_daily_quota: PASS_QUOTA_PER_DAY,
    p_shelf_days: PASS_SHELF_LIFE_DAYS,
  }).maybeSingle();
  const r = error
    ? null
    : data as { granted_ok?: boolean; grant_reason?: string; granted_pass_id?: string | null; was_duplicate?: boolean } | null;
  const reason = error ? `rpc_error: ${error.message}` : (r?.grant_reason ?? "unknown");
  logStep("Agent pass grant", {
    sessionId: session.id, userId,
    granted: r?.granted_ok === true, reason,
    passId: r?.granted_pass_id ?? null, duplicate: r?.was_duplicate === true,
  });
  return { granted: r?.granted_ok === true, reason, passId: r?.granted_pass_id ?? null };
}

/**
 * A PROMOTION ON THE PLAN (the plan checkouts allow promotion codes): the
 * first charge Stripe computed (the paid first invoice, or a trial's upcoming
 * one) and how long the discount lasts. Null when the plan has none or it
 * leaves the first charge at the list price.
 */
async function promotionOf(stripe: Stripe, sub: Stripe.Subscription, listAmount: number): Promise<NoticeFacts["promo"]> {
  const loose = sub as unknown as { discounts?: unknown[]; discount?: unknown };
  if (!(Array.isArray(loose.discounts) && loose.discounts.length) && !loose.discount) return null;
  const full = await stripe.subscriptions.retrieve(sub.id, { expand: ["discounts.source.coupon", "latest_invoice"] }) as unknown as {
    id: string; status: string; discounts?: unknown[]; latest_invoice?: unknown;
  };
  let first: number | null = null;
  if (full.status === "trialing") {
    first = Number((await stripe.invoices.createPreview({ subscription: full.id }) as { amount_due?: number }).amount_due);
  } else if (full.latest_invoice && typeof full.latest_invoice === "object") {
    first = Number((full.latest_invoice as { amount_paid?: number }).amount_paid);
  }
  if (first === null || !Number.isFinite(first) || first >= listAmount) return null;
  let until: number | null = null;
  let forever = false;
  for (const d of (full.discounts ?? []) as Array<{ end?: number | null; source?: { coupon?: unknown }; coupon?: unknown } | string>) {
    if (!d || typeof d !== "object") continue;
    const coupon = (d.source?.coupon ?? d.coupon) as { duration?: string } | string | null | undefined;
    if (coupon && typeof coupon === "object" && coupon.duration === "forever") forever = true;
    else if (typeof d.end === "number") until = Math.max(until ?? 0, d.end);
  }
  return { amount: first, until: !forever && until ? new Date(until * 1000).toISOString() : null, forever };
}

/**
 * SEND A SUBSCRIPTION NOTICE ONCE (wave 3; Cal. B&P 17602; the notices are
 * described in _shared/subscription-notice.ts). Sent directly through Resend
 * with the notice's idempotency key and recorded only after a 2xx (S11-053;
 * owner decision 2026-10-11): the queue is not used for them. A notice the
 * ledger records as sent is not sent again; a send that fails records nothing
 * and throws, so the handler answers 500 and Stripe redelivers the event.
 * Every figure is read from Stripe, never from the clock, so a redelivery
 * sends Resend the same mail under the same key.
 */
async function sendSubscriptionNotice(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  stripe: Stripe,
  kind: NoticeKind,
  sub: Stripe.Subscription,
  email: string | null,
  /** The billing country the checkout collected: the 14-day paragraph is for EU/EEA/UK buyers only. */
  buyerCountry: string | null = null,
): Promise<"sent" | "already" | "skipped" | "suppressed"> {
  const price = sub.items?.data?.[0]?.price;
  if (!email || !price || typeof price.unit_amount !== "number") return "skipped";
  // Already sent: nothing to compute and no Stripe call to spend.
  const { data: prior } = await supabase.from("subscription_notices")
    .select("sent_at").eq("subscription_id", sub.id).eq("kind", kind).maybeSingle();
  if (prior?.sent_at) return "already";
  // The withdrawal period runs from the day the plan began, not from this delivery.
  const startedMs = Number(sub.start_date ?? sub.created) * 1000;
  const promo = await promotionOf(stripe, sub, price.unit_amount);
  const trialEnd = sub.status === "trialing" && sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
  if (kind === "trial_ending" && !trialEnd) return "skipped";
  const env = (k: string) => Deno.env.get(k);
  const loginUrl = env("STRIPE_PORTAL_LOGIN_URL") ?? "";
  const mail = noticeMail(kind, {
    planName: isAgentPriced(sub.items?.data as ReadonlyArray<{ price?: unknown }> | undefined) ? AGENT_PRODUCT_NAME : PRO_PRODUCT_NAME,
    amount: price.unit_amount,
    currency: price.currency ?? "usd",
    interval: price.recurring?.interval ?? "month",
    trialEnd,
    accountUrl: "https://resumebooster.work/account",
    portalLoginUrl: /^https:\/\/billing\.stripe\.com\//.test(loginUrl) ? loginUrl : null,
    withdrawal: kind === "confirmation" && euUkSalesOn(env) && inWithdrawalTerritory(buyerCountry)
      ? { until: new Date((Number.isFinite(startedMs) && startedMs > 0 ? startedMs : Date.now()) + WITHDRAWAL_DAYS * 86_400_000).toISOString(), contact: env("SUPPORT_EMAIL") ?? "resumeboostersupp@gmail.com" }
      : null,
    promo,
  });
  const sent = await sendLegalNotice(supabase, {
    subscriptionId: sub.id, kind, to: email, mail,
    apiKey: env("RESEND_API_KEY"), replyTo: CUSTOMER_REPLY_TO,
  });
  if (sent.outcome === "failed") throw new Error(`subscription notice not sent (${sent.status}): ${sent.error}`);
  if (sent.outcome === "suppressed") {
    logStep("Subscription notice not sent: the address bounced or complained", { kind, subscription: sub.id, reason: sent.reason });
    return "suppressed";
  }
  logStep(sent.outcome === "sent" ? "Subscription notice sent" : "Subscription notice already sent", { kind, subscription: sub.id });
  return sent.outcome;
}

/**
 * A WITHDRAWAL'S ACKNOWLEDGEMENT, WHEN ITS FIRST SEND FAILED (S11-053).
 * withdraw-subscription writes the mail into the ledger (pending_mail) before
 * it cancels the plan, then sends it. The cancel makes Stripe send
 * customer.subscription.deleted, and Stripe redelivers that event until it is
 * answered 2xx: so a pending acknowledgement is sent here, and a failure
 * throws for a redelivery. Only a plan the withdrawal itself cancelled (its
 * comment) is acknowledged.
 */
async function sendPendingWithdrawal(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  sub: Stripe.Subscription,
): Promise<void> {
  const comment = (sub as unknown as { cancellation_details?: { comment?: string | null } }).cancellation_details?.comment ?? "";
  if (comment !== WITHDRAWAL_CANCEL_COMMENT) return;
  const { data: row } = await supabase.from("subscription_notices")
    .select("email, sent_at, pending_mail").eq("subscription_id", sub.id).eq("kind", "withdrawal").maybeSingle();
  const mail = row?.pending_mail as { subject?: unknown; html?: unknown; text?: unknown } | null | undefined;
  if (!row || row.sent_at || !mail || typeof mail.subject !== "string" || typeof mail.html !== "string" || typeof mail.text !== "string") return;
  const sent = await sendLegalNotice(supabase, {
    subscriptionId: sub.id, kind: "withdrawal", to: String(row.email), mail: { subject: mail.subject, html: mail.html, text: mail.text },
    apiKey: Deno.env.get("RESEND_API_KEY"), replyTo: CUSTOMER_REPLY_TO,
  });
  if (sent.outcome === "failed") throw new Error(`withdrawal acknowledgement not sent (${sent.status}): ${sent.error}`);
  logStep("Pending withdrawal acknowledgement", { subscription: sub.id, outcome: sent.outcome });
}

/** The id of a Stripe reference that may arrive expanded or as a bare id. */
const refId = (v: unknown): string | null =>
  typeof v === "string" && v ? v : (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

/** The commission a checkout named, in cents (0 to $100), or null when it named none. */
function namedCommissionOf(raw: unknown): number | null {
  return typeof raw === "string" && /^\d{1,5}$/.test(raw) && Number(raw) <= 10_000 ? Number(raw) : null;
}

/** A customer's address, read from Stripe; null for a deleted customer or a failed read. */
async function customerEmailOf(stripe: Stripe, customerRef: unknown): Promise<string | null> {
  const id = refId(customerRef);
  if (!id) return null;
  try {
    const customer = await stripe.customers.retrieve(id);
    if ((customer as { deleted?: boolean }).deleted) return null;
    return (customer as Stripe.Customer).email ?? null;
  } catch {
    return null;
  }
}

/** What a refunded or disputed payment bought, as payment_revoke needs it. */
type RevocationTarget = {
  sessionId: string | null;
  productType: string | null;
  email: string | null;
  userId: string | null;
  credits: number;
  subscriptionId: string | null;
  customerId: string | null;
  paidAt: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RESOLVE A PAYMENT TO WHAT IT BOUGHT (L6-18). A one-time product is the
 * Checkout session that took the payment (listed by its payment intent); a
 * subscription payment is the invoice it paid (the charge's own reference
 * where the event carries it, else Stripe's invoice-payment record), whose
 * subscription names its buyer. Anything else resolves to the buyer's address
 * alone, and payment_revoke finds nothing to take back but the receipt.
 */
async function revocationTarget(
  stripe: Stripe,
  charge: { created?: number; invoice?: unknown; billing_details?: { email?: string | null } | null } | null,
  intent: string,
): Promise<RevocationTarget> {
  const paidAt = typeof charge?.created === "number" ? new Date(charge.created * 1000).toISOString() : null;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: intent, limit: 1 });
  const s = sessions.data?.[0];
  if (s) {
    const productType = s.metadata?.product_type ?? null;
    const buyer = s.client_reference_id ?? s.metadata?.user_id ?? null;
    return {
      sessionId: s.id,
      productType,
      email: buyerEmailOf(s),
      userId: buyer && UUID_RE.test(buyer) ? buyer : null,
      credits: SCAN_CREDIT_PRODUCT_TYPES.includes(productType ?? "") ? creditsBoughtBy(s) : 0,
      subscriptionId: null,
      customerId: refId(s.customer),
      paidAt,
    };
  }
  let invoiceId = refId(charge?.invoice);
  if (!invoiceId) {
    const payments = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: intent }, limit: 1 });
    invoiceId = refId(payments.data?.[0]?.invoice);
  }
  if (invoiceId) {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const subscriptionId = refId(invoice.parent?.subscription_details?.subscription)
      ?? refId((invoice as unknown as { subscription?: unknown }).subscription);
    const sub = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null;
    return {
      sessionId: null,
      productType: sub && isAgentPriced(sub.items?.data as ReadonlyArray<{ price?: unknown }> | undefined) ? "apply_agent" : "pro_subscription",
      email: invoice.customer_email ?? charge?.billing_details?.email ?? null,
      userId: sub ? subscriptionBuyer(sub) : null,
      credits: 0,
      subscriptionId,
      customerId: refId(invoice.customer),
      paidAt,
    };
  }
  return { sessionId: null, productType: null, email: charge?.billing_details?.email ?? null, userId: null, credits: 0, subscriptionId: null, customerId: null, paidAt };
}

// Trigger product delivery for a completed checkout
// deno-lint-ignore no-explicit-any
/**
 * A PRODUCT MADE ON ITS OWN PAGE STILL GETS A MAIL AT PAYMENT. The Full
 * Analysis and Freelance Boost are made after Checkout, on the page it
 * returns to; a buyer who closed that tab had no mail and no way back
 * (commercial-readiness 2026-10-08, item 3). The mail's button opens that
 * page with the session.
 *
 * AND ITS OUTCOME IS RECORDED (S12-104). It was fire-and-forget on a row the
 * sweep never schedules (next_retry_at infinity): when Resend refused it, the
 * buyer who had closed the tab had no way back and nothing said so. Now a
 * sent mail stamps email_sent_at, and a refused one is recorded through
 * update_delivery_retry as email_failed with its next try scheduled, so
 * retry-failed-deliveries resends the link (and only the link). An order the
 * page has already delivered stays delivered (20261011140000). Background:
 * Stripe has its answer first.
 */
function mailThePurchaseLink(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  supabaseUrl: string, deliveryId: string | undefined, email: string | null,
  productType: string, productName: string, sessionId: string, language: string | null,
): void {
  if (!email) return;
  EdgeRuntime.waitUntil((async () => {
    let failure: string | null = null;
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ email, productType, productName, sessionId, ...(language ? { language } : {}) }),
      });
      if (!r.ok) failure = `send-product-email answered ${r.status}`;
    } catch (e) {
      failure = `send-product-email threw: ${String(e).slice(0, 200)}`;
    }
    if (!deliveryId) {
      if (failure) logStep("Purchase-link mail failed and no delivery row records it", { productType, failure });
      return;
    }
    if (failure) {
      logStep("Purchase-link mail failed; the sweep resends it", { productType, failure });
      await supabase.rpc('update_delivery_retry', { p_id: deliveryId, p_status: 'email_failed', p_error: failure, p_increment_retry: true });
    } else {
      await supabase.from('product_deliveries')
        .update({ email_sent_at: new Date().toISOString(), email_success: true })
        .eq('id', deliveryId);
    }
  })().catch((e) => logStep("Purchase-link mail bookkeeping threw", { productType, error: String(e).slice(0, 200) })));
}

async function triggerProductDelivery(
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient<any, any, any>,
  supabaseUrl: string,
  passGrant: { granted: boolean; reason: string } | null = null,
) {
  const sessionId = session.id;
  const productType = session.metadata?.product_type;
  const productName = session.metadata?.product_name;
  const customerEmail = buyerEmailOf(session);
  // Looked up by the Stripe session id in checkout_resume_refs; the
  // temporary-store id is no longer written to Stripe (it is a bearer key to
  // the text). Sessions minted before that change still carry it in metadata.
  const resumeSessionId = await resumeSessionForCheckout(supabase, sessionId, session.metadata);

  logStep("Triggering product delivery", { sessionId, productType });

  // Atomically claim this session via the PRIMARY KEY on session_id. This webhook
  // and verify-product-purchase (triggered from the user's browser on the success
  // page) can race each other for the same session — a separate SELECT-then-INSERT
  // has a window where both see "not yet used" and both proceed to credit/generate
  // content twice. Doing the INSERT first and checking its result makes the claim
  // atomic: only one caller can win it.
  const { error: claimError } = await supabase
    .from('used_stripe_sessions')
    // WHICH product, not just that one was bought — see _shared/paid-session.ts.
    .insert({ session_id: sessionId, product_type: productType ?? null });

  if (claimError) {
    if (claimError.code === '23505') {
      logStep("Session already claimed by another process (race avoided)", { sessionId });
      // The success page claimed a retired product's sale first and recorded
      // it undeliverable (S12-169); the owner hears of it from here, the one
      // place every paid session reaches. The door is per session.
      const retiredFirst = retiredReasonOf(productType, session);
      if (retiredFirst && !isRetiredAgentPlan(productType, session)) {
        await alertRetiredSale(supabase, session, productType, customerEmail, retiredFirst);
      }
    } else {
      logStep("Error claiming session, aborting delivery", { error: claimError.message });
    }
    return { alreadyProcessed: true };
  }

  const isScanProduct = SCAN_CREDIT_PRODUCT_TYPES.includes(productType ?? '');
  // A retired product's sale (S12-169) is written closed as undeliverable
  // from the start: an entitlement row written 'delivered' first could never
  // be corrected (a delivered order stays delivered, 20261011140000).
  const retired = retiredReasonOf(productType, session);
  const isEntitlement = ENTITLEMENT_PRODUCT_TYPES.includes(productType ?? '') && !retired;
  const deliveredAt = new Date().toISOString();
  const deliveryRecord = await supabase.from('product_deliveries').insert({
    stripe_session_id: sessionId,
    product_type: productType || 'unknown',
    product_name: productName,
    customer_email: customerEmail,
    status: 'payment_received',
    amount_cents: session.amount_total,
    payment_completed_at: deliveredAt,
    // See ENTITLEMENT_PRODUCT_TYPES / DELIVERED_ELSEWHERE_PRODUCT_TYPES above.
    ...(DELIVERED_ELSEWHERE_PRODUCT_TYPES.includes(productType ?? '') ? { next_retry_at: 'infinity' } : {}),
    ...(isEntitlement ? { status: 'delivered', generation_success: true, content_generation_completed_at: deliveredAt } : {}),
    ...(retired ? {
      status: 'generation_failed', generation_success: false, max_retries: 0, next_retry_at: null,
      generation_error: `undeliverable_retired: ${retired}`,
    } : {}),
    metadata: {
      resume_session_id: resumeSessionId,
      job_title: session.metadata?.job_title,
      job_company: session.metadata?.job_company,
      referral_code: session.metadata?.referral_code,
      language: session.metadata?.language,
      target_roles: session.metadata?.target_roles || null,
      ...(isScanProduct ? { credits: creditsBoughtBy(session) } : {}),
      // A test-mode purchase (the owner's rehearsal, CP-033) is tagged so
      // revenue and health readers can leave it out.
      ...(session.livemode === false ? { livemode: false } : {}),
    }
  }).select().single();

  if (deliveryRecord.error) {
    logStep("Failed to create delivery record", { error: deliveryRecord.error.message, sessionId });
    // Continue processing — payment was received, delivery tracking failure shouldn't block fulfillment
  }

  // A RETIRED PRODUCT IS RECORDED AND TOLD, NEVER DELIVERED (S12-169). The
  // claim above stays (it is the proof of payment reconcile-stripe reads);
  // the row was written closed as a failure no sweep retries (max_retries 0),
  // with the reason, and the owner is mailed once. The pass and the plan were
  // never granted (the handler checks the same switch before it grants).
  if (retired) {
    // A retired plan is told to the owner once per subscription by
    // retireAgentPlan; everything else once per session here.
    if (!isRetiredAgentPlan(productType, session)) await alertRetiredSale(supabase, session, productType, customerEmail, retired);
    logStep("Retired product paid after its switch: recorded, not delivered", { sessionId, productType });
    return { success: false, productType, deferred: 'undeliverable_retired', error: retired };
  }

  // A subscription is its own delivery: the row above is already closed, and
  // the entitlement caches are refreshed by the handler before this runs.
  if (isEntitlement) {
    logStep("Subscription — the plan is the delivery; nothing to generate", { productType });
    return { success: true, productType, deferred: 'entitlement' };
  }

  // Handle scan packs - just add credits
  if (productType === 'scan_pack' || productType === 'scan_credits' || productType === 'career_bundle') {
    if (customerEmail) {
      const credits = creditsBoughtBy(session);
      const { error: creditError } = await supabase.rpc('add_scan_credits', {
        p_email: customerEmail,
        p_credits: credits
      });

      if (creditError) {
        logStep("Error adding credits", { error: creditError.message });
      } else {
        logStep("Credits added", { credits, email: customerEmail });
        // AWAITED, not left in the background: the sweeper re-credits a row
        // it finds undelivered, so the record that these credits landed must
        // exist before this returns (L6-13).
        const [saved, closed] = await Promise.all([
          supabase.rpc('save_purchased_content', {
            p_stripe_session_id: sessionId,
            p_customer_email: customerEmail,
            p_product_type: productType,
            p_product_name: productName || `${credits} Scan Credits`,
            p_generated_content: { credits, message: `${credits} scan credits added` }
          }),
          supabase.from('product_deliveries')
            .update({ status: 'delivered', generation_success: true })
            .eq('id', deliveryRecord.data?.id)
        ]);
        if (saved.error || closed.error) {
          logStep("Scan pack delivery tracking failed", { error: (saved.error ?? closed.error)?.message ?? 'unknown' });
        }
      }
    }
    return { success: true, productType };
  }

  // Freelance products are fulfilled interactively on /freelance-boost, against
  // an intake the buyer completes AFTER paying — so there is no resume/intake at
  // webhook time and nothing to auto-generate here. Recognize them explicitly:
  // otherwise they fall through to a "No resume session ID" failure (or, with a
  // resume session, to the switch's "Unknown product type" throw), which logs a
  // bogus webhook failure and can drop a valid purchase into the
  // generation-failed retry queue. The intake page owns delivery.
  if (productType === 'freelance_boost' || productType === 'freelance_transition_pro') {
    logStep("Freelance product — fulfilled via intake page; deferring webhook generation", { productType });
    // THE ONLY WAY BACK TO A $29 / $59 PURCHASE (S8-016; commercial-readiness
    // item 3). It existed only in the success URL: no mail was sent, so a
    // buyer who closed the tab before the intake, or whose generation failed,
    // had nothing to return with and was shown the buy buttons again. The
    // mail carries the link that reopens it on any device. Background: the
    // payment is already recorded.
    mailThePurchaseLink(supabase, supabaseUrl, deliveryRecord.data?.id, customerEmail, productType, productName || "Freelance Boost", sessionId, session.metadata?.language ?? null);
    return { success: true, productType, deferred: 'freelance_intake' };
  }

  // THE FULL RESUME ANALYSIS IS DELIVERED ON THE SUCCESS PAGE, NOT HERE.
  //
  // create-checkout puts no résumé session in its metadata -- the résumé
  // lives in the buyer's temp store and the analysis is rendered from
  // analyze-resume's own response -- so this function has nothing to
  // generate. It used to fall through to the "No resume session ID" failure
  // below, leaving the claim it had just written as the only trace, and that
  // claim was what analyze-resume then read as "already used": every buyer got
  // 409. The claim stays (it is proof of payment, and reconcile-stripe reads
  // it); analyze-resume now treats a claim recorded for this product as paid-
  // not-yet-delivered and redeems the session itself, once.
  if (productType === FULL_ANALYSIS_PRODUCT_TYPE) {
    logStep("Full analysis — delivered by analyze-resume on the success page; nothing to generate here", { sessionId });
    mailThePurchaseLink(supabase, supabaseUrl, deliveryRecord.data?.id, customerEmail, productType, productName || 'Full Resume Analysis', sessionId, session.metadata?.language ?? null);
    return { success: true, productType, deferred: 'success_page' };
  }

  // The six-hour pass has no résumé session and nothing to generate: its
  // delivery IS the agent_passes row, written by grantAgentPass in the
  // handler before this runs. Recognised here, exactly as the freelance
  // products are, so it never reaches the "No resume session ID" failure
  // below and never lands in the generation-failed retry queue. The
  // used_stripe_sessions claim above has already happened, so reconcile-
  // stripe stops seeing the session as an orphan.
  if (productType === PASS_PRODUCT_TYPE) {
    // Close the delivery row from what the grant actually did: 'delivered'
    // when the pass row exists, 'generation_failed' with the reason when it
    // does not — a 'payment_received' left behind would read as stuck after
    // two hours, and a refusal left unrecorded would read as nothing at all.
    const granted = passGrant?.granted === true;
    if (deliveryRecord.data?.id) {
      await supabase.from('product_deliveries')
        .update(granted
          ? { status: 'delivered', generation_success: true, content_generation_completed_at: new Date().toISOString() }
          // max_retries 0: retry-failed-deliveries selects generation_failed rows
          // with retry_count < max_retries and, for a product with no resume
          // session, overwrites generation_error with its own "Resume session
          // ID not available" — the one string that said WHY money was taken
          // with no pass. Nothing about a refused grant is retryable by that
          // sweeper (the success page repeats the grant itself), so the row is
          // written outside its selection and keeps its reason.
          : { status: 'generation_failed', generation_success: false, max_retries: 0, generation_error: `agent_pass_grant: ${passGrant?.reason ?? 'not attempted'}` })
        .eq('id', deliveryRecord.data.id);
    }
    logStep("Agent pass — the entitlement row is the delivery; no generation", { productType, granted, reason: passGrant?.reason ?? null });
    return { success: granted, productType, deferred: PASS_PRODUCT_TYPE, ...(granted ? {} : { error: passGrant?.reason ?? 'not attempted' }) };
  }

  // For content products, need resume data
  if (!resumeSessionId) {
    logStep("No resume session ID");
    return { success: false, error: 'No resume session ID' };
  }

  const { data: resumeData, error: resumeError } = await supabase
    .rpc('get_temp_resume', { p_session_id: resumeSessionId });

  if (resumeError || !resumeData?.[0]) {
    logStep("Resume data not found");
    return { success: false, error: 'Resume data not found' };
  }

  const { resume_text, job_description_text } = resumeData[0];
  const jobTitle = session.metadata?.job_title || 'Target Position';
  const jobCompany = session.metadata?.job_company || '';
  // Captured at checkout time (create-product-checkout) since this runs
  // server-side with no access to the browser's i18n state.
  const language = session.metadata?.language || 'en';

  // STRIPE IS ANSWERED BEFORE THE MODEL IS. Generation takes up to ~90 s and
  // Stripe wants its 2xx within seconds; awaiting it here held every product
  // sale's acknowledgement on the AI writer (commercial-readiness 2026-10-08,
  // item 2). The claim, the delivery row and the 'generating' stamp are
  // written first; the generation, the saved copy and the mail finish in the
  // background. A finish that dies leaves the row 'generating', which the
  // retry sweep picks up after 15 minutes (20261009140000).
  await supabase.from('product_deliveries')
    .update({ status: 'generating', content_generation_started_at: new Date().toISOString() })
    .eq('id', deliveryRecord.data?.id);

  EdgeRuntime.waitUntil(
    generateAndDeliver({
      supabase, supabaseUrl, sessionId, productType, productName, customerEmail,
      deliveryId: deliveryRecord.data?.id, resumeText: resume_text, jobDescriptionText: job_description_text,
      jobTitle, jobCompany, language, targetRoles: targetRolesOf(session.metadata?.target_roles),
    }).then(
      (r) => logStep("Background delivery finished", r),
      (e) => logStep("Background delivery threw; the sweeper retries the row", { error: String(e).slice(0, 300) }),
    ),
  );
  return { success: true, productType, deferred: 'generating' };
}

interface GenerationJob {
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>;
  supabaseUrl: string;
  sessionId: string;
  productType: string | undefined;
  productName: string | undefined;
  customerEmail: string | null;
  deliveryId: string | undefined;
  resumeText: string;
  jobDescriptionText: string | null;
  jobTitle: string;
  jobCompany: string;
  language: string;
  /** The ATS Defense roles named at checkout (S11-074). */
  targetRoles: string[];
}

/** The generation, the saved copy and the delivery mail: run after Stripe has its answer. */
async function generateAndDeliver(job: GenerationJob) {
  const { supabase, supabaseUrl, sessionId, productType, productName, customerEmail, jobTitle, jobCompany, language } = job;
  const resume_text = job.resumeText;
  const job_description_text = job.jobDescriptionText;
  const deliveryRecord = { data: { id: job.deliveryId } };
  const generationStart = Date.now();
  let generatedContent: any = null;
  let generationError: string | null = null;

  try {
    if (productType === 'apply_assistant') {
      // Needs two calls (tailored resume + cover letter) combined into one
      // stored object, and explicitly requires a job posting — unlike the other
      // products here, there's nothing useful to generate without one.
      if (!job_description_text) {
        throw new Error('Apply Assistant requires a job posting; none found in session');
      }

      const [packageResponse, coverLetterResponse] = await Promise.all([
        // The session is generate-apply-package's proof of purchase: it
        // re-reads it from Stripe and checks the product. Without it every
        // Apply Assistant delivery from here was a 402.
        fetch(`${supabaseUrl}/functions/v1/generate-apply-package`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
          body: JSON.stringify({ resumeText: resume_text, jobPostingText: job_description_text, language, sessionId })
        }),
        // The service-role key: the generator's spend gate never counts our
        // own servers by address or against its free ceiling, so strangers
        // spending the free allowance cannot drop a paid letter. The session
        // names the purchase, whose daily allowance still counts.
        fetch(`${supabaseUrl}/functions/v1/generate-cover-letter`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ resumeText: resume_text, jobDescription: job_description_text, jobTitle, jobCompany, tone: 'professional', language, sessionId })
        })
      ]);

      if (!packageResponse.ok) {
        throw new Error(`Apply package generation failed: ${packageResponse.status}`);
      }

      const packageResult = await packageResponse.json();
      const coverLetterResult = coverLetterResponse.ok ? await coverLetterResponse.json() : null;

      generatedContent = {
        jobMetadata: packageResult.jobMetadata,
        tailoredResume: packageResult.tailoredResume,
        skillGaps: packageResult.skillGaps,
        checklist: packageResult.checklist,
        coverLetter: coverLetterResult?.data?.coverLetter || null,
        modelUsed: packageResult.modelUsed,
        // What the fact check removed, shown with the saved copy (S11-055).
        groundingReport: packageResult.groundingReport ?? null,
      };
      logStep("Content generated", { productType });
    } else {
      let endpoint = '';
      const body: Record<string, unknown> = {
        resumeText: resume_text,
        jobDescription: job_description_text || '',
        jobTitle,
        jobCompany,
        language,
        // PROOF OF PURCHASE FOR THE GENERATOR'S OWN GATE. The paid-only
        // generators now call assertPaidSession, which looks this session up in
        // used_stripe_sessions — and the marker is written at the TOP of this
        // function, so by now it exists and the gate passes.
        //
        // Previously only the ats_defense case passed this, and that case
        // carries a comment explaining that WITHOUT it the call always fails and
        // silently falls through to manual recovery. Passing it for everyone
        // means the next gated generator cannot repeat that bug.
        sessionId
      };

      switch (productType) {
        case 'basic_keyword_fix': endpoint = 'generate-keyword-fix'; break;
        case 'cover_letter': endpoint = 'generate-cover-letter'; body.tone = 'professional'; break;
        case 'premium_package': endpoint = 'generate-premium-package'; break;
        case 'graduate_gameplan': endpoint = 'generate-graduate-gameplan'; break;
        case 'career_snapshot': endpoint = 'generate-career-snapshot'; break;
        // generate-ats-defense independently re-verifies payment via a real
        // Stripe checkout session lookup (it's also callable directly from
        // the browser), so it requires sessionId in the body — unlike every
        // other product here, which trusts this webhook call implicitly.
        // Without it, this call always 401s and silently falls through to
        // the frontend's manual recovery flow on the success page instead.
        case 'ats_defense': endpoint = 'generate-ats-defense'; body.sessionId = sessionId; body.targetRoles = job.targetRoles; break;
        case 'interview_coach': endpoint = 'generate-interview-coach'; body.isPremium = true; break;
        case 'career_path_simulator': endpoint = 'generate-career-path'; body.isPremium = true; break;
        default: throw new Error(`Unknown product type: ${productType}`);
      }

      // The service-role key, for the same reason as the Apply Assistant's
      // letter above: a delivery is never counted against a free ceiling or
      // our egress address (_shared/model-spend-gate.ts).
      const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Generation failed: ${response.status}`);
      }

      // EVERY GENERATOR ANSWERS {success, data}. generate-ats-defense answered
      // {report} alone, so this read undefined, saved nothing, emailed nothing
      // and recorded a failure with no message, on every $15 sale (L6-02). A
      // 200 with no payload is a failure with a reason, never a silent skip.
      const result = await response.json().catch(() => null);
      generatedContent = result?.data ?? null;
      if (!generatedContent) throw new Error(`${endpoint} answered 200 with no content`);
      logStep("Content generated", { productType });
    }
  } catch (error) {
    generationError = error instanceof Error ? error.message : String(error);
    logStep("Content generation failed", { error: generationError });
  }

  const generationDuration = Date.now() - generationStart;

  if (generatedContent) {
    const aiModelUsed = generatedContent.modelsUsed?.resume || 
                        generatedContent.modelsUsed?.coverLetter || 
                        generatedContent.modelUsed || null;

    // The stored copy is what recovery and the email retry read, so it is
    // written first and its failure is a failed delivery (the sweeper
    // regenerates and saves again), never a row marked generated with nothing
    // behind it.
    const { error: saveError } = await supabase.rpc('save_purchased_content', {
      p_stripe_session_id: sessionId,
      p_customer_email: customerEmail || '',
      p_product_type: productType,
      p_product_name: productName,
      p_generated_content: generatedContent
    });
    if (saveError) {
      logStep("Generated content could not be saved", { error: saveError.message });
      EdgeRuntime.waitUntil(Promise.resolve(supabase.rpc('update_delivery_retry', {
        p_id: deliveryRecord.data?.id,
        p_status: 'generation_failed',
        p_error: `save_purchased_content: ${saveError.message}`.slice(0, 500),
        p_increment_retry: true
      })));
      return { success: false, error: 'content not saved' };
    }
    await supabase.from('product_deliveries').update({
      status: 'content_generated',
      generation_success: true,
      content_generation_completed_at: new Date().toISOString(),
      generation_duration_ms: generationDuration,
      ai_model_used: aiModelUsed
    }).eq('id', deliveryRecord.data?.id);

    // Send email (background). A send that fails is RECORDED as email_failed
    // with a retry scheduled, so retry-failed-deliveries resends it from the
    // stored copy. It used to have no else: the row stayed content_generated,
    // which the sweeper never selects, and the buyer never got the mail that
    // recover-purchase depends on (L6-14).
    if (customerEmail) {
      EdgeRuntime.waitUntil((async () => {
        let failure: string | null = null;
        try {
          // The service-role key: send-product-email is internal and refuses
          // the publishable key, which every visitor holds.
          const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
            },
            body: JSON.stringify({ email: customerEmail, productType, productName, generatedContent, sessionId })
          });

          if (emailResponse.ok) {
            await supabase.from('product_deliveries').update({
              status: 'delivered',
              email_success: true,
              email_sent_at: new Date().toISOString()
            }).eq('id', deliveryRecord.data?.id);
          } else {
            failure = `send-product-email answered ${emailResponse.status}`;
          }
        } catch (e) {
          failure = `send-product-email threw: ${String(e).slice(0, 200)}`;
        }
        if (failure) {
          console.error("[STRIPE-WEBHOOK] Email send failed:", failure);
          await supabase.rpc('update_delivery_retry', {
            p_id: deliveryRecord.data?.id,
            p_status: 'email_failed',
            p_error: failure,
            p_increment_retry: true
          });
        }
      })());
    }

    return { success: true, productType };
  } else {
    EdgeRuntime.waitUntil(
      Promise.resolve(
        supabase.rpc('update_delivery_retry', {
          p_id: deliveryRecord.data?.id,
          p_status: 'generation_failed',
          p_error: generationError,
          p_increment_retry: true
        })
      )
    );
    return { success: false, error: generationError };
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: BUILD_HEADER });
  }

  const processingStart = Date.now();

  try {
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      return new Response("Configuration error", { status: 500, headers: BUILD_HEADER });
    }

    const liveStripe = getStripe();
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return new Response("Missing signature", { status: 400, headers: BUILD_HEADER });
    }

    // THE LIVE ENDPOINT'S SECRET, THEN THE TEST ENDPOINT'S (CP-033). The
    // owner's test-mode rehearsal posts to this same function from Stripe's
    // test-mode webhook, signed with STRIPE_TEST_WEBHOOK_SECRET. An event
    // verified by the test secret must say livemode false, and is handled with
    // the test-mode client, so a rehearsal never reads or changes live data.
    let event: Stripe.Event | null = null;
    let testMode = false;
    try {
      event = await liveStripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch {
      const testSecret = Deno.env.get("STRIPE_TEST_WEBHOOK_SECRET") ?? "";
      if (testSecret) {
        try {
          event = await liveStripe.webhooks.constructEventAsync(body, signature, testSecret);
          testMode = true;
        } catch { /* refused below */ }
      }
    }
    if (!event || (testMode && (event as { livemode?: boolean }).livemode !== false)) {
      logStep("Signature verification failed");
      return new Response("Webhook signature verification failed", { status: 400, headers: BUILD_HEADER });
    }
    const testStripe = testMode ? getTestStripe() : null;
    if (testMode && !testStripe) {
      logStep("Test-mode event acknowledged: STRIPE_TEST_SECRET_KEY is not a test key, so nothing is delivered", { type: event.type });
      return new Response(JSON.stringify({ received: true, testMode: true, delivered: false }), {
        headers: { "Content-Type": "application/json", ...BUILD_HEADER }, status: 200,
      });
    }
    const stripe: Stripe = testStripe ?? liveStripe;

    logStep("Event verified", { type: event.type, id: event.id, testMode });

    const supabase = getSupabase();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    
    // OPTIMIZATION: Log webhook received in background. The stored payload
    // drops any résumé-bearing metadata key: full-analysis sessions minted
    // before 2026-10-04 carry the top of the buyer's résumé, and their events
    // keep arriving. Only the copy written down is changed; the handler below
    // reads the event exactly as Stripe sent it.
    EdgeRuntime.waitUntil(
      Promise.resolve(
        supabase.rpc('log_webhook_event', {
          p_event_type: event.type,
          p_event_id: event.id,
          p_payload: withoutResumeText(event.data.object),
          p_processed: false
        })
      )
    );

    let processingError: string | null = null;
    // Set when work Stripe must redeliver the event for did not finish: the
    // handler then answers 500, and Stripe retries for up to three days.
    let mustRetry = false;

    switch (event.type) {
      // A DELAYED PAYMENT METHOD (a bank debit) completes the session unpaid
      // and pays it later with checkout.session.async_payment_succeeded
      // (CP-029). That event was unhandled, so such a purchase was never
      // claimed, recorded or mailed. It now runs the same block: the paid
      // gate below lets it through once Stripe says paid, and everything in
      // the block is safe to run twice for one session.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;

        // THE AGENT ENTITLEMENT IS GRANTED BEFORE THE PAYMENT TEST, and it has to be.
        //
        // create-agent-checkout attaches a trial to a FIRST-TIME subscriber's
        // session (once per customer since wave 2), so that session's amount_total is 0 and Stripe
        // reports payment_status as 'no_payment_required' — NOT 'paid'. This whole
        // handler body sat inside `payment_status === 'paid'`, so for the $99
        // Morning Queue the seeding below, and the prepare kick with it, NEVER RAN.
        // A subscriber who closed the tab instead of following the redirect had no
        // entitlement row until they happened to load the Account page.
        //
        // A trial subscription is a real entitlement with nothing yet due, which is
        // why this moves out of the gate rather than the gate widening: everything
        // else in the block — product delivery, the affiliate conversion — is about
        // money actually changing hands and stays exactly where it is.
        //
        // The isAgent test cannot rely on amount_total for the same reason (it is 0
        // on a trial); create-agent-checkout sets metadata.product_type =
        // "apply_agent", which is the durable signal.
        // WHILE THE PLAN IS NOT SOLD (wave 4), a plan checkout opened before
        // the switch and completed after it is neither seeded nor kicked: it
        // is set to end at its period end and its subscriber is told
        // (S12-169, S12-079). A failure answers 500 so Stripe redelivers.
        const retiredPlan = isRetiredAgentPlan(session.metadata?.product_type, session);
        if (retiredPlan) {
          const subId = refId(session.subscription);
          if (subId) {
            try {
              const sub = await stripe.subscriptions.retrieve(subId);
              await retireAgentPlan(stripe, supabase, sub, buyerEmailOf(session), event.type);
            } catch (err) {
              processingError = String(err).slice(0, 500);
              mustRetry = true;
              logStep("Retired agent plan not ended; Stripe will redeliver", { subscription: subId, error: processingError });
            }
          }
        }

        try {
          const paidEmail = session.customer_details?.email ?? session.customer_email ?? "";
          const isAgent = (session.amount_total ?? 0) === AGENT_PRICE_CENTS
            || session.metadata?.product_type === "apply_agent";
          if (paidEmail && isAgent && !retiredPlan) {
            const seeded = await checkAgentByEmail(stripe, supabase, paidEmail);
            logStep("Agent entitlement seeded from webhook", {
              email: paidEmail, active: seeded.active, status: seeded.status,
            });

            // ...and PREPARE, rather than leaving them to wait for :23.
            //
            // The entitlement landing instantly is only half the fix: nothing
            // invokes apply-agent except the hourly cron, so a subscriber who
            // paid at :24 stared at an empty queue for fifty-nine minutes at
            // the exact moment their expectations were highest.
            //
            // agent_prepare_now() mirrors the cron's own vault lookup, so the
            // maintenance key never enters application code. It returns false
            // rather than throwing when the vault is empty, because the cron
            // remains the floor — this only ever removes waiting.
            //
            // Same non-fatal treatment as the seeding above: a failure here
            // must not 500 a webhook whose payment already succeeded.
            // Nothing to prepare while the agent itself is switched off.
            if (seeded.active && APPLY_AGENT_ON) {
              const { data: kicked, error: kickErr } = await supabase.rpc("agent_prepare_now");
              logStep("Prepare kicked", { kicked: kicked === true, error: kickErr?.message ?? null });
            }
          }
        } catch (err) {
          logStep("Agent entitlement seeding failed (Account page will repair)", { error: String(err) });
        }

        // THE PRO CACHE, at the event that means "they subscribed" (L6-28).
        // Before the paid gate for the same reason as the agent seeding: a
        // subscription's first session may be $0 (a trial, a 100%-off code)
        // and is a real entitlement either way. Non-fatal.
        if (session.mode === "subscription") {
          await refreshProEntitlement(
            stripe, supabase,
            buyerEmailOf(session),
            session.customer as string | { id?: string } | null,
            event.type,
          );
          // THE CONFIRMATION A NEW SUBSCRIBER IS OWED (item 11): terms,
          // renewal, the trial's end, how to cancel. Once per subscription;
          // a failure answers 500 so Stripe redelivers, and everything above
          // and below is safe to run again.
          // A retired plan's subscriber was sent the plan-ends notice above
          // instead: a confirmation would promise a renewal that never comes.
          const subId = refId(session.subscription);
          if (subId && !retiredPlan) {
            try {
              const sub = await stripe.subscriptions.retrieve(subId);
              await sendSubscriptionNotice(supabase, stripe, "confirmation", sub, buyerEmailOf(session), session.customer_details?.address?.country ?? null);
            } catch (err) {
              processingError = String(err).slice(0, 500);
              mustRetry = true;
              logStep("Subscription confirmation not sent; Stripe will redeliver", { subscription: subId, error: processingError });
            }
          }
        }

        // The paid gate: 'paid', or a payment-mode session a promotion code
        // covered in full (zero total, nothing owed) — the owner's comps and
        // end-to-end runs, for every one-time product, not only the pass
        // (L6-10). Judged by the shared predicate the success pages use.
        if (checkoutSessionSettled(session)) {
          // GRANT THE APPLY AGENT ENTITLEMENT HERE, at the event that means
          // "they paid". Nothing else did.
          //
          // THE HOLE THIS CLOSES. agent_subscribers was written by exactly one
          // path — checkAgentByEmail — and the only caller that runs AFTER a
          // purchase is agent-access, which fires when the Account page loads.
          // create-agent-checkout calls it too, but BEFORE payment, to avoid
          // double-billing. reconcile-stripe never touched the agent table at
          // all.
          //
          // So a subscriber who paid and did not return to the app had no row.
          // agent-runner filters on that table and runs at 06:10 UTC, which
          // means someone subscribing late in the evening on a phone, closing
          // the tab, and going to bed silently missed the first morning queue —
          // while the UI told them "your first queue arrives after tonight's
          // run". The Stripe redirect usually brings people back, so this looks
          // fine right up until somebody's session ends differently.
          //
          // Deliberately non-fatal: a failure here must not 500 the webhook and
          // make Stripe retry a delivery that already succeeded. The Account
          // page still repairs the row on next load, exactly as before — this
          // removes the dependency on that visit, it does not replace it.

          // THE PASS, by product_type only. Granted BEFORE triggerProductDelivery
          // claims the session, and non-fatal like everything else in this
          // block (the handler answers 200 whatever processingError holds, so a
          // throw here would not buy a Stripe retry — it would only skip the
          // claim). A grant that fails leaves its alert row, and the success
          // page repeats the same idempotent grant from the session id. Inside
          // the paid gate on purpose: a pass is a one-time charge with nothing
          // due later, unlike the trial subscription seeded above it.
          let passGrant: { granted: boolean; reason: string } | null = null;
          if (session.metadata?.product_type === PASS_PRODUCT_TYPE) {
            // Never while the pass is not sold: triggerProductDelivery
            // records that sale as undeliverable_retired instead (S12-169).
            if (!AGENT_PRODUCTS_ON_SALE) {
              logStep("Agent pass not granted: the pass is no longer sold", { sessionId: session.id });
            } else {
              try {
                passGrant = await grantAgentPass(session, supabase);
              } catch (err) {
                passGrant = { granted: false, reason: `threw: ${String(err).slice(0, 200)}` };
                processingError = String(err);
                logStep("Agent pass grant failed", { error: processingError });
              }
            }
          }

          try {
            const result = await triggerProductDelivery(session, supabase, supabaseUrl, passGrant);
            logStep("Delivery result", result);
            
            // Affiliate conversion (background)
            const referralCode = session.metadata?.referral_code;
            if (referralCode && session.amount_total) {
              const productType = session.metadata?.product_type;
              // Kept in sync with the same list in verify-product-purchase/index.ts —
              // this one had drifted out of sync (missing interview_coach/
              // career_path_simulator entirely, and would have defaulted
              // apply_assistant to the $5 tier on a $7 sale).
              const lowCommission = ['basic_keyword_fix', 'cover_letter', 'scan_pack', 'scan_credits', 'career_bundle', 'interview_coach', 'career_path_simulator', 'apply_assistant'];
              // Every checkout now carries the code; the ones the affiliate
              // page promises nothing for mark it "none" and are recorded at
              // $0 (_shared/checkout-policy.ts policyMetadata). A checkout that
              // names its commission (metadata.referral_commission_cents,
              // written by our checkout code, never by the buyer) is paid
              // exactly that: the owner re-based the programme on a flat $10
              // for a referred customer's first paid Pro month (2026-10-12),
              // which the subscription checkout names. Otherwise the
              // per-product amounts the affiliate page lists.
              const namedCommission = namedCommissionOf(session.metadata?.referral_commission_cents);
              const commissionCents = session.metadata?.referral_commission === "none" ? 0
                : namedCommission !== null ? namedCommission
                : lowCommission.includes(productType || '') ? 100 : 500;
              
              // verify-product-purchase (triggered from the success page) can also
              // record this same conversion — the table's UNIQUE constraint on
              // stripe_session_id prevents an actual double-credit either way, but
              // this call previously had no error handling at all, so losing that
              // race failed completely silently instead of just being a harmless,
              // logged no-op.
              EdgeRuntime.waitUntil(
                Promise.resolve(supabase.rpc('record_affiliate_conversion', {
                  p_referral_code: referralCode,
                  p_stripe_session_id: session.id,
                  p_product_name: session.metadata?.product_name || productType || 'Product',
                  p_sale_amount: session.amount_total,
                  p_commission_override: commissionCents
                })).then(({ error }: { error: { message: string } | null }) => {
                  if (error) {
                    logStep("Affiliate conversion recording failed (likely already recorded by verify-product-purchase)", { error: error.message });
                  }
                })
              );
            }
          } catch (err) {
            processingError = String(err);
            logStep("Delivery failed", { error: processingError });
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        
        // Background: log to DB and send alert
        EdgeRuntime.waitUntil((async () => {
          let customerEmail: string | null = null;
          if (pi.customer) {
            try {
              const customer = await stripe.customers.retrieve(pi.customer as string);
              if (customer && !customer.deleted && 'email' in customer) {
                customerEmail = customer.email;
              }
            } catch {}
          }

          await supabase.from('payment_failures').insert({
            payment_intent_id: pi.id,
            amount: pi.amount,
            currency: pi.currency,
            failure_code: pi.last_payment_error?.code || null,
            failure_message: pi.last_payment_error?.message || null,
            customer_email: customerEmail,
            metadata: {
              decline_code: pi.last_payment_error?.decline_code,
              payment_method_type: pi.last_payment_error?.payment_method?.type
            }
          });

          sendFailureAlertBackground({
            type: "Payment Intent Failed",
            amount: pi.amount,
            currency: pi.currency,
            failureCode: pi.last_payment_error?.code,
            failureMessage: pi.last_payment_error?.message,
            customerEmail,
            paymentIntentId: pi.id
          });
        })());
        break;
      }

      case "charge.failed": {
        const charge = event.data.object as Stripe.Charge;
        
        EdgeRuntime.waitUntil((async () => {
          await supabase.from('payment_failures').insert({
            payment_intent_id: charge.payment_intent as string || charge.id,
            amount: charge.amount,
            currency: charge.currency,
            failure_code: charge.failure_code || null,
            failure_message: charge.failure_message || null,
            customer_email: charge.billing_details?.email || null,
            metadata: { charge_id: charge.id }
          });

          sendFailureAlertBackground({
            type: "Charge Failed",
            amount: charge.amount,
            currency: charge.currency,
            failureCode: charge.failure_code,
            failureMessage: charge.failure_message,
            customerEmail: charge.billing_details?.email,
            paymentIntentId: charge.payment_intent as string || charge.id
          });
        })());
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        EdgeRuntime.waitUntil((async () => {
          await supabase.from('payment_failures').insert({
            payment_intent_id: session.payment_intent as string || session.id,
            amount: session.amount_total || 0,
            currency: session.currency || 'usd',
            failure_code: 'checkout_expired',
            failure_message: 'Checkout abandoned',
            customer_email: session.customer_email,
            metadata: { session_id: session.id, product_type: session.metadata?.product_type }
          });

          sendFailureAlertBackground({
            type: "Checkout Abandoned",
            amount: session.amount_total || 0,
            currency: session.currency || 'usd',
            failureCode: 'checkout_expired',
            failureMessage: 'Checkout abandoned',
            customerEmail: session.customer_email,
            paymentIntentId: session.payment_intent as string || session.id
          });
        })());
        break;
      }

      // THE AGENT WENT SILENT ON THE DAY THE CARD WAS FIRST CHARGED.
      //
      // checkout.session.completed seeds the entitlement cache once, at
      // purchase, with `current_period_end` set to the END OF THE TRIAL. Nothing
      // refreshed it after that. rowIsEntitled() compares that timestamp to now,
      // so on day 8 — the moment the first real $99 charge succeeds and the
      // subscription becomes genuinely valuable — the cached row expires and
      // every consumer starts skipping the customer.
      //
      // The failure is silent in three places at once: apply-agent skips with a
      // bare `continue` and no counter, apply-broker unclaims, and the digest
      // email is suppressed — so the customer gets no queue, no email, and no
      // error, on the first day they actually paid. It only recovered if they
      // happened to load /account, which re-seeds the row as a side effect.
      //
      // Stripe already tells us; we simply were not listening. These are the
      // events that change whether somebody is entitled:
      //   invoice.payment_succeeded    the renewal — the day-8 case itself
      //   invoice.payment_failed       card declined; sub heads for past_due
      //   customer.subscription.updated  trial->active, ->past_due, ->canceled
      //   customer.subscription.deleted  cancellation
      //
      // checkAgentByEmail re-reads Stripe and rewrites the cache correctly, and
      // is already safe for manual grants: a comp (stripe_customer_id IS NULL)
      // returns before the cache write, and the downgrade path only touches
      // rows Stripe owns. So this cannot revoke a comp.
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        // Every subscription's renewal or decline can change the Pro answer
        // (a past_due Pro plan must read as owing, a renewed one as live).
        await refreshProEntitlement(
          stripe, supabase,
          invoice.customer_email ?? null,
          invoice.customer as string | { id?: string } | null,
          event.type,
        );
        // Filter to agent invoices so an unrelated subscription's renewal does
        // not spend two Stripe calls recomputing an answer that cannot change.
        if (!isAgentPriced(invoice.lines?.data as ReadonlyArray<{ price?: unknown }> | undefined)) {
          logStep("Invoice ignored for the agent cache (not the agent price)", { type: event.type, invoice: invoice.id });
          break;
        }
        await refreshAgentEntitlement(
          stripe, supabase,
          invoice.customer_email ?? null,
          invoice.customer as string | { id?: string } | null,
          event.type,
        );
        // A RENEWAL OF A RETIRED PLAN (S12-079): the month just paid runs
        // out and the plan never renews again; the owner is told the charge
        // happened. A failure answers 500 so Stripe redelivers.
        if (!AGENT_PRODUCTS_ON_SALE && event.type === "invoice.payment_succeeded") {
          const subId = refId(invoice.parent?.subscription_details?.subscription)
            ?? refId((invoice as unknown as { subscription?: unknown }).subscription);
          if (subId) {
            try {
              const sub = await stripe.subscriptions.retrieve(subId);
              await retireAgentPlan(stripe, supabase, sub, invoice.customer_email ?? await customerEmailOf(stripe, invoice.customer), event.type);
            } catch (err) {
              processingError = String(err).slice(0, 500);
              mustRetry = true;
              logStep("Retired agent plan not ended at renewal; Stripe will redeliver", { subscription: subId, error: processingError });
            }
          }
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        // A withdrawal's acknowledgement whose first send failed (S11-053):
        // a failure answers 500 so Stripe redelivers this event.
        if (event.type === "customer.subscription.deleted") {
          try {
            await sendPendingWithdrawal(supabase, sub);
          } catch (err) {
            processingError = String(err).slice(0, 500);
            mustRetry = true;
            logStep("Withdrawal acknowledgement not sent; Stripe will redeliver", { sub: sub.id, error: processingError });
          }
        }
        // A subscription event carries no email, only a customer reference.
        await refreshProEntitlement(
          stripe, supabase,
          null,
          sub.customer as string | { id?: string } | null,
          event.type,
        );
        if (!isAgentPriced(sub.items?.data as ReadonlyArray<{ price?: unknown }> | undefined)) {
          logStep("Subscription ignored for the agent cache (not the agent price)", { type: event.type, sub: sub.id });
          break;
        }
        await refreshAgentEntitlement(
          stripe, supabase,
          null,
          sub.customer as string | { id?: string } | null,
          event.type,
        );
        // A retired plan still set to renew is set to end (S12-079). The
        // update this makes comes back as this same event and finds it ending.
        if (!AGENT_PRODUCTS_ON_SALE && event.type === "customer.subscription.updated"
            && (sub.status === "trialing" || sub.status === "active") && !sub.cancel_at_period_end && !sub.cancel_at) {
          try {
            await retireAgentPlan(stripe, supabase, sub, await customerEmailOf(stripe, sub.customer), event.type);
          } catch (err) {
            processingError = String(err).slice(0, 500);
            mustRetry = true;
            logStep("Retired agent plan not ended; Stripe will redeliver", { sub: sub.id, error: processingError });
          }
        }
        break;
      }

      // A CUSTOMER DELETED IN STRIPE (S12-100), when the endpoint carries
      // the event: every cached plan of that customer lapses at once.
      case "customer.deleted": {
        const customer = event.data.object as { id?: string };
        if (customer.id) {
          const lapsed = await lapseDeletedCustomer(supabase, customer.id);
          logStep("Customer deleted: cached plans lapsed", { customer: customer.id, ...lapsed });
        }
        break;
      }

      // A DELAYED PAYMENT THAT FAILED (CP-029): nothing was charged and
      // nothing is delivered, and the buyer is told so once, with the way to
      // try again. The session was never claimed (it never passed the paid
      // gate), so no delivery row exists to close.
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const email = buyerEmailOf(session);
        EdgeRuntime.waitUntil((async () => {
          await supabase.from('payment_failures').insert({
            payment_intent_id: refId(session.payment_intent) ?? session.id,
            amount: session.amount_total || 0,
            currency: session.currency || 'usd',
            failure_code: 'async_payment_failed',
            failure_message: 'A delayed payment did not complete',
            customer_email: email,
            metadata: { session_id: session.id, product_type: session.metadata?.product_type },
          });
          if (!email) return;
          const r = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({
              kind: 'payment_failed', email, sessionId: session.id,
              productType: session.metadata?.product_type || 'unknown',
              productName: session.metadata?.product_name || 'your purchase',
              ...(session.metadata?.language ? { language: session.metadata.language } : {}),
            }),
          }).catch((e) => { logStep("Failed-payment mail threw", { error: String(e).slice(0, 200) }); return null; });
          if (r && !r.ok) logStep("Failed-payment mail refused", { status: r.status });
        })());
        break;
      }

      // THREE DAYS BEFORE A TRIAL ENDS Stripe sends this (once the owner adds
      // it to the endpoint): the subscriber is told the date and amount of
      // the first charge and how to cancel before it. A trial already set to
      // cancel is told nothing; a failure answers 500 so Stripe redelivers.
      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as Stripe.Subscription;
        // A RETIRED PLAN'S TRIAL (S12-079) ends without converting: never the
        // reminder of a coming charge, the plan-ends notice instead.
        if (!AGENT_PRODUCTS_ON_SALE && isAgentPriced(sub.items?.data as ReadonlyArray<{ price?: unknown }> | undefined)) {
          try {
            await retireAgentPlan(stripe, supabase, sub, await customerEmailOf(stripe, sub.customer), event.type);
          } catch (err) {
            processingError = String(err).slice(0, 500);
            mustRetry = true;
            logStep("Retired agent trial not ended; Stripe will redeliver", { sub: sub.id, error: processingError });
          }
          break;
        }
        if (sub.status !== "trialing" || sub.cancel_at_period_end || sub.cancel_at) {
          logStep("Trial ending: no reminder for a trial that will not convert", { sub: sub.id, status: sub.status });
          break;
        }
        try {
          const customerId = refId(sub.customer);
          const customer = customerId ? await stripe.customers.retrieve(customerId) : null;
          const email = customer && !(customer as { deleted?: boolean }).deleted ? (customer as Stripe.Customer).email ?? null : null;
          await sendSubscriptionNotice(supabase, stripe, "trial_ending", sub, email);
        } catch (err) {
          processingError = String(err).slice(0, 500);
          mustRetry = true;
          logStep("Trial reminder not sent; Stripe will redeliver", { sub: sub.id, error: processingError });
        }
        break;
      }

      // REFUNDS AND DISPUTES TAKE BACK WHAT THE PAYMENT BOUGHT (L6-18; owner
      // decision 2026-10-04). They used to change nothing: a refunded pass
      // kept its clock, refunded credits stayed spendable, a refunded product
      // could be regenerated, a refunded plan kept its grants. Now a refund
      // IN FULL, or any dispute, resolves the payment to what it bought and
      // payment_revoke (20261008131000) takes it back once per payment
      // intent; a refunded or disputed subscription is cancelled at once in
      // Stripe and both entitlement caches re-read. A partial refund is a
      // goodwill amount the owner chose: it is reported, nothing is revoked.
      // Work that did not finish answers 500, so Stripe redelivers it.
      // Stripe sends these only once the endpoint is subscribed to
      // charge.refunded and charge.dispute.created (an owner action).
      case "charge.refunded":
      case "charge.dispute.created": {
        const isRefund = event.type === "charge.refunded";
        const obj = event.data.object as {
          id: string; amount?: number; amount_refunded?: number; refunded?: boolean; currency?: string;
          payment_intent?: unknown; charge?: unknown; reason?: string | null; created?: number;
          invoice?: unknown; billing_details?: { email?: string | null } | null;
        };
        const intent = refId(obj.payment_intent);
        const amount = (isRefund ? obj.amount_refunded : obj.amount) ?? 0;
        const inFull = !isRefund || obj.refunded === true || (obj.amount_refunded ?? 0) >= (obj.amount ?? Number.POSITIVE_INFINITY);
        const lead = isRefund ? (inFull ? "Refund issued" : "Partial refund issued") : "Dispute opened";

        let summary = "nothing revoked";
        if (!inFull) {
          summary = "a partial refund: nothing revoked (refund in full to take the purchase back)";
        } else if (!intent) {
          summary = "no payment intent on the event: nothing could be matched to a purchase; review it by hand";
        } else {
          try {
            const charge = isRefund
              ? obj
              : await stripe.charges.retrieve(refId(obj.charge) ?? "").catch(() => null) as typeof obj | null;
            const target = await revocationTarget(stripe, charge, intent);
            const { data: receipt, error: revokeError } = await supabase.rpc("payment_revoke", {
              p_payment_intent_id: intent,
              p_reason: isRefund ? "refunded" : "disputed",
              p_stripe_event_id: event.id,
              p_stripe_session_id: target.sessionId,
              p_product_type: target.productType,
              p_email: target.email,
              p_user_id: target.userId,
              p_credits: target.credits,
              p_subscription_id: target.subscriptionId,
              p_paid_at: target.paidAt,
            });
            if (revokeError) throw new Error(`payment_revoke: ${revokeError.message}`);
            const r = (receipt ?? {}) as Record<string, unknown>;
            summary = r.duplicate === true
              ? "already taken back by an earlier event for this payment"
              : `claim revoked ${r.claim_revoked === true}, pass closed ${r.pass_closed === true}, applications stopped ${r.applications_stopped ?? 0}, credits taken back ${r.credits_clawed ?? 0}, Pro grants revoked ${r.grants_revoked ?? 0}`;

            if (target.subscriptionId) {
              const sub = await stripe.subscriptions.retrieve(target.subscriptionId);
              if (sub.status !== "canceled" && sub.status !== "incomplete_expired") {
                await stripe.subscriptions.cancel(target.subscriptionId);
              }
              summary += `; subscription ${target.subscriptionId} cancelled`;
              await refreshProEntitlement(stripe, supabase, target.email, target.customerId, event.type);
              await refreshAgentEntitlement(stripe, supabase, target.email, target.customerId, event.type);
            }
            logStep(isRefund ? "Refund revoked the purchase" : "Dispute revoked the purchase", {
              paymentIntent: intent, sessionId: target.sessionId, productType: target.productType, summary,
            });
          } catch (err) {
            processingError = String(err).slice(0, 500);
            mustRetry = true;
            summary = `REVOCATION FAILED, Stripe will redeliver: ${processingError}`;
            logStep("Revocation failed; answering 500 so Stripe redelivers", { paymentIntent: intent, error: processingError });
          }
        }
        sendFailureAlertBackground({
          type: `${lead}${!isRefund && obj.reason ? ` (${obj.reason})` : ""}: ${summary}`,
          amount,
          currency: obj.currency ?? "usd",
          failureCode: event.type,
          failureMessage: null,
          customerEmail: obj.billing_details?.email ?? null,
          paymentIntentId: intent ?? obj.id,
          subjectLead: lead,
        });
        break;
      }

      default:
        logStep("Unhandled event", { type: event.type });
    }

    // Log completion in background
    const processingTime = Date.now() - processingStart;
    EdgeRuntime.waitUntil(
      Promise.resolve(
        supabase.rpc('log_webhook_event', {
          p_event_type: event.type,
          p_event_id: event.id,
          p_processed: true,
          p_error: processingError,
          p_time_ms: processingTime
        })
      )
    );

    if (mustRetry) {
      return new Response(JSON.stringify({ error: "Processing incomplete; redeliver" }), {
        headers: { "Content-Type": "application/json", ...BUILD_HEADER },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json", ...BUILD_HEADER },
      status: 200
    });
  } catch (error) {
    console.error("[STRIPE-WEBHOOK] Error:", error);
    return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
      headers: { "Content-Type": "application/json", ...BUILD_HEADER },
      status: 500
    });
  }
});
