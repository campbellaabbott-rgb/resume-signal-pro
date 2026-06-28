import { useState } from "react";
import { Coins, CheckCircle2, Mail, Plus, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useScanCredits } from "@/hooks/use-scan-credits";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";
import { useCurrency } from "@/hooks/use-currency";

export interface ScanPackPurchaseProps {
  onClose?: () => void;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const PRESET_AMOUNTS = [5, 10, 20, 50];

export function ScanPackPurchase({ onClose, className, open, onOpenChange }: ScanPackPurchaseProps) {
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
    trackButtonClick('scan_credits_variable', 'scan_pack_dialog');
    trackCheckoutInitiated('scan_credits_variable', creditAmount * pricePerCredit);
    
    await purchaseCredits(email, creditAmount);
  };

  const adjustAmount = (delta: number) => {
    setCreditAmount(prev => Math.max(1, Math.min(100, prev + delta)));
  };

  const isValidEmail = email.includes('@') && email.includes('.');
  const totalPrice = creditAmount * pricePerCredit;

  const content = (
    <div className={`bg-card border border-border rounded-2xl p-6 ${className || ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-full bg-primary/10">
          <Coins className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">{t('scanPackPurchase.topUpCredits')}</h3>
          <p className="text-sm text-muted-foreground">{t('scanPackPurchase.perCreditUseAnytime', { price: formatLocalPrice(pricePerCredit) })}</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Credit amount selector */}
        <div className="bg-secondary/30 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium">{t('scanPackPurchase.creditsToBuy')}</span>
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
          <div className="flex gap-2 mb-4">
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
            <span className="text-sm text-muted-foreground">{t('scanPackPurchase.total')}</span>
            <div className="text-right">
              <span className="text-2xl font-bold">${totalPrice.toFixed(2)}</span>
              {isLocalCurrency && (
                <p className="text-xs text-muted-foreground">{formatPrice(totalPrice)}</p>
              )}
            </div>
          </div>
        </div>

        {/* What you get */}
        <ul className="space-y-2">
          <li className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <span><strong>{t('scanPackPurchase.resumeScans', { count: creditAmount })}</strong></span>
          </li>
          <li className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <span>{t('scanPackPurchase.unlimitedComparisons')}</span>
          </li>
          <li className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <span>{t('scanPackPurchase.creditsNeverExpire')}</span>
          </li>
        </ul>

        {/* Email input */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Mail className="w-4 h-4" />
            {t('scanPackPurchase.emailToReceive')}
          </label>
          <Input
            type="email"
            placeholder={t('scanPackPurchase.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">
            {t('scanPackPurchase.creditsTiedToEmail')}
          </p>
        </div>

        {/* Purchase button */}
        <Button
          onClick={handlePurchase}
          disabled={!isValidEmail || isLoading}
          className="w-full h-12 text-base"
          size="lg"
        >
          {isLoading ? (
            t('scanPackPurchase.processing')
          ) : (
            <>
              <Coins className="w-4 h-4 mr-2" />
              {t('scanPackPurchase.buyCreditsFor', { count: creditAmount, price: formatLocalPrice(totalPrice) })}
            </>
          )}
        </Button>

        {onClose && !onOpenChange && (
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-full"
          >
            {t('scanPackPurchase.maybeLater')}
          </Button>
        )}
      </div>
    </div>
  );

  // If open/onOpenChange are provided, render as a dialog
  if (open !== undefined && onOpenChange) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md p-0 border-0 bg-transparent">
          <DialogHeader className="sr-only">
            <DialogTitle>{t('scanPackPurchase.dialogTitle')}</DialogTitle>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  // Otherwise render inline
  return content;
}
