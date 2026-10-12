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
import { useScanCredits, CREDITS_UPDATED_EVENT, legacyCreditsEmail } from "@/hooks/use-scan-credits";
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
 * the purchases whose Stripe session this browser kept at checkout (a
 * purchase follows the account once a signed-in browser holding it has
 * shown it). A buyer from before browsers kept purchases has only the address
 * they typed here; nothing proves it, so they are told how to get their
 * credits added rather than that they have none.
 */
const SUPPORT_EMAIL = "resumeboostersupp@gmail.com";

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
            variant="secondary"
            size="sm"
            className="gap-1.5 px-2.5"
          >
            <Coins aria-hidden="true" className="w-4 h-4 text-muted-foreground" />
            {/* Named at every width: "My credits: 5 credits" (header.credits). */}
            <span className="sr-only">{t("header.credits", "My credits")}: </span>
            <span className="font-semibold text-foreground">{credits}</span>
            <span className="sr-only xl:not-sr-only text-muted-foreground">{t("scanCredits.credits")}</span>
            <ChevronDown aria-hidden="true" className="w-3 h-3 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-4" align="end">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-muted">
                <Coins aria-hidden="true" className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold">{t("scanCredits.yourScanCredits")}</p>
                {email && <p className="text-sm text-muted-foreground">{email}</p>}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted text-center">
              <p className="text-3xl font-semibold text-foreground">{credits}</p>
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
                <Link to="/auth" className="link" onClick={() => setIsOpen(false)}>
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
  const legacyEmail = legacyCreditsEmail();
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
        >
          <Coins aria-hidden="true" className="w-4 h-4" />
          {/* An icon button under xl, with its name kept for screen readers
              (the audit found it unnamed on phones, WCAG 4.1.2). */}
          <span className="sr-only xl:not-sr-only">{t("header.credits", "My credits")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-1">{t("scanCredits.yourScanCredits")}</h4>
            <p className="text-sm text-muted-foreground">
              {known ? t("scanCredits.noCreditsHere") : t("scanCredits.provenHint")}
            </p>
            {known && legacyEmail && (
              <p className="text-sm text-muted-foreground mt-2" data-testid="legacy-credits-hint">
                {t("scanCredits.legacyHint", { email: legacyEmail, support: SUPPORT_EMAIL })}
              </p>
            )}
          </div>

          {!signedIn && (
            <div className="p-3 rounded-lg bg-muted space-y-2">
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
