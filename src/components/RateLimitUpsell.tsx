import { useState } from "react";
import { Package, Zap, X, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScanCredits } from "@/hooks/use-scan-credits";

interface RateLimitUpselProps {
  onClose: () => void;
}

export function RateLimitUpsell({ onClose }: RateLimitUpselProps) {
  const [email, setEmail] = useState("");
  const { purchaseScanPack, isLoading, creditsPerPack, packPrice } = useScanCredits();

  const handlePurchase = async () => {
    if (!email || !email.includes('@')) return;
    await purchaseScanPack(email);
  };

  const isValidEmail = email.includes('@') && email.includes('.');

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
            <Package className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold mb-2">Daily Free Scans Used</h2>
          <p className="text-muted-foreground">
            You've used all 7 free scans today. Get more scans instantly!
          </p>
        </div>

        {/* Offer */}
        <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl p-4 mb-6 border border-primary/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-3xl font-bold">${packPrice}</span>
            <span className="text-sm text-muted-foreground">one-time</span>
          </div>
          
          <ul className="space-y-2">
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span><strong>{creditsPerPack} resume scans</strong></span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span>Unlimited job comparisons</span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span>Credits never expire</span>
            </li>
          </ul>
        </div>

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
              Get {creditsPerPack} Scans for ${packPrice}
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
