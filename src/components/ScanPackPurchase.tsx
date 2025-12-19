import { useState } from "react";
import { Package, Zap, CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useScanCredits } from "@/hooks/use-scan-credits";

export interface ScanPackPurchaseProps {
  onClose?: () => void;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ScanPackPurchase({ onClose, className, open, onOpenChange }: ScanPackPurchaseProps) {
  const [email, setEmail] = useState("");
  const { purchaseScanPack, isLoading, creditsPerPack, packPrice } = useScanCredits();

  const handlePurchase = async () => {
    if (!email || !email.includes('@')) return;
    await purchaseScanPack(email);
  };

  const isValidEmail = email.includes('@') && email.includes('.');

  const content = (
    <div className={`bg-card border border-border rounded-2xl p-6 ${className || ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-full bg-primary/10">
          <Package className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">$10 for 30 Scans</h3>
          <p className="text-sm text-muted-foreground">Up to 7 scans free daily • Need more? Buy a pack!</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* What you get */}
        <div className="bg-secondary/30 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-2xl font-bold">${packPrice}</span>
            <span className="text-sm text-muted-foreground">one-time</span>
          </div>
          
          <ul className="space-y-2">
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span><strong>{creditsPerPack} resume scans</strong></span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span>Unlimited job description comparisons</span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span>No daily limits on purchased scans</span>
            </li>
            <li className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span>Credits never expire</span>
            </li>
          </ul>
        </div>

        {/* Email input */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Email to receive credits
          </label>
          <Input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">
            Credits are tied to your email address
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
            "Processing..."
          ) : (
            <>
              <Zap className="w-4 h-4 mr-2" />
              Get {creditsPerPack} Scans for ${packPrice}
            </>
          )}
        </Button>

        {onClose && !onOpenChange && (
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-full"
          >
            Maybe later
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
            <DialogTitle>Buy Scan Credits</DialogTitle>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  // Otherwise render inline
  return content;
}
