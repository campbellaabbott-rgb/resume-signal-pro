import { useState } from "react";
import { Coins, Zap, X, Mail, CheckCircle2, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScanCredits } from "@/hooks/use-scan-credits";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";

interface RateLimitUpselProps {
  onClose: () => void;
}

const PRESET_AMOUNTS = [5, 10, 20];

export function RateLimitUpsell({ onClose }: RateLimitUpselProps) {
  const [email, setEmail] = useState("");
  const [creditAmount, setCreditAmount] = useState(10);
  const { purchaseCredits, isLoading, pricePerCredit } = useScanCredits();
  const { trackButtonClick, trackCheckoutInitiated } = useConversionTracking();

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl p-6 shadow-2xl animate-slide-up">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-secondary/50 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-primary/10 mb-4">
            <Coins className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold mb-2">Daily Free Scans Used</h2>
          <p className="text-muted-foreground">
            You've used all 7 free scans today. Top up credits instantly!
          </p>
        </div>

        {/* Credit amount selector */}
        <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl p-4 mb-6 border border-primary/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Credits to buy</span>
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
            <span className="text-sm text-muted-foreground">Total (${pricePerCredit.toFixed(2)}/credit)</span>
            <span className="text-2xl font-bold">${totalPrice.toFixed(2)}</span>
          </div>
        </div>

        {/* Benefits */}
        <ul className="space-y-2 mb-4">
          <li className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <span><strong>{creditAmount} resume scan{creditAmount !== 1 ? 's' : ''}</strong></span>
          </li>
          <li className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <span>Credits never expire</span>
          </li>
        </ul>

        {/* Email input */}
        <div className="space-y-3 mb-4">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
            />
          </div>
        </div>

        {/* Purchase button */}
        <Button
          onClick={handlePurchase}
          disabled={!isValidEmail || isLoading}
          className="w-full h-12 text-base"
          size="lg"
        >
          {isLoading ? (
            "Processing..."
          ) : (
            <>
              <Zap className="w-4 h-4 mr-2" />
              Buy {creditAmount} Credit{creditAmount !== 1 ? 's' : ''} for ${totalPrice}
            </>
          )}
        </Button>

        {/* Alternative */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          Or wait until tomorrow for 7 more free scans
        </p>
      </div>
    </div>
  );
}
