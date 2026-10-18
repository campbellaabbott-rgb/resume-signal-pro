// deploy-stamp: 2026-10-11T17:00Z
// GDPR account deletion: verifies the caller's website session and deletes
// their auth user. user_scans / user_profiles / user_applications rows (and
// R1's mailbox proofs) cascade via FK. Payment records are kept for the
// statutory period (owner decision D9), and nothing else.
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
// then do the CV files go. A refusal after a cancel says how many went
// (subscriptionsCancelled), and one after the agent was switched off says so
// (agentStopped), so the page never says nothing changed.
//
// THE PLANS ARE FOUND BY THE ACCOUNT, NOT BY ITS CURRENT ADDRESS (S12-053,
// S12-097; _shared/account-billing.ts). They were looked up as Stripe
// customers on the account's current email only, so after an email change the
// delete said success while the plan kept charging, and a legacy plan the
// database binds to the account was refused. Now: customers on the address,
// customers a bound pro/agent row names, and subscriptions naming the account
// in metadata.user_id. A plan naming the account, or on a customer a bound row
// names, is cancelled at once; a plan on the address that names no account is
// cancelled only when the account has proven that mailbox
// (_shared/account-proof.ts, which reads R1's proof rows too); a plan naming
// another account is never touched.
//
// WHAT ELSE GOES (S12-153, plan CP-048): before the user is deleted,
// account_erase_personal_data (20261011170000) revokes every API or connector
// key the account minted and blanks its address; for a proven address it also
// removes the address's key requests, market-pulse row, lead rows and
// unsubscribe token and records a do-not-mail entry so queued mail stops. A
// failure there stops the delete too.
//
// A WEBSITE SESSION ONLY (plan CP-J): a token minted for a connected app
// cannot delete the account (_shared/website-session.ts).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { classifyPlans, plansOfAccount, type BillingStripe } from "../_shared/account-billing.ts";
import { accountProvenEmail } from "../_shared/account-proof.ts";
import type { MailboxEnv } from "../_shared/mailbox-proof.ts";
import { requireWebsiteSession } from "../_shared/website-session.ts";

// Provable from outside without deleting anything: every response, the CORS
// preflight included, carries this in x-fn-build. It imports
// _shared/mailbox-proof.ts (through account-proof.ts), which R1 stamped
// 2026-10-14.1, so this build sorts after that day.
// 2026-10-14.25 (wave 4 round 2): plans found by the account, a bound legacy
// plan accepted, keys and lists erased, a website session only.
const FN_BUILD = "delete-account.2026-10-14.25";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    const session = await requireWebsiteSession(req, { auth: anonClient.auth, headers: corsHeaders });
    if (session instanceof Response) return session;
    const user = session.user;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const email = String(user.email ?? "").trim().toLowerCase();
    const proofEnv: MailboxEnv = {
      db: admin,
      confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
      supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
      anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    };
    const provenEmail = await accountProvenEmail(user, session.jwt, proofEnv);

    // 1. The plans this account pays for: read, not yet cancelled.
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      console.error("[DELETE-ACCOUNT] STRIPE_SECRET_KEY is not set; refusing rather than leaving a plan billing");
      return json({ error: "Deletion is unavailable right now. Nothing was deleted.", code: "billing_unreadable" }, 503);
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
    let mine: Array<{ id: string }> = [];
    try {
      const { plans, boundCustomers } = await plansOfAccount(stripe as unknown as BillingStripe, admin, { id: user.id, email });
      const verdict = classifyPlans(plans, { userId: user.id, boundCustomers, mailboxProven: !!provenEmail });
      if (verdict.blocking.length) {
        const loginUrl = Deno.env.get("STRIPE_PORTAL_LOGIN_URL") ?? "";
        return json({
          error: "This address has a subscription that is not linked to this account. Cancel it first from Stripe's billing page, then delete the account. Nothing was deleted.",
          code: "subscription_unlinked",
          ...(/^https:\/\/billing\.stripe\.com\//.test(loginUrl) ? { portalLoginUrl: loginUrl } : {}),
        }, 409);
      }
      mine = verdict.mine;
    } catch (e) {
      console.error("[DELETE-ACCOUNT] Stripe read:", e instanceof Error ? e.message : e);
      return json({ error: "We couldn't read your subscription, so nothing was changed. Please try again in a minute.", code: "billing_unreadable" }, 503);
    }

    // 2. The plans: cancelled at once, before anything else goes (see THE ORDER).
    const cancelled: string[] = [];
    const sofar = () => (cancelled.length ? { subscriptionsCancelled: cancelled.length } : {});
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

    // 5. Keys and mailing-list entries (S12-153): revoked and erased, or the
    //    account stays so the delete can be tried again.
    const { data: erased, error: eraseErr } = await admin.rpc("account_erase_personal_data", {
      p_user_id: user.id, p_email: email, p_email_proven: !!provenEmail,
    });
    if (eraseErr) {
      console.error("[DELETE-ACCOUNT] Erase:", String(eraseErr.message ?? eraseErr).slice(0, 160));
      return json({
        error: "We couldn't revoke your API keys and remove your mailing-list entries, so the account was not deleted. Please try again in a minute.",
        code: "keys_not_revoked",
        agentStopped: true,
        cvRemoved: true,
        ...sofar(),
      }, 503);
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.error("[DELETE-ACCOUNT] Failed:", delErr);
      return json({ error: "Deletion failed", agentStopped: true, cvRemoved: true, ...sofar() }, 500);
    }

    const keysRevoked = Number((erased as { keys_revoked?: unknown } | null)?.keys_revoked ?? 0) || 0;
    console.log(`[DELETE-ACCOUNT] Deleted user ${user.id}; subscriptions cancelled: ${cancelled.length}; keys revoked: ${keysRevoked}`);
    // D9: what stays is said, not left to guess.
    return json({ success: true, subscriptionsCancelled: cancelled.length, keysRevoked, kept: ["payment_records"] });
  } catch (e) {
    console.error("[DELETE-ACCOUNT] Uncaught:", e);
    return json({ error: "Unexpected error" }, 500);
  }
});
