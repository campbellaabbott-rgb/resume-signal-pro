// deploy-stamp: 2026-10-09T18:00Z
// Creates a Stripe Checkout session for Resume Booster Pro — $45/month,
// everything in a free account plus the writing tools (the product line of
// 2026-10-12). Uses inline recurring price_data so no Price object needs to
// exist in the Stripe dashboard.
//
// SIGNED-IN CALLERS ONLY, for their own address (2026-10-04 completeness
// review). It used to take any address from the body and answer
// {alreadySubscribed: true} when that address paid us -- a subscription
// oracle for strangers that spent unmetered Stripe calls on every guess. The
// double-billing guard needs that lookup, and a lookup may only be answered
// about the caller, so the caller must be known: the page sends a signed-out
// visitor to sign in first (the success page, /account, needs an account
// anyway, and so does cancelling). Rate-limited per network address.
//
// THE GUARD (platform sweep L6-06): a plan that owes money (past_due,
// unpaid...) answers needsPaymentUpdate -- the fix is the card, not a second
// subscription that bills beside the first once Stripe's retry succeeds. A
// new subscription is billed to the Stripe customer the address already has,
// so the portal can see everything it pays for (L6-05).
//
// AND THE PLAN BELONGS TO THE ACCOUNT THAT BOUGHT IT (wave 2, L6-08). The
// buyer's user id rides the session (client_reference_id, metadata) and the
// subscription itself (subscription_data.metadata.user_id); checkProByEmail,
// which the webhook runs on purchase, copies it onto pro_subscribers.user_id,
// and every gate reads the plan by that id (pro_entitlement_rows). An address
// is a claim a password sign-up can make. NO TRIAL is offered here, so the
// one-trial rule of create-agent-checkout has nothing to guard.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { PRO_PRICE_CENTS, PRO_PRODUCT_NAME, subscriptionStandingByEmail } from "../_shared/pro.ts";
import { manualAgentGrant } from "../_shared/agent.ts";
import { checkoutVerdict, verdictBody } from "../_shared/subscription-standing.ts";
import { signedInUser } from "../_shared/signed-in-email.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { checkoutContextOf, recordCheckoutStart } from "../_shared/checkout-start.ts";
import { checkoutLanguageOf, checkoutOrigin, euConsentAnswer, euConsentRefusal, policyMetadata, renewalTerms, sessionPolicy } from "../_shared/checkout-policy.ts";
import { ipinfoLookup, territoryAnswer, territoryRefusal } from "../_shared/sales-territory.ts";
import { reusableCustomer } from "../_shared/customer-ownership.ts";
import { recordCheckoutBuyer } from "../_shared/checkout-buyer.ts";
import { PRO_FIRST_MONTH_COMMISSION_CENTS, PRO_FIRST_MONTH_MARKER } from "../_shared/affiliate-commission.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-10-11.23 (wave 4 round 2, checkout-catalogue): a buyer in the EU, the
// EEA or the UK is refused while the EU/UK switch is off; the address's
// existing Stripe customer is reused only when this account provably owns it
// (S12-099); Pro's Stripe description says what Pro is since the product line
// (no cut product named); a referral earns the flat first-month commission;
// the account is written to checkout_buyers; the billing address is collected.
const FN_BUILD = "create-subscription-checkout.2026-10-11.23";

