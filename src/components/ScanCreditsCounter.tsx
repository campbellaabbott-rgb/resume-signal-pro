import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Coins, ChevronDown, Plus, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useScanCredits, CREDITS_UPDATED_EVENT } from "@/hooks/use-scan-credits";
import { ScanPackPurchase } from "@/components/ScanPackPurchase";
import { useCurrency } from "@/hooks/use-currency";
import { supabase } from "@/integrations/supabase/client";

/**
 * THE HEADER'S CREDIT BALANCE: ONLY WHAT THIS BROWSER CAN PROVE.
 *
 * This widget used to take any typed email and show that address's balance
 * (and remember it, so every later scan spent that address's credits): an
 * open door to anyone's purchase (defect sweep 1.26 / 2.07). It now shows the
 * balance the scan-credits function answers for the signed-in account plus
 * the purchases whose Stripe session this browser kept at checkout. Credits
 * bought elsewhere are used by signing in with the purchase email.
 */
export function ScanCreditsCounter() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const { credits, email, signedIn, known, refreshCredits, pricePerCredit } = useScanCredits();
  const { formatPrice, isLocalCurrency } = useCurrency();

  const formatLocalPrice = (usd: number) => {
    if (isLocalCurrency) {
      return `$${usd.toFixed(2)} (${formatPrice(usd)})`;
    }
    return `$${usd.toFixed(2)}`;
  };

  // Read on mount, after a purchase or a scan that spent a credit (the event),
  // and when the visitor signs in or out (the account's pool joins or leaves).
  useEffect(() => {
    refreshCredits();
    const onUpdated = () => { refreshCredits(); };
    window.addEventListener(CREDITS_UPDATED_EVENT, onUpdated);
    // The header mounts on every page, including pages rendered without an
    // auth client (tests, a failed client init): the balance then simply
    // does not follow sign-in until the next page load.
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") refreshCredits();
      });
      unsubscribe = () => data?.subscription?.unsubscribe();
    } catch { /* no auth client */ }
    return () => {
      window.removeEventListener(CREDITS_UPDATED_EVENT, onUpdated);
      unsubscribe?.();
    };
  }, [refreshCredits]);

  // A proven balance: show the counter badge
  if (known && credits > 0) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 min-h-[44px] touch-manipulation bg-success/10 border-success/30 hover:bg-success/20"
          >
            <Coins className="w-4 h-4 text-success" />
            <span className="font-semibold text-success">{credits}</span>
            <span className="text-muted-foreground hidden sm:inline">{t("scanCredits.credits")}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-4" align="end">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-success/10">
                <Coins className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="font-semibold">{t("scanCredits.yourScanCredits")}</p>
                {email && <p className="text-sm text-muted-foreground">{email}</p>}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-secondary/50 text-center">
              <p className="text-3xl font-bold text-success">{credits}</p>
              <p className="text-sm text-muted-foreground">{t("scanCredits.creditsRemaining")}</p>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {t("scanCredits.neverExpire")} • {t("scanCredits.perCredit", { price: formatLocalPrice(pricePerCredit) })}
            </p>

            <Button
              onClick={() => {
                setShowPurchase(true);
                setIsOpen(false);
              }}
              size="sm"
              className="w-full gap-2"
            >
              <Plus className="w-4 h-4" />
              {t("scanCredits.topUpCredits")}
            </Button>

            {!signedIn && (
              <p className="text-xs text-muted-foreground text-center">
                {t("scanCredits.signInHint")}{" "}
                <Link to="/auth" className="text-primary hover:underline" onClick={() => setIsOpen(false)}>
                  {t("scanCredits.signIn")}
                </Link>
              </p>
            )}
          </div>

          <ScanPackPurchase
            open={showPurchase}
            onOpenChange={setShowPurchase}
          />
        </PopoverContent>
      </Popover>
    );
  }

  // No proven balance: explain where credits show up, and offer sign-in and purchase
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 min-h-[44px] touch-manipulation text-muted-foreground hover:text-foreground"
        >
          <Coins className="w-4 h-4" />
          <span className="hidden sm:inline">{t("scanCredits.myCredits")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-1">{t("scanCredits.yourScanCredits")}</h4>
            <p className="text-sm text-muted-foreground">
              {known ? t("scanCredits.noCreditsHere") : t("scanCredits.provenHint")}
            </p>
          </div>

          {!signedIn && (
            <div className="p-3 rounded-lg bg-muted/50 space-y-2">
              <p className="text-xs text-muted-foreground">{t("scanCredits.signInHint")}</p>
              <Button asChild variant="outline" size="sm" className="w-full gap-2">
                <Link to="/auth" onClick={() => setIsOpen(false)}>
                  <LogIn className="w-4 h-4" />
                  {t("scanCredits.signIn")}
                </Link>
              </Button>
            </div>
          )}

          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("scanCredits.freeTier")}
            </p>
            <Button
              onClick={() => {
                setShowPurchase(true);
                setIsOpen(false);
              }}
              variant="outline"
              size="sm"
              className="w-full gap-2"
            >
              <Plus className="w-4 h-4" />
              {t("scanCredits.buyCredits", { price: formatLocalPrice(pricePerCredit) })}
            </Button>
          </div>
        </div>

        <ScanPackPurchase
          open={showPurchase}
          onOpenChange={setShowPurchase}
        />
      </PopoverContent>
    </Popover>
  );
}
