// deploy-stamp: 2026-10-09T13:00Z
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
import { checkoutOrigin } from "../_shared/checkout-policy.ts";

// Provable from outside without an account: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-10-14.1 (R1 integration): _shared/mailbox-proof.ts gained the proof-row
// readers and maskEmail; provenMailbox, the one import here, is unchanged.
// 2026-10-14.23 (wave 4 round 2, checkout-catalogue; R1 stamped this function
// on a later day, so it keeps that day with a higher sequence): the portal
// returns to /account?portal=return, so the Pro card asks Stripe again and a
// plan cancelled there reads "Ends", not "Renews" (S12-076); a plan bound to
// this account is found by the account when the address on it has changed
// (S12-053, the portal half).
const FN_BUILD = "create-portal-session.2026-10-14.23";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

/** Does a Pro or agent cache row bound to this account name this Stripe customer? */
async function rowBindsCustomer(
  // deno-lint-ignore no-explicit-any
  db: { from: (t: string) => any },
  userId: string,
  customerId: string,
): Promise<boolean> {
  for (const table of ["pro_subscribers", "agent_subscribers"]) {
    try {
      const { data, error } = await db.from(table).select("user_id")
        .eq("user_id", userId).eq("stripe_customer_id", customerId).limit(1);
      if (!error && Array.isArray(data) && data.length > 0) return true;
    } catch (_) {
      // An unread table proves nothing; the other proofs still apply.
    }
  }
  return false;
}

/** The Stripe customer a Pro or agent cache row bound to this account names, newest first; null for none. */
async function boundCustomerOf(
  // deno-lint-ignore no-explicit-any
  db: { from: (t: string) => any },
  userId: string,
): Promise<string | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
  for (const table of ["pro_subscribers", "agent_subscribers"]) {
    try {
      const { data, error } = await db.from(table).select("stripe_customer_id, updated_at")
        .eq("user_id", userId).order("updated_at", { ascending: false }).limit(10);
      const rows = !error && Array.isArray(data) ? data as Array<{ stripe_customer_id?: unknown }> : [];
      const id = rows.map((r) => r.stripe_customer_id).find((c) => typeof c === "string" && c.startsWith("cus_"));
      if (typeof id === "string") return id;
    } catch (_) {
      // An unread table names no customer.
    }
  }
  return null;
}

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
    // THE ACCOUNT'S OWN PLAN, WHEN ITS ADDRESS CHANGED (S12-053). Stripe is
    // searched by the account's CURRENT address, so after an address change a
    // subscriber's plan was not found and the portal answered 404 while the
    // plan kept charging. A cache row bound to this account names its
    // customer; that binding is the same proof the check below accepts.
    if (!status.stripeCustomerId) {
      const boundCustomer = await boundCustomerOf(supabase, data?.user?.id ?? "");
      if (boundCustomer) {
        status.stripeCustomerId = boundCustomer;
        status.boundUserId = data?.user?.id ?? null;
      }
    }
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
    //
    // A ROW THE DATABASE ALREADY BINDS COUNTS TOO (S11-015; owner decision
    // 2026-10-11). Plans bought before checkouts stamped metadata.user_id
    // carry no buyer in Stripe, but 20261008130000 bound their cache rows to
    // the account, and check-subscription reads them as this account's. Such
    // a subscriber was offered "Manage subscription" and then refused. A Pro
    // or agent row bound to THIS account whose stripe_customer_id is the
    // customer the portal would open is the proof the plan gates accept.
    const uid = data?.user?.id ?? "";
    const bound = !!uid && (status.boundUserId === uid || await rowBindsCustomer(supabase, uid, status.stripeCustomerId));
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

    // Only our own hosts get the subscriber back (S8-060).
    const origin = checkoutOrigin(req.headers.get("origin"), (k) => Deno.env.get(k));
    const portal = await stripe.billingPortal.sessions.create({
      customer: status.stripeCustomerId,
      // The marker tells the Pro card to ask Stripe again (check-subscription
      // fresh), so a cancel made in the portal shows at once (S12-076).
      return_url: `${origin}/account?portal=return`,
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
