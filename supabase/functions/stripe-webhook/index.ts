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

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    
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
              // Enhanced currency and card details for debugging international payments
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
