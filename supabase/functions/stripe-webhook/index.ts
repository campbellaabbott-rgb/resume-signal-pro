import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

// Send email alert for payment failures
async function sendFailureAlert(details: {
  type: string;
  amount: number;
  currency: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  customerEmail?: string | null;
  paymentIntentId: string;
}) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  
  if (!resendKey || !adminEmail) {
    logStep("Email alert skipped - missing RESEND_API_KEY or ADMIN_EMAIL");
    return;
  }

  const resend = new Resend(resendKey);
  const formattedAmount = (details.amount / 100).toFixed(2);
  
  try {
    await resend.emails.send({
      from: "Resume Booster <alerts@resend.dev>",
      to: [adminEmail],
      subject: `⚠️ Payment Failed - $${formattedAmount} ${details.currency.toUpperCase()}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #dc2626; margin-bottom: 20px;">Payment Failure Alert</h2>
          
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <p style="margin: 0; font-weight: 600; color: #991b1b;">${details.type}</p>
          </div>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Amount</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">$${formattedAmount} ${details.currency.toUpperCase()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Customer Email</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${details.customerEmail || 'Not provided'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Failure Code</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #dc2626;">${details.failureCode || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Failure Message</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${details.failureMessage || 'No details available'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Payment Intent</td>
              <td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${details.paymentIntentId}</td>
            </tr>
          </table>
          
          <div style="margin-top: 24px;">
            <a href="https://dashboard.stripe.com/payments/${details.paymentIntentId}" 
               style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px;">
              View in Stripe Dashboard
            </a>
          </div>
          
          <p style="margin-top: 24px; color: #9ca3af; font-size: 12px;">
            This is an automated alert from Resume Booster.
          </p>
        </div>
      `,
    });
    logStep("Email alert sent successfully");
  } catch (error) {
    logStep("Failed to send email alert", { error: String(error) });
  }
}

