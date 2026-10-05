// Creates a Stripe Checkout session for the Apply Agent — $99/month Morning
// Queue subscription (includes everything in Pro). Inline recurring price_data,
// same pattern as create-subscription-checkout: no dashboard Price needed.
//
// SIGNED-IN CALLERS ONLY, AND ONLY ABOUT THEMSELVES (register 2.09, the
// oracle's second door; agents-api review 2026-10-05). It took `email` from an
// unauthenticated body and ran checkAgentByEmail on it before anything else,
// answering {alreadySubscribed: true} exactly when that address held a live
// agent plan — anyone could check any address — and every call was a paged
// Stripe customer + subscription listing, a cache upsert and, for a
// non-subscriber, a Checkout session, with no limiter. Now the buyer is the
// VERIFIED session: the body is never read for identity, the guard asks only
// about the caller's own address, and the door is rate-limited per network.
//
// AND THE PLAN BELONGS TO THE ACCOUNT THAT BOUGHT IT (1.07). The buyer's user
// id rides the session (client_reference_id, metadata) and the subscription
// itself (subscription_data.metadata.user_id); checkAgentByEmail — which the
// webhook runs on purchase — copies it onto agent_subscribers.user_id, and
// every gate reads the plan by that id (agent_subscription_rows). Sign-ups are
// confirmed automatically, so an address alone is not proof of who paid.
//
// MERGE NOTE: the payments wave (main, 820a3ff0) rewrote this file to sell
// only to a signed-in caller as well (signedInEmail, the standing guard). The
// two reconcile as main's file plus the three user-id stamps below.

// deploy-stamp: 2026-10-05T12:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { AGENT_PRICE_CENTS, AGENT_PRODUCT_NAME, checkAgentByEmail } from "../_shared/agent.ts";
import { checkoutContextOf, recordCheckoutStart } from "../_shared/checkout-start.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { bearerOf } from "../_shared/service-caller.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "create-agent-checkout.2026-10-05.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Per network, before anything else is spent. A counter that cannot be
    // asked does not refuse (a checkout is revenue); only an explicit no does.
    const { data: allowed } = await supabase.rpc("check_rate_limit", {
      p_function: "create-agent-checkout",
      p_ip: clientAddressOr(req.headers),
      p_max_requests: 20,
      p_window_minutes: 60,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The buyer, from the VERIFIED token. The publishable key every visitor
    // holds is not a user and is never sent to the auth server.
    const token = bearerOf(req.headers);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const { data: userData } = token && token !== anonKey
      ? await supabase.auth.getUser(token).catch(() => ({ data: null }))
      : { data: null };
    const user = (userData as { user?: { id?: string; email?: string | null } | null } | null)?.user ?? null;
    const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!user?.id || !email) {
      return new Response(JSON.stringify({ error: "Sign in to start the agent, so it is attached to your account.", signInRequired: true }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));

    // Don't double-bill an existing agent subscriber — asked about the
    // caller's own address, never one a body names.
    const existing = await checkAgentByEmail(stripe, supabase, email);
    if (existing.active) {
      return new Response(JSON.stringify({ alreadySubscribed: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || "https://resumebooster.work";
    // The buyer's user id ON THE SUBSCRIPTION — the copy checkAgentByEmail
    // reads to bind agent_subscribers.user_id, on every later refresh.
    const subscriptionBuyer = { user_id: user.id };
    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      // THE BUYER, three ways: the session, its metadata, and the
      // subscription the session creates — the last is what checkAgentByEmail
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
      // entitlement (and the nightly runner) work from day one.
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

    console.log(`[CREATE-AGENT-CHECKOUT] Session ${session.id} created for ${email}`);
    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[CREATE-AGENT-CHECKOUT] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
