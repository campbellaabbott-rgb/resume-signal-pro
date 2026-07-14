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
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { findOrphanSessions, type ReconcileSession } from "./reconcile.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Safe by design (mirrors send-search-digest): the HTTP response returns counts
  // only — never customer PII — and the sole side effect is an email to the fixed
  // owner address, sent only when genuine orphans exist. So a stray trigger on a
  // healthy system does nothing observable, and no secret gate is needed.
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { lookbackHours?: number } = {};
  try { body = await req.json(); } catch { /* cron may send an empty body */ }
  // Look back long enough to clear Stripe's webhook retry window but stay inside
  // the 30-day used_stripe_sessions retention.
  const lookbackHours = Math.min(Math.max(Number(body.lookbackHours) || 48, 1), 24 * 14);
  const sinceEpoch = Math.floor((Date.now() - lookbackHours * 3_600_000) / 1000);

  try {
    // Page through recent checkout sessions (Stripe = source of truth for money).
    const paid: ReconcileSession[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await stripe.checkout.sessions.list({
        created: { gte: sinceEpoch },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const s of res.data) {
        // Match the webhook's own definition of "should be fulfilled".
        if (s.status === "complete" && s.payment_status === "paid") {
          paid.push({
            id: s.id,
            email: s.customer_email ?? (s.metadata?.customer_email ?? null),
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
        }).catch((e) => console.error("[RECONCILE-STRIPE] owner email failed:", e));
      } else {
        console.error("[RECONCILE-STRIPE] RESEND_API_KEY not set — cannot alert on orphans");
      }
    }

    console.log(`[RECONCILE-STRIPE] ${paid.length} paid sessions over ${lookbackHours}h, ${orphans.length} orphan(s)`);
    // Counts only — never PII — so an unauthenticated caller learns nothing sensitive.
    return json({ checkedPaid: paid.length, orphans: orphans.length, lookbackHours, at: new Date().toISOString() });
  } catch (e) {
    console.error("[RECONCILE-STRIPE] error:", e);
    return json({ error: e instanceof Error ? e.message : "reconciliation failed" }, 500);
  }
});
