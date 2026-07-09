import { ProductId } from "./products";

// Products that support a free "preview-before-pay" slice. Must stay in sync
// with the PREVIEW_SPECS map in supabase/functions/generate-product-preview.
// scanPack is intentionally excluded — it sells scan credits, there is no
// deliverable to preview.
export const PREVIEWABLE_PRODUCTS: ProductId[] = [
  "fullAnalysis",
  "interviewCoach",
  "careerPathSimulator",
  "basicKeywordFix",
  "coverLetter",
  "premiumPackage",
  "atsDefense",
  "careerSnapshot",
  "graduateGamePlan",
  "applyAssistant",
  "freelanceBoost",
  "freelanceTransitionPro",
];

export function isPreviewable(id: ProductId): boolean {
  return PREVIEWABLE_PRODUCTS.includes(id);
}
