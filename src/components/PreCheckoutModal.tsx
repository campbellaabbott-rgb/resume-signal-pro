import { useState } from "react";
import { useTranslation } from "react-i18next";
import { 
  CheckCircle2, Lock, Shield, CreditCard, Zap, 
  FileText, Target, ArrowRight, X, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrency } from "@/hooks/use-currency";

interface PreCheckoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isLoading?: boolean;
  atsScore?: number;
}

export function PreCheckoutModal({ 
  open, 
  onOpenChange, 
  onConfirm, 
  isLoading,
  atsScore 
}: PreCheckoutModalProps) {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  
  const priceDisplay = isLocalCurrency ? `$25 ≈ ${formatPrice(25)}` : '$25';
  const potentialIncrease = atsScore ? Math.min(95, atsScore + 25) - atsScore : 20;

  const features = [
    { icon: FileText, text: "Complete ATS score breakdown with fixes" },
    { icon: Zap, text: "AI-powered bullet point rewrites" },
    { icon: Target, text: "Industry-specific keyword optimization" },
    { icon: Star, text: "Recruiter-approved formatting tips" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        {/* Header with gradient */}
        <div className="bg-gradient-to-br from-primary/20 via-primary/10 to-background p-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-center">
              Ready to Get Interview-Ready?
            </DialogTitle>
          </DialogHeader>
          
          {/* Score improvement preview */}
          {atsScore && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-destructive">{atsScore}</div>
                <div className="text-xs text-muted-foreground">Current</div>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
              <div className="text-center">
                <div className="text-2xl font-bold text-success">{Math.min(95, atsScore + potentialIncrease)}+</div>
                <div className="text-xs text-muted-foreground">Potential</div>
              </div>
            </div>
          )}
        </div>

        {/* Features list */}
        <div className="p-6 pt-4 space-y-4">
          <div className="space-y-3">
            {features.map((feature, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                  <feature.icon className="w-4 h-4 text-success" />
                </div>
                <span className="text-sm text-foreground">{feature.text}</span>
              </div>
            ))}
          </div>

          {/* Price box */}
          <div className="p-4 rounded-xl bg-muted/50 border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">Full Resume Analysis</span>
              <span className="text-xl font-bold text-primary">{priceDisplay}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3 h-3 text-success" />
              <span>One-time payment • Instant access • Keep forever</span>
            </div>
          </div>

          {/* CTA Button */}
          <Button 
            onClick={onConfirm}
            disabled={isLoading}
            size="lg"
            className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/25"
          >
            {isLoading ? (
              "Processing..."
            ) : (
              <>
                Continue to Secure Checkout
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-4 pt-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="w-3 h-3" />
              <span>SSL Encrypted</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Shield className="w-3 h-3" />
              <span>Secure Payment</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CreditCard className="w-3 h-3" />
              <span>Stripe</span>
            </div>
          </div>

          {/* Money back note */}
          <p className="text-center text-xs text-muted-foreground">
            💰 One interview = your investment paid back 10x
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
