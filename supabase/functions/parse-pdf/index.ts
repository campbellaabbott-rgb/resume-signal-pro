import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDocument, GlobalWorkerOptions } from "https://esm.sh/pdfjs-dist@4.0.379/build/pdf.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Disable worker for Deno environment
GlobalWorkerOptions.workerSrc = "";

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

    // Convert file to array buffer
    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);

    // Load PDF document
    const loadingTask = getDocument({ data: typedArray, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true });
    const pdf = await loadingTask.promise;

    console.log("PDF loaded. Pages:", pdf.numPages);

    // Extract text from all pages
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      fullText += pageText + "\n\n";
    }

    console.log("PDF parsed successfully. Text length:", fullText.length);

    return new Response(
      JSON.stringify({ 
        success: true, 
        text: fullText.trim(),
        pages: pdf.numPages 
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
