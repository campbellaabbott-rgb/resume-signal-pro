// deploy-stamp: 2026-10-09T14:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FULL_ANALYSIS_PRODUCT_TYPE } from "../_shared/full-analysis.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { targetRolesOf } from "../_shared/target-roles.ts";
import { purchaseLinkFor } from "../_shared/purchase-links.ts";

// Provable from outside without running a sweep: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "retry-failed-deliveries.2026-10-11.22";

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
  args: { p_id: string; p_status: string; p_error: string; p_increment_retry: boolean },
): Promise<void> {
  await supabase.rpc('update_delivery_retry', args);
  try {
    const { data: row } = await supabase.from('product_deliveries')
      .select('retry_count, max_retries, next_retry_at').eq('id', delivery.id).maybeSingle();
    if (!row || Number(row.retry_count) < Number(row.max_retries)) return;
    await alertDeliverySpent(supabase, delivery, args.p_error);
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
 * One mail per spent delivery, to the owner, naming what to do for THIS
 * product (S12-061). The door (held 30 days) is taken before the send so two
 * runs cannot both mail, and given back when no sender accepted it, so the
 * next run tries again (CP-027: the door used to be spent on a refused send).
 * Never throws.
 */
async function alertDeliverySpent(supabase: Db, delivery: DeliveryRow, lastError: string, buyerTold: string | null = null): Promise<void> {
  const door = 'owner-alert:delivery';
  const bucket = String(delivery.id).slice(0, 64);
  try {
    const { data: first, error } = await supabase.rpc('mail_door_take', {
      p_door: door, p_bucket: bucket, p_max: 1, p_window_minutes: 43200,
    });
    if (error || first !== true) return;
    const sent = await sendOwnerMail(
      `Paid delivery ran out of retries: ${String(delivery.product_type).slice(0, 40)}`,
      `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111">
          <p>A paid order was not delivered, and the retry sweep has stopped trying.</p>
          <p>Product: <b>${escapeHtml(delivery.product_type)}</b><br>Buyer: ${escapeHtml(delivery.customer_email ?? '(no address on the row)')}<br>Checkout session: ${escapeHtml(delivery.stripe_session_id)}<br>Last error: ${escapeHtml(String(lastError).slice(0, 300))}</p>
          ${buyerTold ? `<p>The buyer was mailed: ${escapeHtml(buyerTold)}</p>` : ''}
          <p>What to do: ${escapeHtml(remedyFor(delivery.product_type, delivery.stripe_session_id))}</p>
          <p>Once it is delivered, set the order's status to delivered so the monitors stop counting it.</p>
        </div>`,
    );
    if (!sent) await supabase.from('mail_door_counts').delete().eq('door', door).eq('bucket', bucket);
  } catch (e) {
    console.warn('[RETRY-FAILED-DELIVERIES] spent-delivery alarm not sent:', e instanceof Error ? e.message.slice(0, 120) : String(e));
  }
}

/**
 * A FAILURE NO RETRY CAN CURE: spend the row now, tell the buyer once what is
 * missing (through send-product-email, which knows the purchase link), and
 * tell the owner once. The buyer mail is held to one per order by its own
 * door, given back when the mail was refused so the next run tries again.
 */
async function spendTerminal(
  supabase: Db, supabaseUrl: string, supabaseServiceKey: string, delivery: DeliveryRow, terminal: Terminal,
): Promise<{ buyerMailed: boolean }> {
  const detail = `${terminal.reason}: ${terminal.detail}`;
  await supabase.from('product_deliveries')
    .update({ status: 'generation_failed', generation_success: false, generation_error: detail, last_retry_error: detail, max_retries: 0, next_retry_at: null })
    .eq('id', delivery.id);
  let buyerMailed = false;
  if (delivery.customer_email) {
    const door = 'buyer-needs-input';
    const bucket = String(delivery.stripe_session_id).slice(0, 64);
    const { data: first } = await supabase.rpc('mail_door_take', { p_door: door, p_bucket: bucket, p_max: 1, p_window_minutes: 43200 });
    if (first === true) {
      try {
        const language = (delivery.metadata as { language?: unknown } | null)?.language;
        const res = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({
            kind: 'needs_input', reason: terminal.reason, email: delivery.customer_email,
            productType: delivery.product_type, productName: delivery.product_name || delivery.product_type,
            sessionId: delivery.stripe_session_id, ...(typeof language === 'string' ? { language } : {}),
          }),
        });
        buyerMailed = res.ok;
      } catch { /* given back below */ }
      if (!buyerMailed) await supabase.from('mail_door_counts').delete().eq('door', door).eq('bucket', bucket);
    }
  }
  await alertDeliverySpent(supabase, delivery, detail, buyerMailed ? `${TERMINAL_DETAIL[terminal.reason]}; they were asked for it.` : null);
  return { buyerMailed };
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

    // Get failed deliveries that need retry. This build handles a 'generating'
    // row nobody finished, so it asks for them; the old build did not
    // (20261009140000, S11-146).
    const { data: failedDeliveries, error: fetchError } = await supabase
      // Two rows a run (CP-031): each paid generation can take a minute, and
      // five one after another ran past the function's wall clock.
      .rpc('get_failed_deliveries_for_retry', { p_limit: 2, p_include_generating: true });

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

      try {
        const metadata = delivery.metadata as Record<string, unknown> || {};
        const resumeSessionId = metadata.resume_session_id as string;
        
        // Handle based on current status. A 'generating' row reaches here only
        // when its generation began 15+ minutes ago and never finished
        // (20261009140000): nothing is still writing it, so it is generated
        // again like a payment that was never started.
        if (delivery.status === 'payment_received' || delivery.status === 'generation_failed' || delivery.status === 'generating') {
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

          // Update delivery status
          await supabase
            .from('product_deliveries')
            .update({
              status: 'content_generated',
              generation_success: true,
              content_generation_completed_at: new Date().toISOString()
            })
            .eq('id', delivery.id);

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
          p_increment_retry: true
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