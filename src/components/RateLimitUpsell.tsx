import { useState } from "react";
import { Coins, Zap, X, Mail, CheckCircle2, Plus, Minus, Clock, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScanCredits } from "@/hooks/use-scan-credits";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";
import { useCurrency } from "@/hooks/use-currency";

interface RateLimitUpselProps {
  onClose: () => void;
}

const PRESET_AMOUNTS = [5, 10, 20];

export function RateLimitUpsell({ onClose }: RateLimitUpselProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [creditAmount, setCreditAmount] = useState(10);
  const { purchaseCredits, isLoading, pricePerCredit } = useScanCredits();
  const { trackButtonClick, trackCheckoutInitiated } = useConversionTracking();
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
    trackCheckoutInitiated('scan_credits_variable', creditAmount * pricePerCredit);
    
    await purchaseCredits(email, creditAmount);
  };

  const adjustAmount = (delta: number) => {
    setCreditAmount(prev => Math.max(1, Math.min(100, prev + delta)));
  };

  const isValidEmail = email.includes('@') && email.includes('.');
  const totalPrice = creditAmount * pricePerCredit;

  // Calculate time until reset (midnight local time)
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const hoursUntilReset = Math.ceil((midnight.getTime() - now.getTime()) / (1000 * 60 * 60));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl animate-slide-up overflow-hidden">
        {/* Error Banner - Prominent and clear */}
        <div className="bg-gradient-to-r from-amber-500/90 to-orange-500/90 px-6 py-4 text-white">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-white/20 rounded-full shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg">{t('rateLimitUpsell.title')}</h2>
              <p className="text-white/90 text-sm mt-1">
                {t('rateLimitUpsell.subtitle')}
              </p>
            </div>
          </div>
        </div>
        
        <div className="p-6">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white rounded-full hover:bg-white/10 transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>

          {/* Reset timer info */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6 bg-secondary/50 rounded-lg px-4 py-3">
            <Clock className="w-4 h-4 shrink-0" />
            <span>
              {t('rateLimitUpsell.resetIn')} <strong className="text-foreground">{t('rateLimitUpsell.hour', { count: hoursUntilReset })}</strong>
            </span>
          </div>

          {/* Credit amount selector */}
          <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl p-4 mb-6 border border-primary/20">
            <div className="flex items-center gap-2 mb-3">
              <Coins className="w-5 h-5 text-primary" />
              <span className="font-semibold">{t('rateLimitUpsell.getMoreScans')}</span>
            </div>

            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">{t('rateLimitUpsell.howManyCredits')}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => adjustAmount(-1)}
                  disabled={creditAmount <= 1}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  className="w-16 h-8 text-center"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => adjustAmount(1)}
                  disabled={creditAmount >= 100}
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
                placeholder={t('rateLimitUpsell.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-12"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('rateLimitUpsell.creditsLinkedToEmail')}</p>
          </div>

          {/* Purchase button */}
          <Button
            onClick={handlePurchase}
            disabled={!isValidEmail || isLoading}
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
      </div>
    </div>
  );
}
