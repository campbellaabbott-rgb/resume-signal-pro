// BUY A PASS — one Stripe Checkout session for the six-hour Agent Pass.
//
// The pass is a third way to hold ONE entitlement (beside the Agent plan and
// a comp), never a fourteenth one-time SKU. So it does not go through
// create-product-checkout's PRODUCTS table: that flow takes an email from
// the request body, and a pass is bound to a USER (auth.users.id), never to
// an address. This function runs with verify_jwt (the Supabase default) and
// reads the buyer from the VERIFIED token exactly as agent-connect does —
// nothing about identity comes from the body. Applications key to
// agent_mandates.user_id and agent_queue.user_id; an email is a claim.
//
// WHAT IDENTIFIES THE PURCHASE is metadata.product_type, never the amount.
// Freelance Boost bills the same unit_amount (create-product-checkout), so an
// amount match in the webhook would be a live collision, not a hypothetical.
// The one Stripe-side price is the price_data line below, derived from the
// Deno constant; a dashboard Price object would be a second spelling no guard
// reads.
//
// TWO REFUSALS BEFORE STRIPE, both answered as JSON the page renders:
//   alreadySubscribed — an active Agent plan already includes applications,
//     and consumption never draws on a pass while a subscription is live, so
//     a subscriber's pass would buy six hours of raised quota for the full
//     price. The manual-grant guard in checkAgentByEmail is untouched.
//   alreadyLive — an open pass (unactivated or live) after the lazy close.
//     No stacking, no queueing: one open pass per user is a database fact
//     (the partial UNIQUE), and "buy again when the clock ends" costs the
//     buyer nothing.
//
// Its rate bucket is its own name through check_rate_limit, like every other
// checkout; it is NOT one of the budget-enforced front-door functions and
// never asks the cross-function budget (project_rate_budget — naming that
// gate's function even in prose makes the scope guard count this file as an
// enforcer, so it is described here, not spelled).

import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkAgentByEmail } from "../_shared/agent.ts";
import {
  PASS_APPLICATIONS,
  PASS_PRICE_CENTS,
  PASS_PRODUCT_NAME,
  PASS_PRODUCT_TYPE,
  PASS_SESSION_HOURS,
} from "../_shared/pass.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

/**
 * The caller's address as the platform saw it: cf-connecting-ip, else the
 * LAST x-forwarded-for hop (the one the nearest proxy appended — the first
 * hop is whatever the caller wrote).
 */
function callerAddress(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const hops = String(headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1) || "unknown";
}

// deno-lint-ignore no-explicit-any
type ServiceClient = SupabaseClient<any, any, any>;

/**
 * THE SHARED LAZY CLOSE, in PostgREST's vocabulary. The SQL readers close a
 * pass whose clock or shelf has run out in one statement; PostgREST cannot
 * express the coalesce, so it is two idempotent updates: an activated pass
 * whose session ended, and an unactivated one whose shelf expired. After
 * this, "closed_at IS NULL" means genuinely open.
 */
async function lazyClosePasses(service: ServiceClient, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await service.from("agent_passes")
    .update({ closed_at: now, close_reason: "session_ended" })
    .eq("user_id", userId).is("closed_at", null).not("activated_at", "is", null).lte("expires_at", now);
  await service.from("agent_passes")
    .update({ closed_at: now, close_reason: "shelf_expired" })
    .eq("user_id", userId).is("closed_at", null).is("activated_at", null).lte("shelf_expires_at", now);
}

type OpenPass = {
  activated_at: string | null;
  expires_at: string | null;
  shelf_expires_at: string;
  applications_total: number;
  applications_used: number;
  session_hours: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // The buyer, from the VERIFIED token — the anon-key client validates the
  // JWT; the body is never consulted for identity.
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user?.id || !user.email) {
    return json({ error: "Sign in to buy a pass — it is bound to your account, not an address." }, 401);
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Own bucket, own name. Not budget-enforced: see the header.
  const { data: allowed } = await service.rpc("check_rate_limit", {
    p_function: "create-pass-checkout",
    p_ip: callerAddress(req.headers),
    p_max_requests: 30,
    p_window_minutes: 60,
  });
  if (allowed === false) return json({ error: "Too many requests. Please try again later." }, 429);

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    // Refusal one: an active Agent plan already includes applications.
    const existing = await checkAgentByEmail(stripe, service, user.email);
    if (existing.active) {
      return json({
        alreadySubscribed: true,
        error: "Your Agent plan already includes applications — a pass would add nothing you do not already have.",
      });
    }

    // Refusal two: an open pass. Lazy-close first, so a pass whose clock ran
    // out yesterday never blocks today's purchase.
    await lazyClosePasses(service, user.id);
    const { data: openRow } = await service.from("agent_passes")
      .select("activated_at, expires_at, shelf_expires_at, applications_total, applications_used, session_hours")
      .eq("user_id", user.id).is("closed_at", null).maybeSingle();
    const open = openRow as OpenPass | null;
    if (open) {
      const applicationsLeft = Math.max(0, Number(open.applications_total) - Number(open.applications_used));
      const live = open.activated_at !== null;
      const endsAt = live ? open.expires_at : null;
      const hoursLeft = live && endsAt
        ? Math.max(0, (Date.parse(endsAt) - Date.now()) / 3_600_000)
        : Number(open.session_hours);
      const hoursText = live ? `${hoursLeft.toFixed(1)} hours` : `all ${open.session_hours} hours`;
      return json({
        alreadyLive: true,
        state: live ? "live" : "unactivated",
        hoursLeft: Number(hoursLeft.toFixed(2)),
        applicationsLeft,
        endsAt,
        shelfExpiresAt: open.shelf_expires_at,
        error: live
          ? `You already have a pass running — ${hoursText} and ${applicationsLeft} applications left. Buy another when the clock ends.`
          : `You already hold a pass that has not started — ${hoursText} and ${applicationsLeft} applications are waiting for your agent's first call. Buy another when it ends.`,
      });
    }

    const origin = req.headers.get("origin") || "https://resumebooster.work";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      // The buyer's id rides in BOTH places Stripe carries it, so the webhook
      // can bind the pass to the account whichever one it reads.
      client_reference_id: user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: PASS_PRICE_CENTS,
            product_data: {
              name: PASS_PRODUCT_NAME,
              description:
                `${PASS_SESSION_HOURS} hours with your own AI agent on the board and up to ${PASS_APPLICATIONS} applications requested through it. ` +
                "The clock starts at your agent's first call, not at purchase. Never renews.",
            },
          },
        },
      ],
      metadata: {
        product_type: PASS_PRODUCT_TYPE,
        product_name: PASS_PRODUCT_NAME,
        user_id: user.id,
        customer_email: user.email,
      },
      // The post-purchase page repairs a late webhook from this session id
      // (agent-pass-status), then hands the buyer the connect block for their
      // host. The placeholder is Stripe's, verbatim.
      success_url: `${origin}/agents/pass?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/agents?pass=cancelled`,
      allow_promotion_codes: true,
      automatic_tax: { enabled: false },
    });

    console.log(`[CREATE-PASS-CHECKOUT] Session ${session.id} created for user ${user.id}`);
    return json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("[CREATE-PASS-CHECKOUT] Error:", error instanceof Error ? error.message : error);
    return json({ error: "Failed to create checkout. Please try again." }, 500);
  }
});
