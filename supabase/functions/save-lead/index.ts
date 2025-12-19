import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// Performance monitoring
const SLOW_REQUEST_THRESHOLD = 2000;
const VERY_SLOW_THRESHOLD = 5000;

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "admin@resumebooster.com";
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const alertLastSent: Record<string, number> = {};

async function sendAlert(alertType: string, subject: string, details: Record<string, unknown>) {
  const now = Date.now();
  if (now - (alertLastSent[alertType] || 0) < ALERT_COOLDOWN_MS) return;
  alertLastSent[alertType] = now;
  
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) return;
    
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Resume Booster Alerts <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        subject: `⚠️ ${subject}`,
        html: `<h2>Edge Function Alert</h2><p><strong>Type:</strong> ${alertType}</p><p><strong>Time:</strong> ${new Date().toISOString()}</p><pre style="background:#f4f4f4;padding:15px;">${JSON.stringify(details, null, 2)}</pre>`,
      }),
    });
    console.log(`[ALERT] Sent ${alertType}`);
  } catch (e) { console.error("[ALERT] Error:", e); }
}

const trackPerformance = (startTime: number, operation: string, success: boolean, details?: Record<string, unknown>, clientIp?: string) => {
  const duration = Date.now() - startTime;
  const level = duration > VERY_SLOW_THRESHOLD ? 'CRITICAL' : duration > SLOW_REQUEST_THRESHOLD ? 'SLOW' : 'OK';
  console.log(`[PERF] ${operation} | ${duration}ms | ${level} | success=${success}${details ? ` | ${JSON.stringify(details)}` : ''}`);
  
  if (level === 'CRITICAL' || !success) {
    EdgeRuntime.waitUntil(sendAlert(
      success ? `${operation}_slow` : `${operation}_error`,
      success ? `${operation} CRITICAL (${duration}ms)` : `${operation} Error`,
      { operation, duration, level, success, ip: clientIp || 'unknown', ...details }
    ));
  }
};

// Send lead notification email with customer info
async function sendLeadNotificationEmail(
  email: string,
  ip: string,
  country: string,
  industry: string | null,
  atsScore: number | null
) {
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) return;
    
    const scoreColor = atsScore && atsScore >= 80 ? '#22c55e' : atsScore && atsScore >= 60 ? '#eab308' : '#ef4444';
    const scoreEmoji = atsScore && atsScore >= 80 ? '🟢' : atsScore && atsScore >= 60 ? '🟡' : '🔴';
    const conversionNote = atsScore && atsScore < 70 ? 'HIGH CONVERSION POTENTIAL - Low score means they need help!' : 'Good candidate for premium upsell';
    
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Resume Booster <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        subject: `${scoreEmoji} NEW LEAD: ${email} | ${industry || 'Unknown'} | ${country}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #f8fafc;">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 20px; border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; font-size: 20px;">🎯 New Lead Captured!</h1>
              <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 13px;">${new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            
            <!-- Customer Email - PROMINENT -->
            <div style="background: #eff6ff; padding: 25px; border-bottom: 2px solid #3b82f6;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">📧 Customer Email</p>
              <a href="mailto:${email}" style="font-size: 24px; font-weight: bold; color: #1e40af; text-decoration: none;">${email}</a>
            </div>
            
            <!-- Quick Info -->
            <div style="background: white; padding: 20px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px;">🌍 Location</td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; color: #1e293b;">${country}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px;">🏢 Industry</td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; color: #1e293b;">${industry || 'Not detected'}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px;">📊 ATS Score</td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                    <span style="background: ${scoreColor}; color: white; padding: 4px 12px; border-radius: 12px; font-weight: 600; font-size: 14px;">${atsScore || 'N/A'}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; color: #64748b; font-size: 13px;">🔍 IP Address</td>
                  <td style="padding: 10px 0; text-align: right; font-size: 12px; color: #94a3b8; font-family: monospace;">${ip}</td>
                </tr>
              </table>
            </div>
            
            <!-- Conversion Note -->
            <div style="background: #fefce8; padding: 15px 20px; border-left: 4px solid #eab308;">
              <p style="margin: 0; font-size: 13px; color: #854d0e;"><strong>💡 Note:</strong> ${conversionNote}</p>
            </div>
            
            <!-- CTA -->
            <div style="background: #f1f5f9; padding: 20px; border-radius: 0 0 12px 12px; text-align: center;">
              <a href="mailto:${email}?subject=Your%20Resume%20Booster%20Results%20%F0%9F%93%84&body=Hi!%0A%0AThanks%20for%20trying%20our%20free%20resume%20scan.%20I%20noticed%20your%20ATS%20score%20could%20use%20some%20improvement%20%E2%80%93%20I%E2%80%99d%20love%20to%20help%20you%20boost%20it!%0A%0AWould%20you%20be%20interested%20in%20a%20quick%20chat%20about%20how%20to%20optimize%20your%20resume%3F%0A%0ABest%2C%0AResume%20Booster%20Team" 
                 style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                📧 Reply to Lead
              </a>
            </div>
            
          </div>
        `,
      }),
    });
    
    if (!response.ok) {
      console.error("[SAVE-LEAD] Email notification failed:", await response.text());
    } else {
      console.log("[SAVE-LEAD] Lead notification email sent");
    }
  } catch (error) {
    console.error("[SAVE-LEAD] Email notification error:", error);
  }
}

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

