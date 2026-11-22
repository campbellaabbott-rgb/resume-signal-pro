// deploy-stamp: 2026-10-09T14:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { purchaseReferenceIn } from "../_shared/purchase-links.ts";
import { REFUNDED_PURCHASE_MESSAGE, paymentRevocationState } from "../_shared/payment-revocation.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-11-09.1 (cost wave, lane ci-edge, cost audit 2026-11-08 Do first #10): the CORS answer says Access-Control-Max-Age 7200, so a browser asks the preflight once per two hours instead of before every call.
// 2026-11-21.1 (bug round of 2026-11-19, lane payments-delivery, S9-030): a refunded or disputed purchase, and a Pro grant its refund took back, is refused here as everywhere else that delivers: its saved copy is no longer handed back.
const FN_BUILD = "recover-purchase.2026-11-21.1";

/** The code a refused recovery answers, the one analyze-resume answers for the same refusal. */
const REFUNDED_CODE = "purchase_refunded";

/**
 * WAS THIS PURCHASE TAKEN BACK? (S9-030). stripe-webhook records every full
 * refund and every dispute in payment_revocations, and a refunded month of
 * the plan revokes the Pro grants it paid for. This function read only the
 * saved copy, so a refunded purchase was handed back here after every
 * generator had stopped delivering it. A read that fails answers "not taken
 * back", as sessionWasRefunded does at the success page: a refund is a rare
 * correction, and a database hiccup must not refuse an honest buyer the copy
 * they already received.
 */
// deno-lint-ignore no-explicit-any
async function purchaseTakenBack(db: any, reference: string): Promise<boolean> {
  if (reference.startsWith("pro_")) {
    try {
      const { data, error } = await db.from("pro_grants").select("revoked_at").eq("id", reference.slice(4)).maybeSingle();
      if (error) {
        logStep("Grant revocation unreadable; answering from the saved copy", { error: error.message });
        return false;
      }
      return !!data?.revoked_at;
    } catch (e) {
      logStep("Grant revocation unreadable; answering from the saved copy", { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }
  const state = await paymentRevocationState(db, { sessionId: reference });
  if (state === "unreadable") logStep("Payment revocation unreadable; answering from the saved copy");
  return state === "revoked";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[RECOVER-PURCHASE] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, sessionId: pasted } = await req.json();

    // Require a purchase reference to prevent enumeration of purchases by
    // email alone. WHAT THE EMAIL CONTAINS IS ACCEPTED AS PASTED: the bare
    // session id, the button's link (any of the purchase pages, encoded or
    // not), or the "Order reference" line (commercial-readiness 2026-10-08,
    // item 3). This asked for a link no email carried, and took only a raw
    // id, so a pasted line failed as "no purchase".
    const sessionId = purchaseReferenceIn(pasted);
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "Paste the button link or the order reference from your purchase email." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Recovery request", { email: email ? email.substring(0, 5) + "..." : undefined, hasSessionId: !!sessionId });


    // Initialize Supabase with service role for database access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let purchases: unknown[] = [];

    if (sessionId) {
      // A purchase taken back is refused before its copy is read (S9-030).
      if (await purchaseTakenBack(supabase, sessionId)) {
        logStep("Refused: the purchase was refunded or its grant taken back");
        return new Response(
          JSON.stringify({ error: REFUNDED_PURCHASE_MESSAGE, code: REFUNDED_CODE, refunded: true }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Recover by session ID
      const { data, error } = await supabase.rpc('get_purchased_content_by_session', {
        p_session_id: sessionId
      });

      if (error) {
        logStep("Session lookup error", { error: error.message });
        throw new Error("Failed to look up purchase");
      }

      purchases = data || [];
    } else if (email) {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return new Response(
          JSON.stringify({ error: "Invalid email format" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Recover by email
      const { data, error } = await supabase.rpc('get_purchased_content_by_email', {
        p_email: email.toLowerCase().trim()
      });

      if (error) {
        logStep("Email lookup error", { error: error.message });
        throw new Error("Failed to look up purchases");
      }

      purchases = data || [];
    }

    logStep("Purchases found", { count: purchases.length });

    if (purchases.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          found: false,
          message: "No purchases found for this email. Please check the email address used during checkout.",
          purchases: []
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        found: true,
        purchases: purchases.map((p: any) => ({
          id: p.id,
          productType: p.product_type,
          productName: p.product_name,
          generatedContent: p.generated_content,
          createdAt: p.created_at
        }))
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[RECOVER-PURCHASE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to recover purchase", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});