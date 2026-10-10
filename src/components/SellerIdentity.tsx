/**
 * THE SELLER'S NAME AND POSTAL ADDRESS (commercial-readiness plan item 10).
 * Renders nothing until both are set in src/config/seller.ts; never an
 * invented identity.
 */
import { useTranslation } from "react-i18next";
import { sellerIdentity } from "@/config/seller";
import { cn } from "@/lib/utils";

type Props = {
  /** soldBy beside a buy button and in the footer; terms on /terms; controller on /privacy. */
  variant: "soldBy" | "terms" | "controller";
  className?: string;
};

export function SellerIdentity({ variant, className }: Props) {
  const { t } = useTranslation();
  const id = sellerIdentity();
  if (!id) return null;
  return (
    <p className={cn(className)} data-testid="seller-identity">
      {t(`seller.${variant}`, { name: id.legalName, address: id.postalAddress })}
    </p>
  );
}
