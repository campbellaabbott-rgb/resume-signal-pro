// THE PASS, AS ITS OWNER SEES IT — the post-purchase page's one read.
//
// Answers, for the signed-in user (from the VERIFIED token, never the body):
//   pass  state none | unactivated | live | closed, with the clock, the
//         applications left, and how it was activated;
//   key   whether a live agent key exists on the account (prefix and date
//         only — the key itself was shown once at minting and is held here
//         only as a hash), so the page can say "your existing key already
//         carries the pass" instead of minting a new one and revoking it.
//
// THE SUCCESS-PAGE REPAIR. Stripe delivers checkout.session.completed
// reliably but not instantly; the buyer lands on /agents/pass first. If a
// ?session_id= is given and no pass row carries it, the session is retrieved
// from Stripe and — only when it is paid, is this user's, and is a pass by
// product_type — granted through the same idempotent RPC the webhook uses.
// Whichever of the two arrives second finds the row already there (the
// session id is UNIQUE) and reports duplicate. Done authenticated, never
// through the unauthenticated verify-product-purchase.
//
// State is DERIVED from timestamps, never a status column: the readers share
// one lazy close, and after it "closed_at IS NULL" means genuinely open.

import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  PASS_APPLICATIONS,
  PASS_PRICE_CENTS,
  PASS_PRODUCT_TYPE,
  PASS_QUOTA_PER_DAY,
  PASS_RATE_PER_MIN,
  PASS_SESSION_HOURS,
  PASS_SHELF_LIFE_DAYS,
} from "../_shared/pass.ts";
import { passSessionSettled } from "../_shared/pass-settlement.ts";
import { paymentRevocationState } from "../_shared/payment-revocation.ts";

// Provable from outside without signing in: the preflight carries it. The
// name and the date sit on separate lines on purpose: a guard reads every line
// that names the product for a spelled pass number, and a build date's "10"
// is not one.
const FN_NAME = "agent-pass-status";
const FN_BUILD = `${FN_NAME}.2026-10-08.1`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "x-fn-build": FN_BUILD,
};

/**
 * REPAIR REFUSALS THAT NO WAIT WILL CHANGE (L6-09). A second paid pass (two
 * checkouts opened in two tabs, both paid) is refused at grant because an
 * account holds one open pass at a time, and a session paid by another
 * account is not this one's. Both were rendered with "give it a minute and
 * retry — the receipt arrives on its own", which never happens: $29 taken,
 * a false instruction, and the owner learning only from delivery health.
 * Both are now terminal on the page; for the second pass, the owner is told
 * once per session so the charge can be refunded (a session another account
 * paid has its pass on that account, and the page says to sign in there).
 * A refunded payment (L6-18) is terminal too: no wait opens a pass from it.
 */
const TERMINAL_REPAIRS = new Set(["pass_already_open", "not_yours", "payment_revoked"]);

