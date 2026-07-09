import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PRODUCTS, ProductId } from "@/config/products";

export interface ProductPreviewData {
  productId: string;
  kind: string;
  label: string;
  heading: string;
  body: string;
  before: string | null;
  note: string | null;
}

interface GenerateOptions {
  industry?: string;
  jobDescription?: string;
}

// Calls the generate-product-preview edge function to fetch one real slice of a
// paid product's deliverable, built from the user's resume. On-demand only.
export function useProductPreview() {
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<ProductPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (productId: ProductId, resumeText: string, opts: GenerateOptions = {}) => {
      const product = PRODUCTS[productId];
      if (!product || !resumeText || resumeText.trim().length < 100) {
        setError("A resume is required to generate a preview.");
        return null;
      }

      setIsLoading(true);
      setError(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "generate-product-preview",
          {
            body: {
              productId: product.id, // snake_case id the function keys on
              resumeText,
              industry: opts.industry,
              jobDescription: opts.jobDescription,
              language: localStorage.getItem("i18nextLng") || "en",
              honeypot: "",
            },
          },
        );

        if (fnError || !data?.success || !data?.preview) {
          setError("Couldn't generate a sample right now. Please try again.");
          return null;
        }

        setPreview(data.preview as ProductPreviewData);
        return data.preview as ProductPreviewData;
      } catch {
        setError("Couldn't generate a sample right now. Please try again.");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  return { generate, reset, isLoading, preview, error };
}
