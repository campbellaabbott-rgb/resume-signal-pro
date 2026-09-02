// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[AFFILIATE-COMMISSION-EMAIL] ${step}${detailsStr}`);
};

// productName/referralCode are inserted directly into the HTML email below.
// productName always comes from our own product config and referralCode is
// sanitized to [a-f0-9] before storage elsewhere in the codebase, but escaping
// here too is zero-cost defense-in-depth against any future code path that
// supplies an unsanitized value.
function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      logStep("RESEND_API_KEY not set, skipping email");
      // 503, matching send-product-email's convention — this used to return
      // 200 with success:false, which the one caller (verify-product-purchase)
      // doesn't actually check, so it silently logged "email sent" either way.
      return new Response(
        JSON.stringify({ success: false, message: "Email service not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
      );
    }

    const { 
      affiliateEmail, 
      productName, 
      saleAmount, 
      commissionAmount,
      referralCode 
    } = await req.json();

    if (!affiliateEmail) {
      return new Response(
        JSON.stringify({ error: "Affiliate email is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    logStep("Sending commission notification", { 
      affiliateEmail, 
      productName, 
      commission: commissionAmount 
    });

    const resend = new Resend(resendKey);
    const formattedCommission = (commissionAmount / 100).toFixed(2);
    const formattedSale = (saleAmount / 100).toFixed(2);

    const { error: emailError } = await resend.emails.send({
      from: "Resume Booster <reports@resumebooster.work>",
      to: [affiliateEmail],
      subject: `🎉 You earned $${formattedCommission} commission!`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; padding: 30px; text-align: center; margin-bottom: 24px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">You Earned a Commission! 🎉</h1>
          </div>
          
          <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <h2 style="margin-top: 0; color: #111;">Commission Details</h2>
            
            <div style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Product Sold</p>
              <p style="margin: 0; font-size: 18px; font-weight: 600;">${escapeHtml(productName) || 'Resume Product'}</p>
            </div>
            
            <div style="display: flex; gap: 16px;">
              <div style="background: white; border-radius: 8px; padding: 16px; flex: 1;">
                <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Sale Amount</p>
                <p style="margin: 0; font-size: 20px; font-weight: 600;">$${formattedSale}</p>
              </div>
              <div style="background: #ecfdf5; border-radius: 8px; padding: 16px; flex: 1; border: 2px solid #10b981;">
                <p style="margin: 0 0 8px 0; color: #059669; font-size: 14px;">Your Commission</p>
                <p style="margin: 0; font-size: 24px; font-weight: 700; color: #059669;">+$${formattedCommission}</p>
              </div>
            </div>
          </div>
          
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="https://atsresumescanner.com/affiliates" 
               style="display: inline-block; background: #10b981; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              View Your Dashboard →
            </a>
          </div>
          
          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; text-align: center;">
            <p style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">
              Your referral code: <strong style="color: #111;">${escapeHtml(referralCode)}</strong>
            </p>
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              Commission is pending approval and will be paid out monthly.
            </p>
          </div>
        </body>
        </html>
      `,
    });

    if (emailError) {
      logStep("Email send failed", { error: emailError.message });
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    logStep("Commission notification sent successfully");
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
