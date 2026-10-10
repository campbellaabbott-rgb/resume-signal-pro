import { useTranslation } from "react-i18next";
import { sellerIdentity, SELLER } from "@/config/seller";

/**
 * The seller's name and postal address in the footer, the Terms and the
 * Privacy policy, from the one constant in src/config/seller.ts. Renders
 * NOTHING while that constant is empty: an identity the owner has not chosen
 * is never invented.
 */
export function SellerIdentity({
  variant,
  seller = SELLER,
  className,
}: {
  variant: "footer" | "terms" | "privacy";
  seller?: { legalName: string; postalAddress: string };
  className?: string;
}) {
  const { t } = useTranslation();
  const id = sellerIdentity(seller);
  if (!id) return null;
  const vars = { name: id.legalName, address: id.postalAddress };
  const text = variant === "footer"
    ? t("seller.soldBy", { defaultValue: "Sold by {{name}}, {{address}}.", ...vars })
    : variant === "terms"
      ? t("seller.termsParty", { defaultValue: "These Terms are an agreement between you and {{name}}, {{address}}.", ...vars })
      : t("seller.controller", { defaultValue: "The controller of your personal data is {{name}}, {{address}}.", ...vars });
  return <p className={className} data-testid={`seller-${variant}`}>{text}</p>;
}
