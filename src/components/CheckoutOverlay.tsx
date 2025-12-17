import { Loader2 } from "lucide-react";

interface CheckoutOverlayProps {
  isVisible: boolean;
}

export function CheckoutOverlay({ isVisible }: CheckoutOverlayProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="text-center space-y-4 p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-foreground">
            Preparing Secure Checkout
          </h3>
          <p className="text-muted-foreground max-w-sm">
            You'll be redirected to Stripe's secure payment page in a moment...
          </p>
        </div>
      </div>
    </div>
  );
}
