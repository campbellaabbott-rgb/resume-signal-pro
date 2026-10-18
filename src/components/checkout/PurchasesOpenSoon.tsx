/**
 * WHERE A BUY BUTTON WOULD BE, WHILE PURCHASES ARE NOT OPEN (owner decision
 * 2026-10-17). The seller's legal name and postal address must show before
 * anyone pays (B&P 17538(d)); until src/config/seller.ts carries both, the
 * pages render this line instead of the Full Analysis and Pro buttons
 * (src/lib/purchases-open.ts).
 */
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export function PurchasesOpenSoon({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p role="note" data-purchases-open-soon className={cn("flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground", className)}>
      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        {t("checkoutGate.purchasesOpenSoon", "Purchases open soon. Searching jobs, the free scan and a free account work now.")}
      </span>
    </p>
  );
}
