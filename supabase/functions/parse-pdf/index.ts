// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolvePDFJS } from "https://esm.sh/pdfjs-serverless@0.4.1?target=deno";
import { looksGarbled } from "../_shared/text-validation.ts";

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

type PdfTextItem = { str?: string; transform?: number[] };

// Detects a real, mechanical ATS-parsing risk: multi-column layouts. PDF.js (like
// most real ATS text extractors) reads text in the order it appears in the file's
// content stream, not visual reading order. A two-column resume often gets its
// entire left column extracted, then jumps back up to the top of the page for the
// right column — which an ATS reading linearly will interleave nonsensically
// (e.g. a job title from the right column landing in the middle of a left-column
// bullet). We detect this by watching for the y-coordinate jumping back upward
// (a new "column" starting) more than once on a page — normal single-column text
// only ever moves down the page.
function detectMultiColumnRisk(items: PdfTextItem[]): boolean {
  let lastY: number | null = null;
  let upwardJumps = 0;
  const Y_JUMP_THRESHOLD = 15; // points; ignores normal sub-line jitter

  for (const item of items) {
    const y = item.transform?.[5];
    if (typeof y !== "number" || !item.str?.trim()) continue;
    if (lastY !== null && y - lastY > Y_JUMP_THRESHOLD) {
      upwardJumps++;
    }
    lastY = y;
  }

  return upwardJumps >= 2;
}

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
      // `code` distinguishes this from the per-function ceiling below. Both used
      // to return byte-identical text, so a 429 could not be attributed to
      // either without logs that RLS makes unreadable — which is how board
      // traffic exhausting this budget got reported as "PDF parse failures".
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later.", code: "rate_limited_budget" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "3600" } }
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
        JSON.stringify({ error: "Rate limit exceeded. Please try again later.", code: "rate_limited_function" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "3600" } }
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

    if (arrayBuffer.byteLength === 0) {
      trackPerformance(requestStartTime, 'parse-pdf', false, { reason: 'empty_file' }, clientIp);
      return new Response(
        JSON.stringify({ success: false, error: "This file appears to be empty. Please check the file and try again." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = new Uint8Array(arrayBuffer);

    // Initialize PDF.js (serverless wrapper)
    const { getDocument } = await resolvePDFJS();

    let doc;
    try {
      doc = await getDocument({
        data,
        useSystemFonts: true,
      }).promise;
    } catch (loadError: unknown) {
      // Distinguish the two most common, specific failure modes from the
      // generic catch-all below — both used to surface as the same misleading
      // "ensure the file is a valid PDF" message, even though a password-
      // protected PDF is a perfectly valid PDF, just locked.
      //
      // Deliberately checking `.name` rather than `instanceof PasswordException`/
      // `instanceof InvalidPDFException`: verified directly against this package's
      // bundled source that PasswordException isn't actually re-exported from
      // resolvePDFJS()'s returned object in a plain Node import (it's undefined),
      // even though pdf.js's internals always set `.name` to a stable string on
      // the thrown instance regardless of build target. `instanceof undefined`
      // would throw its own TypeError, silently defeating this entire check — the
      // edge function uses a different (Deno) build target than was verified
      // locally, so trusting instanceof here would be exactly the kind of
      // looks-right-but-isn't bug this session already found once with mammoth.
      const errorName = (loadError as { name?: string })?.name;
      if (errorName === 'PasswordException') {
        trackPerformance(requestStartTime, 'parse-pdf', false, { reason: 'password_protected' }, clientIp);
        EdgeRuntime.waitUntil(
          (async () => {
            await supabase.rpc('log_parse_failure', {
              p_file_type: 'pdf',
              p_error_code: 'password_protected',
              p_error_message: 'PDF is password-protected',
              p_visitor_id: clientIp
            });
          })()
        );
        return new Response(
          JSON.stringify({
            success: false,
            error: "This PDF is password-protected. Please remove the password (or export an unprotected copy) and try again.",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (errorName === 'InvalidPDFException') {
        trackPerformance(requestStartTime, 'parse-pdf', false, { reason: 'invalid_pdf' }, clientIp);
        EdgeRuntime.waitUntil(
          supabase.rpc('log_parse_failure', {
            p_file_type: 'pdf',
            p_error_code: 'invalid_pdf',
            p_error_message: 'File is not a valid PDF',
            p_visitor_id: clientIp
          })
        );
        return new Response(
          JSON.stringify({
            success: false,
            error: "This file doesn't appear to be a valid PDF (it may be corrupted or a different file type renamed to .pdf). Please try re-exporting it or upload a different file.",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw loadError; // Anything else falls through to the generic handler below.
    }

    // Defensive cap — a real resume is never more than a handful of pages.
    // Without this, a pathological or abusive upload (hundreds of pages) would
    // process every page sequentially and risk timing the function out instead
    // of failing fast with a clear message.
    const MAX_PAGES = 50;
    if (doc.numPages > MAX_PAGES) {
      trackPerformance(requestStartTime, 'parse-pdf', false, { pages: doc.numPages, reason: 'too_many_pages' }, clientIp);
      return new Response(
        JSON.stringify({
          success: false,
          error: `This PDF has ${doc.numPages} pages, which is more than we support (${MAX_PAGES} max). Please upload just your resume, not a combined document.`,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[PARSE-PDF] PDF loaded. Pages:", doc.numPages);

    // Extract text from all pages
    let fullText = "";
    let multiColumnDetected = false;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const items = textContent.items as PdfTextItem[];
      const pageText = items
        .map((item) => item.str ?? "")
        .join(" ");
      fullText += pageText + "\n\n";

      if (!multiColumnDetected && detectMultiColumnRisk(items)) {
        multiColumnDetected = true;
      }
    }

    const text = fullText.trim();

    // PDF.js only extracts text that's actually embedded in the file. A scanned/
    // image-based PDF (or one with only a couple of selectable characters, e.g.
    // a page number) "succeeds" here with little-to-no text, which would otherwise
    // silently flow into analysis as garbage input. Treat that as a parse failure
    // with specific, actionable guidance instead of pretending it worked.
    const MIN_CHARS_PER_PAGE = 200;
    const looksLikeScannedPdf = text.length < Math.max(200, doc.numPages * MIN_CHARS_PER_PAGE);

    if (looksLikeScannedPdf) {
      trackPerformance(requestStartTime, 'parse-pdf', false, { pages: doc.numPages, textLength: text.length, reason: 'scanned_or_empty' }, clientIp);
      console.log("[PARSE-PDF] Extracted text too short relative to page count — likely a scanned/image-based PDF. Length:", text.length, "Pages:", doc.numPages);

      EdgeRuntime.waitUntil(
        (async () => {
          await supabase.rpc('log_parse_failure', {
            p_file_type: 'pdf',
            p_error_code: 'scanned_or_empty',
            p_error_message: `Extracted ${text.length} chars across ${doc.numPages} page(s)`,
            p_visitor_id: clientIp
          });
        })()
      );

      return new Response(
        JSON.stringify({
          success: false,
          error: "This PDF appears to be a scanned image with little or no selectable text. Please upload a text-based PDF (exported from Word/Google Docs), or paste your resume text directly.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // PDF.js can "succeed" (real text extracted, not too short) while that text
    // is a wall of mis-decoded glyphs from a broken embedded font — a different
    // failure mode than the scanned-PDF check above. Language-agnostic — does
    // not assume English or any specific script.
    if (looksGarbled(text)) {
      trackPerformance(requestStartTime, 'parse-pdf', false, { pages: doc.numPages, textLength: text.length, reason: 'garbled_text' }, clientIp);
      console.log("[PARSE-PDF] Extracted text looks garbled (broken encoding).");

      EdgeRuntime.waitUntil(
        (async () => {
          await supabase.rpc('log_parse_failure', {
            p_file_type: 'pdf',
            p_error_code: 'garbled_text',
            p_error_message: `Extracted ${text.length} chars but text appears corrupted`,
            p_visitor_id: clientIp
          });
        })()
      );

      return new Response(
        JSON.stringify({
          success: false,
          error: "We extracted text from this PDF, but it appears corrupted (likely a broken or embedded font). Please try re-exporting the PDF or paste your resume text directly.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    trackPerformance(requestStartTime, 'parse-pdf', true, { pages: doc.numPages, textLength: text.length }, clientIp);
    console.log("[PARSE-PDF] PDF parsed successfully. Text length:", text.length);

    return new Response(
      JSON.stringify({
        success: true,
        text,
        pages: doc.numPages,
        multiColumnDetected,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    trackPerformance(requestStartTime, 'parse-pdf', false, { error: error instanceof Error ? error.message : 'Unknown' }, clientIp);
    console.error("[PARSE-PDF] Error:", error);
    
    // Log parse failure to database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    EdgeRuntime.waitUntil(
      (async () => {
        await supabase.rpc('log_parse_failure', {
          p_file_type: 'pdf',
          p_error_code: 'parse_error',
          p_error_message: error instanceof Error ? error.message : 'Unknown error',
          p_visitor_id: clientIp
        });
      })()
    );
    
    return new Response(
      JSON.stringify({
        error: "Failed to parse PDF. Please ensure the file is a valid PDF document.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});