/** What Stripe's page and receipts say Pro is: the Pro card's lines (src/config/pro-perks.ts), in one sentence. */
export const PRO_STRIPE_DESCRIPTION =
  "Everything in a free account, plus the writing tools: a tailored résumé, cover letter and interview prep for your jobs (up to 5 sets a day and 60 a month), batch application prep, the $5 Full Analysis, Freelance Boost and Transition Pro included, and unlimited scans.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Fail open on a counter error (a checkout is revenue); only an explicit
    // "no" refuses.
    const { data: allowed } = await supabase.rpc("check_rate_limit", {
      p_function: "create-subscription-checkout",
      p_ip: clientAddressOr(req.headers),
      p_max_requests: 20,
      p_window_minutes: 60,
    });
    if (allowed === false) return json({ error: "Too many requests. Please try again later." }, 429);

    const buyer = await signedInUser(supabase.auth, req.headers, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const email = buyer?.email ?? null;
    if (!buyer?.id || !email) {
      return json({ error: "Sign in to subscribe, so the plan is attached to your account.", signInRequired: true }, 401);
    }
    const body = await req.json().catch(() => ({}));
    const env = (k: string) => Deno.env.get(k);
    // The EU/UK switch, off by default: with it on, the buyer must have asked
    // for the service to start inside the withdrawal period.
    const consentMissing = euConsentRefusal(env, "subscription", body);
    if (consentMissing) return json(euConsentAnswer(consentMissing), 400);

    // NO SALE INTO THE EU, THE EEA OR THE UK WHILE THE SWITCH IS OFF (S12-059).
    const territory = await territoryRefusal({
      env, headers: req.headers, body, address: clientAddressOr(req.headers), lookup: ipinfoLookup(env),
    });
    if (territory) {
      const answer = territoryAnswer(territory, { body, acceptLanguage: req.headers.get("accept-language") });
      console.log(`[CREATE-SUBSCRIPTION-CHECKOUT] refused: the buyer is in the VAT territory (${territory.signal})`);
      return json(answer.body, answer.status);
    }

    // An account granted the agent by hand already has Pro (the agent includes it).
    if (await manualAgentGrant(supabase, email)) return json({ alreadySubscribed: true, tier: "agent" });

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    // Don't double-bill: a live plan, or one that owes money, is answered
    // before Stripe is asked for anything new.
    const standing = await subscriptionStandingByEmail(stripe, email);
    const verdict = checkoutVerdict(standing, "pro");
    if (verdict.kind !== "proceed") return json(verdictBody(verdict));

    // Only our own hosts get the buyer back (S8-060); a forged Origin gets the site.
    const origin = checkoutOrigin(req.headers.get("origin"), env);
    // A referred customer's first paid Pro month is the one sale an affiliate
    // earns on (_shared/affiliate-commission.ts): Pro sells no trial, so this
    // session is that month.
    const policy = policyMetadata(body, env, { commission: PRO_FIRST_MONTH_MARKER, commissionCents: PRO_FIRST_MONTH_COMMISSION_CENTS });
    // THE ADDRESS'S STRIPE CUSTOMER ONLY IF THIS ACCOUNT OWNS IT (S12-099): a
    // password sign-up on a former customer's address must not have its plan
    // billed to that customer and see their invoices in the portal.
    const reuseCustomerId = await reusableCustomer(supabase, { id: buyer.id, email }, standing.reuseCustomerId);
    // The buyer's user id ON THE SUBSCRIPTION: the copy checkProByEmail reads
    // to bind pro_subscribers.user_id, on every later refresh.
    // The service-start request (EU/UK switch) rides on the plan too: a
    // withdrawal reads it there to know whether the days provided may be kept.
    const subscriptionBuyer = {
      user_id: buyer.id,
      ...(policy.service_start_consent ? { service_start_consent: policy.service_start_consent } : {}),
    };
    const session = await stripe.checkout.sessions.create({
      ...(reuseCustomerId ? { customer: reuseCustomerId } : { customer_email: email }),
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: PRO_PRICE_CENTS,
            recurring: { interval: "month" },
            product_data: {
              name: PRO_PRODUCT_NAME,
              description: PRO_STRIPE_DESCRIPTION,
            },
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      // THE BUYER, three ways (the session, its metadata, the subscription).
      client_reference_id: buyer.id,
      subscription_data: { metadata: subscriptionBuyer },
      // The session id comes back so the account page can confirm the plan
      // before the webhook has refreshed the cache (S8-055).
      success_url: `${origin}/account?pro=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?pro=cancelled`,
      metadata: { product_type: "pro_subscription", customer_email: email, user_id: buyer.id, ...policy },
      // Renewal terms beside Stripe's pay button, tax only with the EU/UK switch on.
      // In the buyer's site language, with Stripe's page in the same one.
      ...sessionPolicy({
        mode: "subscription", env, hasCustomer: !!reuseCustomerId,
        renewal: renewalTerms(PRO_PRICE_CENTS, null, checkoutLanguageOf(body)), language: checkoutLanguageOf(body),
      }),
    });

    // The start is on record before the browser has the url, so no
    // navigation can race it; keyed on the session id, so a second checkout
    // is a second row. Never blocks the purchase.
    await recordCheckoutStart(supabase, {
      stripeSessionId: session.id,
      checkoutFunction: "create-subscription-checkout",
      productType: "pro_subscription",
      productId: null,
      amountCents: session.amount_total,
      currency: session.currency,
      mode: session.mode,
      context: checkoutContextOf(body),
      metadata: { planCents: PRO_PRICE_CENTS, termsVersion: policy.terms_version || null, referral: !!policy.referral_code, serviceStartConsent: policy.service_start_consent ?? null },
    });
    // The account behind the session, before the browser has the url (CP-022).
    await recordCheckoutBuyer(supabase, {
      stripeSessionId: session.id, caller: { kind: "signed_in", id: buyer.id, email }, checkoutFunction: "create-subscription-checkout", productType: "pro_subscription",
    });

    console.log(`[CREATE-SUBSCRIPTION-CHECKOUT] Session ${session.id} created`);
    return json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("[CREATE-SUBSCRIPTION-CHECKOUT] Error:", error);
    return json({ error: "Could not start checkout. Please try again." }, 500);
  }
});
