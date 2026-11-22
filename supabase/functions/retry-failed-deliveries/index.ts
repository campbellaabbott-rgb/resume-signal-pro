// deploy-stamp: 2026-10-09T14:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FULL_ANALYSIS_PRODUCT_TYPE } from "../_shared/full-analysis.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { targetRolesOf } from "../_shared/target-roles.ts";
import { purchaseLinkFor } from "../_shared/purchase-links.ts";

// Provable from outside without running a sweep: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-11-12.1 (bug round of 2026-11-08, part A, full-analysis lane, S14X-220, RC-S13-110): a finished analysis whose mail was refused is resent from its stored copy, and a refused owner alarm or buyer notice is sent first on a later run; only a 400 or 422 from send-product-email gives a buyer's notice up at once.
// 2026-11-21.1 (bug round of 2026-11-19, lane payments-delivery, S10-077): built against the selector that claims what it hands out (20261121130000): two runs at once, the cron's and a visitor's, no longer both mail a saved copy or a failed mail's resend. The selector's call is unchanged; this build is the one the claim was proven with.
const FN_BUILD = "retry-failed-deliveries.2026-11-21.1";

// HOW LONG THIS SWEEP HOLDS AN ORDER IT MAKES (20261011144000, CP-019). The
// row is leased before the generator is called: a maker that lost its lease
// (the webhook whose isolate outlived the fifteen-minute wait) is refused
// when it finishes, so an order is never made and mailed twice; and a row
// another maker holds is left to it.
const LEASE_MINUTES = 10;

// THE PRODUCTS MADE ON THEIR OWN PAGE. Nothing here makes them; what this
// sweep does for them is resend the purchase-link mail when the webhook's
// first send was refused (S12-104): the link is the buyer's only way back.
const MADE_ON_ITS_PAGE = [FULL_ANALYSIS_PRODUCT_TYPE, "freelance_boost", "freelance_transition_pro"];

/**
 * FAILURES NO RETRY CAN CURE (CP-C item 4, S12-054). The row is spent at once
 * instead of eight times over a day, the buyer is mailed once to say what is
 * missing and how to give it, and the owner is told once. An Apply Assistant
 * bought with no posting could never be made, yet the success page told its
 * buyer to close the tab and wait for an email that never came.
 */
type Terminal = { reason: "job_posting_required" | "resume_missing" | "resume_expired"; detail: string };
const TERMINAL_DETAIL: Readonly<Record<Terminal["reason"], string>> = {
  job_posting_required: "No job posting is attached to this Apply Assistant purchase, so it cannot be made",
  resume_missing: "No résumé is attached to this purchase, so it cannot be made",
  resume_expired: "The résumé for this purchase is no longer stored (résumés are kept 24 hours), so it cannot be made",
};

// WHAT THIS SWEEP CAN DELIVER. A row for anything else (a subscription, the
// six-hour pass, the Freelance Boost tiers, an unknown type) is taken off the
// schedule with the reason written down, instead of being stamped
// generation_failed and retried until exhausted: those were guaranteed false
// failures that buried real ones on the delivery monitor (platform sweep
// L6-27, register 2.16). The full analysis keeps its own branch below.
const SCAN_CREDIT_PRODUCT_TYPES = ["scan_pack", "scan_credits", "career_bundle"];
const GENERATED_PRODUCT_TYPES = [
  "apply_assistant", "basic_keyword_fix", "cover_letter", "premium_package", "graduate_gameplan",
  "career_snapshot", "ats_defense", "interview_coach", "career_path_simulator",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[RETRY-FAILED-DELIVERIES] ${step}`, details ? JSON.stringify(details) : '');
};

type DeliveryRow = { id: string; stripe_session_id: string; product_type: string; customer_email: string | null; product_name?: string | null; metadata?: unknown };
// deno-lint-ignore no-explicit-any
type Db = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (t: string) => any };

/**
 * WHAT THE OWNER CAN DO ABOUT A SPENT ORDER, BY PRODUCT (S12-061). The alarm
 * sent the owner to admin-regenerate-delivery for every product, and that
 * tool only ever makes a Premium Package: a failed Full Analysis followed to
 * the letter got the buyer a résumé rewrite. Sales are final (owner decision
 * 2026-10-12), so every remedy is a delivery, never a refund.
 */
function remedyFor(productType: string, sessionId: string): string {
  const link = purchaseLinkFor(productType, sessionId);
  switch (productType) {
    case FULL_ANALYSIS_PRODUCT_TYPE:
      return `The Full Analysis is made on the buyer's own page. Send the buyer this link, which reopens the purchase (recover-purchase finds it by the session): ${link}`;
    case "freelance_boost":
    case "freelance_transition_pro":
      return `Freelance Boost is made on the buyer's intake page. Send the buyer this link, which reopens the purchase without a second charge: ${link}`;
    case "apply_assistant":
      return "Make it by hand with generate-apply-package from the buyer's résumé and the job posting (ask the buyer for the posting if none was attached), then mail it to the buyer.";
    case "premium_package":
      return "Remake it with admin-regenerate-delivery (it needs the buyer's job title), which mails the buyer a new link.";
    case "scan_pack":
    case "scan_credits":
    case "career_bundle":
      return "Add the credits by hand (add_scan_credits) for the address on the order.";
    default:
      return `No tool remakes this product by hand (it is no longer sold). Reply to the buyer, and send them this link once the order is made: ${link}`;
  }
}

/**
 * A FAILED TRY, AND THE ALARM WHEN IT WAS THE LAST (S11-014; owner decision
 * 2026-10-11). update_delivery_retry (20261009134100) decides what the
 * failure costs: an outage (a 402, 429, 5xx, timeout) is retried on the
 * day-long schedule without spending a try, a real failure spends one, and a
 * row whose tries are spent, or whose next try would fall after the résumé's
 * 24 hours, is done. A row that just ran out used to go quiet: now the owner
 * is mailed once for it, with the buyer's address, so the sale can be made
 * good by hand.
 */
