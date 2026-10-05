// Stripe payment reconciliation sweep (robustness #5).
//
// The safety net for a dropped webhook. stripe-webhook writes an idempotency
// marker to used_stripe_sessions at the TOP of triggerProductDelivery for EVERY
// paid checkout session (one-time products, scan packs, subscriptions alike), and
// the browser success-page path (verify-product-purchase) claims the same marker.
// So a session Stripe reports as PAID with NO marker means BOTH fulfilment paths
// missed it — a customer who paid and got nothing.
//
// This lists recent paid sessions from Stripe (the source of truth for money),
// cross-checks the markers, and EMAILS THE OWNER any orphans to recover through
// the existing recover-purchase flow. Alert-first by design: it never mutates
// money or entitlement state, and the HTTP response carries counts only (no PII).
//
// WHO MAY RUN IT (2026-10-04 completeness review). It used to answer anyone:
// "counts only, so no secret gate is needed". But every POST paged through up
// to 20 Stripe list calls on our key, with a lookback the caller chose -- an
// unauthenticated amplifier for spending our Stripe rate limit, which every
// checkout shares. It now answers only:
//   - the pg_cron job, whose x-reconcile-cron key migration 20261005113000
//     generated in the vault (reconcile_cron_key_matches checks it and never
//     returns it), or
//   - the service-role key, or the owner's ADMIN_API_KEY (x-admin-key), for a
//     hand-run.
// Anything else is a 401 before any client is built or any Stripe call made.
// The lookback stays bounded (1 hour to 14 days) and the paging at 20 pages.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { findOrphanSessions, type ReconcileSession } from "./reconcile.ts";
import { isServiceRoleCaller } from "../_shared/service-caller.ts";
import { keyMatches } from "../_shared/admin-key.ts";
import { checkoutSessionSettled } from "../_shared/pass-settlement.ts";
import { buyerEmailOf } from "../_shared/buyer-email.ts";

// The only external tell of which bundle is live. Bump on every deploy — twice
// this month a fix was "deployed" and the old code was still answering, and the
// version marker is the single thing that separates that from a job not running.
const BUILD_VERSION = "2026-10-05.1";
const FN_BUILD = `reconcile-stripe.${BUILD_VERSION}`;