async function tellOwnerOnce(service: ServiceClient, reason: string, sessionId: string): Promise<void> {
  try {
    const bucket = `pass:${reason}:${sessionId}`.slice(0, 64);
    const { data: first, error } = await service.rpc("mail_door_take", {
      p_door: "owner-alert", p_bucket: bucket, p_max: 1, p_window_minutes: 43200,
    });
    if (error || first !== true) return;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return;
    const to = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";
    const what = "was paid while the buyer's account already held an open pass, so no pass was granted";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Resume Booster <reports@resumebooster.work>",
        to: [to],
        subject: "Agent Pass payment with no pass: refund it",
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111">
          <p>A $29 Agent Pass checkout ${what}.</p>
          <p>Stripe checkout session: <code>${sessionId.replace(/[^A-Za-z0-9_]/g, "")}</code></p>
          <p>Find it in Stripe and refund the charge. The buyer was told the payment did not create a pass and that it will be refunded.</p>
        </div>`,
      }),
    });
  } catch (e) {
    console.warn("[AGENT-PASS-STATUS] owner alert failed:", String((e as Error)?.message ?? e).slice(0, 120));
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

// deno-lint-ignore no-explicit-any
type ServiceClient = SupabaseClient<any, any, any>;

/** The shared lazy close, as two idempotent PostgREST updates (see create-pass-checkout). */
async function lazyClosePasses(service: ServiceClient, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await service.from("agent_passes")
    .update({ closed_at: now, close_reason: "session_ended" })
    .eq("user_id", userId).is("closed_at", null).not("activated_at", "is", null).lte("expires_at", now);
  await service.from("agent_passes")
    .update({ closed_at: now, close_reason: "shelf_expired" })
    .eq("user_id", userId).is("closed_at", null).is("activated_at", null).lte("shelf_expires_at", now);
}

type PassRow = {
  id: string;
  stripe_session_id: string;
  purchased_at: string;
  shelf_expires_at: string;
  activated_at: string | null;
  expires_at: string | null;
  activated_via: string | null;
  closed_at: string | null;
  close_reason: string | null;
  applications_total: number;
  applications_used: number;
  session_hours: number;
};

const PASS_COLUMNS =
  "id, stripe_session_id, purchased_at, shelf_expires_at, activated_at, expires_at, activated_via, " +
  "closed_at, close_reason, applications_total, applications_used, session_hours";

function describePass(p: PassRow | null) {
  if (!p) return { state: "none" as const };
  const state = p.closed_at ? "closed" : p.activated_at ? "live" : "unactivated";
  const total = Number(p.applications_total);
  const used = Number(p.applications_used);
  return {
    state,
    purchasedAt: p.purchased_at,
    shelfExpiresAt: p.shelf_expires_at,
    activatedAt: p.activated_at,
    expiresAt: p.expires_at,
    ...(state === "live" && p.expires_at
      ? { endsInSeconds: Math.max(0, Math.floor((Date.parse(p.expires_at) - Date.now()) / 1000)) }
      : {}),
    sessionHours: Number(p.session_hours),
    applicationsTotal: total,
    applicationsUsed: used,
    applicationsLeft: Math.max(0, total - used),
    activatedVia: p.activated_via,
    ...(p.close_reason ? { closeReason: p.close_reason } : {}),
    startsOn: "your agent's first call other than key_status",
  };
}

/**
 * The repair: grant from the Stripe session when the webhook has not yet.
 * Refuses anything that is not paid, not this user's, or not a pass — and
 * logs the refusal, because a buyer on this page with a session that fails
 * these checks is either a late webhook (fine) or a mismatch worth seeing.
 */
async function repairFromSession(service: ServiceClient, userId: string, sessionId: string): Promise<string | null> {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return "stripe_unconfigured";
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  // 'paid', or the one no-cost shape the shared predicate admits for a pass.
  if (session.payment_status !== "paid" && !passSessionSettled(session)) return "not_paid";
  if (session.metadata?.product_type !== PASS_PRODUCT_TYPE) return "not_a_pass";
  const owner = session.client_reference_id ?? session.metadata?.user_id ?? "";
  if (owner !== userId) return "not_yours";
  const intent = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? "";
  // A REFUNDED PAYMENT OPENS NO PASS (L6-18). A second pass paid while one
  // is open is refused at grant and refunded by the owner; payment_revoke
  // then finds no pass to close and writes only its receipt, and Stripe
  // still answers 'paid'. Without this, reopening the success URL once the
  // first pass closed granted a pass from the refunded session. A receipt
  // that cannot be read grants nothing either; the page offers a retry.
  const revoked = await paymentRevocationState(service, { sessionId: session.id, paymentIntentId: intent });
  if (revoked === "revoked") return "payment_revoked";
  if (revoked === "unreadable") return "revocation_unreadable";
  const { data, error } = await service.rpc("agent_pass_grant", {
    p_user_id: userId,
    p_stripe_session_id: session.id,
    p_payment_intent_id: intent,
    // What was actually charged, as the webhook records it; the constant only
    // fills a session Stripe answered without a total.
    p_amount_cents: session.amount_total ?? PASS_PRICE_CENTS,
    p_session_hours: PASS_SESSION_HOURS,
    p_applications_total: PASS_APPLICATIONS,
    p_rate_per_min: PASS_RATE_PER_MIN,
    p_daily_quota: PASS_QUOTA_PER_DAY,
    p_shelf_days: PASS_SHELF_LIFE_DAYS,
  }).maybeSingle();
  if (error) {
    console.error("[AGENT-PASS-STATUS] repair grant failed:", error.message?.slice(0, 160));
    return "grant_failed";
  }
  const r = data as { granted_ok?: boolean; grant_reason?: string } | null;
  console.log(`[AGENT-PASS-STATUS] repair ${session.id}: ${r?.grant_reason ?? "unknown"}`);
  return r?.granted_ok ? null : (r?.grant_reason ?? "grant_refused");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user?.id) return json({ error: "Sign in to see your pass." }, 401);

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // session_id from the query (GET) or the body (POST); Stripe's ids are
  // cs_… strings, so anything else is ignored rather than sent to Stripe.
  let sessionId = new URL(req.url).searchParams.get("session_id") ?? "";
  if (!sessionId && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    sessionId = typeof body?.session_id === "string" ? body.session_id : "";
  }
  sessionId = /^cs_[A-Za-z0-9_]+$/.test(sessionId) ? sessionId : "";

  try {
    await lazyClosePasses(service, user.id);

    let repair: string | null = null;
    if (sessionId) {
      const { data: bySession } = await service.from("agent_passes")
        .select("id").eq("stripe_session_id", sessionId).maybeSingle();
      if (!bySession) {
        repair = await repairFromSession(service, user.id, sessionId);
        // A grant closes nothing itself; a pass granted just now is open.
        // Only a second pass is money taken for nothing: a session another
        // account paid has its pass on that account.
        if (repair === "pass_already_open") await tellOwnerOnce(service, repair, sessionId);
      }
    }

    // The open pass if there is one; otherwise the most recent, so the page
    // can say "your last pass ended" rather than "you have never bought one".
    const { data: openRow } = await service.from("agent_passes")
      .select(PASS_COLUMNS).eq("user_id", user.id).is("closed_at", null).maybeSingle();
    let row = openRow as PassRow | null;
    if (!row) {
      const { data: lastRow } = await service.from("agent_passes")
        .select(PASS_COLUMNS).eq("user_id", user.id)
        .order("purchased_at", { ascending: false }).limit(1).maybeSingle();
      row = lastRow as PassRow | null;
    }

    // The live agent key, service role: api_keys carries no RLS policies.
    const { data: keyRow } = await service.from("api_keys")
      .select("key_prefix, created_at").eq("user_id", user.id).is("revoked_at", null).maybeSingle();
    const key = keyRow as { key_prefix?: string; created_at?: string } | null;

    return json({
      pass: describePass(row),
      key: key
        ? { live: true, prefix: key.key_prefix ?? null, createdAt: key.created_at ?? null }
        : { live: false },
      ...(repair ? { repair, repairTerminal: TERMINAL_REPAIRS.has(repair) } : {}),
    });
  } catch (e) {
    console.error("[AGENT-PASS-STATUS] failed:", String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: "Could not read the pass right now. Retry shortly." }, 503);
  }
});