async function recordFailedTry(
  supabase: Db,
  delivery: DeliveryRow,
  args: { p_id: string; p_status: string; p_error: string; p_increment_retry: boolean; p_lease_token?: string | null },
): Promise<void> {
  await supabase.rpc('update_delivery_retry', args);
  try {
    const { data: row } = await supabase.from('product_deliveries')
      .select('retry_count, max_retries, next_retry_at').eq('id', delivery.id).maybeSingle();
    if (!row || Number(row.retry_count) < Number(row.max_retries)) return;
    // Refused, the alarm is owed on the order and a later run sends it
    // (RC-S13-110): this row has no tries left, so no later try would.
    if (await alertDeliverySpent(supabase, delivery, args.p_error) === 'refused') await owe(supabase, delivery.id, 'owner');
  } catch (e) {
    logStep("Could not read the row back for the spent-delivery alarm", { id: delivery.id, error: e instanceof Error ? e.message : String(e) });
  }
}

const escapeHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c] as string));

/**
 * The owner's alerts leave from our own domain first and, when that is
 * refused, from Resend's onboarding sender to ADMIN_EMAIL (CP-027). True only
 * when one of them was accepted.
 */
const OWNER_ALERT_SENDERS = [
  'Resume Booster Alerts <alerts@resumebooster.work>',
  'Resume Booster Alerts <onboarding@resend.dev>',
];
async function sendOwnerMail(subject: string, html: string): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error(`[RETRY-FAILED-DELIVERIES] owner alert not sent (RESEND_API_KEY is not set): ${subject.slice(0, 120)}`);
    return false;
  }
  const owner = Deno.env.get('OWNER_NOTIFY_EMAIL') ?? 'resumeboostersupp@gmail.com';
  const admin = Deno.env.get('ADMIN_EMAIL') ?? owner;
  for (const from of OWNER_ALERT_SENDERS) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        // Resend's onboarding sender reaches only the account's own address.
        body: JSON.stringify({ from, to: [from.includes('resend.dev') ? admin : owner], subject, html }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return true;
      console.error(`[RETRY-FAILED-DELIVERIES] owner alert refused by Resend from ${from}: ${res.status}`);
    } catch (e) {
      console.warn(`[RETRY-FAILED-DELIVERIES] owner alert from ${from} not sent:`, e instanceof Error ? e.message.slice(0, 120) : String(e));
    }
  }
  return false;
}

/**
 * WHAT BECAME OF A NOTICE (RC-S13-110): sent; already sent, or being sent, by
 * another run (its door is taken); refused, so it is owed to a later run;
 * rejected (send-product-email answered 400 or 422: an address or a request
 * it will never take, so no later run tries it); or nobody to send it to.
 * Any other answer (a 401 or 403 from its caller check, a 404, a 429, a 5xx)
 * is about the run, not the message, and leaves the notice refused.
 */
type NoticeOutcome = 'sent' | 'not-first' | 'refused' | 'rejected' | 'nobody';
type NoticeOwed = 'owner' | 'buyer' | 'both';
const owedOf = (buyer: NoticeOutcome, owner: NoticeOutcome): NoticeOwed | null =>
  buyer === 'refused' ? (owner === 'refused' ? 'both' : 'buyer') : owner === 'refused' ? 'owner' : null;

/**
 * A BUYER'S NOTICE IS NOT OWED FOREVER (RC-S13-110). One the mail service
 * refused outright is given up on that run, and one refused on this many
 * runs is given up then: an address that bounces for good was retried on
 * every run, wrote a failed log row naming the address each time, and kept
 * one of the run's few owed-notice slots. The owner is told once, by a mail
 * of its own, that the buyer was not asked.
 */
const OWED_BUYER_TRIES = 6;
const GIVEN_UP_OUTRIGHT = 'the mail service refused the address outright';
const givenUpAfter = (tries: number) => `the mail service refused it on ${tries} runs`;
const buyerNotToldLine = (why: string) => `The buyer was not told what is missing (${why}). Write to them yourself at the address above.`;

/**
 * THE NOTICE A SPENT ORDER STILL OWES, WRITTEN ON THE ORDER (RC-S13-110,
 * 20261112130000). A refused notice gave its door back "so the next run tries
 * again", but no next run looked: a spent order is never selected again. A
 * write of its own, so a database without the column (before the migration)
 * fails only this write and is logged. Never throws.
 */