const MAX_PAGES = 20;
const DEFAULT_LOOKBACK_HOURS = 48;
const MAX_LOOKBACK_HOURS = 24 * 14;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reconcile-cron, x-admin-key",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const unauthorized = () => json({ error: "Unauthorized" }, 401);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // The owner's key or the service role opens it outright. Otherwise only a
  // cron key long enough to be the vault's is even asked about, so a
  // stranger's POST costs no database call and no Stripe call.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const byServer = isServiceRoleCaller(req.headers, serviceKey)
    || keyMatches(req.headers.get("x-admin-key") ?? "", Deno.env.get("ADMIN_API_KEY") ?? "");
  const cronKey = req.headers.get("x-reconcile-cron") ?? "";
  if (!byServer && cronKey.length < 32) return unauthorized();

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  if (!byServer) {
    const { data: matches, error: keyError } = await supabase.rpc("reconcile_cron_key_matches", { p_key: cronKey });
    if (keyError || matches !== true) {
      if (keyError) console.error("[RECONCILE-STRIPE] cron key check failed:", keyError.message?.slice(0, 160));
      return unauthorized();
    }
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

  let body: { lookbackHours?: number } = {};
  try { body = await req.json(); } catch { /* cron may send an empty body */ }
  // Look back long enough to clear Stripe's webhook retry window but stay inside
  // the 30-day used_stripe_sessions retention.
  const lookbackHours = Math.min(Math.max(Number(body.lookbackHours) || DEFAULT_LOOKBACK_HOURS, 1), MAX_LOOKBACK_HOURS);
  const sinceEpoch = Math.floor((Date.now() - lookbackHours * 3_600_000) / 1000);

  try {
    // Page through recent checkout sessions (Stripe = source of truth for money).
    const paid: ReconcileSession[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await stripe.checkout.sessions.list({
        created: { gte: sinceEpoch },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const s of res.data) {
        // Match the webhook's own definition of "should be fulfilled": paid,
        // or a payment-mode session a 100%-off code completed at $0.
        if (s.status === "complete" && checkoutSessionSettled(s)) {
          paid.push({
            id: s.id,
            // customer_details first: an anonymous buyer's address exists only there.
            email: buyerEmailOf(s),
            amountCents: s.amount_total ?? null,
            currency: s.currency ?? "usd",
            product: s.metadata?.product_name ?? s.metadata?.product_type ?? null,
            createdIso: new Date((s.created ?? 0) * 1000).toISOString(),
          });
        }
      }
      if (!res.has_more || res.data.length === 0) break;
      startingAfter = res.data[res.data.length - 1].id;
    }

    // Which of those paid sessions have a fulfilment marker?
    const markers = new Set<string>();
    if (paid.length > 0) {
      const ids = paid.map((p) => p.id);
      const { data: rows } = await supabase
        .from("used_stripe_sessions")
        .select("session_id")
        .in("session_id", ids);
      for (const r of (rows ?? []) as Array<{ session_id: string }>) markers.add(r.session_id);
    }

    const orphans = findOrphanSessions(paid, markers);

    // Did the alert actually leave the building? `null` means there was nothing
    // to send, which is NOT the same as a send that failed — and neither is the
    // same as a missing key. Orphans found with no RESEND_API_KEY currently
    // produces one console.error nobody reads, which would make the loudest
    // event this function can detect its quietest observable.
    let alerted: boolean | null = null;

    if (orphans.length > 0) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      const adminEmail = Deno.env.get("ADMIN_EMAIL") || "resumeboostersupp@gmail.com";
      if (resendKey) {
        const esc = (x: string | null) => (x ?? "—").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
        const rows = orphans.map((o) =>
          `<tr><td>${o.createdIso}</td><td><code>${esc(o.id)}</code></td><td>${esc(o.email)}</td><td>${o.amountCents != null ? (o.amountCents / 100).toFixed(2) + " " + o.currency.toUpperCase() : "—"}</td><td>${esc(o.product)}</td></tr>`,
        ).join("");
        await new Resend(resendKey).emails.send({
          from: "Resume Booster Alerts <onboarding@resend.dev>",
          to: [adminEmail],
          subject: `⚠️ ${orphans.length} paid Stripe session(s) with no delivery`,
          html: `<h2>Stripe reconciliation: ${orphans.length} unfulfilled paid session(s)</h2>`
            + `<p>These were PAID in Stripe in the last ${lookbackHours}h but have no <code>used_stripe_sessions</code> marker — the webhook (and the success-page fallback) both missed them. Recover each via the <code>recover-purchase</code> function.</p>`
            + `<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Created</th><th>Session</th><th>Email</th><th>Amount</th><th>Product</th></tr>${rows}</table>`,
        }).then(() => { alerted = true; })
          .catch((e) => { alerted = false; console.error("[RECONCILE-STRIPE] owner email failed:", e); });
      } else {
        alerted = false;
        console.error("[RECONCILE-STRIPE] RESEND_API_KEY not set — cannot alert on orphans");
      }
    }

    console.log(`[RECONCILE-STRIPE] ${paid.length} paid sessions over ${lookbackHours}h, ${orphans.length} orphan(s)`);

    // WHAT THE LAST SWEEP SAW, so a healthy result stops being indistinguishable
    // from no result. Counts only — session ids, addresses and amounts stay in
    // the owner email, because this row is read by an anon-facing status
    // endpoint and a sweep must not become a way to enumerate purchases.
    //
    // Note what is NOT written here: lastCronAt. That belongs to
    // reconcile_stripe_tick(), which only the scheduler can call. Keeping them
    // in separate rows keeps a hand-run from ever looking like a cron run.
    const stampedAt = new Date().toISOString();
    try {
      await supabase.from("job_board_meta").upsert({
        k: "reconcile_stripe_run",
        v: { at: stampedAt, buildVersion: BUILD_VERSION, checkedPaid: paid.length,
             orphans: orphans.length, alerted, lookbackHours },
        updated_at: stampedAt,
      }, { onConflict: "k" });
    } catch (e) {
      // Never fail the sweep over its own bookkeeping. The email is the product
      // here; the stamp is only how we find out the email never happened.
      console.error("[RECONCILE-STRIPE] run stamp failed:", e);
    }

    // Counts only — never PII.
    return json({ checkedPaid: paid.length, orphans: orphans.length, alerted, lookbackHours,
                  buildVersion: BUILD_VERSION, at: stampedAt });
  } catch (e) {
    console.error("[RECONCILE-STRIPE] error:", e);
    return json({ error: "reconciliation failed" }, 500);
  }
});
