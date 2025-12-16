import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Common disposable email domains to block
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  // Temporary email services
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com',
  'guerrillamail.com', 'guerrillamail.org', 'guerrillamail.net', 'guerrillamail.biz',
  'mailinator.com', 'mailinator2.com', 'mailinater.com',
  '10minutemail.com', '10minutemail.net', '10minutemail.org',
  'throwaway.email', 'throwawaymail.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'fakeinbox.com', 'fakemailgenerator.com',
  'getnada.com', 'nada.email',
  'mailnesia.com', 'mailnator.com',
  'dispostable.com', 'disposableemailaddresses.com',
  'trashmail.com', 'trashmail.net', 'trashmail.org',
  'maildrop.cc', 'mailsac.com',
  'sharklasers.com', 'guerrillamailblock.com',
  'pokemail.net', 'spam4.me',
  'grr.la', 'getairmail.com',
  'mohmal.com', 'tempail.com',
  'emailondeck.com', 'emailfake.com',
  'crazymailing.com', 'tempinbox.com',
  'mintemail.com', 'mytrashmail.com',
  'throwam.com', 'burnermail.io',
  'mailcatch.com', 'inboxalias.com',
  'spamgourmet.com', 'spamex.com',
  'jetable.org', 'incognitomail.com',
  'anonymbox.com', 'discard.email',
  'discardmail.com', 'mailexpire.com',
  'tmpmail.org', 'tmpmail.net',
  'emailtemporario.com.br', 'emailtemporar.ro',
  'mail-temp.com', 'temp.email',
  'fake-box.com', 'trash-mail.com',
  'mt2009.com', 'mt2014.com', 'mt2015.com',
  'binkmail.com', 'safetymail.info',
  'spamfree24.org', 'spamfree24.de',
  'spamobox.com', 'tempr.email',
  'disbox.org', 'disbox.net',
  '33mail.com', 'amilegit.com',
  'emailisvalid.com', 'emailsensei.com',
  'fakemail.fr', 'getonemail.com',
  'quickmail.nl', 'tempsky.com'
]);

const getClientIp = (req: Request): string => {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         req.headers.get('x-real-ip') || 
         'unknown';
};

const isDisposableEmail = (email: string): boolean => {
  const domain = email.toLowerCase().split('@')[1];
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, industry, atsScore, honeypot } = await req.json();

    const clientIp = getClientIp(req);
    console.log(`[SAVE-LEAD] Request from IP: ${clientIp}`);

    // Honeypot check - if filled, it's a bot
    if (honeypot && honeypot.trim() !== '') {
      console.log(`[SAVE-LEAD] Honeypot triggered for IP: ${clientIp}`);
      // Return success to not alert the bot, but don't save
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!email || !emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for disposable email
    if (isDisposableEmail(email)) {
      console.log(`[SAVE-LEAD] Disposable email blocked: ${email.split('@')[1]}`);
      return new Response(
        JSON.stringify({ error: 'Please use a permanent email address.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[SAVE-LEAD] Supabase credentials not configured");
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limit: max 10 email submissions per hour per IP
    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_function: 'save-lead',
      p_ip: clientIp,
      p_max_requests: 10,
      p_window_minutes: 60
    });

    if (rlError) {
      console.error("[SAVE-LEAD] Rate limit check error:", rlError);
    } else if (!allowed) {
      console.log(`[SAVE-LEAD] Rate limit exceeded for IP: ${clientIp}`);
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save lead using RPC
    const { error } = await supabase.rpc('save_free_scan_lead', {
      p_email: email,
      p_industry: industry || null,
      p_ats_score: atsScore || null
    });

    if (error) {
      console.error("[SAVE-LEAD] Database error:", error);
      return new Response(
        JSON.stringify({ error: 'Something went wrong. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[SAVE-LEAD] Lead saved successfully for IP: ${clientIp}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("[SAVE-LEAD] Error:", error);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