async function owe(supabase: Db, id: string, owed: NoticeOwed | null, buyer: { tries?: number; givenUp?: string | null } = {}): Promise<void> {
  try {
    // notice_tried_at orders the next run's read (oldest first); the try count
    // and the reason a buyer's notice was given up ride in the same write.
    const { error } = await supabase.from('product_deliveries').update({
      notice_owed: owed,
      notice_tried_at: new Date().toISOString(),
      ...(buyer.tries !== undefined ? { notice_tries: buyer.tries } : {}),
      ...(buyer.givenUp !== undefined ? { notice_given_up: buyer.givenUp } : {}),
    }).eq('id', id);
    if (error) logStep("The notice this order owes could not be written", { id, owed, error: String(error.message ?? error).slice(0, 200) });
  } catch (e) {
    logStep("The notice this order owes could not be written", { id, owed, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * One mail per spent delivery, to the owner, naming what to do for THIS
 * product (S12-061). The door (held 30 days) is taken before the send so two
 * runs cannot both mail, and given back when no sender accepted it (CP-027:
 * the door used to be spent on a refused send). Says what became of it, so a
 * refused alarm is owed on the order (RC-S13-110). With `buyerNotTold` (why
 * the buyer's notice was given up) it is the mail saying so, through a door
 * of its own, since the spent-order alarm has usually gone already. Never
 * throws.
 */
async function alertDeliverySpent(supabase: Db, delivery: DeliveryRow, lastError: string, buyerTold: string | null = null, buyerNotTold: string | null = null): Promise<NoticeOutcome> {
  const door = buyerNotTold ? 'owner-alert:buyer-not-told' : 'owner-alert:delivery';
  const bucket = String(delivery.id).slice(0, 64);
  try {
    const { data: first, error } = await supabase.rpc('mail_door_take', {
      p_door: door, p_bucket: bucket, p_max: 1, p_window_minutes: 43200,
    });
    if (error) return 'refused';
    if (first !== true) return 'not-first';
    const sent = await sendOwnerMail(
      buyerNotTold
        ? `Buyer of a spent order could not be told: ${String(delivery.product_type).slice(0, 40)}`
        : `Paid delivery ran out of retries: ${String(delivery.product_type).slice(0, 40)}`,
      `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111">
          <p>A paid order was not delivered, and the retry sweep has stopped trying.</p>
          <p>Product: <b>${escapeHtml(delivery.product_type)}</b><br>Buyer: ${escapeHtml(delivery.customer_email ?? '(no address on the row)')}<br>Checkout session: ${escapeHtml(delivery.stripe_session_id)}<br>Last error: ${escapeHtml(String(lastError).slice(0, 300))}</p>
          ${buyerTold ? `<p>The buyer was mailed: ${escapeHtml(buyerTold)}</p>` : ''}
          ${buyerNotTold ? `<p><b>${escapeHtml(buyerNotToldLine(buyerNotTold))}</b></p>` : ''}
          <p>What to do: ${escapeHtml(remedyFor(delivery.product_type, delivery.stripe_session_id))}</p>
          <p>Once it is delivered, set the order's status to delivered so the monitors stop counting it.</p>
        </div>`,
    );
    if (sent) return 'sent';
    await supabase.from('mail_door_counts').delete().eq('door', door).eq('bucket', bucket);
    return 'refused';
  } catch (e) {
    console.warn('[RETRY-FAILED-DELIVERIES] spent-delivery alarm not sent:', e instanceof Error ? e.message.slice(0, 120) : String(e));
    return 'refused';
  }
}

/**
 * The buyer's one mail saying what is missing (through send-product-email,
 * which knows the purchase link), held to one per order by its own door and
 * given back when the mail was refused. Never throws.
 */
async function mailBuyerNeedsInput(
  supabase: Db, supabaseUrl: string, supabaseServiceKey: string, delivery: DeliveryRow, reason: Terminal['reason'],
): Promise<NoticeOutcome> {
  if (!delivery.customer_email) return 'nobody';
  const door = 'buyer-needs-input';
  const bucket = String(delivery.stripe_session_id).slice(0, 64);
  try {
    const { data: first, error } = await supabase.rpc('mail_door_take', { p_door: door, p_bucket: bucket, p_max: 1, p_window_minutes: 43200 });
    if (error) return 'refused';
    if (first !== true) return 'not-first';
  } catch {
    return 'refused';
  }
  let sent = false;
  let status = 0;
  try {
    const language = (delivery.metadata as { language?: unknown } | null)?.language;
    const res = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
      body: JSON.stringify({
        kind: 'needs_input', reason, email: delivery.customer_email,
        productType: delivery.product_type, productName: delivery.product_name || delivery.product_type,
        sessionId: delivery.stripe_session_id, ...(typeof language === 'string' ? { language } : {}),
      }),
    });
    sent = res.ok;
    status = res.status;
  } catch { /* given back below */ }
  if (sent) return 'sent';
  try {
    await supabase.from('mail_door_counts').delete().eq('door', door).eq('bucket', bucket);
  } catch { /* the door expires on its own */ }
  // Only a refusal of the message itself is given up at once: send-product-
  // email answers 400 for an address its pattern rejects, a missing product
  // or an unknown reason (422 is read the same way), and no later run would
  // fare better. A 401 or 403 is its service-role check refusing this caller
  // (a key that rotated), a 404 a function not deployed, a 429 a rate limit
  // and a 5xx an outage: each is about this run, so the notice stays owed and
  // a later run tries it (OWED_BUYER_TRIES runs at most).
  return status === 400 || status === 422 ? 'rejected' : 'refused';
}

const buyerAskedLine = (reason: Terminal['reason']) => `${TERMINAL_DETAIL[reason]}; they were asked for it.`;

/**
 * A FAILURE NO RETRY CAN CURE: spend the row now, tell the buyer once what is
 * missing, and tell the owner once. A notice the provider refused is owed on
 * the order (RC-S13-110), and a later run sends it.
 */
async function spendTerminal(
  supabase: Db, supabaseUrl: string, supabaseServiceKey: string, delivery: DeliveryRow, terminal: Terminal,
): Promise<{ buyerMailed: boolean }> {
  const detail = `${terminal.reason}: ${terminal.detail}`;
  await supabase.from('product_deliveries')
    .update({ status: 'generation_failed', generation_success: false, generation_error: detail, last_retry_error: detail, max_retries: 0, next_retry_at: null })
    .eq('id', delivery.id);
  const buyer = await mailBuyerNeedsInput(supabase, supabaseUrl, supabaseServiceKey, delivery, terminal.reason);
  const givenUp = buyer === 'rejected' ? GIVEN_UP_OUTRIGHT : null;
  const owner = await alertDeliverySpent(supabase, delivery, detail, buyer === 'sent' ? buyerAskedLine(terminal.reason) : null, givenUp);
  const owed = owedOf(buyer, owner);
  if (owed || givenUp) await owe(supabase, delivery.id, owed, { tries: buyer === 'refused' || buyer === 'rejected' ? 1 : 0, givenUp });
  return { buyerMailed: buyer === 'sent' };
}

/**
 * THE NOTICES STILL OWED, SENT FIRST ON EVERY RUN (RC-S13-110). A spent order
 * is never selected for a retry again, so the run that spent it was the only
 * one that ever tried its alarm and its buyer mail. Now a refused one is owed
 * on the order (notice_owed) and every run reads a few such orders, whatever
 * their tries, the ones tried longest ago first (notice_tried_at), sends what
 * is owed through the same doors (so nothing is sent twice), and writes what
 * is still owed, or nothing. A buyer's notice rejected outright, or refused
 * on OWED_BUYER_TRIES runs, is given up and the owner told once. Nothing is
 * made again. Before 20261112130000 the read fails on the missing columns and
 * is skipped. Never throws.
 */
const OWED_NOTICES_PER_RUN = 5;
async function sendOwedNotices(supabase: Db, supabaseUrl: string, supabaseServiceKey: string): Promise<number> {
  try {
    const { data, error } = await supabase.from('product_deliveries')
      .select('id, status, stripe_session_id, product_type, product_name, customer_email, metadata, generation_error, last_retry_error, notice_owed, notice_tries, notice_given_up')
      .in('notice_owed', ['owner', 'buyer', 'both'])
      .order('notice_tried_at', { ascending: true, nullsFirst: true })
      .limit(OWED_NOTICES_PER_RUN);
    if (error) {
      logStep("Owed notices not read", { error: String(error.message ?? error).slice(0, 200) });
      return 0;
    }
    let handled = 0;
    for (const row of (data ?? []) as Array<DeliveryRow & { status?: string; notice_owed?: string; generation_error?: string | null; last_retry_error?: string | null; notice_tries?: number | null; notice_given_up?: string | null }>) {
      // An order made good since (delivered by hand, or refunded) owes nobody a notice.
      if (row.status === 'delivered' || row.status === 'refunded') {
        await owe(supabase, row.id, null);
        continue;
      }
      const reason = /^(job_posting_required|resume_missing|resume_expired):/.exec(String(row.generation_error ?? ''))?.[1] as Terminal['reason'] | undefined;
      const buyerOwed = (row.notice_owed === 'buyer' || row.notice_owed === 'both') && !!reason && !row.notice_given_up;
      const tried: NoticeOutcome = buyerOwed
        ? await mailBuyerNeedsInput(supabase, supabaseUrl, supabaseServiceKey, row, reason!)
        : 'nobody';
      const tries = Number(row.notice_tries ?? 0) + (tried === 'refused' || tried === 'rejected' ? 1 : 0);
      const givenUp = row.notice_given_up
        ?? (tried === 'rejected' ? GIVEN_UP_OUTRIGHT : tried === 'refused' && tries >= OWED_BUYER_TRIES ? givenUpAfter(tries) : null);
      // A notice given up on this run is the owner's to hear, once.
      const newlyGivenUp = !!givenUp && !row.notice_given_up;
      const buyer: NoticeOutcome = givenUp ? 'nobody' : tried;
      const owner: NoticeOutcome = row.notice_owed === 'owner' || row.notice_owed === 'both' || newlyGivenUp
        ? await alertDeliverySpent(supabase, row, String(row.last_retry_error ?? row.generation_error ?? 'not recorded'), buyer === 'sent' && reason ? buyerAskedLine(reason) : null, givenUp)
        : 'nobody';
      await owe(supabase, row.id, owedOf(buyer, owner), { tries, givenUp });
      handled++;
      logStep("Owed notice", { id: row.id, owed: row.notice_owed, buyer: tried, owner, tries, givenUp: !!givenUp });
    }
    return handled;
  } catch (e) {
    logStep("Owed notices not sent", { error: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

/**
 * THE FINISHED FULL ANALYSIS BEHIND AN ORDER (S14X-220): the share id its
 * redemption points at, or null when the analysis was never made (the order
 * is waiting for the buyer's page, and its failed mail was the purchase link).
 */
async function finishedAnalysisOf(supabase: Db, sessionId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_purchased_content_by_session', { p_session_id: sessionId });
  if (error) throw new Error(`Content lookup failed: ${String(error.message ?? error).slice(0, 200)}`);
  const row = Array.isArray(data)
    ? data.find((r: { product_type?: unknown; generated_content?: { shareId?: unknown } | null }) =>
      r?.product_type === FULL_ANALYSIS_PRODUCT_TYPE && typeof r?.generated_content?.shareId === 'string')
    : null;
  return row ? String(row.generated_content.shareId) : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting retry check");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // RATE LIMITED rather than key-gated, deliberately. This endpoint is
    // verify_jwt=false and re-runs paid product generation — AI spend, and
    // credits — so an unauthenticated caller could hammer it and amplify every
    // pending retry. But its scheduled caller is a pg_cron net.http_post that
    // sends NO auth header (20260725224137), and breaking delivery recovery for
    // paying customers is a worse outcome than the abuse. A limit the cron
    // cannot hit (it runs every four hours) bounds the blast radius without
    // touching that chain.
    // The platform's word for the caller's address, never the first forwarded
    // hop, which a caller writes itself and could rotate per request.
    const ip = clientAddressOr(req.headers);
    const { data: rlAllowed } = await supabase.rpc("check_rate_limit", {
      p_function: "retry-failed-deliveries", p_ip: ip, p_max_requests: 6, p_window_minutes: 60,
    });
    if (rlAllowed === false) {
      logStep("Rate limited");
      return new Response(JSON.stringify({ error: "Too many requests." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // What earlier runs owe first (RC-S13-110): a few orders whose alarm or
    // buyer mail the provider refused, sent before anything is made.
    await sendOwedNotices(supabase, supabaseUrl, supabaseServiceKey);

    // Get failed deliveries that need retry. This build handles a 'generating'
    // row nobody finished, so it asks for them; the old build did not
    // (20261009140000, S11-146). It also handles an order made and never
    // mailed ('generated' or 'content_generated' with no mail sent, 15
    // minutes on), so it asks for those too (20261011143000, CP-021). The
    // rows it is handed are this run's for twenty minutes (20261121130000,
    // S10-077); whatever it writes on each (delivered, the next try's time,
    // infinity) replaces that claim.
    const { data: failedDeliveries, error: fetchError } = await supabase
      // Two rows a run (CP-031): each paid generation can take a minute, and
      // five one after another ran past the function's wall clock.
      .rpc('get_failed_deliveries_for_retry', { p_limit: 2, p_include_generating: true, p_include_unmailed: true });

    if (fetchError) {
      logStep("Error fetching failed deliveries", { error: fetchError.message });
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!failedDeliveries || failedDeliveries.length === 0) {
      logStep("No failed deliveries to retry");
      return new Response(
        JSON.stringify({ message: "No deliveries to retry", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Found failed deliveries", { count: failedDeliveries.length });

    const results: Array<{
      id: string;
      status: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const delivery of failedDeliveries) {
      logStep("Retrying delivery", { 
        id: delivery.id, 
        productType: delivery.product_type,
        status: delivery.status,
        retryCount: delivery.retry_count
      });

      // The lease this sweep holds on the row while it makes it (null until
      // taken, and for the paths that make nothing: a saved copy, credits,
      // a resent link).
      let leaseToken: string | null = null;
      try {
        const metadata = delivery.metadata as Record<string, unknown> || {};
        const resumeSessionId = metadata.resume_session_id as string;
        
        // MADE, NEVER MAILED (CP-021). A 'generated' row (the success page
        // made it) or a 'content_generated' row (the webhook or a sweep made
        // it) whose mail never left reaches here 15 minutes after it was made
        // (20261011143000): the writer that would have mailed it is gone. It
        // goes through the branch below, which mails the saved copy and never
        // makes it again. With no address on the order there is nobody to
        // mail: the buyer saw it on the page, so it leaves the schedule.
        const madeNotMailed = delivery.status === 'generated' || delivery.status === 'content_generated';
        if (madeNotMailed && !delivery.customer_email) {
          await supabase.from('product_deliveries')
            .update({ next_retry_at: 'infinity', last_retry_error: 'Made and never mailed, and the order carries no address to mail it to (shown on the success page)' })
            .eq('id', delivery.id).eq('status', delivery.status);
          results.push({ id: delivery.id, status: delivery.status, success: false, error: 'no address on the order' });
          continue;
        }

        // A FINISHED FULL ANALYSIS WHOSE MAIL WAS REFUSED (S14X-220): resent
        // below from its stored copy, never made again.
        const finishedShareId = delivery.status === 'email_failed' && delivery.product_type === FULL_ANALYSIS_PRODUCT_TYPE
          ? await finishedAnalysisOf(supabase, delivery.stripe_session_id)
          : null;

        // Handle based on current status. A 'generating' row reaches here only
        // when its generation began 15+ minutes ago and never finished
        // (20261009140000): nothing is still writing it, so it is generated
        // again like a payment that was never started.
        if (delivery.status === 'payment_received' || delivery.status === 'generation_failed' || delivery.status === 'generating' || madeNotMailed) {
          // Need to generate content
          
          // For scan packs, just add credits
          if (SCAN_CREDIT_PRODUCT_TYPES.includes(delivery.product_type)) {
            // WHAT WAS BOUGHT, not a hard-coded 10 (or 75): the webhook writes
            // the count into the row's metadata at payment (L6-13). A row from
            // before that falls back to the old defaults.
            const recorded = Number((metadata as { credits?: unknown }).credits);
            const credits = Number.isFinite(recorded) && recorded > 0
              ? Math.min(Math.floor(recorded), 500)
              : delivery.product_type === 'career_bundle' ? 75 : 10;

            if (delivery.customer_email) {
              // ALREADY CREDITED? The webhook writes the receipt beside the
              // credit; when only its 'delivered' update failed, adding again
              // would pay the buyer twice. The receipt is the evidence.
              const { data: receipt } = await supabase
                .rpc('get_purchased_content_by_session', { p_session_id: delivery.stripe_session_id });
              const alreadyCredited = Array.isArray(receipt) && receipt.some(
                (r: { generated_content?: { credits?: unknown } | null }) => r?.generated_content && typeof r.generated_content === 'object' && 'credits' in r.generated_content,
              );

              if (!alreadyCredited) {
                const { error: creditError } = await supabase.rpc('add_scan_credits', {
                  p_email: delivery.customer_email,
                  p_credits: credits
                });
                if (creditError) {
                  throw new Error(`Credit add failed: ${creditError.message}`);
                }
                const { error: saveError } = await supabase.rpc('save_purchased_content', {
                  p_stripe_session_id: delivery.stripe_session_id,
                  p_customer_email: delivery.customer_email,
                  p_product_type: delivery.product_type,
                  p_product_name: delivery.product_name || `${credits} Scan Credits`,
                  p_generated_content: { credits, message: `${credits} scan credits added` }
                });
                if (saveError) logStep("Credits added but the receipt was not saved", { id: delivery.id, error: saveError.message });
              }

              await supabase
                .from('product_deliveries')
                .update({ status: 'delivered', generation_success: true })
                .eq('id', delivery.id);

              results.push({ id: delivery.id, status: 'delivered', success: true });
              logStep(alreadyCredited ? "Credits were already added; row closed" : "Credits retry successful", { id: delivery.id, credits });
              continue;
            }
          }

          // THE FULL ANALYSIS IS NOT THIS SWEEPER'S TO DELIVER. Its résumé is in
          // the buyer's temp store with no link from the Stripe session, and
          // the analysis is produced on the success page by analyze-resume,
          // which closes this row itself. The webhook now writes the row with
          // no retry scheduled, so it is never selected; this catches rows
          // written before that, which would otherwise be stamped with the
          // misleading missing-resume-session error below -- and, oldest
          // first, would crowd every other product out of this five-row batch
          // on every run. Unscheduled rather than exhausted, so the health
          // count of spent retries stays honest; left open, the row still
          // counts as stuck in product_delivery_health -- the right signal.
          if (delivery.product_type === FULL_ANALYSIS_PRODUCT_TYPE) {
            await supabase
              .from('product_deliveries')
              .update({ next_retry_at: 'infinity', generation_error: 'Full Resume Analysis is delivered on the buyer\'s success page by analyze-resume; there is nothing to regenerate server-side' })
              .eq('id', delivery.id);
            results.push({ id: delivery.id, status: delivery.status, success: false, error: 'full_analysis: delivered on the success page, not by this sweep' });
            continue;
          }

          // Nothing here can generate it: unscheduled with the reason, not
          // stamped as a failure and retried until exhausted (see the list at
          // the top). Left open, it still reads as stuck on the delivery
          // monitor after two hours, which is the signal a human should see.
          if (!GENERATED_PRODUCT_TYPES.includes(delivery.product_type)) {
            const reason = SCAN_CREDIT_PRODUCT_TYPES.includes(delivery.product_type)
              ? 'Scan credits with no buyer email on the row: nothing to credit; recover by hand'
              : `${delivery.product_type || 'unknown'} is not delivered by this sweep (a subscription, the pass or Freelance Boost is closed by its own path)`;
            await supabase
              .from('product_deliveries')
              .update({ next_retry_at: 'infinity', generation_error: reason })
              .eq('id', delivery.id);
            results.push({ id: delivery.id, status: delivery.status, success: false, error: `${delivery.product_type}: not this sweep's to deliver` });
            continue;
          }

          // ALREADY MADE AND SAVED (CP-030): a row stranded after its copy was
          // saved (the isolate died before the status write) is mailed from
          // that copy, never generated a second time.
          const { data: savedRows } = await supabase
            .rpc('get_purchased_content_by_session', { p_session_id: delivery.stripe_session_id });
          const savedCopy = Array.isArray(savedRows)
            ? savedRows.find((r: { generated_content?: unknown }) => r?.generated_content)?.generated_content ?? null
            : null;

          // NOTHING TO MAKE IT FROM IS TERMINAL (CP-C item 4, S12-054): no
          // résumé linked, the stored résumé gone, an Apply Assistant with no
          // posting. Eight tries over a day could never change any of them.
          if (!savedCopy && !resumeSessionId) {
            await spendTerminal(supabase, supabaseUrl, supabaseServiceKey, delivery, { reason: 'resume_missing', detail: TERMINAL_DETAIL.resume_missing });
            results.push({ id: delivery.id, status: 'generation_failed', success: false, error: 'resume_missing' });
            continue;
          }

          // Try to get resume data. A read that errored is an outage, retried;
          // a read that found nothing is a résumé that is gone.
          const { data: resumeData, error: resumeError } = savedCopy
            ? { data: null, error: null }
            : await supabase.rpc('get_temp_resume', { p_session_id: resumeSessionId });

          if (!savedCopy && resumeError) {
            await recordFailedTry(supabase, delivery, {
              p_id: delivery.id,
              p_status: 'generation_failed',
              p_error: `get_temp_resume unavailable: ${String(resumeError.message ?? resumeError).slice(0, 200)}`,
              p_increment_retry: true
            });
            results.push({ id: delivery.id, status: 'generation_failed', success: false, error: 'Resume data unreadable' });
            continue;
          }
          if (!savedCopy && (!resumeData || resumeData.length === 0)) {
            await spendTerminal(supabase, supabaseUrl, supabaseServiceKey, delivery, { reason: 'resume_expired', detail: TERMINAL_DETAIL.resume_expired });
            results.push({ id: delivery.id, status: 'generation_failed', success: false, error: 'resume_expired' });
            continue;
          }

          const { resume_text, job_description_text } = savedCopy ? { resume_text: '', job_description_text: null } : resumeData[0];
          const jobTitle = (metadata.job_title as string) || 'Target Position';
          const jobCompany = (metadata.job_company as string) || '';
          const language = (metadata.language as string) || 'en';

          if (!savedCopy && delivery.product_type === 'apply_assistant' && !job_description_text) {
            await spendTerminal(supabase, supabaseUrl, supabaseServiceKey, delivery, { reason: 'job_posting_required', detail: TERMINAL_DETAIL.job_posting_required });
            results.push({ id: delivery.id, status: 'generation_failed', success: false, error: 'job_posting_required' });
            continue;
          }

          // THE LEASE, before anything is paid for (20261011144000). A row
          // whose lease is live belongs to another maker (the webhook still
          // making it, or the success page): it is left to them. A row whose
          // lease expired, or that was never leased, is this sweep's now, and
          // the finish below carries the token. A saved copy takes no lease,
          // since nothing is made: what keeps a second run from mailing it
          // too is the selector's claim (20261121130000, S10-077). The read
          // that handed this run the row held it for twenty minutes, so a run
          // started meanwhile, by the cron or by a visitor's POST, is not
          // handed it.
          if (!savedCopy) {
            const { data: token, error: leaseError } = await supabase.rpc('take_delivery_lease', {
              p_stripe_session_id: delivery.stripe_session_id, p_seen_status: delivery.status, p_minutes: LEASE_MINUTES,
            });
            if (leaseError) throw new Error(`take_delivery_lease unavailable: ${String(leaseError.message ?? leaseError).slice(0, 200)}`);
            if (!token) {
              logStep("Another maker holds this order; left to it", { id: delivery.id, status: delivery.status });
              results.push({ id: delivery.id, status: delivery.status, success: false, error: 'leased elsewhere: another maker holds this order' });
              continue;
            }
            leaseToken = String(token);
          }

          let generatedContent: unknown = savedCopy;

          if (savedCopy) {
            logStep("A saved copy exists; mailing it without generating again", { id: delivery.id });
          } else if (delivery.product_type === 'apply_assistant') {
            if (!job_description_text) {
              throw new Error('Apply Assistant requires a job posting; none found in session');
            }
            const [packageResponse, coverLetterResponse] = await Promise.all([
              // The delivery's own session proves the purchase to the generator;
              // without it this retry could only ever 402.
              fetch(`${supabaseUrl}/functions/v1/generate-apply-package`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
                body: JSON.stringify({ resumeText: resume_text, jobPostingText: job_description_text, language, sessionId: delivery.stripe_session_id })
              }),
              // The service-role key: the generator's spend gate never counts
              // our own servers by address or against its free ceiling; the
              // session still counts against the purchase's daily allowance.
              fetch(`${supabaseUrl}/functions/v1/generate-cover-letter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
                body: JSON.stringify({ resumeText: resume_text, jobDescription: job_description_text, jobTitle, jobCompany, tone: 'professional', language, sessionId: delivery.stripe_session_id })
              })
            ]);

            if (!packageResponse.ok) {
              const errorText = await packageResponse.text();
              throw new Error(`Generation failed: ${packageResponse.status} - ${errorText}`);
            }

            const packageResult = await packageResponse.json();
            const coverLetterResult = coverLetterResponse.ok ? await coverLetterResponse.json() : null;
            generatedContent = {
              jobMetadata: packageResult.jobMetadata,
              tailoredResume: packageResult.tailoredResume,
              skillGaps: packageResult.skillGaps,
              checklist: packageResult.checklist,
              coverLetter: coverLetterResult?.data?.coverLetter || null,
              modelUsed: packageResult.modelUsed,
              // What the fact check removed, shown with the saved copy (S11-055).
              groundingReport: packageResult.groundingReport ?? null,
            };
          } else {
            // Generate content
            let endpoint = '';
            const body: Record<string, unknown> = {
              resumeText: resume_text,
              jobDescription: job_description_text || '',
              jobTitle,
              jobCompany,
              language,
              // Proof of purchase for the paid-only generators' own gate
              // (assertPaidSession). A RETRY is exactly where omitting this
              // would hurt most: the delivery already failed once, and a 402
              // here would turn a recoverable failure into a permanent one.
              sessionId: delivery.stripe_session_id
            };

            if (delivery.product_type === 'basic_keyword_fix') {
              endpoint = 'generate-keyword-fix';
            } else if (delivery.product_type === 'cover_letter') {
              endpoint = 'generate-cover-letter';
              body.tone = 'professional';
            } else if (delivery.product_type === 'premium_package') {
              endpoint = 'generate-premium-package';
            } else if (delivery.product_type === 'graduate_gameplan') {
              endpoint = 'generate-graduate-gameplan';
            } else if (delivery.product_type === 'career_snapshot') {
              endpoint = 'generate-career-snapshot';
            } else if (delivery.product_type === 'ats_defense') {
              // generate-ats-defense independently re-verifies payment via a
              // real Stripe checkout session lookup, so it requires
              // sessionId in the body — unlike every other product here.
              // Without it, this call always 401s.
              endpoint = 'generate-ats-defense';
              body.sessionId = delivery.stripe_session_id;
              // The roles named at checkout (S11-074), kept on the row by the webhook or the verifier.
              body.targetRoles = targetRolesOf((metadata as { target_roles?: unknown }).target_roles);
            } else if (delivery.product_type === 'interview_coach') {
              endpoint = 'generate-interview-coach';
              body.isPremium = true;
            } else if (delivery.product_type === 'career_path_simulator') {
              endpoint = 'generate-career-path';
              body.isPremium = true;
            } else {
              throw new Error(`Unknown product type: ${delivery.product_type}`);
            }

            // The service-role key, as for the Apply Assistant's letter above.
            const genResponse = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify(body)
            });

            if (!genResponse.ok) {
              const errorText = await genResponse.text();
              throw new Error(`Generation failed: ${genResponse.status} - ${errorText}`);
            }

            // Every generator answers {success, data}; a 200 without a payload
            // is a failure with a reason (generate-ats-defense answered
            // {report} alone, and this read undefined -- L6-02).
            const genResult = await genResponse.json().catch(() => null);
            generatedContent = genResult?.data ?? null;
            if (!generatedContent) throw new Error(`${endpoint} answered 200 with no content`);
          }

          // Save content. Checked BEFORE the row is marked generated: a copy
          // that never landed is a failed delivery, not a "delivered" one with
          // nothing behind it for recovery or the email retry to read. A copy
          // that was already saved is not written again.
          if (!savedCopy) {
            const { error: saveError } = await supabase.rpc('save_purchased_content', {
              p_stripe_session_id: delivery.stripe_session_id,
              p_customer_email: delivery.customer_email || '',
              p_product_type: delivery.product_type,
              p_product_name: delivery.product_name,
              p_generated_content: generatedContent
            });
            if (saveError) throw new Error(`save_purchased_content: ${saveError.message}`);
          }

          // Update delivery status. A made order's finish carries the lease:
          // refused when the row is no longer this sweep's (another maker
          // finished it first, or a refund closed it), in which case the copy
          // stays saved and nothing is mailed from here (20261011144000).
          if (leaseToken) {
            const { data: finished, error: finishError } = await supabase.rpc('finish_delivery_generation', {
              p_stripe_session_id: delivery.stripe_session_id, p_lease_token: leaseToken, p_status: 'content_generated',
            });
            if (finishError) throw new Error(`finish_delivery_generation: ${String(finishError.message ?? finishError).slice(0, 200)}`);
            if (finished !== true) {
              logStep("The order moved while this sweep made it (another maker finished first, or it closed): the copy is saved, nothing is mailed", { id: delivery.id });
              results.push({ id: delivery.id, status: delivery.status, success: false, error: 'the order was finished by another maker; not mailed from here' });
              continue;
            }
          } else {
            await supabase
              .from('product_deliveries')
              .update({
                status: 'content_generated',
                generation_success: true,
                content_generation_completed_at: new Date().toISOString()
              })
              .eq('id', delivery.id);
          }

          logStep("Content generation retry successful", { id: delivery.id });

          // Now try to send email
          if (delivery.customer_email) {
            // The service-role key: send-product-email is internal and
            // refuses the publishable key, which every visitor holds.
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify({
                email: delivery.customer_email,
                productType: delivery.product_type,
                productName: delivery.product_name,
                generatedContent,
                // The link that reopens the purchase, and its id (S8-015).
                sessionId: delivery.stripe_session_id,
                // The buyer's language, captured at checkout (S12-114).
                language,
              })
            });

            if (emailResponse.ok) {
              await supabase
                .from('product_deliveries')
                .update({
                  status: 'delivered',
                  email_success: true,
                  email_sent_at: new Date().toISOString()
                })
                .eq('id', delivery.id);

              results.push({ id: delivery.id, status: 'delivered', success: true });
              logStep("Full retry successful", { id: delivery.id });
            } else {
              // The content exists and is saved: what failed is only the
              // mail, so the row moves to email_failed and the next sweep
              // resends it from the stored copy. Thrown, it kept its old
              // status and the next sweep paid for the generation again.
              const failure = `Email failed: ${emailResponse.status}`;
              await recordFailedTry(supabase, delivery, {
                p_id: delivery.id,
                p_status: 'email_failed',
                p_error: failure,
                p_increment_retry: true
              });
              results.push({ id: delivery.id, status: 'email_failed', success: false, error: failure });
            }
          } else {
            results.push({ id: delivery.id, status: 'content_generated', success: true });
          }

        } else if (finishedShareId) {
          // THE FINISHED ANALYSIS, RESENT (S14X-220). analyze-resume made and
          // stored it, showed it on the page, and the provider refused its
          // mail: the order waits here as email_failed. The stored copy is
          // mailed through send-analysis-email (never the purchase link, never
          // a new model call), and the write names the status it saw.
          if (!delivery.customer_email) {
            await supabase.from('product_deliveries')
              .update({ next_retry_at: 'infinity', last_retry_error: 'The analysis mail failed and the order carries no address to resend it to (the buyer saw it on the page)' })
              .eq('id', delivery.id).eq('status', 'email_failed');
            results.push({ id: delivery.id, status: 'email_failed', success: false, error: 'no address on the order' });
            continue;
          }
          const { data: stored, error: storedError } = await supabase.rpc('get_analysis_by_share_id', { share_id_param: finishedShareId });
          if (storedError) throw new Error(`get_analysis_by_share_id unavailable: ${String(storedError.message ?? storedError).slice(0, 200)}`);
          const analysisData = Array.isArray(stored) ? stored[0]?.analysis_result : null;
          if (!analysisData || typeof analysisData !== 'object') {
            // Deleted by its buyer, or expired: nothing is left to mail, and
            // the buyer saw it on the page, which is what was bought.
            await supabase.from('product_deliveries')
              .update({ status: 'delivered', last_retry_error: 'The analysis is no longer stored (its buyer deleted it, or it expired) before its mail was resent; the buyer saw it on the page' })
              .eq('id', delivery.id).eq('status', 'email_failed');
            results.push({ id: delivery.id, status: 'delivered', success: true });
            continue;
          }
          const language = (metadata as { language?: unknown }).language;
          const analysisMail = await fetch(`${supabaseUrl}/functions/v1/send-analysis-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
            body: JSON.stringify({
              email: delivery.customer_email,
              analysisData,
              shareId: finishedShareId,
              ...(typeof language === 'string' ? { language } : {}),
            }),
          });
          if (!analysisMail.ok) throw new Error(`send-analysis-email answered ${analysisMail.status}`);
          await supabase.from('product_deliveries')
            .update({ status: 'delivered', email_success: true, email_sent_at: new Date().toISOString(), email_error: null })
            .eq('id', delivery.id).eq('status', 'email_failed');
          results.push({ id: delivery.id, status: 'delivered', success: true });
          logStep("Finished analysis resent", { id: delivery.id });
        } else if (delivery.status === 'email_failed' && MADE_ON_ITS_PAGE.includes(delivery.product_type)) {
          // THE PURCHASE LINK, RESENT (S12-104). For a product made on its own
          // page the failed mail was the link back to it; nothing is made
          // here. Sent, the row goes back to waiting for the buyer's own
          // page (off the schedule again); an order the page delivered in the
          // meantime stays delivered (20261011140000), and the write names the
          // status it saw so it cannot reopen anything else.
          if (!delivery.customer_email) {
            await supabase.from('product_deliveries')
              .update({ next_retry_at: 'infinity', generation_error: 'The purchase-link mail failed and the order carries no address to resend it to' })
              .eq('id', delivery.id).eq('status', 'email_failed');
            results.push({ id: delivery.id, status: 'email_failed', success: false, error: 'no address on the order' });
            continue;
          }
          const language = (metadata as { language?: unknown }).language;
          const linkResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
            body: JSON.stringify({
              email: delivery.customer_email,
              productType: delivery.product_type,
              productName: delivery.product_name || delivery.product_type,
              sessionId: delivery.stripe_session_id,
              ...(typeof language === 'string' ? { language } : {}),
            }),
          });
          if (!linkResponse.ok) throw new Error(`send-product-email answered ${linkResponse.status}`);
          await supabase.from('product_deliveries')
            .update({ status: 'payment_received', next_retry_at: 'infinity', email_success: true, email_sent_at: new Date().toISOString() })
            .eq('id', delivery.id).eq('status', 'email_failed');
          results.push({ id: delivery.id, status: 'payment_received', success: true });
          logStep("Purchase link resent", { id: delivery.id, productType: delivery.product_type });
        } else if (delivery.status === 'email_failed') {
          // Content was generated, just retry email

          // Get the saved content
          const { data: contentData, error: contentError } = await supabase
            .rpc('get_purchased_content_by_session', { p_session_id: delivery.stripe_session_id });
          if (contentError) throw new Error(`Content lookup failed: ${contentError.message}`);

          // A row whose failed mail was the success page's confirmation
          // (verify-product-purchase, for a product the browser generated)
          // has no stored copy, and never had one: the mail it failed to send
          // carried none. Resend that confirmation rather than failing the
          // row until its retries run out.
          const generatedContent = Array.isArray(contentData) && contentData.length > 0
            ? contentData[0].generated_content ?? null
            : null;

          if (delivery.customer_email) {
            // The service-role key: send-product-email is internal and
            // refuses the publishable key, which every visitor holds.
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify({
                email: delivery.customer_email,
                productType: delivery.product_type,
                productName: delivery.product_name,
                generatedContent,
                // The link that reopens the purchase, and its id (S8-015).
                sessionId: delivery.stripe_session_id,
                // The buyer's language, captured at checkout (S12-114).
                ...(typeof (metadata as { language?: unknown }).language === 'string' ? { language: (metadata as { language: string }).language } : {}),
              })
            });

            if (emailResponse.ok) {
              await supabase
                .from('product_deliveries')
                .update({
                  status: 'delivered',
                  email_success: true,
                  email_sent_at: new Date().toISOString()
                })
                .eq('id', delivery.id);

              results.push({ id: delivery.id, status: 'delivered', success: true });
              logStep("Email retry successful", { id: delivery.id });
            } else {
              throw new Error(`Email retry failed: ${emailResponse.status}`);
            }
          }
        }

      } catch (retryError) {
        const errorMessage = retryError instanceof Error ? retryError.message : String(retryError);
        logStep("Retry failed", { id: delivery.id, error: errorMessage });

        // A stuck generation that failed again is a failed generation, not
        // one still in flight.
        const failedStatus = delivery.status === 'generating' ? 'generation_failed' : delivery.status;
        await recordFailedTry(supabase, delivery, {
          p_id: delivery.id,
          p_status: failedStatus,
          p_error: errorMessage,
          p_increment_retry: true,
          // The lease this sweep held, if it took one: a failure on a row
          // another maker holds by now is refused (20261011144000).
          p_lease_token: leaseToken,
        });

        results.push({ 
          id: delivery.id, 
          status: failedStatus, 
          success: false, 
          error: errorMessage 
        });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    logStep("Retry batch complete", { successful, failed, total: results.length });

    return new Response(
      JSON.stringify({ 
        message: "Retry complete", 
        results,
        summary: { successful, failed, total: results.length }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Fatal error", { error: errorMessage });
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});