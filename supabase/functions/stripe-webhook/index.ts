import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

// OPTIMIZATION: Module-level singletons for reuse across warm invocations
let stripeInstance: Stripe | null = null;
// deno-lint-ignore no-explicit-any
let supabaseInstance: SupabaseClient<any, any, any> | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2025-12-15.clover" });
  }
  return stripeInstance;
}

// deno-lint-ignore no-explicit-any
function getSupabase(): SupabaseClient<any, any, any> {
  if (!supabaseInstance) {
    supabaseInstance = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
  }
  return supabaseInstance;
}

// Send email alert for payment failures (non-blocking)
function sendFailureAlertBackground(details: {
  type: string;
  amount: number;
  currency: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  customerEmail?: string | null;
  paymentIntentId: string;
}) {
  EdgeRuntime.waitUntil((async () => {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const adminEmail = Deno.env.get("ADMIN_EMAIL");
    if (!resendKey || !adminEmail) return;

    const resend = new Resend(resendKey);
    const formattedAmount = (details.amount / 100).toFixed(2);
    
    try {
      await resend.emails.send({
        from: "Resume Booster <alerts@resend.dev>",
        to: [adminEmail],
        subject: `⚠️ Payment Failed - $${formattedAmount} ${details.currency.toUpperCase()}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #dc2626;">Payment Failure Alert</h2>
            <p><strong>${details.type}</strong></p>
            <p>Amount: $${formattedAmount} ${details.currency.toUpperCase()}</p>
            <p>Customer: ${details.customerEmail || 'N/A'}</p>
            <p>Code: ${details.failureCode || 'N/A'}</p>
            <p>Message: ${details.failureMessage || 'N/A'}</p>
            <a href="https://dashboard.stripe.com/payments/${details.paymentIntentId}">View in Stripe</a>
          </div>
        `,
      });
    } catch (e) {
      console.error("[STRIPE-WEBHOOK] Alert email failed:", e);
    }
  })());
}

