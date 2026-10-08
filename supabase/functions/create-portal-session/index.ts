// deploy-stamp: 2026-10-08T13:00Z
// Opens the Stripe customer billing portal so Pro subscribers can update
// their card or cancel. Requires a signed-in user (JWT) — the portal exposes
// billing details, so an email in the body is not enough.
//
// Its Stripe read (checkProByEmail) refreshes the Pro cache, which since
// wave 2 also binds the row to the account a plan names (20261008130000).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkProByEmail } from "../_shared/pro.ts";
import { provenMailbox } from "../_shared/mailbox-proof.ts";

// Provable from outside without an account: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "create-portal-session.2026-10-08.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Sign in required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwt = authHeader.replace("Bearer ", "");
    const { data } = await supabase.auth.getUser(jwt);
    const email = data?.user?.email?.toLowerCase();
    if (!email) {
      return new Response(JSON.stringify({ error: "Sign in required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const status = await checkProByEmail(stripe, supabase, email);
    if (!status.stripeCustomerId) {
      return new Response(JSON.stringify({ error: "No subscription found for this account" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A SESSION FOR AN ADDRESS IS NOT THE SUBSCRIBER (sweep S8-001). While
    // sign-ups are auto-confirmed, anyone can register a subscriber's address
    // and hold a session for it at once; the portal shows their card, address
    // and invoices and can cancel the plan. It opens here only for the account
    // the plan names (metadata.user_id) or a session that proved the mailbox.
    // Anyone else is sent to Stripe's own emailed portal login, which proves
    // the mailbox itself, so a paying password user can still cancel.
    const bound = !!data?.user?.id && status.boundUserId === data.user.id;
    const proven = bound || !!(await provenMailbox(data?.user, jwt, {
      db: supabase,
      confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
      supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
      anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    }));
    if (!proven) {
      const loginUrl = Deno.env.get("STRIPE_PORTAL_LOGIN_URL") ?? "";
      if (/^https:\/\/billing\.stripe\.com\//.test(loginUrl)) {
        return new Response(JSON.stringify({ url: loginUrl, verify: "email" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        error: "To protect your billing details, open billing from the link in your Stripe receipt, or email resumeboostersupp@gmail.com from this address.",
        code: "mailbox_unproven",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const origin = req.headers.get("origin") || "https://resumebooster.work";
    const portal = await stripe.billingPortal.sessions.create({
      customer: status.stripeCustomerId,
      return_url: `${origin}/account`,
    });

    return new Response(JSON.stringify({ url: portal.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[CREATE-PORTAL-SESSION] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
