// deploy-stamp: 2026-10-08T12:00Z
// affiliate-payout-request: the affiliate dashboard's Request Payout button.
//
// WHY THIS EXISTS (register L13-63). The button called nothing: the page
// rendered PayoutRequest without a handler, and the component toasted
// "Payout request submitted! You'll receive payment within 5-7 business days"
// whatever happened. No record, no message, no payout.
//
// POST { sessionToken } -- the affiliate's own session (affiliate_sessions,
// minted by login_affiliate), checked here with the service role:
//   - an unknown or expired session is a 401;
//   - a balance under the minimum is a 400 naming the minimum;
//   - one open request per affiliate (a unique index): a second is a 409;
//   - otherwise one affiliate_payout_requests row for the whole pending
//     balance, and a mail to the owner through the same Resend path every
//     owner note uses. The answer is {status:"requested"} only once the row
//     exists; a mail that fails is logged and said in the answer, never hidden.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { networkBucket } from "../_shared/network-bucket.ts";

const FN_BUILD = "affiliate-payout-request.2026-10-08.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

/** The smallest payout, in cents: the dashboard's PayoutRequest minimum. */
export const MIN_PAYOUT_CENTS = 2500;
const PER_NETWORK_PER_HOUR = 20;
const OWNER_EMAIL = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, { auth: { persistSession: false } });

    // Bounded per network first, so a loop of guesses costs nothing else.
    const net = await networkBucket(req.headers, serviceKey, "affiliate-payout");
    const { data: underLimit, error: doorErr } = await admin.rpc("mail_door_take", {
      p_door: "affiliate-payout", p_bucket: net, p_max: PER_NETWORK_PER_HOUR, p_window_minutes: 60,
    });
    if (doorErr) return json({ error: "Please try again in a moment." }, 503);
    if (underLimit !== true) return json({ error: "Too many requests. Please try again later." }, 429);

    const body = await req.json().catch(() => ({}));
    const token = typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";
    if (!/^[0-9a-f]{32,128}$/i.test(token)) return json({ error: "Please sign in again." }, 401);

    // THE CALLER OWNS THE ACCOUNT: the session row names it, and it is live.
    const { data: session, error: sErr } = await admin
      .from("affiliate_sessions").select("affiliate_id, expires_at")
      .eq("session_token", token).maybeSingle();
    if (sErr) return json({ error: "Please try again in a moment." }, 503);
    if (!session || Date.parse(String(session.expires_at)) <= Date.now()) {
      return json({ error: "Your session has expired. Please sign in again." }, 401);
    }

    const { data: affiliate, error: aErr } = await admin
      .from("affiliates").select("id, email, status, pending_payout")
      .eq("id", session.affiliate_id).maybeSingle();
    if (aErr) return json({ error: "Please try again in a moment." }, 503);
    if (!affiliate) return json({ error: "Please sign in again." }, 401);
    if (affiliate.status !== "active") return json({ error: "This affiliate account is not active." }, 403);
    const amount = Number(affiliate.pending_payout) || 0;
    if (amount < MIN_PAYOUT_CENTS) {
      return json({ error: `The minimum payout is ${dollars(MIN_PAYOUT_CENTS)}.`, minimumCents: MIN_PAYOUT_CENTS }, 400);
    }

    const { data: row, error: insErr } = await admin
      .from("affiliate_payout_requests")
      .insert({ affiliate_id: affiliate.id, amount_cents: amount })
      .select("id, requested_at").single();
    if (insErr) {
      if ((insErr as { code?: string }).code === "23505") return json({ status: "already_requested" }, 409);
      console.error("[AFFILIATE-PAYOUT] request insert failed:", insErr.message);
      return json({ error: "Could not record the request. Please try again." }, 500);
    }

    // The owner hears about it through the same Resend path as every owner note.
    let notified = false;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error(`[AFFILIATE-PAYOUT] request ${row.id} recorded, but RESEND_API_KEY is not set: the owner was not mailed`);
    } else {
      const { error: sendErr } = await new Resend(RESEND_API_KEY).emails.send({
        from: "Resume Booster <reports@resumebooster.work>",
        to: [OWNER_EMAIL],
        subject: `Affiliate payout request: ${dollars(amount)}`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111">
          <p>An affiliate asked to be paid <b>${escapeHtml(dollars(amount))}</b>, their whole pending balance.</p>
          <p>Affiliate: ${escapeHtml(affiliate.email)} (id ${escapeHtml(affiliate.id)})</p>
          <p>Request: ${escapeHtml(row.id)}, ${escapeHtml(row.requested_at)}</p>
          <p style="font-size:12px;color:#64748b">Recorded in affiliate_payout_requests (status requested). Pay it, then mark the row paid or rejected.</p>
        </div>`,
      });
      if (sendErr) console.error(`[AFFILIATE-PAYOUT] request ${row.id} recorded, but the owner mail was refused:`, (sendErr as { message?: string }).message ?? sendErr);
      else notified = true;
    }

    return json({ status: "requested", id: row.id, amountCents: amount, ownerNotified: notified });
  } catch (e) {
    console.error("[AFFILIATE-PAYOUT] Uncaught:", e);
    return json({ error: "Unexpected error." }, 500);
  }
});
