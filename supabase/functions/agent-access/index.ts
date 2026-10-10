// THE SIGNED-IN USER'S AGENT, AS THEIR ACCOUNT PAGE ASKS ABOUT IT.
//
//   POST {}                         -> may this account's agent act, and on what?
//                                      { active, tier, status, currentPeriodEnd,
//                                        pass: {state, applicationsLeft, ...} }
//   POST {action:"approve", id}     -> release one waiting packet (held for
//                                      review, review mode, sender offline,
//                                      daily cap) with the cancel window
//   POST {action:"cancel",  id}     -> stop one packet no worker holds
//
// WHO IT ANSWERS ABOUT: the caller, from the VERIFIED session, and nobody else.
//
// It used to take an email from the request body with no authentication and
// answer {active, status, currentPeriodEnd, stripeCustomerId} for ANY address
// (defect sweep 2.09): whether a stranger pays for the agent, when their card
// renews, and their Stripe customer id — and every call ran a paged Stripe
// customer + subscription listing with no limiter, so a loop was unmetered
// Stripe traffic on this account's key. Now there is no address to name: the
// account's own address comes from the token, the Stripe read is metered per
// account and per network, a live answer cached in the last ten minutes is
// served without asking Stripe, and the customer id never leaves.
//
// AND IT KNOWS ABOUT THE PASS (L3-02). A $29 Agent Pass is a second way to be
// allowed, and this endpoint asked only Stripe about the $99 plan — so a pass
// holder's account page showed the $99 paywall with every Activate and Resume
// control disabled, and the only writer of agent_mandates.active was behind
// them. request_application then refused every call with "your agent is
// switched off". A pass that is open (bought and not yet started, or running
// with applications left) now answers active, tier "pass".
//
// AND THE SUBSCRIPTION IS THE ACCOUNT'S, NOT THE ADDRESS'S. Sign-ups are
// confirmed automatically, so "the session's address has a plan" is not proof
// the session bought it: registering a subscriber's address (one with no
// account yet) made this answer active for the registrant. The answer is now
// agent_subscription_rows(user id): a plan bound to this account (the buyer's
// user id rides the Stripe subscription, stamped by create-agent-checkout and
// copied onto the row by checkAgentByEmail), or one on a mailbox the account
// has proven. A live plan on the address that is neither answers inactive with
// subscriptionUnbound, so the page can say so rather than sell a second one.
//
// The two decisions go through the service-role agent_packet_decide with the
// verified user id; the vendor check is made here because "can the worker
// complete this vendor's form" lives in TypeScript (SENDABLE_VENDORS).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkAgentByEmail } from "../_shared/agent.ts";
import { ACCOUNT_SUBSCRIPTION_RPC, accountSubscription, normalizeEmail, rowIsEntitled, type AccountSubscriptionRow } from "../_shared/agent-entitlement.ts";
import { isSendableVendor } from "../_shared/apply-automation.ts";
import { networkBucket } from "../_shared/network-bucket.ts";

// Provable from outside without signing in: the preflight carries it.
// 2026-10-05.2: the subscription is the account's by user id
// (agent_subscription_rows) — a live Stripe plan on the caller's address that
// is not bound to the account and not on a proven mailbox answers inactive,
// and says so (subscriptionUnbound).
const FN_BUILD = "agent-access.2026-10-10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** A live Stripe answer younger than this is served from the cache row. */
const CACHE_FRESH_MS = 10 * 60_000;
/** Stripe reads per account per hour, and per network per hour. */
const STRIPE_READS_PER_ACCOUNT_HOUR = 12;
const STRIPE_READS_PER_NETWORK_HOUR = 60;

type PassRow = {
  activated_at: string | null;
  expires_at: string | null;
  closed_at: string | null;
  shelf_expires_at: string | null;
  applications_total: number | null;
  applications_used: number | null;
};

/**
 * The pass as the account page needs it. "unactivated" is a pass bought and
 * not started — it FUNDS a request (the first agent call starts the clock),
 * which is exactly why the page must not show a paywall for it.
 */
