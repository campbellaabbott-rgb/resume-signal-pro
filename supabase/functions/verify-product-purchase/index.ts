// deploy-stamp: 2026-10-05T11:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resumeSessionForCheckout } from "../_shared/checkout-resume-ref.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { checkoutSessionSettled } from "../_shared/pass-settlement.ts";
import { buyerEmailOf } from "../_shared/buyer-email.ts";
import { isProCached } from "../_shared/pro.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "verify-product-purchase.2026-10-05.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[VERIFY-PRODUCT-PURCHASE] ${step}`, details ? JSON.stringify(details) : '');
};

const SCAN_CREDIT_PRODUCT_TYPES = ['scan_pack', 'scan_credits', 'career_bundle'];
// The products this path can generate when asked: the Apply Assistant and
// every case of buildGenerationRequest below.
const GENERATED_PRODUCT_TYPES = [
  'apply_assistant', 'basic_keyword_fix', 'cover_letter', 'premium_package', 'graduate_gameplan',
  'career_snapshot', 'ats_defense', 'interview_coach', 'career_path_simulator',
];

/**
 * How many credits a scan purchase bought: the metadata, else the line item's
 * quantity (create-scan-pack-checkout), else the product's default. Capped at
 * 500, as the webhook caps it. Read once, so the credit grant and the delivery
 * row the sweeper re-credits from can never disagree.
 */
function creditsBoughtBy(session: {
  metadata: Record<string, string>;
  line_items?: { data?: Array<{ quantity?: number | null }> };
}): number {
  const productType = session.metadata?.product_type;
  const fallback = productType === 'career_bundle' ? 75 : 10;
  let credits = parseInt(session.metadata?.credits || '', 10);
  if (!(credits > 0) && productType !== 'career_bundle') credits = session.line_items?.data?.[0]?.quantity ?? 0;
  return Math.min(credits > 0 ? Math.floor(credits) : fallback, 500);
}

// Maps each content product to its generation endpoint and request body.
// Mirrors stripe-webhook's switch — this is the recovery path used when the
// success page calls verify-product-purchase because the webhook hasn't
// fired yet (or failed). A product missing here means recovery silently does
// nothing for it, even though the customer paid.
function buildGenerationRequest(
  productType: string,
  resumeText: string,
  jobDescriptionText: string,
  jobTitle: string,
  jobCompany: string,
  language: string,
  sessionId: string
): { endpoint: string; body: Record<string, unknown> } | null {
  switch (productType) {
    // generate-keyword-fix gates on assertPaidSession too, and this is the path
    // the success page asks to generate the keyword fix on -- without the
    // session it was a 402 every time, rescued only by the browser's own retry.
    case 'basic_keyword_fix':
      return { endpoint: 'generate-keyword-fix', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle, jobCompany, language } };
    // The free generators (cover letter, coach, career path) read the session
    // to count this purchase's daily allowance -- see generate-cover-letter.
    case 'cover_letter':
      return { endpoint: 'generate-cover-letter', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle: jobTitle || 'Professional Position', jobCompany, tone: 'professional', language } };
    // These three now gate on assertPaidSession (they are paid-only endpoints —
    // unlike cover_letter, whose generator the public board also calls free).
    // The sessionId is their proof of purchase; omit it and a real buyer 402s.
    case 'premium_package':
      return { endpoint: 'generate-premium-package', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle: jobTitle || 'Target Position', jobCompany, language } };
    case 'graduate_gameplan':
      return { endpoint: 'generate-graduate-gameplan', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle, jobCompany, language } };
    case 'career_snapshot':
      return { endpoint: 'generate-career-snapshot', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle, jobCompany, language } };
    case 'ats_defense':
      // generate-ats-defense independently re-verifies payment via a real
      // Stripe checkout session lookup, so it requires sessionId in the
      // body — unlike every other product here, which trusts this caller
      // implicitly. Without it, this call always 401s.
      return { endpoint: 'generate-ats-defense', body: { sessionId, resumeText, jobDescription: jobDescriptionText, targetRoles: [], language } };
    case 'interview_coach':
      return { endpoint: 'generate-interview-coach', body: { sessionId, resumeText, isPremium: true, language } };
    case 'career_path_simulator':
      return { endpoint: 'generate-career-path', body: { sessionId, resumeText, isPremium: true, language } };
    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // The platform's word for the caller's address, never the first forwarded
  // hop, which the caller writes itself and could rotate per request.
  const clientIp = clientAddressOr(req.headers);
  const supabaseEarly = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  // Only an explicit "no" refuses (L6-19). A counter that errored (a statement
  // timeout, a pool hiccup) used to read as "too many requests" on the page a
  // buyer lands on right after paying.
  const { data: rlAllowed, error: rlError } = await supabaseEarly.rpc("check_rate_limit", { p_function: "verify-product-purchase", p_ip: clientIp, p_max_requests: 30, p_window_minutes: 60 });
  if (rlError) logStep("Rate limit check failed; continuing", { error: rlError.message });
  if (rlAllowed === false) return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { sessionId, generateContent = false } = await req.json();

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "Session ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Verifying purchase", { sessionId: sessionId.substring(0, 20) + "..." });

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    // Pro subscription grants: sessionId "pro_<uuid>" refers to a server-issued
    // row in pro_grants (created by create-product-checkout only when the email
    // has an active Pro subscription). Synthesize the same shape a paid Stripe
    // session would have so the rest of the flow (single-use claim, delivery
    // logging, generation) runs unchanged.
    let session: {
      payment_status: string;
      mode?: string | null;
      customer_email: string | null;
      customer_details?: { email?: string | null } | null;
      amount_total: number | null;
      metadata: Record<string, string>;
      line_items?: { data?: Array<{ quantity?: number | null }> };
    };
    if (typeof sessionId === "string" && sessionId.startsWith("pro_")) {
      const grantId = sessionId.slice(4);
      const supabaseGrant = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      // consumed_at is part of the lookup, not a note written afterwards. A
      // replayed grant id — a bookmarked success URL, a re-sent link — finds
      // nothing here rather than minting the product a second time.
      const { data: unspent } = await supabaseGrant
        .from("pro_grants")
        .select("*")
        .eq("id", grantId)
        .is("consumed_at", null)
        .maybeSingle();
      let grant = unspent;
      if (!grant) {
        // A REFRESH OF A GRANT ALREADY REDEEMED (platform sweep L6-15). The
        // grant is spent when this page first verifies it, before anything
        // is generated, so a reload mid-generation found nothing and showed a
        // verification error, while a Stripe buyer's reload simply continued.
        // A spent grant whose redemption claim exists is answered the way a
        // claimed Stripe session is: verified, isFirstUse false. Nothing is
        // minted again (credits, email and conversion all need a first use,
        // and the claim insert below loses to the existing one); a replayed
        // id with no claim is still refused.
        const { data: spent } = await supabaseGrant
          .from("pro_grants")
          .select("*")
          .eq("id", grantId)
          .not("consumed_at", "is", null)
          .maybeSingle();
        const { data: claim } = spent
          ? await supabaseGrant.from("used_stripe_sessions").select("session_id").eq("session_id", sessionId).maybeSingle()
          : { data: null };
        if (!spent || !claim) {
          return new Response(
            JSON.stringify({ error: "Invalid session" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        grant = spent;
      } else {
        // Re-verify the subscription is still active before honoring the
        // grant -- both caches (a $99 or comped agent account includes Pro),
        // through the one shared reader.
        if (!(await isProCached(supabaseGrant, grant.email))) {
          return new Response(
            JSON.stringify({ error: "Subscription is not active" }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // The consume is the claim. Two requests can both pass the SELECT above;
        // only one can win this UPDATE, because the filter and the write are one
        // statement. The loser gets nothing rather than a second copy. This runs
        // after the subscription re-check on purpose: a lapsed subscriber's grant
        // must survive its 402 rather than being burned by it.
        const { data: consumed } = await supabaseGrant
          .from("pro_grants")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", grantId)
          .is("consumed_at", null)
          .select("id");
        if (!consumed || consumed.length === 0) {
          return new Response(
            JSON.stringify({ error: "Invalid session" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      session = {
        payment_status: "paid",
        customer_email: grant.email,
        amount_total: 0,
        metadata: {
          product_type: grant.product_type || "",
          product_name: grant.product_name || "",
          customer_email: grant.email,
          session_id: grant.resume_session_id || "",
          credits: grant.credits != null ? String(grant.credits) : "",
          job_title: grant.job_title || "",
          job_company: grant.job_company || "",
          referral_code: "",
          language: grant.language || "en",
        },
      };
      logStep("Pro grant verified", { grantId, productType: session.metadata.product_type });
    } else {
      // Retrieve checkout session. A malformed/expired/unknown id makes Stripe
      // throw — return a clean 400 the client can message, not a bare 500
      // (a user reloading a stale success URL would otherwise hit an error page).
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ['line_items', 'customer']
        }) as unknown as typeof session;
      } catch (e) {
        logStep("Session retrieve failed", { message: e instanceof Error ? e.message : String(e) });
        return new Response(
          JSON.stringify({ error: "We couldn't find that purchase. If you just paid, wait a moment and refresh; otherwise the link may have expired." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    logStep("Session retrieved", { 
      status: session.payment_status,
      productType: session.metadata?.product_type 
    });

    // 'paid', or a payment-mode session a 100%-off code completed at $0 -- the
    // same rule the webhook applies (L6-10).
    if (!checkoutSessionSettled(session)) {
      return new Response(
        JSON.stringify({
          error: "Payment not completed",
          status: session.payment_status
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const productType = session.metadata?.product_type;
    const productName = session.metadata?.product_name;
    // customer_details first: an anonymous buyer's address exists only there (L6-25).
    const customerEmail = buyerEmailOf(session);
    // Looked up by the Stripe session id in checkout_resume_refs: the
    // temporary-store id is no longer written to Stripe (it is a bearer key to
    // the text). A Pro grant's synthetic session, and a session minted before
    // that change, still name it in metadata.
    const resumeSessionId = await resumeSessionForCheckout(supabaseEarly, sessionId, session.metadata);

    // Initialize Supabase to check for duplicate processing
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Atomically claim this session via the table's PRIMARY KEY on session_id.
    // This function and stripe-webhook can both race to verify the same session
    // (e.g. the webhook fires from Stripe while the user's browser hits this
    // function almost simultaneously) — a separate SELECT-then-INSERT would have
    // a window where both reads see "not yet used" and both proceed to credit/
    // generate content. Doing the INSERT first and checking its result makes the
    // claim atomic: only one caller can win the insert.
    const { error: claimError } = await supabase
      .from('used_stripe_sessions')
      // WHICH product, not just that one was bought — see _shared/paid-session.ts.
      .insert({ session_id: sessionId, product_type: productType ?? null });

    let isFirstUse: boolean;
    if (claimError) {
      // Postgres unique_violation — another process already claimed this session.
      if (claimError.code === '23505') {
        isFirstUse = false;
        logStep("Session already claimed by another process (race avoided)", { sessionId });
      } else {
        // Unexpected DB error — fail closed (treat as already-processed) rather
        // than risk double-crediting/double-generating on a transient failure.
        logStep("Error claiming session, treating as not-first-use", { error: claimError.message });
        isFirstUse = false;
      }
    } else {
      isFirstUse = true;
      logStep("Session marked as used");
    }

    const isScanProduct = SCAN_CREDIT_PRODUCT_TYPES.includes(productType ?? '');
    const purchasedCredits = isScanProduct ? creditsBoughtBy(session) : null;

    if (isFirstUse) {
      // Log delivery step: payment received. This is the ONLY delivery record
      // a sale gets when this page claims it first (every Pro grant, and any
      // purchase the webhook was late for) -- the webhook then answers
      // alreadyProcessed. Until 20261005110000 the RPC could not create the
      // row (its INSERT omitted the NOT NULL product_type) and the error was
      // never read, so those sales left no trace for the monitors or the
      // sweeper (L6-26, register 2.04). Read now, and said out loud.
      //
      // The rest of p_metadata is what the retry sweeper needs to finish the
      // sale -- the keys the webhook writes on its own row: the credits
      // bought (or it re-credits its default of 10), and the résumé and job
      // to regenerate from. log_delivery_step keeps them in the row's
      // metadata (20261005110000).
      const { error: trackError } = await supabase.rpc('log_delivery_step', {
        p_stripe_session_id: sessionId,
        p_step: 'payment_received',
        p_metadata: {
          email: customerEmail,
          product_type: productType,
          product_name: productName,
          amount_cents: session.amount_total,
          resume_session_id: resumeSessionId || null,
          job_title: session.metadata?.job_title || null,
          job_company: session.metadata?.job_company || null,
          referral_code: session.metadata?.referral_code || null,
          language: session.metadata?.language || null,
          ...(purchasedCredits != null ? { credits: purchasedCredits } : {}),
        }
      });
      if (trackError) logStep("Delivery record could not be written", { error: trackError.message });
      else logStep("Delivery tracking started");
    }

    // If content generation is requested and we have resume data
    let generatedContent: any = null;
    // WHAT THIS REQUEST OWED THE BUYER AND COULD NOT DO: a credit grant or a
    // generation that failed. While it is set the confirmation mail is not
    // sent, because its 'email_sent' step closed the row as 'delivered' over
    // the failure, and the sweeper never looked at it again (2026-10-05
    // review of L6-13 / L6-26). The row is left generation_failed, with the
    // reason, for the sweeper to finish: it re-credits what the row says was
    // bought, or regenerates the product and mails it.
    let undelivered: string | null = null;
    const recordUndelivered = async (reason: string) => {
      undelivered = reason.slice(0, 500);
      if (!isFirstUse) return;
      await supabase.rpc('log_delivery_step', {
        p_stripe_session_id: sessionId,
        p_step: 'generation_completed',
        p_success: false,
        p_error: undelivered
      });
    };
    
    // Idempotency for the (expensive, AI-billed) generation path. The Stripe
    // webhook ALSO generates every product's content, gated on the atomic
    // session claim — and it almost always wins that claim because it fires
    // server-side with no browser round-trip. This browser-side generation is a
    // fallback for when the webhook is slow/fails, but it was gated on NEITHER
    // the claim nor resume consumption (get_temp_resume was changed to a
    // non-consuming read). Result: for products the frontend asks to generate
    // here (e.g. basicKeywordFix) the webhook and this path both generated the
    // same content — double AI spend — and every success-page refresh generated
    // it yet again. Reuse already-saved content when it exists; only fall
    // through to generate if nothing has been produced for this session yet.
    if (generateContent && resumeSessionId && !generatedContent) {
      try {
        const { data: priorRows } = await supabase
          .rpc('get_purchased_content_by_session', { p_session_id: sessionId });
        const prior = Array.isArray(priorRows)
          ? priorRows.find((r: { generated_content?: unknown }) => r?.generated_content)?.generated_content
          : null;
        if (prior) {
          generatedContent = prior;
          logStep("Reusing already-generated content — skipping regeneration (idempotent)", { sessionId });
        }
      } catch (e) {
        logStep("Idempotency lookup failed, proceeding to generate", { error: String(e) });
      }
    }

    if (generateContent && resumeSessionId && !generatedContent) {
      logStep("Content generation requested", { productType, resumeSessionId });

      // Log generation started
      await supabase.rpc('log_delivery_step', {
        p_stripe_session_id: sessionId,
        p_step: 'generation_started'
      });
      
      const generationStartTime = Date.now();
      
      // Get stored resume data
      const { data: resumeData, error: resumeError } = await supabase
        .rpc('get_temp_resume', { p_session_id: resumeSessionId });

      if (resumeError) {
        logStep("Error fetching resume data", { error: resumeError.message });
      } else if (resumeData && resumeData.length > 0) {
        const { resume_text, job_description_text } = resumeData[0];
        logStep("Resume data found", { 
          resumeLength: resume_text?.length, 
          hasJobDescription: !!job_description_text 
        });

        // Extract job details from job description if available
        // This ensures content generators have proper context
        const jobTitle = session.metadata?.job_title || 'Target Position';
        const jobCompany = session.metadata?.job_company || '';
        // Captured at checkout time (create-product-checkout) since this
        // runs server-side with no access to the browser's i18n state.
        const language = session.metadata?.language || 'en';

        // Generate content based on product type
        if (productType === 'apply_assistant' && resume_text && job_description_text) {
          logStep("Calling generate-apply-package + generate-cover-letter");
          const [packageResponse, coverLetterResponse] = await Promise.all([
            // The session is the generator's proof of purchase (a cs_ id is
            // re-read from Stripe; a pro_ grant by the claim made above).
            fetch(`${supabaseUrl}/functions/v1/generate-apply-package`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
              body: JSON.stringify({ resumeText: resume_text, jobPostingText: job_description_text, language, sessionId })
            }),
            // The service-role key: the generator's spend gate never counts
            // our own servers by address or against its free ceiling; the
            // session still counts against this purchase's daily allowance,
            // which bounds the regeneration every refresh can trigger here.
            fetch(`${supabaseUrl}/functions/v1/generate-cover-letter`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({ resumeText: resume_text, jobDescription: job_description_text, jobTitle, jobCompany, tone: 'professional', language, sessionId })
            })
          ]);

          const applyGenDuration = Date.now() - generationStartTime;

          if (packageResponse.ok) {
            const packageResult = await packageResponse.json();
            const coverLetterResult = coverLetterResponse.ok ? await coverLetterResponse.json() : null;
            generatedContent = {
              jobMetadata: packageResult.jobMetadata,
              tailoredResume: packageResult.tailoredResume,
              skillGaps: packageResult.skillGaps,
              checklist: packageResult.checklist,
              coverLetter: coverLetterResult?.data?.coverLetter || null,
              modelUsed: packageResult.modelUsed,
            };
            logStep("Apply package generated successfully");

            await supabase.rpc('save_purchased_content', {
              p_stripe_session_id: sessionId,
              p_customer_email: customerEmail || '',
              p_product_type: productType,
              p_product_name: productName,
              p_generated_content: generatedContent
            });
            logStep("Content saved for recovery");

            await supabase.rpc('log_delivery_step', {
              p_stripe_session_id: sessionId,
              p_step: 'generation_completed',
              p_success: true,
              p_duration_ms: applyGenDuration
            });
          } else {
            const errorText = await packageResponse.text();
            logStep("Apply package generation failed", { status: packageResponse.status, error: errorText });
            undelivered = `generate-apply-package ${packageResponse.status}: ${errorText}`.slice(0, 500);

            await supabase.rpc('log_delivery_step', {
              p_stripe_session_id: sessionId,
              p_step: 'generation_completed',
              p_success: false,
              p_error: errorText.substring(0, 500),
              p_duration_ms: applyGenDuration
            });
          }
        } else {
          const request = resume_text
            ? buildGenerationRequest(productType, resume_text, job_description_text || '', jobTitle, jobCompany, language, sessionId)
            : null;

          if (request) {
            logStep(`Calling ${request.endpoint}`);
            // The service-role key, as for the Apply Assistant's letter above.
            const genResponse = await fetch(`${supabaseUrl}/functions/v1/${request.endpoint}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
              },
              body: JSON.stringify(request.body)
            });

            const genDuration = Date.now() - generationStartTime;
            // Every generator answers {success, data}; a 200 without a payload
            // is recorded as the failure it is (L6-02), never as success.
            const genResult = genResponse.ok ? await genResponse.json().catch(() => null) : null;

            if (genResponse.ok && genResult?.data) {
              generatedContent = genResult.data;
              logStep(`${request.endpoint} generated successfully`);

              // Save content permanently for customer recovery
              const { error: saveError } = await supabase.rpc('save_purchased_content', {
                p_stripe_session_id: sessionId,
                p_customer_email: customerEmail || '',
                p_product_type: productType,
                p_product_name: productName,
                p_generated_content: generatedContent
              });
              if (saveError) logStep("Content could NOT be saved for recovery", { error: saveError.message });
              else logStep("Content saved for recovery");

              await supabase.rpc('log_delivery_step', {
                p_stripe_session_id: sessionId,
                p_step: 'generation_completed',
                p_success: !saveError,
                p_error: saveError ? `save_purchased_content: ${saveError.message}`.slice(0, 500) : null,
                p_duration_ms: genDuration
              });
            } else {
              const errorText = genResponse.ok ? `${request.endpoint} answered 200 with no content` : await genResponse.text();
              logStep(`${request.endpoint} generation failed`, { status: genResponse.status, error: errorText });
              undelivered = `${request.endpoint} ${genResponse.status}: ${errorText}`.slice(0, 500);

              await supabase.rpc('log_delivery_step', {
                p_stripe_session_id: sessionId,
                p_step: 'generation_completed',
                p_success: false,
                p_error: errorText.substring(0, 500),
                p_duration_ms: genDuration
              });
            }
          } else {
            logStep("No matching content generator", { productType, hasResumeText: !!resume_text });
          }
        }
      } else {
        logStep("No resume data found for session", { resumeSessionId });
      }
    } else if (generateContent && !resumeSessionId) {
      logStep("Content generation requested but no resume session ID available");
    }

    // Asked to generate a product this path generates, and nothing came of it
    // without a failure being recorded above (no résumé linked, or the stored
    // one gone): that is a failed delivery too, not a sale to confirm.
    if (generateContent && !generatedContent && !undelivered && GENERATED_PRODUCT_TYPES.includes(productType ?? '')) {
      await recordUndelivered(resumeSessionId
        ? 'The résumé for this purchase could not be read; nothing was generated'
        : 'No résumé is linked to this purchase; nothing was generated');
    }

    // Handle credits for scan pack (used by both create-product-checkout and create-scan-pack-checkout)
    if ((productType === 'scan_pack' || productType === 'scan_credits') && isFirstUse && customerEmail) {
      // Metadata first, then line_items quantity, then 10; capped at 500 --
      // matches stripe-webhook (creditsBoughtBy above).
      const credits = purchasedCredits ?? creditsBoughtBy(session);

      logStep("Adding scan pack credits", { credits, email: customerEmail, productType });

      const { error: creditError } = await supabase.rpc('add_scan_credits', {
        p_email: customerEmail,
        p_credits: credits
      });

      if (creditError) {
        logStep("Error adding scan pack credits", { error: creditError.message });
        await recordUndelivered(`add_scan_credits: ${creditError.message}`);
      } else {
        logStep("Scan pack credits added successfully", { credits, email: customerEmail });
        generatedContent = { credits, message: `${credits} scan credits added to your account` };
      }
    }

    // Handle credits for career bundle
    if (productType === 'career_bundle' && isFirstUse && customerEmail) {
      const credits = purchasedCredits ?? creditsBoughtBy(session);
      logStep("Adding career bundle credits", { credits, email: customerEmail });

      const { error: creditError } = await supabase.rpc('add_scan_credits', {
        p_email: customerEmail,
        p_credits: credits // capped at 500 by creditsBoughtBy -- matches stripe-webhook
      });

      if (creditError) {
        logStep("Error adding career bundle credits", { error: creditError.message });
        await recordUndelivered(`add_scan_credits: ${creditError.message}`);
      } else {
        logStep("Career bundle credits added successfully", { credits, email: customerEmail });
        generatedContent = { credits, message: `${credits} scan credits added to your account` };
      }
    }

    // THE RECEIPT FOR CREDITS THIS PATH ADDED. Since 20261005110000 a sale this
    // page claims first has a delivery row, and the retry sweeper re-credits a
    // scan row it finds undelivered unless a receipt shows the credits landed.
    // Written beside the credit, and the row moved past payment_received, so
    // a buyer is never credited twice for one purchase.
    if (isFirstUse && customerEmail && isScanProduct
        && generatedContent && typeof generatedContent === 'object' && 'credits' in generatedContent) {
      const { error: receiptError } = await supabase.rpc('save_purchased_content', {
        p_stripe_session_id: sessionId,
        p_customer_email: customerEmail,
        p_product_type: productType,
        p_product_name: productName || `${generatedContent.credits} Scan Credits`,
        p_generated_content: generatedContent
      });
      if (receiptError) logStep("Credits added but the receipt was not saved", { error: receiptError.message });
      await supabase.rpc('log_delivery_step', {
        p_stripe_session_id: sessionId,
        p_step: 'generation_completed',
        p_success: true
      });
    }

    // Record affiliate conversion if there was a referral
    const referralCode = session.metadata?.referral_code;
    if (referralCode && isFirstUse && session.amount_total) {
      // Commission rates: $1 for basic products, $5 for premium products.
      // applyAssistant is $7 — without being in this list it defaulted to the $5
      // premium-tier commission, leaving only ~$2 to cover the Stripe fee and two
      // AI generation calls on every affiliate-referred sale.
      const lowCommissionProducts = ['basic_keyword_fix', 'cover_letter', 'scan_pack', 'scan_credits', 'career_bundle', 'interview_coach', 'career_path_simulator', 'apply_assistant'];
      const commissionCents = lowCommissionProducts.includes(productType || '') ? 100 : 500;
      logStep("Recording affiliate conversion", { 
        referralCode, 
        amount: session.amount_total,
        commission: commissionCents,
        productType 
      });
      
      const { error: affiliateError } = await supabase.rpc('record_affiliate_conversion', {
        p_referral_code: referralCode,
        p_stripe_session_id: sessionId,
        p_product_name: productName || productType || 'Product',
        p_sale_amount: session.amount_total,
        p_commission_override: commissionCents
      });

      if (affiliateError) {
        logStep("Affiliate conversion recording failed", { error: affiliateError.message });
      } else {
        logStep("Affiliate conversion recorded successfully");
        
        // Send email notification to affiliate
        try {
          const { data: affiliateData } = await supabase
            .from('affiliates')
            .select('email')
            .eq('referral_code', referralCode)
            .single();
          
          if (affiliateData?.email) {
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
            // The service-role key: the commission mailer is internal and
            // refuses the publishable key, which every visitor holds.
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-affiliate-commission-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
              },
              body: JSON.stringify({
                affiliateEmail: affiliateData.email,
                productName: productName || productType,
                saleAmount: session.amount_total,
                commissionAmount: commissionCents,
                referralCode
              })
            });
            // Previously logged "sent" unconditionally without checking the
            // response — a misconfigured RESEND_API_KEY or a send failure
            // would silently look successful in these logs.
            if (emailResponse.ok) {
              logStep("Affiliate commission email sent", { email: affiliateData.email });
            } else {
              logStep("Affiliate commission email failed", { email: affiliateData.email, status: emailResponse.status });
            }
          }
        } catch (emailErr) {
          logStep("Affiliate email notification failed", { error: String(emailErr) });
          // Don't fail the whole request for email errors
        }
      }
    }
    let emailSent = false;
    if (isFirstUse && customerEmail && undelivered) {
      // Not mailed: the row stays generation_failed with the reason above
      // for the retry sweeper, which mails a product when it has made it.
      logStep("Confirmation mail held back: this delivery failed and is left for the retry sweeper", { reason: undelivered });
    }
    if (isFirstUse && customerEmail && !undelivered) {
      try {
        // The service-role key: send-product-email is internal and refuses
        // the publishable key, which every visitor holds.
        const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
          },
          body: JSON.stringify({
            email: customerEmail,
            productType,
            productName,
            generatedContent
          })
        });

        if (emailResponse.ok) {
          emailSent = true;
          logStep("Confirmation email sent", { email: customerEmail });
          
          // Log email sent successfully
          await supabase.rpc('log_delivery_step', {
            p_stripe_session_id: sessionId,
            p_step: 'email_sent',
            p_success: true
          });
        } else {
          logStep("Email send failed", { status: emailResponse.status });
          
          // Log email failed
          await supabase.rpc('log_delivery_step', {
            p_stripe_session_id: sessionId,
            p_step: 'email_sent',
            p_success: false,
            p_error: `Email send failed with status ${emailResponse.status}`
          });
        }
      } catch (emailError) {
        logStep("Email error", { error: String(emailError) });
        
        // Log email error
        await supabase.rpc('log_delivery_step', {
          p_stripe_session_id: sessionId,
          p_step: 'email_sent',
          p_success: false,
          p_error: String(emailError).substring(0, 500)
        });
        // Don't fail the request if email fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        verified: true,
        isFirstUse,
        productType,
        productName,
        customerEmail,
        // Whether THIS call mailed the confirmation. When the webhook claimed
        // the session first it sends the mail itself, to customerEmail; with
        // no address on the purchase nobody sends anything, and the page must
        // not say otherwise.
        emailSent,
        generatedContent,
        hasResumeData: !!resumeSessionId
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[VERIFY-PRODUCT-PURCHASE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to verify purchase", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
