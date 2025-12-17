import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import mammoth from "https://esm.sh/mammoth@1.6.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
const RATE_LIMIT = 20; // 20 requests per hour
const RATE_WINDOW_MINUTES = 60;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Get client IP for rate limiting
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
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

    // Extract text using mammoth
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value.trim();

    console.log("[PARSE-DOCX] DOCX parsed successfully. Text length:", text.length);

    if (result.messages && result.messages.length > 0) {
      console.log("[PARSE-DOCX] Mammoth messages:", result.messages);
    }

    return new Response(
      JSON.stringify({
        success: true,
        text,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("[PARSE-DOCX] Error:", error);

    return new Response(
      JSON.stringify({
        error: "Failed to parse document. Please ensure the file is a valid Word document.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});