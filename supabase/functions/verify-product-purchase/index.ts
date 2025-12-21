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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer']
    });

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

    // Check if this session was already processed
    const { data: existingSession } = await supabase
      .from('used_stripe_sessions')
      .select('session_id')
      .eq('session_id', sessionId)
      .single();

    const isFirstUse = !existingSession;

    if (isFirstUse) {
      // Mark session as used
      await supabase
        .from('used_stripe_sessions')
        .insert({ session_id: sessionId });
      
      logStep("Session marked as used");
    }

    // If content generation is requested and we have resume data
    let generatedContent = null;
    
    if (generateContent && resumeSessionId) {
      logStep("Content generation requested", { productType, resumeSessionId });
      
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

        // Generate content based on product type
        if (productType === 'basic_keyword_fix' && resume_text) {
          logStep("Calling generate-keyword-fix");
          const keywordResponse = await fetch(`${supabaseUrl}/functions/v1/generate-keyword-fix`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
            },
            body: JSON.stringify({
              resumeText: resume_text,
              jobDescription: job_description_text || '',
              jobTitle,
              jobCompany
            })
          });

          if (keywordResponse.ok) {
            const keywordResult = await keywordResponse.json();
            generatedContent = keywordResult.data;
            logStep("Keyword analysis generated successfully");
          } else {
            const errorText = await keywordResponse.text();
            logStep("Keyword generation failed", { status: keywordResponse.status, error: errorText });
          }
        } else if (productType === 'cover_letter' && resume_text) {
          logStep("Calling generate-cover-letter");
          // Cover letter needs jobDescription OR jobTitle - provide fallback
          const coverLetterResponse = await fetch(`${supabaseUrl}/functions/v1/generate-cover-letter`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
            },
            body: JSON.stringify({
              resumeText: resume_text,
              jobDescription: job_description_text || '',
              jobTitle: jobTitle || 'Professional Position',  // Fallback so it doesn't fail
              jobCompany,
              tone: 'professional'
            })
          });

          if (coverLetterResponse.ok) {
            const coverLetterResult = await coverLetterResponse.json();
            generatedContent = coverLetterResult.data;
            logStep("Cover letter generated successfully");
          } else {
            const errorText = await coverLetterResponse.text();
            logStep("Cover letter generation failed", { status: coverLetterResponse.status, error: errorText });
          }
        } else if (productType === 'premium_package' && resume_text) {
          logStep("Calling generate-premium-package");
          const premiumResponse = await fetch(`${supabaseUrl}/functions/v1/generate-premium-package`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
            },
            body: JSON.stringify({
              resumeText: resume_text,
              jobDescription: job_description_text || '',
              jobTitle: jobTitle || 'Target Position',
              jobCompany
            })
          });

          if (premiumResponse.ok) {
            const premiumResult = await premiumResponse.json();
            generatedContent = premiumResult.data;
            logStep("Premium package generated successfully");
          } else {
            const errorText = await premiumResponse.text();
            logStep("Premium package generation failed", { status: premiumResponse.status, error: errorText });
          }
        } else {
          logStep("No matching content generator", { productType, hasResumeText: !!resume_text });
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
        p_credits: Math.min(credits, 100) // Cap at 100 per call for safety
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
        p_credits: Math.min(credits, 100) // Cap at 100 per call for safety
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
      // Commission rates: $1 for keyword fix, $5 for everything else
      const commissionCents = productType === 'basic_keyword_fix' ? 100 : 500;
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
        } else {
          logStep("Email send failed", { status: emailResponse.status });
        }
      } catch (emailError) {
        logStep("Email error", { error: String(emailError) });
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