function passState(p: PassRow | null, now = Date.now()) {
  if (!p) return { state: "none" as const, usable: false };
  const total = Number(p.applications_total ?? 0);
  const used = Number(p.applications_used ?? 0);
  const left = Math.max(0, total - used);
  if (p.closed_at) return { state: "closed" as const, usable: false, applicationsLeft: left };
  if (!p.activated_at) {
    const shelf = p.shelf_expires_at ? Date.parse(p.shelf_expires_at) : NaN;
    const onShelf = !Number.isFinite(shelf) || shelf > now;
    return {
      state: onShelf ? "unactivated" as const : "closed" as const,
      usable: onShelf && left > 0,
      applicationsLeft: left,
      ...(p.shelf_expires_at ? { expiresUnusedOn: p.shelf_expires_at } : {}),
    };
  }
  const ends = p.expires_at ? Date.parse(p.expires_at) : NaN;
  const running = Number.isFinite(ends) && ends > now;
  return {
    state: running ? "live" as const : "closed" as const,
    usable: running && left > 0,
    applicationsLeft: left,
    ...(p.expires_at ? { endsAt: p.expires_at } : {}),
  };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // The user, from the VERIFIED token. Nothing about identity is read from
  // the body — an address there is what made this an oracle.
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user?.id) {
    return json({ active: false, status: "signed_out", error: "Sign in to see your agent." }, 401);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({})) as { action?: unknown; id?: unknown };
  const action = typeof body.action === "string" ? body.action : "status";

  try {
    // ── the owner's two decisions on one packet ─────────────────────────────
    if (action === "approve" || action === "cancel") {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json({ ok: false, reason: "bad_request" }, 400);
      if (action === "approve") {
        // Only a vendor the worker can complete may be released: a packet for
        // any other is prepared for the candidate to send by hand, and
        // releasing it would read as "on its way" when nothing can take it.
        const { data: pkt } = await service.from("agent_submissions")
          .select("source").eq("id", id).eq("user_id", user.id).maybeSingle();
        const source = String((pkt as { source?: string } | null)?.source ?? "");
        if (!pkt) return json({ ok: false, reason: "not_found" }, 404);
        if (!isSendableVendor(source)) return json({ ok: false, reason: "vendor_needs_you" }, 409);
      }
      const { data, error } = await service.rpc("agent_packet_decide", {
        p_user_id: user.id, p_submission_id: id, p_decision: action,
      }).maybeSingle();
      if (error) {
        console.error("[AGENT-ACCESS] decide failed:", error.message?.slice(0, 160));
        return json({ ok: false, reason: "unavailable" }, 503);
      }
      const d = data as { decided_ok?: boolean; decide_reason?: string; decided_claimable_at?: string | null } | null;
      return json({
        ok: d?.decided_ok === true,
        reason: d?.decide_reason ?? "unknown",
        ...(d?.decided_claimable_at ? { claimableAt: d.decided_claimable_at } : {}),
      }, d?.decided_ok === true ? 200 : 409);
    }

    // ── status: may this account's agent act? ──────────────────────────────
    const email = normalizeEmail(user.email ?? "");

    const { data: passRow } = await service.from("agent_passes")
      .select("activated_at, expires_at, closed_at, shelf_expires_at, applications_total, applications_used")
      .eq("user_id", user.id).is("closed_at", null)
      .order("purchased_at", { ascending: false }).limit(1).maybeSingle();
    const pass = passState(passRow as PassRow | null);

    // The account's own row first, by user id. A live answer written in the
    // last ten minutes (by the webhook, or by this endpoint) is served as it
    // stands: Stripe is not asked twice in ten minutes about a live plan. A
    // read that fails is no subscription — never a fallback to the address.
    const accountRow = async (): Promise<AccountSubscriptionRow | null> => {
      const { data, error } = await service.rpc(ACCOUNT_SUBSCRIPTION_RPC, { p_user_ids: [user.id] });
      if (error) console.error("[AGENT-ACCESS] subscription read failed:", String(error.message ?? "").slice(0, 160));
      return error ? null : accountSubscription(data, user.id);
    };
    let sub = await accountRow();
    const cachedLive = rowIsEntitled(sub);
    const cacheFresh = !!sub?.updated_at && Date.now() - Date.parse(sub.updated_at) < CACHE_FRESH_MS;

    let stale = false;
    // A live Stripe plan on this address that the account may not use.
    let unbound = false;
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (email && stripeKey && !(cachedLive && cacheFresh)) {
      // METERED. Per account and per network, through the atomic door
      // counter. Over either, the cached answer stands and says it is cached.
      // A limiter that cannot be asked does not block (the caller is signed
      // in, and asks only about themselves).
      const take = async (door: string, bucket: string, max: number): Promise<boolean> => {
        const { data, error } = await service.rpc("mail_door_take", {
          p_door: door, p_bucket: bucket, p_max: max, p_window_minutes: 60,
        });
        return error ? true : data === true;
      };
      const allowed = await take("agent-access", `u:${(await sha256Hex(user.id)).slice(0, 32)}`, STRIPE_READS_PER_ACCOUNT_HOUR)
        && await take("agent-access-net", await networkBucket(req.headers, serviceKey, "agent-access"), STRIPE_READS_PER_NETWORK_HOUR);
      if (allowed) {
        // Refreshes the cache row (and binds it, when the plan carries this
        // account's user id); the ANSWER is still the account's row.
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
        const live = await checkAgentByEmail(stripe, service, email);
        sub = await accountRow();
        unbound = live.active && !rowIsEntitled(sub);
      } else {
        stale = true;
      }
    }

    const subscribed = rowIsEntitled(sub);
    const subscription = {
      active: subscribed,
      status: subscribed ? String(sub?.status ?? "active") : String(sub?.status ?? "inactive"),
      currentPeriodEnd: sub?.current_period_end ?? null,
    };

    const tier = subscription.active ? "subscription" : pass.usable ? "pass" : "none";
    return json({
      active: subscription.active || pass.usable,
      tier,
      status: subscription.active ? subscription.status : pass.usable ? "pass" : subscription.status,
      currentPeriodEnd: subscription.active ? subscription.currentPeriodEnd : null,
      pass,
      ...(stale ? { cached: true } : {}),
      ...(unbound ? { subscriptionUnbound: true } : {}),
    });
  } catch (error) {
    console.error("[AGENT-ACCESS] Error:", String((error as Error)?.message ?? error).slice(0, 200));
    return json({ active: false, status: "error" }, 500);
  }
});
