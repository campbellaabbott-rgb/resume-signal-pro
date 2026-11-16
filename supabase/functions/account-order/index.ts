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
//        (purchased_content) mailed again, ONLY to the order's own address, at
//        most three times a day per order (mail_door_take). A Full Analysis
//        saves only a pointer to its analysis ({shareId}); that analysis is
//        read back and sent through send-analysis-email, the mail it went out
//        in, so a finished analysis is never described as a purchase still to
//        run (S14X-222). Everything else goes through send-product-email. An
//        order with no saved copy, or whose analysis is no longer stored,
//        answers 409 no_saved_copy, and spends none of the day's three.
//
// A PRO INCLUSION (S14X-108). An order may also be named by its pro_<grant id>
// reference, which is the account's only when that grant's user id is the
// caller's; any other answers 404 before the order is read. An inclusion has
// no Stripe charge, so a receipt for it answers 404 without asking Stripe.
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
// 2026-10-14.30 (wave 4 round 2 fixes): a receipt is asked of Stripe at most
// RECEIPTS_PER_HOUR times an hour per account, counted before Stripe is asked
// (the account's Stripe reads share one limit with the checkouts).
// 2026-10-14.31 (recheck 3, 2026-10-26): "Email it again" sends the order's own language (the delivery's metadata.language) to send-product-email.
// 2026-11-09.1 (cost wave, lane ci-edge, cost audit 2026-11-08 Do first #10): the CORS answer says Access-Control-Max-Age 7200, so a browser asks the preflight once per two hours instead of before every call.
// 2026-11-12.1 (bug round of 2026-11-08, part A, account lane, S14X-108, S14X-222): a used Pro inclusion is one order under its grant's reference and opens only for the grant's own account, and a Full Analysis mailed again carries its saved analysis or answers that no copy is saved.
const FN_BUILD = "account-order.2026-11-12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Sends of one order's saved copy in a day. */
export const MAIL_AGAIN_PER_DAY = 3;
/** Receipts one account may ask Stripe for in an hour. */
export const RECEIPTS_PER_HOUR = 30;
const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{8,200}$/;
/** A Pro inclusion's reference: pro_ and the grant's uuid. */
const GRANT_REF_RE = /^pro_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The analysis a Full Analysis order's saved pointer names, or null. */
const shareIdOf = (content: unknown): string | null => {
  const id = content && typeof content === "object" ? (content as { shareId?: unknown }).shareId : null;
  return typeof id === "string" && /^[a-f0-9]{24,32}$/.test(id.trim()) ? id.trim() : null;
};

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
    const named = typeof body.sessionId === "string" ? body.sessionId : "";
    const grantId = GRANT_REF_RE.exec(named)?.[1] ?? null;
    const sessionId = SESSION_RE.test(named) || grantId ? named : null;
    if (!action || !sessionId) return json({ error: "Name an order and what you want for it." }, 400);

    const service = createClient(url, supabaseServiceKey, { auth: { persistSession: false } });

    // A Pro inclusion is the account's only through its own grant, asked
    // before anything of the order is read.
    let grantEmail = "";
    if (grantId) {
      const { data: grant, error: gErr } = await service.from("pro_grants").select("user_id, email").eq("id", grantId).maybeSingle();
      if (gErr) return json({ error: "Could not read that order right now. Try again in a minute." }, 503);
      if ((grant as { user_id?: string } | null)?.user_id !== user.id) return json({ error: "No such order on this account." }, 404);
      if (action === "receipt") return json({ error: "An inclusion with Pro has no receipt of its own." }, 404);
      grantEmail = String((grant as { email?: string } | null)?.email ?? "").trim().toLowerCase();
    }

    const proofEnv: MailboxEnv = {
      db: service,
      confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
      supabaseUrl: url,
      anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    };
    const provenEmail = grantId ? null : await accountProvenEmail(user, session.jwt, proofEnv);

    // The order, and whether this account owns it.
    const [{ data: delivery, error: dErr }, { data: content, error: cErr }, bound] = await Promise.all([
      service.from("product_deliveries").select("customer_email, product_name, product_type, status, metadata").eq("stripe_session_id", sessionId).maybeSingle(),
      service.from("purchased_content").select("customer_email, product_name, product_type, generated_content").eq("stripe_session_id", sessionId).maybeSingle(),
      grantId ? Promise.resolve({ data: null, error: null }) : service.from("checkout_buyers").select("user_id").eq("stripe_session_id", sessionId).maybeSingle(),
    ]);
    if (dErr || cErr) return json({ error: "Could not read that order right now. Try again in a minute." }, 503);
    const orderEmail = String((delivery as { customer_email?: string } | null)?.customer_email ?? (content as { customer_email?: string } | null)?.customer_email ?? grantEmail).trim().toLowerCase();
    const boundToMe = !bound.error && (bound.data as { user_id?: string } | null)?.user_id === user.id;
    const mineByAddress = !!provenEmail && !!orderEmail && orderEmail === provenEmail;
    if (!orderEmail || !(!!grantId || boundToMe || mineByAddress)) return json({ error: "No such order on this account." }, 404);

    if (action === "receipt") {
      const stripeKey = Deno.env.get(sessionId.startsWith("cs_test_") ? "STRIPE_TEST_SECRET_KEY" : "STRIPE_SECRET_KEY");
      if (!stripeKey) return json({ error: "Receipts are unavailable right now." }, 503);
      // Counted before Stripe is asked: every retrieve spends the account's shared read limit.
      const receiptBucket = (await sha256Hex(`${supabaseServiceKey}:account-order-receipt:${user.id}`)).slice(0, 32);
      const { data: receiptOk, error: receiptDoorErr } = await service.rpc("mail_door_take", {
        p_door: "account-order:receipt", p_bucket: receiptBucket, p_max: RECEIPTS_PER_HOUR, p_window_minutes: 60,
      });
      if (receiptDoorErr) return json({ error: "Receipts are unavailable right now. Try again in a minute." }, 503);
      if (receiptOk !== true) return json({ error: "Too many receipt requests this hour. Try again later.", code: "rate_limited" }, 429);
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
    const noSavedCopy = () => json({ error: "This order has no saved copy to email. Open it from its link instead.", code: "no_saved_copy" }, 409);
    if (!saved || saved.generated_content == null) return noSavedCopy();
    const productType = saved.product_type ?? (delivery as { product_type?: string } | null)?.product_type ?? "purchase";

    // A Full Analysis saved only the pointer to its analysis: the analysis is
    // read back first, so an order whose analysis is gone spends no slot.
    let analysis: { shareId: string; data: unknown } | null = null;
    if (productType === "full_analysis") {
      const shareId = shareIdOf(saved.generated_content);
      if (!shareId) return noSavedCopy();
      const { data: row, error: aErr } = await service.from("resume_analyses").select("analysis_result").eq("share_id", shareId).maybeSingle();
      if (aErr) return json({ error: "Could not send it right now. Try again in a minute." }, 503);
      const data = (row as { analysis_result?: unknown } | null)?.analysis_result;
      if (data == null || typeof data !== "object") return noSavedCopy();
      analysis = { shareId, data };
    }

    const bucket = (await sha256Hex(`${supabaseServiceKey}:account-order-mail:${sessionId}`)).slice(0, 32);
    const { data: allowed, error: doorErr } = await service.rpc("mail_door_take", {
      p_door: "account-order:mail-again", p_bucket: bucket, p_max: MAIL_AGAIN_PER_DAY, p_window_minutes: 1440,
    });
    if (doorErr) return json({ error: "Could not send it right now. Try again in a minute." }, 503);
    if (allowed !== true) return json({ error: "This order was emailed three times today already. Try again tomorrow.", code: "daily_limit" }, 429);

    const productName = saved.product_name ?? (delivery as { product_name?: string } | null)?.product_name ?? "Your purchase";
    // The language the order was bought in, as retry-failed-deliveries sends
    // it (recheck 3): the resend went out in English for every buyer.
    const meta = (delivery as { metadata?: { language?: unknown } | null } | null)?.metadata;
    const language = typeof meta?.language === "string" ? meta.language : undefined;
    // Each mailer is named in its own fetch, so a reader of this file (and the
    // internal-mailer census) sees which one is called and with which key.
    const sent = analysis
      ? await fetch(`${url}/functions/v1/send-analysis-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}`, apikey: supabaseServiceKey },
        body: JSON.stringify({ email: orderEmail, analysisData: analysis.data, shareId: analysis.shareId, ...(language ? { language } : {}) }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null)
      : await fetch(`${url}/functions/v1/send-product-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}`, apikey: supabaseServiceKey },
        body: JSON.stringify({ email: orderEmail, productType, productName, generatedContent: saved.generated_content, sessionId, ...(language ? { language } : {}) }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
    if (!sent || !sent.ok) return json({ error: "Could not send it right now. Try again in a minute." }, 502);
    return json({ sent: true });
  } catch (e) {
    console.error("[ACCOUNT-ORDER] Uncaught:", e instanceof Error ? e.message : String(e));
    return json({ error: "Unexpected error" }, 500);
  }
});