// Blocked country codes (ISO 3166-1 alpha-2)
const BLOCKED_COUNTRIES = new Set(['RU', 'NG', 'PK']);

// Country cache to avoid repeated API calls for same IP
const countryCache = new Map<string, { country: string; timestamp: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const getCountryFromHeaders = (req: Request): string | null => {
  return req.headers.get('cf-ipcountry') || 
         req.headers.get('x-vercel-ip-country') || 
         req.headers.get('x-country-code') ||
         null;
};

// Fetch country from ipinfo.io API (fallback when headers missing)
async function getCountryFromIpInfo(ip: string): Promise<string | null> {
  if (!ip || ip === 'unknown') return null;
  
  // Check cache first
  const cached = countryCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.country;
  }
  
  try {
    const IPINFO_API_KEY = Deno.env.get("IPINFO_API_KEY");
    if (!IPINFO_API_KEY) {
      console.log("[SAVE-LEAD] IPINFO_API_KEY not configured");
      return null;
    }
    
    const response = await fetch(`https://ipinfo.io/${ip}?token=${IPINFO_API_KEY}`, {
      signal: AbortSignal.timeout(2000) // 2 second timeout
    });
    
    if (!response.ok) {
      console.log(`[SAVE-LEAD] ipinfo.io error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const country = data.country || null;
    
    // Cache the result
    if (country) {
      countryCache.set(ip, { country, timestamp: Date.now() });
    }
    
    console.log(`[SAVE-LEAD] ipinfo.io resolved IP ${ip} to country: ${country}`);
    return country;
  } catch (error) {
    console.log(`[SAVE-LEAD] ipinfo.io lookup failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    return null;
  }
}

// Get country code with fallback to ipinfo.io
async function getCountryCode(req: Request, clientIp: string): Promise<string | null> {
  // Try CDN headers first (fastest)
  const headerCountry = getCountryFromHeaders(req);
  if (headerCountry) return headerCountry;
  
  // Fallback to ipinfo.io API
  return await getCountryFromIpInfo(clientIp);
}

const isBlockedCountry = async (req: Request, clientIp: string): Promise<boolean> => {
  const country = await getCountryCode(req, clientIp);
  if (!country) return false;
  return BLOCKED_COUNTRIES.has(country.toUpperCase());
};

const isDisposableEmail = (email: string): boolean => {
  const domain = email.toLowerCase().split('@')[1];
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
};

serve(async (req) => {
  const requestStartTime = Date.now();
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = getClientIp(req);

  // Geo-blocking check (async with ipinfo.io fallback)
  if (await isBlockedCountry(req, clientIp)) {
    const country = await getCountryCode(req, clientIp);
    console.log(`[SAVE-LEAD] Blocked request from country: ${country}`);
    return new Response(
      JSON.stringify({ error: 'Service not available in your region.' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { email, industry, atsScore, honeypot } = await req.json();
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

    // Send lead notification email in background (get country async)
    const countryPromise = getCountryCode(req, clientIp).then(c => c || 'Unknown');
    EdgeRuntime.waitUntil(
      countryPromise.then(country => sendLeadNotificationEmail(email, clientIp, country, industry, atsScore))
    );

    trackPerformance(requestStartTime, 'save-lead', true, {}, clientIp);
    console.log(`[SAVE-LEAD] Lead saved successfully for IP: ${clientIp}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    trackPerformance(requestStartTime, 'save-lead', false, { error: error instanceof Error ? error.message : 'Unknown' }, clientIp);
    console.error("[SAVE-LEAD] Error:", error);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
