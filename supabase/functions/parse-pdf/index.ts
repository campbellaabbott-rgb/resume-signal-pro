import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// pdfjs-serverless is designed for edge/serverless runtimes; import as a namespace to avoid
// brittle named-export differences across ESM wrappers.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as pdfjsServerless from "https://esm.sh/pdfjs-serverless@0.4.1?target=deno";

type PdfTextItem = { str?: string };

function resolveGetDocument() {
  const mod: any = pdfjsServerless as any;
  return mod.getDocument ?? mod.default?.getDocument;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const getDocument = resolveGetDocument();
    if (typeof getDocument !== "function") {
      throw new Error("PDF parser module loaded but getDocument() export was not found");
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Parsing PDF:", file.name, "Size:", file.size);

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Load PDF
    const document = await getDocument({ data, useSystemFonts: true }).promise;
    console.log("PDF loaded. Pages:", document.numPages);

    // Extract text from all pages
    let fullText = "";
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
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
        pages: document.numPages,
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
