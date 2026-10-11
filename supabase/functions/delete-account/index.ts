// deploy-stamp: 2026-10-10T15:00Z
// GDPR account deletion: verifies the caller's JWT and deletes their auth
// user. user_scans / user_profiles / user_applications rows cascade via FK.
// Email-keyed purchase records are retained (legal/accounting basis), but the
// account link to them is gone.
//
// TWO THINGS THE DELETE LEFT BEHIND (platform sweep 2026-10-04):
//   L6-30  a live Stripe subscription kept billing a deleted account, which no
//          longer had a session to reach the billing portal with;
//   L3-13  the CV files under resumes/{user id}/ stayed in storage forever,
//          and the owner-only policies meant nobody could remove them after.
// Both are done before the user is deleted, and either failing stops the
// delete: an account must not vanish while its card is still charged or its
// CV is still kept. THE ORDER (wave 3 reviews): the plans are READ first (a
// failure changes nothing) and CANCELLED next; then the apply agent is
// switched off (agent_mandates.active, which the broker enforces), and only
// then do the CV files go. Removing the files first left, on a failed cancel,
// a billing plan and a running agent whose mandate pointed at a deleted CV,
// so it could submit applications with none. A refusal after a cancel says
// how many went (subscriptionsCancelled), and one after the agent was
// switched off says so (agentStopped), so the page never says nothing changed.
//
// WHICH SUBSCRIPTIONS IT MAY CANCEL. While sign-ups are auto-confirmed anyone
// can register a subscriber's address, so the address alone does not make a
// plan this account's (sweep S8-001). A plan whose subscription names this
// account (metadata.user_id) is cancelled; a plan on the address that names
// no account is cancelled only for a session that proved the mailbox, and
// otherwise the delete is refused with the way to cancel it from Stripe's own
// emailed sign-in. A plan that names another account is not touched.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { subscriptionBuyer } from "../_shared/agent.ts";
import { listAll } from "../_shared/stripe-paging.ts";
import { provenMailbox } from "../_shared/mailbox-proof.ts";
import { bearerOf } from "../_shared/service-caller.ts";

// Provable from outside without deleting anything: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "delete-account.2026-10-09.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Statuses Stripe can still charge, or will charge once a card works. */
const BILLABLE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);
/** The storage bucket the apply agent's CV uploads go to, under {user id}/. */
const RESUME_BUCKET = "resumes";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error } = await anonClient.auth.getUser();
    if (error || !user?.id) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1. The plans this account pays for: read, not yet cancelled.
    const email = String(user.email ?? "").trim().toLowerCase();
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    let stripe: Stripe | null = null;
    const mine: Stripe.Subscription[] = [];
    if (email.includes("@") && stripeKey) {
      try {
        stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
        const client = stripe;
        const customers = await listAll<Stripe.Customer>((after) => client.customers.list({ email, limit: 100, ...(after ? { starting_after: after } : {}) }));
        const live: Stripe.Subscription[] = [];
        for (const c of customers) {
          const subs = await listAll<Stripe.Subscription>((after) => client.subscriptions.list({ customer: c.id, status: "all", limit: 100, ...(after ? { starting_after: after } : {}) }));
          live.push(...subs.filter((s) => BILLABLE.has(s.status)));
        }
        mine.push(...live.filter((s) => subscriptionBuyer(s) === user.id));
        const unbound = live.filter((s) => !subscriptionBuyer(s));
        if (unbound.length) {
          const proven = await provenMailbox(user, bearerOf(req.headers) ?? "", {
            db: admin,
            confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
            supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
            anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          });
          if (!proven) {
            const loginUrl = Deno.env.get("STRIPE_PORTAL_LOGIN_URL") ?? "";
            return json({
              error: "This address has a subscription that is not linked to this account. Cancel it first from Stripe's billing page, then delete the account. Nothing was deleted.",
              code: "subscription_unlinked",
              ...(/^https:\/\/billing\.stripe\.com\//.test(loginUrl) ? { portalLoginUrl: loginUrl } : {}),
            }, 409);
          }
          mine.push(...unbound);
        }
      } catch (e) {
        console.error("[DELETE-ACCOUNT] Stripe read:", e instanceof Error ? e.message : e);
        return json({ error: "We couldn't read your subscription, so nothing was changed. Please try again in a minute.", code: "billing_unreadable" }, 503);
      }
    } else if (email.includes("@") && !stripeKey) {
      console.error("[DELETE-ACCOUNT] STRIPE_SECRET_KEY is not set; refusing rather than leaving a plan billing");
      return json({ error: "Deletion is unavailable right now. Nothing was deleted.", code: "billing_unreadable" }, 503);
    }

    // 2. The plans: cancelled before anything else goes (see THE ORDER).
    const cancelled: string[] = [];
    const sofar = () => (cancelled.length ? { subscriptionsCancelled: cancelled.length } : {});
    if (stripe) {
      try {
        for (const s of mine) {
          await stripe.subscriptions.cancel(s.id);
          cancelled.push(s.id);
        }
      } catch (e) {
        console.error("[DELETE-ACCOUNT] Stripe cancel:", e instanceof Error ? e.message : e);
        return json({
          error: "We couldn't cancel your subscription, so your CV was kept and the account was not deleted. Please try again in a minute.",
          code: "subscription_cancel_failed",
          ...sofar(),
        }, 503);
      }
    }

    // 3. The agent, switched off before its CV goes: nothing is sent without it.
    const { error: offErr } = await admin.from("agent_mandates").update({ active: false }).eq("user_id", user.id);
    if (offErr) {
      console.error("[DELETE-ACCOUNT] Agent off:", offErr.message);
      return json({
        error: "We couldn't switch off your apply agent, so your CV was kept and the account was not deleted. Please try again in a minute.",
        code: "files_not_deleted",
        ...sofar(),
      }, 503);
    }

    // 4. The CV files: every object under resumes/{user id}/, removed.
    try {
      const bucket = admin.storage.from(RESUME_BUCKET);
      for (;;) {
        const { data: files, error: listErr } = await bucket.list(user.id, { limit: 100 });
        if (listErr) throw new Error(listErr.message);
        const paths = (files ?? []).map((f: { name: string }) => `${user.id}/${f.name}`);
        if (!paths.length) break;
        const { error: rmErr } = await bucket.remove(paths);
        if (rmErr) throw new Error(rmErr.message);
        if (paths.length < 100) break;
      }
    } catch (e) {
      console.error("[DELETE-ACCOUNT] Storage:", e instanceof Error ? e.message : e);
      return json({
        error: "We couldn't delete your stored CV, so the account was not deleted. Your apply agent is switched off. Please try again in a minute.",
        code: "files_not_deleted",
        agentStopped: true,
        ...sofar(),
      }, 503);
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.error("[DELETE-ACCOUNT] Failed:", delErr);
      return json({ error: "Deletion failed", agentStopped: true, cvRemoved: true, ...sofar() }, 500);
    }

    console.log(`[DELETE-ACCOUNT] Deleted user ${user.id}; subscriptions cancelled: ${cancelled.length}`);
    return json({ success: true, subscriptionsCancelled: cancelled.length });
  } catch (e) {
    console.error("[DELETE-ACCOUNT] Uncaught:", e);
    return json({ error: "Unexpected error" }, 500);
  }
});