// Trigger product delivery for a completed checkout
async function triggerProductDelivery(
  session: Stripe.Checkout.Session,
  supabase: any,
  supabaseUrl: string
) {
  const sessionId = session.id;
  const productType = session.metadata?.product_type;
  const productName = session.metadata?.product_name;
  const customerEmail = session.customer_email || session.metadata?.customer_email;
  const resumeSessionId = session.metadata?.session_id;

  logStep("Triggering product delivery", { sessionId, productType, customerEmail });

  // Check if this session was already processed
  const { data: existingSession } = await supabase
    .from('used_stripe_sessions')
    .select('session_id')
    .eq('session_id', sessionId)
    .single();

  if (existingSession) {
    logStep("Session already processed, skipping delivery", { sessionId });
    return { alreadyProcessed: true };
  }

  // Mark session as used immediately to prevent duplicates
  await supabase
    .from('used_stripe_sessions')
    .insert({ session_id: sessionId });

  // Create delivery tracking record
  const { data: deliveryRecord } = await supabase
    .from('product_deliveries')
    .insert({
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
        referral_code: session.metadata?.referral_code
      }
    })
    .select()
    .single();

  logStep("Delivery record created", { deliveryId: deliveryRecord?.id });

  // Skip content generation for scan packs - just add credits
  if (productType === 'scan_pack' || productType === 'scan_credits' || productType === 'career_bundle') {
    if (customerEmail) {
      let credits = parseInt(session.metadata?.credits || "10");
      if (productType === 'career_bundle') credits = parseInt(session.metadata?.credits || "75");
      
      const { error: creditError } = await supabase.rpc('add_scan_credits', {
        p_email: customerEmail,
        p_credits: Math.min(credits, 100)
      });

      if (creditError) {
        logStep("Error adding credits", { error: creditError.message });
        await supabase.rpc('update_delivery_retry', {
          p_id: deliveryRecord?.id,
          p_status: 'generation_failed',
          p_error: creditError.message,
          p_increment_retry: true
        });
      } else {
        logStep("Credits added successfully", { credits, email: customerEmail });
        
        // Save to purchased_content
        await supabase.rpc('save_purchased_content', {
          p_stripe_session_id: sessionId,
          p_customer_email: customerEmail,
          p_product_type: productType,
          p_product_name: productName || `${credits} Scan Credits`,
          p_generated_content: { credits, message: `${credits} scan credits added` }
        });

        // Update delivery status to completed
        await supabase
          .from('product_deliveries')
          .update({ status: 'delivered', generation_success: true })
          .eq('id', deliveryRecord?.id);
      }
    }
    return { success: true, productType };
  }

  // For content products, we need resume data
  if (!resumeSessionId) {
    logStep("No resume session ID, cannot generate content");
    await supabase.rpc('update_delivery_retry', {
      p_id: deliveryRecord?.id,
      p_status: 'generation_failed',
      p_error: 'No resume session ID available',
      p_increment_retry: true
    });
    return { success: false, error: 'No resume session ID' };
  }

  // Get resume data
  const { data: resumeData, error: resumeError } = await supabase
    .rpc('get_temp_resume', { p_session_id: resumeSessionId });

  if (resumeError || !resumeData || resumeData.length === 0) {
    logStep("Resume data not found or expired", { error: resumeError?.message });
    await supabase.rpc('update_delivery_retry', {
      p_id: deliveryRecord?.id,
      p_status: 'generation_failed',
      p_error: 'Resume data expired or not found',
      p_increment_retry: true
    });
    return { success: false, error: 'Resume data not found' };
  }

  const { resume_text, job_description_text } = resumeData[0];
  const jobTitle = session.metadata?.job_title || 'Target Position';
  const jobCompany = session.metadata?.job_company || '';

  logStep("Generating content", { productType, resumeLength: resume_text?.length });

  // Update status to generating
  await supabase
    .from('product_deliveries')
    .update({ 
      status: 'generating',
      content_generation_started_at: new Date().toISOString()
    })
    .eq('id', deliveryRecord?.id);

  const generationStart = Date.now();
  let generatedContent = null;
  let generationError = null;

  try {
    // Generate content based on product type
    let endpoint = '';
    let body: Record<string, unknown> = {
      resumeText: resume_text,
      jobDescription: job_description_text || '',
      jobTitle,
      jobCompany
    };

    if (productType === 'basic_keyword_fix') {
      endpoint = 'generate-keyword-fix';
    } else if (productType === 'cover_letter') {
      endpoint = 'generate-cover-letter';
      body.tone = 'professional';
    } else if (productType === 'premium_package') {
      endpoint = 'generate-premium-package';
    } else {
      throw new Error(`Unknown product type: ${productType}`);
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
      const errorText = await response.text();
      throw new Error(`Generation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    generatedContent = result.data;
    logStep("Content generated successfully", { productType });

  } catch (error) {
    generationError = error instanceof Error ? error.message : String(error);
    logStep("Content generation failed", { error: generationError });
  }

  const generationDuration = Date.now() - generationStart;

  if (generatedContent) {
    // Save content permanently
    await supabase.rpc('save_purchased_content', {
      p_stripe_session_id: sessionId,
      p_customer_email: customerEmail || '',
      p_product_type: productType,
      p_product_name: productName,
      p_generated_content: generatedContent
    });

    // Update delivery status
    await supabase
      .from('product_deliveries')
      .update({
        status: 'content_generated',
        generation_success: true,
        content_generation_completed_at: new Date().toISOString(),
        generation_duration_ms: generationDuration
      })
      .eq('id', deliveryRecord?.id);

    // Send email
    if (customerEmail) {
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
          await supabase
            .from('product_deliveries')
            .update({
              status: 'delivered',
              email_success: true,
              email_sent_at: new Date().toISOString()
            })
            .eq('id', deliveryRecord?.id);
        } else {
          throw new Error(`Email failed: ${emailResponse.status}`);
        }
      } catch (emailError) {
        logStep("Email send failed", { error: String(emailError) });
        await supabase.rpc('update_delivery_retry', {
          p_id: deliveryRecord?.id,
          p_status: 'email_failed',
          p_error: String(emailError),
          p_increment_retry: true
        });
      }
    }

    return { success: true, productType, generatedContent };
  } else {
    // Generation failed
    await supabase.rpc('update_delivery_retry', {
      p_id: deliveryRecord?.id,
      p_status: 'generation_failed',
      p_error: generationError,
      p_increment_retry: true
    });
    return { success: false, error: generationError };
  }
}

serve(async (req) => {
  // Stripe webhooks must be POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    logStep("Webhook received");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    
    if (!stripeKey || !webhookSecret) {
      console.error("[STRIPE-WEBHOOK] Missing required secrets");
      return new Response("Configuration error", { status: 500 });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
    
    // Get the raw body for signature verification
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");
    
    if (!signature) {
      logStep("Missing signature header");
      return new Response("Missing signature", { status: 400 });
    }

    // Verify the webhook signature
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logStep("Signature verification failed", { error: message });
      return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
    }

    logStep("Event verified", { type: event.type, id: event.id });

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const processingStart = Date.now();
    let processingError: string | null = null;

    // Log webhook received
    await supabase.rpc('log_webhook_event', {
      p_event_type: event.type,
      p_event_id: event.id,
      p_payload: event.data.object,
      p_processed: false
    });

    // Handle different event types
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        logStep("Checkout completed - triggering delivery", {
          sessionId: session.id,
          productType: session.metadata?.product_type,
          email: session.customer_email
        });

        // Only trigger delivery for paid sessions
        if (session.payment_status === 'paid') {
          try {
            const result = await triggerProductDelivery(session, supabase, supabaseUrl);
            logStep("Delivery result", result);
            
            // Handle affiliate conversion
            const referralCode = session.metadata?.referral_code;
            if (referralCode && session.amount_total) {
              const productType = session.metadata?.product_type;
              const lowCommissionProducts = ['basic_keyword_fix', 'cover_letter', 'scan_pack', 'scan_credits'];
              const commissionCents = lowCommissionProducts.includes(productType || '') ? 100 : 500;
              
              await supabase.rpc('record_affiliate_conversion', {
                p_referral_code: referralCode,
                p_stripe_session_id: session.id,
                p_product_name: session.metadata?.product_name || productType || 'Product',
                p_sale_amount: session.amount_total,
                p_commission_override: commissionCents
              });
              logStep("Affiliate conversion recorded");
            }
          } catch (deliveryError) {
            processingError = String(deliveryError);
            logStep("Delivery failed", { error: processingError });
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        
        logStep("Payment failed", {
          id: paymentIntent.id,
          amount: paymentIntent.amount,
          failureCode: paymentIntent.last_payment_error?.code,
          failureMessage: paymentIntent.last_payment_error?.message
        });

        // Get customer email if available
        let customerEmail: string | null = null;
        if (paymentIntent.customer) {
          try {
            const customer = await stripe.customers.retrieve(paymentIntent.customer as string);
            if (customer && !customer.deleted && 'email' in customer) {
              customerEmail = customer.email;
            }
          } catch (e) {
            logStep("Could not fetch customer", { error: String(e) });
          }
        }

        // Log to database with enhanced currency-specific details
        const { error: insertError } = await supabase
          .from('payment_failures')
          .insert({
            payment_intent_id: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            failure_code: paymentIntent.last_payment_error?.code || null,
            failure_message: paymentIntent.last_payment_error?.message || null,
            customer_email: customerEmail,
            metadata: {
              decline_code: paymentIntent.last_payment_error?.decline_code,
              payment_method_type: paymentIntent.last_payment_error?.payment_method?.type,
              description: paymentIntent.description,
              card_brand: (paymentIntent.last_payment_error?.payment_method as any)?.card?.brand,
              card_country: (paymentIntent.last_payment_error?.payment_method as any)?.card?.country,
              card_funding: (paymentIntent.last_payment_error?.payment_method as any)?.card?.funding,
              card_last4: (paymentIntent.last_payment_error?.payment_method as any)?.card?.last4,
              original_currency: paymentIntent.currency,
              error_type: paymentIntent.last_payment_error?.type,
              error_doc_url: paymentIntent.last_payment_error?.doc_url
            }
          });

        if (insertError) {
          console.error("[STRIPE-WEBHOOK] Failed to insert payment failure:", insertError);
        } else {
          logStep("Payment failure logged to database");
        }

        // Send email alert
        await sendFailureAlert({
          type: "Payment Intent Failed",
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          failureCode: paymentIntent.last_payment_error?.code,
          failureMessage: paymentIntent.last_payment_error?.message,
          customerEmail: customerEmail,
          paymentIntentId: paymentIntent.id
        });
        break;
      }

      case "charge.failed": {
        const charge = event.data.object as Stripe.Charge;
        
        logStep("Charge failed", {
          id: charge.id,
          amount: charge.amount,
          failureCode: charge.failure_code,
          failureMessage: charge.failure_message
        });

        // Log to database
        const { error: insertError } = await supabase
          .from('payment_failures')
          .insert({
            payment_intent_id: charge.payment_intent as string || charge.id,
            amount: charge.amount,
            currency: charge.currency,
            failure_code: charge.failure_code || null,
            failure_message: charge.failure_message || null,
            customer_email: charge.billing_details?.email || null,
            metadata: {
              charge_id: charge.id,
              outcome: charge.outcome
            }
          });

        if (insertError) {
          console.error("[STRIPE-WEBHOOK] Failed to insert charge failure:", insertError);
        } else {
          logStep("Charge failure logged to database");
        }

        // Send email alert
        await sendFailureAlert({
          type: "Charge Failed",
          amount: charge.amount,
          currency: charge.currency,
          failureCode: charge.failure_code,
          failureMessage: charge.failure_message,
          customerEmail: charge.billing_details?.email,
          paymentIntentId: charge.payment_intent as string || charge.id
        });
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        logStep("Checkout session expired", {
          id: session.id,
          email: session.customer_email
        });

        // Log expired checkouts (abandoned carts)
        const { error: insertError } = await supabase
          .from('payment_failures')
          .insert({
            payment_intent_id: session.payment_intent as string || session.id,
            amount: session.amount_total || 0,
            currency: session.currency || 'usd',
            failure_code: 'checkout_expired',
            failure_message: 'Customer abandoned checkout before completing payment',
            customer_email: session.customer_email,
            metadata: {
              session_id: session.id,
              product_type: session.metadata?.product_type
            }
          });

        if (insertError) {
          console.error("[STRIPE-WEBHOOK] Failed to insert expired session:", insertError);
        } else {
          logStep("Expired checkout logged to database");
        }

        // Send email alert for abandoned checkout
        await sendFailureAlert({
          type: "Checkout Abandoned",
          amount: session.amount_total || 0,
          currency: session.currency || 'usd',
          failureCode: 'checkout_expired',
          failureMessage: 'Customer abandoned checkout before completing payment',
          customerEmail: session.customer_email,
          paymentIntentId: session.payment_intent as string || session.id
        });
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    // Log successful processing
    const processingTime = Date.now() - processingStart;
    await supabase.rpc('log_webhook_event', {
      p_event_type: event.type,
      p_event_id: event.id,
      p_processed: true,
      p_error: processingError,
      p_time_ms: processingTime
    });

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[STRIPE-WEBHOOK] Error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
});