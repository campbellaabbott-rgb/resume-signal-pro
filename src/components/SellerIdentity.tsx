/**
 * THE SELLER'S NAME AND POSTAL ADDRESS (commercial-readiness plan item 10).
 * Renders nothing until both are set in src/config/seller.ts; never an
 * invented identity.
 *
 * Variants (wave 3: payments-account named them soldBy/terms/controller,
 * seo-content footer/terms/privacy; both spellings render the same line):
 *   soldBy | footer   beside a buy button and in the footer
 *   terms             the party on /terms
 *   controller | privacy   the controller on /privacy
 */
import { useTranslation } from "react-i18next";
import { SELLER, sellerIdentity, type SellerIdentity as Identity } from "@/config/seller";
import { cn } from "@/lib/utils";

type Props = {
  variant: "soldBy" | "footer" | "terms" | "controller" | "privacy";
  /** A stand-in identity (tests); the shipped constant otherwise. */
  seller?: Identity;
  className?: string;
};

export function SellerIdentity({ variant, seller = SELLER, className }: Props) {
  const { t } = useTranslation();
  const id = sellerIdentity(seller);
  if (!id) return null;
  const vars = { name: id.legalName, address: id.postalAddress };
  const text = variant === "soldBy" || variant === "footer"
    ? t("seller.soldBy", { defaultValue: "Sold by {{name}}, {{address}}.", ...vars })
    : variant === "terms"
      ? t("seller.terms", { defaultValue: "These Terms are an agreement between you and {{name}}, {{address}}.", ...vars })
      : t("seller.controller", { defaultValue: "The controller of your personal data is {{name}}, {{address}}.", ...vars });
  return (
    <p className={cn(className)} data-testid="seller-identity" data-variant={variant}>
      {text}
    </p>
  );
}
