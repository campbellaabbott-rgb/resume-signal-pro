// Creates a Stripe Checkout session for the Apply Agent — $99/month Morning
// Queue subscription (includes everything in Pro). Inline recurring price_data,
// same pattern as create-subscription-checkout: no dashboard Price needed.
//
// SIGNED-IN CALLERS ONLY, for their own address (2026-10-04 completeness
// review): it used to answer {alreadySubscribed: true} for any address a
// stranger posted, spending unmetered Stripe calls on each guess. The guard
// below needs that lookup, and it may only be answered about the caller.
// Rate-limited per network address.
//
// THE GUARD, which now sees every plan the address holds, not only the agent:
//   - a live agent plan: already subscribed;
//   - any plan that owes money (past_due, unpaid...): update the card -- the
//     old guard refused only an ACTIVE agent plan, so a declined card was
//     offered a second subscription and a fresh seven-day trial (L6-06);
//   - a live $45 Pro plan not yet cancelled: refused with the way out, since
//     the agent would bill beside it ($144 a month for $99 of entitlement,
//     with only the newer plan visible in the portal -- L6-05).
// A new subscription is billed to the Stripe customer the address already
// has, so one portal sees everything it pays for.

// AND THE PLAN BELONGS TO THE ACCOUNT THAT BOUGHT IT (1.07). The buyer's user
// id rides the session (client_reference_id, metadata) and the subscription
// itself (subscription_data.metadata.user_id); checkAgentByEmail — which the
// webhook runs on purchase — copies it onto agent_subscribers.user_id, and
// every gate reads the plan by that id (agent_subscription_rows). Sign-ups are
// confirmed automatically, so an address alone is not proof of who paid.