// Trigger product delivery for a completed checkout
// deno-lint-ignore no-explicit-any
async function triggerProductDelivery(
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient<any, any, any>,
  supabaseUrl: string
) {
  const sessionId = session.id;
  const productType = session.metadata?.product_type;
  const productName = session.metadata?.product_name;
  const customerEmail = session.customer_email || session.metadata?.customer_email;
  const resumeSessionId = session.metadata?.session_id;

  logStep("Triggering product delivery", { sessionId, productType });

  // Atomically claim this session via the PRIMARY KEY on session_id. This webhook
  // and verify-product-purchase (triggered from the user's browser on the success
  // page) can race each other for the same session — a separate SELECT-then-INSERT
  // has a window where both see "not yet used" and both proceed to credit/generate
  // content twice. Doing the INSERT first and checking its result makes the claim
  // atomic: only one caller can win it.
  const { error: claimError } = await supabase
    .from('used_stripe_sessions')
    .insert({ session_id: sessionId });

  if (claimError) {
    if (claimError.code === '23505') {
      logStep("Session already claimed by another process (race avoided)", { sessionId });
    } else {
      logStep("Error claiming session, aborting delivery", { error: claimError.message });
    }
    return { alreadyProcessed: true };
  }

  const deliveryRecord = await supabase.from('product_deliveries').insert({
    stripe_session_id: sessionId,
    product_type: productType || 'unknown',
    product_name: productName,
    customer_email: customerEmail,
    status: 'payment_received',
    amount_cents: session.amount_total,
    payment_completed_at: new Date().toISOString(),
    metadata: {
      resume_session_id: resumeSessionId,
      job_title: session.metadata?.job_title,
      job_company: session.metadata?.job_company,
      referral_code: session.metadata?.referral_code,
      language: session.metadata?.language
    }
  }).select().single();

  if (deliveryRecord.error) {
    logStep("Failed to create delivery record", { error: deliveryRecord.error.message, sessionId });
    // Continue processing — payment was received, delivery tracking failure shouldn't block fulfillment
  }

  // Handle scan packs - just add credits
  if (productType === 'scan_pack' || productType === 'scan_credits' || productType === 'career_bundle') {
    if (customerEmail) {
      let credits = parseInt(session.metadata?.credits || "10");
      if (productType === 'career_bundle') credits = parseInt(session.metadata?.credits || "75");
      
      const clippedCredits = Math.min(credits, 500);
      if (clippedCredits !== credits) logStep("Credit cap applied", { intended: credits, applied: clippedCredits });
      const { error: creditError } = await supabase.rpc('add_scan_credits', {
        p_email: customerEmail,
        p_credits: clippedCredits
      });

      if (creditError) {
        logStep("Error adding credits", { error: creditError.message });
      } else {
        logStep("Credits added", { credits, email: customerEmail });
        
        // Background: save to purchased_content and update delivery
        EdgeRuntime.waitUntil(Promise.all([
          supabase.rpc('save_purchased_content', {
            p_stripe_session_id: sessionId,
            p_customer_email: customerEmail,
            p_product_type: productType,
            p_product_name: productName || `${credits} Scan Credits`,
            p_generated_content: { credits, message: `${credits} scan credits added` }
          }),
          supabase.from('product_deliveries')
            .update({ status: 'delivered', generation_success: true })
            .eq('id', deliveryRecord.data?.id)
        ]).catch(err => logStep("Scan pack delivery tracking failed", { error: String(err) })));
      }
    }
    return { success: true, productType };
  }

  // For content products, need resume data
  if (!resumeSessionId) {
    logStep("No resume session ID");
    return { success: false, error: 'No resume session ID' };
  }

  const { data: resumeData, error: resumeError } = await supabase
    .rpc('get_temp_resume', { p_session_id: resumeSessionId });

  if (resumeError || !resumeData?.[0]) {
    logStep("Resume data not found");
    return { success: false, error: 'Resume data not found' };
  }

  const { resume_text, job_description_text } = resumeData[0];
  const jobTitle = session.metadata?.job_title || 'Target Position';
  const jobCompany = session.metadata?.job_company || '';
  // Captured at checkout time (create-product-checkout) since this runs
  // server-side with no access to the browser's i18n state.
  const language = session.metadata?.language || 'en';

  // Update status to generating (background)
  EdgeRuntime.waitUntil(
    Promise.resolve(
      supabase.from('product_deliveries')
        .update({ status: 'generating', content_generation_started_at: new Date().toISOString() })
        .eq('id', deliveryRecord.data?.id)
    )
  );

  const generationStart = Date.now();
  let generatedContent = null;
  let generationError = null;

  try {
    if (productType === 'apply_assistant') {
      // Needs two calls (tailored resume + cover letter) combined into one
      // stored object, and explicitly requires a job posting — unlike the other
      // products here, there's nothing useful to generate without one.
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
        throw new Error(`Apply package generation failed: ${packageResponse.status}`);
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
      logStep("Content generated", { productType });
    } else {
      let endpoint = '';
      const body: Record<string, unknown> = {
        resumeText: resume_text,
        jobDescription: job_description_text || '',
        jobTitle,
        jobCompany,
        language
      };

      switch (productType) {
        case 'basic_keyword_fix': endpoint = 'generate-keyword-fix'; break;
        case 'cover_letter': endpoint = 'generate-cover-letter'; body.tone = 'professional'; break;
        case 'premium_package': endpoint = 'generate-premium-package'; break;
        case 'graduate_gameplan': endpoint = 'generate-graduate-gameplan'; break;
        case 'career_snapshot': endpoint = 'generate-career-snapshot'; break;
        // generate-ats-defense independently re-verifies payment via a real
        // Stripe checkout session lookup (it's also callable directly from
        // the browser), so it requires sessionId in the body — unlike every
        // other product here, which trusts this webhook call implicitly.
        // Without it, this call always 401s and silently falls through to
        // the frontend's manual recovery flow on the success page instead.
        case 'ats_defense': endpoint = 'generate-ats-defense'; body.sessionId = sessionId; body.targetRoles = []; break;
        case 'interview_coach': endpoint = 'generate-interview-coach'; body.isPremium = true; break;
        case 'career_path_simulator': endpoint = 'generate-career-path'; body.isPremium = true; break;
        default: throw new Error(`Unknown product type: ${productType}`);
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Generation failed: ${response.status}`);
      }

      const result = await response.json();
      generatedContent = result.data;
      logStep("Content generated", { productType });
    }
  } catch (error) {
    generationError = error instanceof Error ? error.message : String(error);
    logStep("Content generation failed", { error: generationError });
  }

  const generationDuration = Date.now() - generationStart;

  if (generatedContent) {
    const aiModelUsed = generatedContent.modelsUsed?.resume || 
                        generatedContent.modelsUsed?.coverLetter || 
                        generatedContent.modelUsed || null;

    // Save content + update delivery in parallel
    await Promise.all([
      supabase.rpc('save_purchased_content', {
        p_stripe_session_id: sessionId,
        p_customer_email: customerEmail || '',
        p_product_type: productType,
        p_product_name: productName,
        p_generated_content: generatedContent
      }),
      supabase.from('product_deliveries').update({
        status: 'content_generated',
        generation_success: true,
        content_generation_completed_at: new Date().toISOString(),
        generation_duration_ms: generationDuration,
        ai_model_used: aiModelUsed
      }).eq('id', deliveryRecord.data?.id)
    ]);

    // Send email (background)
    if (customerEmail) {
      EdgeRuntime.waitUntil((async () => {
        try {
          const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
            },
            body: JSON.stringify({ email: customerEmail, productType, productName, generatedContent })
          });

          if (emailResponse.ok) {
            await supabase.from('product_deliveries').update({
              status: 'delivered',
              email_success: true,
              email_sent_at: new Date().toISOString()
            }).eq('id', deliveryRecord.data?.id);
          }
        } catch (e) {
          console.error("[STRIPE-WEBHOOK] Email send failed:", e);
        }
      })());
    }

    return { success: true, productType };
  } else {
    EdgeRuntime.waitUntil(
      Promise.resolve(
        supabase.rpc('update_delivery_retry', {
          p_id: deliveryRecord.data?.id,
          p_status: 'generation_failed',
          p_error: generationError,
          p_increment_retry: true
        })
      )
    );
    return { success: false, error: generationError };
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const processingStart = Date.now();

  try {
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      return new Response("Configuration error", { status: 500 });
    }

    const stripe = getStripe();
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");
    
    if (!signature) {
      return new Response("Missing signature", { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      logStep("Signature verification failed");
      return new Response("Webhook signature verification failed", { status: 400 });
    }

    logStep("Event verified", { type: event.type, id: event.id });

    const supabase = getSupabase();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    
    // OPTIMIZATION: Log webhook received in background
    EdgeRuntime.waitUntil(
      Promise.resolve(
        supabase.rpc('log_webhook_event', {
          p_event_type: event.type,
          p_event_id: event.id,
          p_payload: event.data.object,
          p_processed: false
        })
      )
    );

    let processingError: string | null = null;

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        if (session.payment_status === 'paid') {
          try {
            const result = await triggerProductDelivery(session, supabase, supabaseUrl);
            logStep("Delivery result", result);
            
            // Affiliate conversion (background)
            const referralCode = session.metadata?.referral_code;
            if (referralCode && session.amount_total) {
              const productType = session.metadata?.product_type;
              // Kept in sync with the same list in verify-product-purchase/index.ts —
              // this one had drifted out of sync (missing interview_coach/
              // career_path_simulator entirely, and would have defaulted
              // apply_assistant to the $5 tier on a $7 sale).
              const lowCommission = ['basic_keyword_fix', 'cover_letter', 'scan_pack', 'scan_credits', 'career_bundle', 'interview_coach', 'career_path_simulator', 'apply_assistant'];
              const commissionCents = lowCommission.includes(productType || '') ? 100 : 500;
              
              // verify-product-purchase (triggered from the success page) can also
              // record this same conversion — the table's UNIQUE constraint on
              // stripe_session_id prevents an actual double-credit either way, but
              // this call previously had no error handling at all, so losing that
              // race failed completely silently instead of just being a harmless,
              // logged no-op.
              EdgeRuntime.waitUntil(
                supabase.rpc('record_affiliate_conversion', {
                  p_referral_code: referralCode,
                  p_stripe_session_id: session.id,
                  p_product_name: session.metadata?.product_name || productType || 'Product',
                  p_sale_amount: session.amount_total,
                  p_commission_override: commissionCents
                }).then(({ error }: { error: { message: string } | null }) => {
                  if (error) {
                    logStep("Affiliate conversion recording failed (likely already recorded by verify-product-purchase)", { error: error.message });
                  }
                })
              );
            }
          } catch (err) {
            processingError = String(err);
            logStep("Delivery failed", { error: processingError });
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        
        // Background: log to DB and send alert
        EdgeRuntime.waitUntil((async () => {
          let customerEmail: string | null = null;
          if (pi.customer) {
            try {
              const customer = await stripe.customers.retrieve(pi.customer as string);
              if (customer && !customer.deleted && 'email' in customer) {
                customerEmail = customer.email;
              }
            } catch {}
          }

          await supabase.from('payment_failures').insert({
            payment_intent_id: pi.id,
            amount: pi.amount,
            currency: pi.currency,
            failure_code: pi.last_payment_error?.code || null,
            failure_message: pi.last_payment_error?.message || null,
            customer_email: customerEmail,
            metadata: {
              decline_code: pi.last_payment_error?.decline_code,
              payment_method_type: pi.last_payment_error?.payment_method?.type
            }
          });

          sendFailureAlertBackground({
            type: "Payment Intent Failed",
            amount: pi.amount,
            currency: pi.currency,
            failureCode: pi.last_payment_error?.code,
            failureMessage: pi.last_payment_error?.message,
            customerEmail,
            paymentIntentId: pi.id
          });
        })());
        break;
      }

      case "charge.failed": {
        const charge = event.data.object as Stripe.Charge;
        
        EdgeRuntime.waitUntil((async () => {
          await supabase.from('payment_failures').insert({
            payment_intent_id: charge.payment_intent as string || charge.id,
            amount: charge.amount,
            currency: charge.currency,
            failure_code: charge.failure_code || null,
            failure_message: charge.failure_message || null,
            customer_email: charge.billing_details?.email || null,
            metadata: { charge_id: charge.id }
          });

          sendFailureAlertBackground({
            type: "Charge Failed",
            amount: charge.amount,
            currency: charge.currency,
            failureCode: charge.failure_code,
            failureMessage: charge.failure_message,
            customerEmail: charge.billing_details?.email,
            paymentIntentId: charge.payment_intent as string || charge.id
          });
        })());
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        EdgeRuntime.waitUntil((async () => {
          await supabase.from('payment_failures').insert({
            payment_intent_id: session.payment_intent as string || session.id,
            amount: session.amount_total || 0,
            currency: session.currency || 'usd',
            failure_code: 'checkout_expired',
            failure_message: 'Checkout abandoned',
            customer_email: session.customer_email,
            metadata: { session_id: session.id, product_type: session.metadata?.product_type }
          });

          sendFailureAlertBackground({
            type: "Checkout Abandoned",
            amount: session.amount_total || 0,
            currency: session.currency || 'usd',
            failureCode: 'checkout_expired',
            failureMessage: 'Checkout abandoned',
            customerEmail: session.customer_email,
            paymentIntentId: session.payment_intent as string || session.id
          });
        })());
        break;
      }

      default:
        logStep("Unhandled event", { type: event.type });
    }

    // Log completion in background
    const processingTime = Date.now() - processingStart;
    EdgeRuntime.waitUntil(
      Promise.resolve(
        supabase.rpc('log_webhook_event', {
          p_event_type: event.type,
          p_event_id: event.id,
          p_processed: true,
          p_error: processingError,
          p_time_ms: processingTime
        })
      )
    );

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    });
  } catch (error) {
    console.error("[STRIPE-WEBHOOK] Error:", error);
    return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
});
