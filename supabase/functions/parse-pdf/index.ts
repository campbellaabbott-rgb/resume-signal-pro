// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolvePDFJS } from "https://esm.sh/pdfjs-serverless@0.4.1?target=deno";
import { isDamagedPdfError, looksGarbled, normalizeIntakeText } from "../_shared/text-validation.ts";
import {
  arabicShare,
  cjkControlsAsSpaces,
  detectMultiColumnRisk,
  dropUnnamedIndicGlyphs,
  linksLine,
  pageTextFromItems,
  scannedVerdict,
  type PdfTextItem,
} from "./page-text.ts";
import { clientAddressOr } from "../_shared/client-address.ts";

// Provable from outside without an upload: every response, the CORS preflight
// included, carries this in x-fn-build.
// 2026-11-09.1 (cost wave, lane ci-edge, cost audit 2026-11-08 Do first #10): the CORS answer says Access-Control-Max-Age 7200, so a browser asks the preflight once per two hours instead of before every call.
const FN_BUILD = "parse-pdf.2026-11-09.1";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// Performance monitoring
const SLOW_REQUEST_THRESHOLD = 3000;
const VERY_SLOW_THRESHOLD = 8000;

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "resumeboostersupp@gmail.com";
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
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
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

  // The platform's address (cf-connecting-ip, else the LAST forwarded hop),
  // never the first hop, which the caller writes (_shared/client-address.ts).
  const clientIp = clientAddressOr(req.headers, 'unknown');

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
        JSON.stringify({ success: false, code: "empty_file", error: "This file appears to be empty. Please check the file and try again." }),
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
            code: "password_protected",
            error: "This PDF is password-protected. Please remove the password (or export an unprotected copy) and try again.",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (errorName === 'InvalidPDFException') {
        trackPerformance(requestStartTime, 'parse-pdf', false, { reason: 'invalid_pdf' }, clientIp);
      EdgeRuntime.waitUntil(
        (async () => {
          await supabase.rpc('log_parse_failure', {
            p_file_type: 'pdf',
            p_error_code: 'invalid_pdf',
            p_error_message: 'File is not a valid PDF',
            p_visitor_id: clientIp
          });
        })()
      );
        return new Response(
          JSON.stringify({
            success: false,
            code: "invalid_pdf",
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
          code: "too_many_pages",
          pages: doc.numPages,
          max: MAX_PAGES,
          error: `This PDF has ${doc.numPages} pages, which is more than we support (${MAX_PAGES} max). Please upload just your resume, not a combined document.`,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[PARSE-PDF] PDF loaded. Pages:", doc.numPages);

    // Extract text from all pages
    let fullText = "";
    let multiColumnDetected = false;
    const pageLengths: number[] = [];
    const linkTargets: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const items = textContent.items as PdfTextItem[];
      // Lines kept (register L5-01): the scanner reads a résumé line by line.
      const pageText = pageTextFromItems(items);
      fullText += pageText + "\n\n";
      pageLengths.push(pageText.trim().length);
      // A contact block written as links keeps its addresses only in them
      // (S14X-147). A page whose links cannot be read still reads its text.
      try {
        for (const a of (await page.getAnnotations()) as Array<{ subtype?: string; url?: unknown; unsafeUrl?: unknown }>) {
          const url = typeof a.url === "string" ? a.url : typeof a.unsafeUrl === "string" ? a.unsafeUrl : null;
          if (a.subtype === "Link" && url) linkTargets.push(url);
        }
      } catch (e) {
        console.warn("[PARSE-PDF] Link read skipped:", e instanceof Error ? e.message : String(e));
      }

      if (!multiColumnDetected) {
        // The page's own size: the column tests measure in shares of it.
        const viewport = page.getViewport({ scale: 1 });
        if (detectMultiColumnRisk(items, { width: viewport.width, height: viewport.height })) {
          multiColumnDetected = true;
        }
      }
    }

    // Glyphs pdf.js could only name as U+0000 in Indic text (register
    // S11-035) are removed before the corruption test, and the visitor is told
    // a .docx or pasted text reads them exactly.
    const unnamed = dropUnnamedIndicGlyphs(fullText.trim());
    // A Korean or Japanese word gap pdf.js could only name as one control
    // character, inside an item (S14X-123); then the hyphens and invisible
    // marks a keyword search trips on (S14X-280).
    const text = normalizeIntakeText(cjkControlsAsSpaces(unnamed.text).text).trim();

    // PDF.js only extracts text that's actually embedded in the file. A scanned/
    // image-based PDF "succeeds" here with little-to-no text, which would
    // otherwise flow into analysis as garbage input. It is refused when no page
    // carries a résumé's worth of text; pages with next to nothing on them
    // (scanned certificates after a résumé) are counted and named (S14X-282).
    const verdict = scannedVerdict(pageLengths);

    if (verdict.refuse) {
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
          code: "scanned_or_empty",
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

      // Re-exporting from the same program writes the same fonts, so the
      // remedy offered reads the text another way.
      return new Response(
        JSON.stringify({
          success: false,
          code: "garbled_text",
          error: "We couldn't read the characters in this PDF correctly (its font doesn't map to real letters). Please upload a .docx version or paste your resume text instead.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    trackPerformance(requestStartTime, 'parse-pdf', true, { pages: doc.numPages, textLength: text.length }, clientIp);
    console.log("[PARSE-PDF] PDF parsed successfully. Text length:", text.length);

    const links = linksLine(linkTargets, text);
    // One notice, the most useful first: characters left out, Arabic whose
    // joined letters pdf.js cannot rebuild (S14X-044), image pages skipped.
    const notice = unnamed.dropped > 0
      ? { notice: "unread_characters", unreadCharacters: unnamed.dropped }
      : arabicShare(text) >= 0.3
        ? { notice: "rtl_unreliable" }
        : verdict.imagePages > 0
          ? { notice: "image_pages_skipped", skippedPages: verdict.imagePages }
          : {};

    return new Response(
      JSON.stringify({
        success: true,
        text: links ? `${text}\n\n${links}` : text,
        pages: doc.numPages,
        multiColumnDetected,
        ...notice,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    // A broken file is the FILE's problem, not an outage (register S11-033).
    // pdf.js names a damaged stream, page tree or cross-reference table
    // (FormatError, UnknownErrorException, ...); answering those with a 500
    // made the browser retry the same bytes twice, open the parse circuit,
    // say "PDF Parser Unavailable" and refuse the visitor's NEXT, valid file
    // for 30 seconds. They are a 422 that says what is wrong with the file.
    const damaged = isDamagedPdfError(error);
    trackPerformance(requestStartTime, 'parse-pdf', false, { error: error instanceof Error ? error.message : 'Unknown', damaged }, clientIp);
    console.error("[PARSE-PDF] Error:", error);

    // Log parse failure to database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    EdgeRuntime.waitUntil(
      (async () => {
        await supabase.rpc('log_parse_failure', {
          p_file_type: 'pdf',
          p_error_code: damaged ? 'damaged_file' : 'parse_error',
          p_error_message: error instanceof Error ? error.message : 'Unknown error',
          p_visitor_id: clientIp
        });
      })()
    );

    if (damaged) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "damaged_file",
          error: "This file looks damaged or isn't a real PDF. Please export it again, upload a .docx, or paste your resume text instead.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        error: "Failed to parse PDF. Please ensure the file is a valid PDF document.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});