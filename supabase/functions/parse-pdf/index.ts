import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - pdfjs-serverless types issue
import { getDocument } from "https://esm.sh/pdfjs-serverless@0.4.1";

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

    // Convert file to typed array
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Load PDF using pdfjs-serverless (designed for edge environments)
    const document = await getDocument({ data, useSystemFonts: true }).promise;
    
    console.log("PDF loaded. Pages:", document.numPages);

    // Extract text from all pages
    let fullText = "";
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: unknown) => (item as { str?: string }).str || "")
        .join(" ");
      fullText += pageText + "\n\n";
    }

    console.log("PDF parsed successfully. Text length:", fullText.length);

    return new Response(
      JSON.stringify({ 
        success: true, 
        text: fullText.trim(),
        pages: document.numPages 
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
