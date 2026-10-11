import { useState } from "react";
import { Coins, Zap, Mail, CheckCircle2, Plus, Minus, Clock, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScanCredits } from "@/hooks/use-scan-credits";
import { clampScanCredits, MAX_SCAN_CREDITS, MIN_SCAN_CREDITS } from "@/config/scan-credits";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";
import { useCurrency } from "@/hooks/use-currency";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PurchaseTerms } from "@/components/PurchaseTerms";

interface RateLimitUpselProps {
  onClose: () => void;
  /**
   * Hours until the daily limit resets, AS THE SERVER COUNTS THEM (its
   * rolling window), or null when the answer did not say: then no reset time
   * is printed rather than a guessed one (S8-119).
   */
  resetHours?: number | null;
}

const PRESET_AMOUNTS = [5, 10, 20];

/**
 * The scan-credit offer shown when the daily free scans run out. A Radix
 * dialog (S8-119): it was a plain fixed div after the footer, with no dialog
 * role, no focus handling and no Escape, and its stepper and amount field had
 * no labels.
 */
export function RateLimitUpsell({ onClose, resetHours = null }: RateLimitUpselProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [creditAmount, setCreditAmount] = useState(10);
  const { purchaseCredits, isLoading, pricePerCredit } = useScanCredits();
  const { trackButtonClick } = useConversionTracking();
  const { formatPrice, isLocalCurrency } = useCurrency();
  
  const formatLocalPrice = (usd: number) => {
    if (isLocalCurrency) {
      return `$${usd.toFixed(2)} (${formatPrice(usd)})`;
    }
    return `$${usd.toFixed(2)}`;
  };

  const handlePurchase = async () => {
    if (!email || !email.includes('@')) return;
    
    // Track conversion events
    trackButtonClick('scan_credits_variable', 'rate_limit_upsell');
    
    await purchaseCredits(email, clampScanCredits(creditAmount));
  };

  const adjustAmount = (delta: number) => {
    setCreditAmount(prev => clampScanCredits(prev + delta));
  };

  const isValidEmail = email.includes('@') && email.includes('.');
  const totalPrice = creditAmount * pricePerCredit;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-full max-w-md p-0 gap-0 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Error Banner - Prominent and clear */}
        <div className="bg-gradient-to-r from-amber-500/90 to-orange-500/90 px-6 py-4 text-white">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-white/20 rounded-full shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-bold text-lg">{t('rateLimitUpsell.title')}</DialogTitle>
              <DialogDescription className="text-white/90 text-sm mt-1">
                {t('rateLimitUpsell.subtitle')}
              </DialogDescription>
            </div>
          </div>
        </div>
        
        <div className="p-6">
          {/* Reset timer info: the server's count, or nothing. */}
          {resetHours !== null && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6 bg-secondary/50 rounded-lg px-4 py-3">
              <Clock className="w-4 h-4 shrink-0" />
              <span>
                {t('rateLimitUpsell.resetIn')} <strong className="text-foreground">{t('rateLimitUpsell.hour', { count: resetHours })}</strong>
              </span>
            </div>
          )}

          {/* Credit amount selector */}
          <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl p-4 mb-6 border border-primary/20">
            <div className="flex items-center gap-2 mb-3">
              <Coins className="w-5 h-5 text-primary" />
              <span className="font-semibold">{t('rateLimitUpsell.getMoreScans')}</span>
            </div>

            <div className="flex items-center justify-between mb-3">
              <label htmlFor="rate-limit-credit-amount" className="text-sm text-muted-foreground">{t('rateLimitUpsell.howManyCredits')}</label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => adjustAmount(-1)}
                  disabled={creditAmount <= MIN_SCAN_CREDITS}
                  aria-label={t('rateLimitUpsell.fewerCredits')}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  id="rate-limit-credit-amount"
                  type="number"
                  min={MIN_SCAN_CREDITS}
                  max={MAX_SCAN_CREDITS}
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(Math.min(MAX_SCAN_CREDITS, Math.max(0, parseInt(e.target.value) || 0)))}
                  onBlur={() => setCreditAmount((c) => clampScanCredits(c))}
                  className="w-16 h-8 text-center"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => adjustAmount(1)}
                  disabled={creditAmount >= MAX_SCAN_CREDITS}
                  aria-label={t('rateLimitUpsell.moreCredits')}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Preset amounts */}
            <div className="flex gap-2 mb-3">
              {PRESET_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  variant={creditAmount === amount ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setCreditAmount(amount)}
                >
                  {amount}
                </Button>
              ))}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border/50">
              <span className="text-sm text-muted-foreground">{t('rateLimitUpsell.total', { price: formatLocalPrice(pricePerCredit) })}</span>
              <div className="text-right">
                <span className="text-2xl font-bold">${totalPrice.toFixed(2)}</span>
                {isLocalCurrency && (
                  <p className="text-xs text-muted-foreground">{formatPrice(totalPrice)}</p>
                )}
              </div>
            </div>
          </div>

          {/* Benefits */}
          <ul className="space-y-2 mb-4">
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span><strong>{t('rateLimitUpsell.credits', { count: creditAmount })}</strong> {t('rateLimitUpsell.useAnytime')}</span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span>{t('rateLimitUpsell.neverExpirePrefix')} <strong>{t('rateLimitUpsell.neverExpire')}</strong></span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span>{t('rateLimitUpsell.fullAtsEachScan')}</span>
            </li>
          </ul>

          {/* Email input */}
          <div className="space-y-3 mb-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="email"
                aria-label={t('rateLimitUpsell.emailPlaceholder')}
                placeholder={t('rateLimitUpsell.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-12"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('rateLimitUpsell.creditsLinkedToEmail')}</p>
          </div>

          <PurchaseTerms kind="payment" className="mb-3 text-center" />
          {/* Purchase button */}
          <Button
            onClick={handlePurchase}
            disabled={!isValidEmail || isLoading || creditAmount < MIN_SCAN_CREDITS}
            className="w-full h-12 text-base font-semibold"
            size="lg"
          >
            {isLoading ? (
              t('rateLimitUpsell.processing')
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                {t('rateLimitUpsell.getCreditsFor', { count: creditAmount, price: formatLocalPrice(totalPrice) })}
              </>
            )}
          </Button>

          {/* Alternative */}
          <div className="text-center mt-4 pt-4 border-t border-border/50">
            <button
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('rateLimitUpsell.noThanks')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
