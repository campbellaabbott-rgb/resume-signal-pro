import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolvePDFJS } from "https://esm.sh/pdfjs-serverless@0.4.1?target=deno";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// Performance monitoring
const SLOW_REQUEST_THRESHOLD = 3000;
const VERY_SLOW_THRESHOLD = 8000;

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
const RATE_LIMIT = 20; // 20 requests per hour
const RATE_WINDOW_MINUTES = 60;

type PdfTextItem = { str?: string };

serve(async (req) => {
  const requestStartTime = Date.now();
  
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Get client IP for rate limiting (prioritize Cloudflare's trusted header)
  const clientIp = req.headers.get('cf-connecting-ip') ||
                   req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
                   req.headers.get('x-real-ip') || 
                   'unknown';

  try {
    console.log(`[PARSE-PDF] Request from IP: ${clientIp}`);

    // Check persistent rate limit
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check global rate limit first (100 req/hr across ALL functions)
    const { data: globalAllowed, error: globalRlError } = await supabase.rpc('check_global_rate_limit', {
      p_ip: clientIp,
      p_max_requests: 100,
      p_window_minutes: 60
    });

    if (globalRlError) {
      console.error("[PARSE-PDF] Global rate limit check error:", globalRlError);
    } else if (!globalAllowed) {
      console.log(`[PARSE-PDF] Global rate limit exceeded for IP: ${clientIp}`);
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check per-function rate limit
    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_ip: clientIp,
      p_function: 'parse-pdf',
      p_max_requests: RATE_LIMIT,
      p_window_minutes: RATE_WINDOW_MINUTES
    });

    if (rlError) {
      console.error("[PARSE-PDF] Rate limit check error:", rlError);
    } else if (!allowed) {
      console.log(`[PARSE-PDF] Rate limit exceeded for IP: ${clientIp}`);
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // File size validation
    if (file.size > MAX_FILE_SIZE) {
      console.log(`[PARSE-PDF] File too large: ${file.size} bytes`);
      return new Response(JSON.stringify({ error: "File too large. Maximum size is 10MB." }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // File type validation
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      console.log(`[PARSE-PDF] Invalid file type: ${file.type}`);
      return new Response(JSON.stringify({ error: "Invalid file type. Please upload a PDF file." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[PARSE-PDF] Parsing file:", file.name, "Size:", file.size);

    // Convert file to typed array
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Initialize PDF.js (serverless wrapper)
    const { getDocument } = await resolvePDFJS();

    const doc = await getDocument({
      data,
      useSystemFonts: true,
    }).promise;

    console.log("[PARSE-PDF] PDF loaded. Pages:", doc.numPages);

    // Extract text from all pages
    let fullText = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = (textContent.items as unknown[])
        .map((item) => (item as PdfTextItem).str ?? "")
        .join(" ");
      fullText += pageText + "\n\n";
    }

    const text = fullText.trim();
    trackPerformance(requestStartTime, 'parse-pdf', true, { pages: doc.numPages, textLength: text.length }, clientIp);
    console.log("[PARSE-PDF] PDF parsed successfully. Text length:", text.length);

    return new Response(
      JSON.stringify({
        success: true,
        text,
        pages: doc.numPages,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    trackPerformance(requestStartTime, 'parse-pdf', false, { error: error instanceof Error ? error.message : 'Unknown' }, clientIp);
    console.error("[PARSE-PDF] Error:", error);
    
    return new Response(
      JSON.stringify({
        error: "Failed to parse PDF. Please ensure the file is a valid PDF document.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});