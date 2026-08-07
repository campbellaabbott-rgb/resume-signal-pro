// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[VERIFY-PRODUCT-PURCHASE] ${step}`, details ? JSON.stringify(details) : '');
};

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
    case 'basic_keyword_fix':
      return { endpoint: 'generate-keyword-fix', body: { resumeText, jobDescription: jobDescriptionText, jobTitle, jobCompany, language } };
    case 'cover_letter':
      return { endpoint: 'generate-cover-letter', body: { resumeText, jobDescription: jobDescriptionText, jobTitle: jobTitle || 'Professional Position', jobCompany, tone: 'professional', language } };
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
      return { endpoint: 'generate-interview-coach', body: { resumeText, isPremium: true, language } };
    case 'career_path_simulator':
      return { endpoint: 'generate-career-path', body: { resumeText, isPremium: true, language } };
    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabaseEarly = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: rlAllowed } = await supabaseEarly.rpc("check_rate_limit", { p_function: "verify-product-purchase", p_ip: clientIp, p_max_requests: 30, p_window_minutes: 60 });
  if (!rlAllowed) return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
      customer_email: string | null;
      amount_total: number | null;
      metadata: Record<string, string>;
      line_items?: { data?: Array<{ quantity?: number | null }> };
    };
    if (typeof sessionId === "string" && sessionId.startsWith("pro_")) {
      const grantId = sessionId.slice(4);
      const supabaseGrant = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: grant } = await supabaseGrant
        .from("pro_grants")
        .select("*")
        .eq("id", grantId)
        .maybeSingle();
      if (!grant) {
        return new Response(
          JSON.stringify({ error: "Invalid session" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Re-verify the subscription is still active before honoring the grant.
      const { data: proRow } = await supabaseGrant
        .from("pro_subscribers")
        .select("status, current_period_end")
        .eq("email", grant.email)
        .maybeSingle();
      const proActive = !!proRow && ["active", "trialing"].includes(proRow.status) &&
        (!proRow.current_period_end || new Date(proRow.current_period_end).getTime() > Date.now() - 24 * 3600 * 1000);
      if (!proActive) {
        return new Response(
          JSON.stringify({ error: "Subscription is not active" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      await supabaseGrant
        .from("pro_grants")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", grantId)
        .is("consumed_at", null);
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

    if (session.payment_status !== 'paid') {
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
    const customerEmail = session.customer_email || session.metadata?.customer_email;
    const resumeSessionId = session.metadata?.session_id;

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
      .insert({ session_id: sessionId });

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

    if (isFirstUse) {
      // Log delivery step: payment received
      await supabase.rpc('log_delivery_step', {
        p_stripe_session_id: sessionId,
        p_step: 'payment_received',
        p_metadata: {
          email: customerEmail,
          product_type: productType,
          product_name: productName,
          amount_cents: session.amount_total
        }
      });
      logStep("Delivery tracking started");
    }

    // If content generation is requested and we have resume data
    let generatedContent: any = null;
    
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
            fetch(`${supabaseUrl}/functions/v1/generate-apply-package`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
              body: JSON.stringify({ resumeText: resume_text, jobPostingText: job_description_text, language })
            }),
            fetch(`${supabaseUrl}/functions/v1/generate-cover-letter`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
              body: JSON.stringify({ resumeText: resume_text, jobDescription: job_description_text, jobTitle, jobCompany, tone: 'professional', language })
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
            const genResponse = await fetch(`${supabaseUrl}/functions/v1/${request.endpoint}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
              },
              body: JSON.stringify(request.body)
            });

            const genDuration = Date.now() - generationStartTime;

            if (genResponse.ok) {
              const genResult = await genResponse.json();
              generatedContent = genResult.data;
              logStep(`${request.endpoint} generated successfully`);

              // Save content permanently for customer recovery
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
                p_duration_ms: genDuration
              });
            } else {
              const errorText = await genResponse.text();
              logStep(`${request.endpoint} generation failed`, { status: genResponse.status, error: errorText });

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

    // Handle credits for scan pack (used by both create-product-checkout and create-scan-pack-checkout)
    if ((productType === 'scan_pack' || productType === 'scan_credits') && isFirstUse && customerEmail) {
      // Get credits from metadata first, fallback to line_items quantity
      let credits = parseInt(session.metadata?.credits || "0");
      
      // If no credits in metadata, check line_items quantity (for create-scan-pack-checkout)
      if (credits === 0 && session.line_items?.data?.length) {
        credits = session.line_items.data[0].quantity || 10;
      }
      
      // Default to 10 if still no credits found
      if (credits === 0) credits = 10;
      
      logStep("Adding scan pack credits", { credits, email: customerEmail, productType });
      
      const { error: creditError } = await supabase.rpc('add_scan_credits', {
        p_email: customerEmail,
        p_credits: Math.min(credits, 500) // Cap at 500 — matches stripe-webhook cap
      });

      if (creditError) {
        logStep("Error adding scan pack credits", { error: creditError.message });
      } else {
        logStep("Scan pack credits added successfully", { credits, email: customerEmail });
        generatedContent = { credits, message: `${credits} scan credits added to your account` };
      }
    }

    // Handle credits for career bundle
    if (productType === 'career_bundle' && isFirstUse && customerEmail) {
      const credits = parseInt(session.metadata?.credits || "75");
      logStep("Adding career bundle credits", { credits, email: customerEmail });
      
      const { error: creditError } = await supabase.rpc('add_scan_credits', {
        p_email: customerEmail,
        p_credits: Math.min(credits, 500) // Cap at 500 — matches stripe-webhook cap
      });

      if (creditError) {
        logStep("Error adding career bundle credits", { error: creditError.message });
      } else {
        logStep("Career bundle credits added successfully", { credits, email: customerEmail });
        generatedContent = { credits, message: `${credits} scan credits added to your account` };
      }
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
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-affiliate-commission-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
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
    if (isFirstUse && customerEmail) {
      try {
        const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
          },
          body: JSON.stringify({
            email: customerEmail,
            productType,
            productName,
            generatedContent
          })
        });

        if (emailResponse.ok) {
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
