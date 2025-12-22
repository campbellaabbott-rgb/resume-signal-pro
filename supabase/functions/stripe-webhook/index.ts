import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

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

        // Log to database
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
              description: paymentIntent.description
            }
          });

        if (insertError) {
          console.error("[STRIPE-WEBHOOK] Failed to insert payment failure:", insertError);
        } else {
          logStep("Payment failure logged to database");
        }
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
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

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
