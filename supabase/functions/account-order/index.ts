// ONE ORDER, ASKED ABOUT BY THE ACCOUNT THAT OWNS IT (plan CP-050, CP-H;
// wave 4 round 2, account-compliance).
//
// Account purchase rows had no receipt and no way to get a delivery mail
// again (S11-096). Two actions, each only for an order THIS account owns: the
// order's address is the account's proven address (_shared/account-proof.ts:
// a provider sign-in, confirmation once required, or R1's proof row), or the
// checkout bound the Stripe session to the account (checkout_buyers).
//
//   POST {action:"receipt", sessionId}     -> {url}: the Stripe receipt of the
//        order's charge. A read of Stripe; nothing is written or sent.
//   POST {action:"mail_again", sessionId}  -> {sent:true}: the saved copy
//        (purchased_content) mailed again through send-product-email, ONLY to
//        the order's own address, at most three times a day per order
//        (mail_door_take). An order with no saved copy (a Full Analysis lives
//        behind its own link) answers 409 no_saved_copy.
//
// A WEBSITE SESSION ONLY (plan CP-J, _shared/website-session.ts). An order
// this account cannot be shown to own answers 404, the same as one that does
// not exist, so the function never confirms a stranger's order.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { accountProvenEmail } from "../_shared/account-proof.ts";
import type { MailboxEnv } from "../_shared/mailbox-proof.ts";
import { requireWebsiteSession } from "../_shared/website-session.ts";

// Provable from outside without touching an order: every response, the CORS
// preflight included, carries this in x-fn-build. It imports
// _shared/mailbox-proof.ts, which R1 stamped 2026-10-14.1.
const FN_BUILD = "account-order.2026-10-14.25";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Sends of one order's saved copy in a day. */
export const MAIL_AGAIN_PER_DAY = 3;
const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{8,200}$/;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST an action." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { auth: { persistSession: false } });
    const session = await requireWebsiteSession(req, { auth: anon.auth, headers: corsHeaders });
    if (session instanceof Response) return session;
    const user = session.user;

    const body = await req.json().catch(() => ({})) as { action?: unknown; sessionId?: unknown };
    const action = body.action === "receipt" || body.action === "mail_again" ? body.action : null;
    const sessionId = typeof body.sessionId === "string" && SESSION_RE.test(body.sessionId) ? body.sessionId : null;
    if (!action || !sessionId) return json({ error: "Name an order and what you want for it." }, 400);

    const service = createClient(url, supabaseServiceKey, { auth: { persistSession: false } });
    const proofEnv: MailboxEnv = {
      db: service,
      confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
      supabaseUrl: url,
      anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    };
    const provenEmail = await accountProvenEmail(user, session.jwt, proofEnv);

    // The order, and whether this account owns it.
    const [{ data: delivery, error: dErr }, { data: content, error: cErr }, bound] = await Promise.all([
      service.from("product_deliveries").select("customer_email, product_name, product_type, status").eq("stripe_session_id", sessionId).maybeSingle(),
      service.from("purchased_content").select("customer_email, product_name, product_type, generated_content").eq("stripe_session_id", sessionId).maybeSingle(),
      service.from("checkout_buyers").select("user_id").eq("stripe_session_id", sessionId).maybeSingle(),
    ]);
    if (dErr || cErr) return json({ error: "Could not read that order right now. Try again in a minute." }, 503);
    const orderEmail = String((delivery as { customer_email?: string } | null)?.customer_email ?? (content as { customer_email?: string } | null)?.customer_email ?? "").trim().toLowerCase();
    const boundToMe = !bound.error && (bound.data as { user_id?: string } | null)?.user_id === user.id;
    const mineByAddress = !!provenEmail && !!orderEmail && orderEmail === provenEmail;
    if (!orderEmail || !(boundToMe || mineByAddress)) return json({ error: "No such order on this account." }, 404);

    if (action === "receipt") {
      const stripeKey = Deno.env.get(sessionId.startsWith("cs_test_") ? "STRIPE_TEST_SECRET_KEY" : "STRIPE_SECRET_KEY");
      if (!stripeKey) return json({ error: "Receipts are unavailable right now." }, 503);
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
      const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
      const pi = s.payment_intent as unknown as { latest_charge?: { receipt_url?: string | null } | string | null } | null;
      const charge = pi && typeof pi === "object" ? pi.latest_charge : null;
      const receiptUrl = charge && typeof charge === "object" ? charge.receipt_url ?? null : null;
      if (!receiptUrl || !/^https:\/\/pay\.stripe\.com\//.test(receiptUrl)) return json({ error: "Stripe holds no receipt for this order yet." }, 404);
      return json({ url: receiptUrl });
    }

    // mail_again: the saved copy, to the order's own address only.
    const saved = content as { product_name?: string | null; product_type?: string | null; generated_content?: unknown } | null;
    if (!saved || saved.generated_content == null) {
      return json({ error: "This order has no saved copy to email. Open it from its link instead.", code: "no_saved_copy" }, 409);
    }
    const bucket = (await sha256Hex(`${supabaseServiceKey}:account-order-mail:${sessionId}`)).slice(0, 32);
    const { data: allowed, error: doorErr } = await service.rpc("mail_door_take", {
      p_door: "account-order:mail-again", p_bucket: bucket, p_max: MAIL_AGAIN_PER_DAY, p_window_minutes: 1440,
    });
    if (doorErr) return json({ error: "Could not send it right now. Try again in a minute." }, 503);
    if (allowed !== true) return json({ error: "This order was emailed three times today already. Try again tomorrow.", code: "daily_limit" }, 429);

    const productType = saved.product_type ?? (delivery as { product_type?: string } | null)?.product_type ?? "purchase";
    const productName = saved.product_name ?? (delivery as { product_name?: string } | null)?.product_name ?? "Your purchase";
    const sent = await fetch(`${url}/functions/v1/send-product-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}`, apikey: supabaseServiceKey },
      body: JSON.stringify({ email: orderEmail, productType, productName, generatedContent: saved.generated_content, sessionId }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!sent || !sent.ok) return json({ error: "Could not send it right now. Try again in a minute." }, 502);
    return json({ sent: true });
  } catch (e) {
    console.error("[ACCOUNT-ORDER] Uncaught:", e instanceof Error ? e.message : String(e));
    return json({ error: "Unexpected error" }, 500);
  }
});
