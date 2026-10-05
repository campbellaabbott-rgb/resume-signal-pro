// deploy-stamp: 2026-10-05T11:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FULL_ANALYSIS_PRODUCT_TYPE } from "../_shared/full-analysis.ts";
import { clientAddressOr } from "../_shared/client-address.ts";

// Provable from outside without running a sweep: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "retry-failed-deliveries.2026-10-05.1";

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

    // Get failed deliveries that need retry
    const { data: failedDeliveries, error: fetchError } = await supabase
      .rpc('get_failed_deliveries_for_retry', { p_limit: 5 });

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
        
        // Handle based on current status
        if (delivery.status === 'payment_received' || delivery.status === 'generation_failed') {
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

          // For content products, check if we have resume data
          if (!resumeSessionId) {
            // No resume data available - mark as permanently failed
            await supabase.rpc('update_delivery_retry', {
              p_id: delivery.id,
              p_status: 'generation_failed',
              p_error: 'Resume session ID not available - cannot generate content',
              p_increment_retry: true
            });
            results.push({ 
              id: delivery.id, 
              status: 'generation_failed', 
              success: false, 
              error: 'No resume session ID' 
            });
            continue;
          }

          // Try to get resume data
          const { data: resumeData, error: resumeError } = await supabase
            .rpc('get_temp_resume', { p_session_id: resumeSessionId });

          if (resumeError || !resumeData || resumeData.length === 0) {
            await supabase.rpc('update_delivery_retry', {
              p_id: delivery.id,
              p_status: 'generation_failed',
              p_error: 'Resume data expired',
              p_increment_retry: true
            });
            results.push({ 
              id: delivery.id, 
              status: 'generation_failed', 
              success: false, 
              error: 'Resume data expired' 
            });
            continue;
          }

          const { resume_text, job_description_text } = resumeData[0];
          const jobTitle = (metadata.job_title as string) || 'Target Position';
          const jobCompany = (metadata.job_company as string) || '';
          const language = (metadata.language as string) || 'en';

          let generatedContent: unknown;

          if (delivery.product_type === 'apply_assistant') {
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
              body.targetRoles = [];
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
          // nothing behind it for recovery or the email retry to read.
          const { error: saveError } = await supabase.rpc('save_purchased_content', {
            p_stripe_session_id: delivery.stripe_session_id,
            p_customer_email: delivery.customer_email || '',
            p_product_type: delivery.product_type,
            p_product_name: delivery.product_name,
            p_generated_content: generatedContent
          });
          if (saveError) throw new Error(`save_purchased_content: ${saveError.message}`);

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
                generatedContent
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
              await supabase.rpc('update_delivery_retry', {
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
                generatedContent
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

        await supabase.rpc('update_delivery_retry', {
          p_id: delivery.id,
          p_status: delivery.status,
          p_error: errorMessage,
          p_increment_retry: true
        });

        results.push({ 
          id: delivery.id, 
          status: delivery.status, 
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