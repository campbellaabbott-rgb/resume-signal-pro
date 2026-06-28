import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
          if (delivery.product_type === 'scan_pack' || delivery.product_type === 'scan_credits' || delivery.product_type === 'career_bundle') {
            const credits = delivery.product_type === 'career_bundle' ? 75 : 10;
            
            if (delivery.customer_email) {
              const { error: creditError } = await supabase.rpc('add_scan_credits', {
                p_email: delivery.customer_email,
                p_credits: credits
              });

              if (creditError) {
                throw new Error(`Credit add failed: ${creditError.message}`);
              }

              // Save content
              await supabase.rpc('save_purchased_content', {
                p_stripe_session_id: delivery.stripe_session_id,
                p_customer_email: delivery.customer_email,
                p_product_type: delivery.product_type,
                p_product_name: delivery.product_name || `${credits} Scan Credits`,
                p_generated_content: { credits, message: `${credits} scan credits added` }
              });

              await supabase
                .from('product_deliveries')
                .update({ status: 'delivered', generation_success: true })
                .eq('id', delivery.id);

              results.push({ id: delivery.id, status: 'delivered', success: true });
              logStep("Credits retry successful", { id: delivery.id, credits });
              continue;
            }
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
              language
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

            const genResponse = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
              },
              body: JSON.stringify(body)
            });

            if (!genResponse.ok) {
              const errorText = await genResponse.text();
              throw new Error(`Generation failed: ${genResponse.status} - ${errorText}`);
            }

            const genResult = await genResponse.json();
            generatedContent = genResult.data;
          }

          // Save content
          await supabase.rpc('save_purchased_content', {
            p_stripe_session_id: delivery.stripe_session_id,
            p_customer_email: delivery.customer_email || '',
            p_product_type: delivery.product_type,
            p_product_name: delivery.product_name,
            p_generated_content: generatedContent
          });

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
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
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
              throw new Error(`Email failed: ${emailResponse.status}`);
            }
          } else {
            results.push({ id: delivery.id, status: 'content_generated', success: true });
          }

        } else if (delivery.status === 'email_failed') {
          // Content was generated, just retry email
          
          // Get the saved content
          const { data: contentData } = await supabase
            .rpc('get_purchased_content_by_session', { p_session_id: delivery.stripe_session_id });

          if (!contentData || contentData.length === 0) {
            throw new Error('Content not found for email retry');
          }

          const generatedContent = contentData[0].generated_content;

          if (delivery.customer_email) {
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
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