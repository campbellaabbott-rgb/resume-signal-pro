// Creates a Stripe Checkout session for the Apply Agent — $99/month Morning
// Queue subscription (includes everything in Pro). Inline recurring price_data,
// same pattern as create-subscription-checkout: no dashboard Price needed.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { AGENT_PRICE_CENTS, AGENT_PRODUCT_NAME, checkAgentByEmail } from "../_shared/agent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "A valid email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Don't double-bill an existing agent subscriber.
    const existing = await checkAgentByEmail(stripe, supabase, email);
    if (existing.active) {
      return new Response(JSON.stringify({ alreadySubscribed: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || "https://resumebooster.work";
    const session = await stripe.checkout.sessions.create({
      customer_email: email,
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
      subscription_data: { trial_period_days: 7 },
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
      metadata: { product_type: "apply_agent", customer_email: email },
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
