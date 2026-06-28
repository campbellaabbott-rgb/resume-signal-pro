import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import mammoth from "https://esm.sh/mammoth@1.6.0";
import { looksGarbled, isOleCompoundFile } from "../_shared/text-validation.ts";

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
    console.log(`[PARSE-DOCX] Request from IP: ${clientIp}`);

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
      console.error("[PARSE-DOCX] Global rate limit check error:", globalRlError);
    } else if (!globalAllowed) {
      console.log(`[PARSE-DOCX] Global rate limit exceeded for IP: ${clientIp}`);
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check per-function rate limit
    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_ip: clientIp,
      p_function: 'parse-docx',
      p_max_requests: RATE_LIMIT,
      p_window_minutes: RATE_WINDOW_MINUTES
    });

    if (rlError) {
      console.error("[PARSE-DOCX] Rate limit check error:", rlError);
    } else if (!allowed) {
      console.log(`[PARSE-DOCX] Rate limit exceeded for IP: ${clientIp}`);
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
      console.log(`[PARSE-DOCX] File too large: ${file.size} bytes`);
      return new Response(JSON.stringify({ error: "File too large. Maximum size is 10MB." }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // File type validation
    const validDocxTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    const isValidType = validDocxTypes.includes(file.type) || 
                        file.name.toLowerCase().endsWith('.docx') || 
                        file.name.toLowerCase().endsWith('.doc');
    
    if (!isValidType) {
      console.log(`[PARSE-DOCX] Invalid file type: ${file.type}`);
      return new Response(JSON.stringify({ error: "Invalid file type. Please upload a Word document." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[PARSE-DOCX] Parsing file:", file.name, "Size:", file.size);

    // Convert file to array buffer
    const arrayBuffer = await file.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      trackPerformance(requestStartTime, 'parse-docx', false, { reason: 'empty_file' }, clientIp);
      return new Response(
        JSON.stringify({ success: false, error: "This file appears to be empty. Please check the file and try again." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // .docx is a ZIP archive (starts with "PK"); legacy .doc (pre-2007, OLE
    // Compound File binary format) is not a ZIP at all and mammoth can't read it —
    // it would fail deep inside JSZip with a confusing, generic error. The upload
    // UI's accept filter discourages .doc, but drag-and-drop ignores that filter
    // and the file-type check above explicitly allows a .doc extension through.
    // Note: a password-encrypted .docx (Word's "Encrypt with Password") is ALSO
    // wrapped in this same OLE container per the MS-OFFCRYPTO spec, so this check
    // catches both cases — the message below covers both rather than asserting
    // it must be the legacy format, which would be actively wrong for an
    // encrypted modern file.
    if (isOleCompoundFile(arrayBuffer)) {
      trackPerformance(requestStartTime, 'parse-docx', false, { reason: 'legacy_doc_or_encrypted' }, clientIp);
      EdgeRuntime.waitUntil(
        supabase.rpc('log_parse_failure', {
          p_file_type: 'docx',
          p_error_code: 'legacy_doc_or_encrypted',
          p_error_message: 'OLE compound file: legacy .doc format or password-encrypted .docx',
          p_visitor_id: clientIp
        })
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "We can't read this file directly — it's either an older .doc format (Word 2003 or earlier) or a password-protected document. Please save it as an unprotected .docx (File > Save As in Word) or paste your resume text instead.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Extract text using mammoth. mammoth's extractRawText() passes its input
    // straight to unzip.openZip(), which only recognizes a `buffer`, `path`, or
    // `file` key — never `arrayBuffer` (confirmed against mammoth@1.6.0's
    // source). Passing { arrayBuffer } here always failed with "Could not find
    // file in options", meaning every .docx upload through this function was
    // failing. Wrapped in a Uint8Array before passing as `buffer` — verified
    // directly against the real package that both a raw ArrayBuffer and a
    // Uint8Array work under the `buffer` key, but Uint8Array is the safer,
    // more conventional choice for binary data in Deno.
    const docxBuffer = new Uint8Array(arrayBuffer);
    const result = await mammoth.extractRawText({ buffer: docxBuffer });
    const text = result.value.trim();

    if (result.messages && result.messages.length > 0) {
      console.log("[PARSE-DOCX] Mammoth messages:", result.messages);
    }

    // A near-empty result usually means the document is blank or is text wrapped
    // in an image/embedded object that mammoth can't extract. Surface a specific,
    // actionable error instead of letting near-empty text flow into analysis.
    const MIN_TEXT_LENGTH = 40;
    if (text.length < MIN_TEXT_LENGTH) {
      trackPerformance(requestStartTime, 'parse-docx', false, { textLength: text.length, reason: 'empty_or_too_short' }, clientIp);
      console.log("[PARSE-DOCX] Extracted text too short:", text.length);

      EdgeRuntime.waitUntil(
        (async () => {
          await supabase.rpc('log_parse_failure', {
            p_file_type: 'docx',
            p_error_code: 'empty_or_too_short',
            p_error_message: `Extracted only ${text.length} chars`,
            p_visitor_id: clientIp
          });
        })()
      );

      return new Response(
        JSON.stringify({
          success: false,
          error: "Couldn't find readable text in this document. If your resume content is inside an image or text box, please paste your resume text directly instead.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // mammoth can "succeed" (no exception, text isn't too short) while having
    // extracted a wall of mis-decoded glyphs from a broken embedded font —
    // that's a different failure mode than the too-short check above, and
    // letting it through would feed garbage into the AI analysis instead of
    // surfacing a clear, actionable error. Language-agnostic — does not assume
    // English or any specific script.
    if (looksGarbled(text)) {
      trackPerformance(requestStartTime, 'parse-docx', false, { textLength: text.length, reason: 'garbled_text' }, clientIp);
      console.log("[PARSE-DOCX] Extracted text looks garbled (broken encoding).");

      EdgeRuntime.waitUntil(
        supabase.rpc('log_parse_failure', {
          p_file_type: 'docx',
          p_error_code: 'garbled_text',
          p_error_message: `Extracted ${text.length} chars but text appears corrupted`,
          p_visitor_id: clientIp
        })
      );

      return new Response(
        JSON.stringify({
          success: false,
          error: "We extracted text from this document, but it appears corrupted (likely a broken or embedded font). Please try saving the document again or paste your resume text directly.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    trackPerformance(requestStartTime, 'parse-docx', true, { textLength: text.length }, clientIp);
    console.log("[PARSE-DOCX] DOCX parsed successfully. Text length:", text.length);

    return new Response(
      JSON.stringify({
        success: true,
        text,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    trackPerformance(requestStartTime, 'parse-docx', false, { error: error instanceof Error ? error.message : 'Unknown' }, clientIp);
    console.error("[PARSE-DOCX] Error:", error);

    // Log parse failure to database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    EdgeRuntime.waitUntil(
      (async () => {
        await supabase.rpc('log_parse_failure', {
          p_file_type: 'docx',
          p_error_code: 'parse_error',
          p_error_message: error instanceof Error ? error.message : 'Unknown error',
          p_visitor_id: clientIp
        });
      })()
    );

    return new Response(
      JSON.stringify({
        error: "Failed to parse document. Please ensure the file is a valid Word document.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});