// deploy-stamp: 2026-10-05T13:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { AGENT_PRICE_CENTS, AGENT_PRODUCT_NAME, manualAgentGrant } from "../_shared/agent.ts";
import { subscriptionStandingByEmail } from "../_shared/pro.ts";
import { checkoutVerdict, verdictBody } from "../_shared/subscription-standing.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { checkoutContextOf, recordCheckoutStart } from "../_shared/checkout-start.ts";
import { bearerOf } from "../_shared/service-caller.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "create-agent-checkout.2026-10-05.3";

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
      p_function: "create-agent-checkout",
      p_ip: clientAddressOr(req.headers),
      p_max_requests: 20,
      p_window_minutes: 60,
    });
    if (allowed === false) return json({ error: "Too many requests. Please try again later." }, 429);

    // The buyer, from the VERIFIED token: id and address. The publishable key
    // every visitor holds is not a user and is never sent to the auth server,
    // and a body address is never read for identity.
    const token = bearerOf(req.headers);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const { data: userData } = token && token !== anonKey
      ? await supabase.auth.getUser(token).catch(() => ({ data: null }))
      : { data: null };
    const user = (userData as { user?: { id?: string; email?: string | null } | null } | null)?.user ?? null;
    const email = typeof user?.email === "string" && user.email.includes("@") ? user.email.trim().toLowerCase() : "";
    if (!user?.id || !email) {
      return json({ error: "Sign in to start the agent, so it is attached to your account.", signInRequired: true }, 401);
    }
    const body = await req.json().catch(() => ({}));

    // An account granted the agent by hand already has it.
    if (await manualAgentGrant(supabase, email)) return json({ alreadySubscribed: true, tier: "agent" });

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    const standing = await subscriptionStandingByEmail(stripe, email);
    const verdict = checkoutVerdict(standing, "agent");
    if (verdict.kind !== "proceed") return json(verdictBody(verdict));

    const origin = req.headers.get("origin") || "https://resumebooster.work";
    // The buyer's user id ON THE SUBSCRIPTION — the copy checkAgentByEmail
    // reads to bind agent_subscribers.user_id, on every later refresh.
    const subscriptionBuyer = { user_id: user.id };
    const session = await stripe.checkout.sessions.create({
      ...(standing.reuseCustomerId ? { customer: standing.reuseCustomerId } : { customer_email: email }),
      // THE BUYER, three ways: the session, its metadata, and the
      // subscription the session creates -- the last is what checkAgentByEmail
      // reads to bind agent_subscribers.user_id.
      client_reference_id: user.id,
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: AGENT_PRICE_CENTS,
            recurring: { interval: "month" },
            product_data: {
              name: AGENT_PRODUCT_NAME,
              description:
                "Your overnight job-search agent: every morning, a reviewed shortlist of fresh roles scored against your resume — churny companies skipped, genuine hirers prioritized — each one tap from a tailored application kit. You always press send. Includes everything in Pro.",
            },
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      // The Agent sells an experience ("wake up to a shortlist") that has to
      // be FELT once — 7 free mornings before the first charge.
      // checkAgentByEmail already treats 'trialing' as active, so the
      // entitlement (and the nightly runner) work from day one. Whether a
      // returning subscriber gets another trial is an open owner decision
      // (platform sweep L6-29); the guard above already refuses a new trial
      // to anyone whose plan owes money.
      subscription_data: { trial_period_days: 7, metadata: subscriptionBuyer },
      // LAND THEM WHERE THE AGENT IS SET UP, NOT ON THE ACCOUNT PAGE.
      //
      // This used to return the buyer to `/account?agent=success` — and nothing
      // in the app has ever read that parameter (Account.tsx does not call
      // useSearchParams at all). So a customer who had just paid $99 was
      // dropped at the top of a 1,768-line account page with no banner, no
      // scroll and no prompt, while the thing they bought sat inert.
      //
      // That mattered more than a cosmetic miss, because BUYING DOES NOT CREATE
      // A MANDATE. apply-agent opens with `agent_mandates WHERE active = true`;
      // nothing at checkout writes that row, and the only writers are panels the
      // customer has to find and drive by hand. With no mandate the hourly run
      // matches zero rows and does nothing — no queue, no digest, no error.
      // Indistinguishable from a quiet night, forever. The redirect was the
      // cheapest place to make the required step unmissable.
      //
      // /agent renders AgentSetupChecklist first, which reads live state and
      // names the three prerequisites (CV/consent, exclusions, active mandate)
      // with the consequence of skipping each.
      //
      // `welcome=1` IS READ — see src/pages/Agent.tsx. Do not add a parameter
      // here without wiring the reader; a redirect carrying a flag nobody
      // consumes is precisely the bug this replaced.
      success_url: `${origin}/agent?welcome=1`,
      // Cancel returns to the agent page too, where the pitch and the retry
      // path live — not to an account page that says nothing about why they
      // came. NO FLAG: the first draft of this line carried `?checkout=cancelled`
      // and the guard rejected it within a minute, because nothing reads it.
      // Someone who backed out of a payment needs no banner about it.
      cancel_url: `${origin}/agent`,
      metadata: { product_type: "apply_agent", customer_email: email, user_id: user.id },
    });

    // The start is on record before the browser has the url, so no
    // navigation can race it; keyed on the session id, so a second checkout
    // is a second row. Never blocks the purchase. amount_total is zero on a
    // trial, so the plan price travels in metadata by name.
    await recordCheckoutStart(supabase, {
      stripeSessionId: session.id,
      checkoutFunction: "create-agent-checkout",
      productType: "apply_agent",
      productId: null,
      amountCents: session.amount_total,
      currency: session.currency,
      mode: session.mode,
      context: checkoutContextOf(body),
      metadata: { planCents: AGENT_PRICE_CENTS, trial: session.payment_status === "no_payment_required" },
    });

    console.log(`[CREATE-AGENT-CHECKOUT] Session ${session.id} created`);
    return json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("[CREATE-AGENT-CHECKOUT] Error:", error);
    return json({ error: "Could not start checkout. Please try again." }, 500);
  }
});
