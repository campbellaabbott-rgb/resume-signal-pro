import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolvePDFJS } from "https://esm.sh/pdfjs-serverless@0.4.1?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PdfTextItem = { str?: string };

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Parsing PDF:", file.name, "Size:", file.size);

    // Convert file to typed array
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Initialize PDF.js (serverless wrapper)
    const { getDocument } = await resolvePDFJS();

    const doc = await getDocument({
      data,
      useSystemFonts: true,
    }).promise;

    console.log("PDF loaded. Pages:", doc.numPages);

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
    console.log("PDF parsed successfully. Text length:", text.length);

    return new Response(
      JSON.stringify({
        success: true,
        text,
        pages: doc.numPages,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Error parsing PDF:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({
        error: "Failed to parse PDF",
        details: errorMessage,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
