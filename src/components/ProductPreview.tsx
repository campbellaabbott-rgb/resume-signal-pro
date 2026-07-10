import { useTranslation } from "react-i18next";
import { Sparkles, ArrowRight, Loader2, Lock, RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PRODUCTS, ProductId } from "@/config/products";
import { isPreviewable } from "@/config/product-previews";
import { useProductPreview } from "@/hooks/use-product-preview";
import { useProductCheckout } from "@/hooks/use-product-checkout";
import { useCurrency } from "@/hooks/use-currency";

interface ProductPreviewProps {
  productId: ProductId;
  resumeText?: string | null;
  industry?: string;
  jobDescription?: string;
  sessionId?: string;
  className?: string;
}

// Preview-before-pay: a "see a real sample from your résumé" button that
// generates one genuine slice of the paid deliverable, then paywalls the rest.
// Renders nothing unless the product is previewable AND a resume is available.
export function ProductPreview({
  productId,
  resumeText,
  industry,
  jobDescription,
  sessionId,
  className,
}: ProductPreviewProps) {
  const { t } = useTranslation();
  const { formatPrice } = useCurrency();
  const { generate, reset, isLoading, preview, error } = useProductPreview();
  const { purchaseProduct, isLoading: isCheckingOut } = useProductCheckout();

  const product = PRODUCTS[productId];
  const hasResume = !!resumeText && resumeText.trim().length >= 100;

  if (!product || !isPreviewable(productId) || !hasResume) return null;

  const runGenerate = () =>
    generate(productId, resumeText as string, { industry, jobDescription });

  const buy = () => {
    // fullAnalysis has no entry in create-product-checkout's product map — it
    // sells through the main scan flow. Without this branch the unlock button
    // 400s ("Invalid product selected"). Mirrors Pricing.tsx's handlePurchase.
    if ("useMainCheckout" in product && product.useMainCheckout) {
      window.location.href = "/#upload";
      return;
    }
    purchaseProduct(productId, { sessionId, ctaSection: "product_preview" });
  };

  // Idle state — the entry-point button.
  if (!preview && !isLoading && !error) {
    return (
      <button
        type="button"
        onClick={runGenerate}
        className={cn(
          "group inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline",
          className,
        )}
      >
        <Sparkles className="w-4 h-4" />
        {t("productPreview.seeSample")}
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    );
  }

  if (isLoading) {
    return (
      <div className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("productPreview.generating")}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("text-sm", className)}>
        <p className="text-muted-foreground mb-2">{t("productPreview.error")}</p>
        <button type="button" onClick={runGenerate} className="text-primary hover:underline font-medium">
          {t("productPreview.tryAgain")}
        </button>
      </div>
    );
  }

  const isDiff = preview!.kind === "diff" && preview!.before;
  const features = product.features.slice(0, 4);

  return (
    <div
      className={cn(
        "rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5 p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <Badge variant="secondary" className="text-xs gap-1">
          <Sparkles className="w-3 h-3" />
          {t("productPreview.previewBadge")}
        </Badge>
        <span className="text-sm font-semibold text-foreground">{preview!.heading}</span>
      </div>

      {/* The generated slice */}
      {isDiff ? (
        <div className="space-y-2 mb-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              {t("productPreview.beforeLabel")}
            </p>
            <p className="text-sm text-muted-foreground line-through decoration-destructive/40">
              {preview!.before}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-primary mb-1">
              {t("productPreview.afterLabel")}
            </p>
            <p className="text-sm font-medium text-foreground rounded-lg bg-primary/10 px-3 py-2">
              {preview!.body}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-foreground rounded-lg bg-primary/10 px-3 py-2 mb-3 whitespace-pre-line">
          {preview!.body}
        </p>
      )}

      {preview!.note && (
        <p className="text-xs text-muted-foreground italic mb-4">{preview!.note}</p>
      )}

      {/* Paywall */}
      <div className="border-t border-border/60 pt-3">
        <p className="text-xs font-semibold text-foreground mb-2">
          {t("productPreview.fullIncludes", { name: product.name })}
        </p>
        <ul className="space-y-1 mb-4">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check className="w-3 h-3 text-primary mt-0.5 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <Button onClick={buy} disabled={isCheckingOut} size="sm" className="gap-2">
            <Lock className="w-3.5 h-3.5" />
            {t("productPreview.unlockCta", { name: product.name, price: formatPrice(product.priceUsd) })}
          </Button>
          <button
            type="button"
            onClick={() => {
              reset();
              runGenerate();
            }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-3 h-3" />
            {t("productPreview.tryAnother")}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">{t("productPreview.guarantee", "Not happy with the output? Free regeneration or refund.")}</p>
      </div>
    </div>
  );
}
