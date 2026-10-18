/**
 * NOT YET SOLD IN THE EU, THE EEA, THE UK OR INDIA, SAID BEFORE THE PRESS
 * (S12-059; India by owner decision 2026-10-17).
 *
 * While the EU/UK switch is off the checkouts refuse a buyer there
 * (supabase/functions/_shared/sales-territory.ts). A browser whose time zone
 * is one of theirs sees this line where it would buy, so nobody fills in
 * Stripe's page to be refused. It says what the page checked (the browser's
 * time zone), because that is all it checked: the server's own refusal names
 * its signal (the currency, the time zone or the address lookup). It
 * disappears the moment the server says the switch is on (purchase-terms.ts
 * asks create-checkout once).
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { inSalesTerritory } from "@/lib/checkout-territory";
import { askServerForEuUkSwitch, useEuUkBoxShown } from "@/lib/purchase-terms";

/** True when this browser should see the notice instead of a buy button. */
export function useRegionRefused(): boolean {
  const switchOn = useEuUkBoxShown();
  useEffect(() => { askServerForEuUkSwitch(); }, []);
  return !switchOn && inSalesTerritory();
}

export function RegionNotice({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p role="note" data-region-notice className={cn("flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground", className)}>
      <Globe className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        {t("checkoutGate.regionNoticeTimeZone", "Your browser's time zone is in the EU, the EEA, the UK or India, where we don't sell yet: sales there wait until our tax registration there is settled. Searching jobs and the free scan work everywhere.")}
      </span>
    </p>
  );
}
