import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "https://esm.sh/pdf-parse@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Parsing PDF:", file.name, "Size:", file.size);

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Parse PDF using pdf-parse
    const data = await pdf(buffer);

    console.log("PDF parsed successfully. Pages:", data.numpages, "Text length:", data.text.length);

    return new Response(
      JSON.stringify({ 
        success: true, 
        text: data.text.trim(),
        pages: data.numpages 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error parsing PDF:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ 
        error: "Failed to parse PDF", 
        details: errorMessage 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
