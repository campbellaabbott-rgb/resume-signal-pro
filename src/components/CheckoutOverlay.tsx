import { Loader2, Check, Wifi, CreditCard, ExternalLink, RefreshCw, Copy, ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export type CheckoutStep = 'verifying' | 'connecting' | 'redirecting';

interface CheckoutOverlayProps {
  isVisible: boolean;
  currentStep?: CheckoutStep;
  error?: string;
  checkoutUrl?: string; // Store the URL for manual fallback
  onRetry?: () => void;
  onClose?: () => void;
}

const steps: { id: CheckoutStep; label: string; icon: React.ElementType }[] = [
  { id: 'verifying', label: 'Verifying your data', icon: Wifi },
  { id: 'connecting', label: 'Connecting to payment', icon: CreditCard },
  { id: 'redirecting', label: 'Redirecting to checkout', icon: ExternalLink },
];

export function CheckoutOverlay({ 
  isVisible, 
  currentStep = 'verifying', 
  error, 
  checkoutUrl,
  onRetry,
  onClose 
}: CheckoutOverlayProps) {
  const [copied, setCopied] = useState(false);

  if (!isVisible) return null;

  const currentStepIndex = steps.findIndex(s => s.id === currentStep);

  const handleCopyLink = async () => {
    if (!checkoutUrl) return;
    try {
      await navigator.clipboard.writeText(checkoutUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text approach
      const textArea = document.createElement('textarea');
      textArea.value = checkoutUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenLink = () => {
    if (!checkoutUrl) return;
    window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
  };

  // Show fallback UI when we have a URL but there's an error (redirect failed)
  const showFallbackOptions = checkoutUrl && error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="text-center space-y-6 p-8 max-w-md">
        {error ? (
          <>
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <span className="text-destructive text-2xl">!</span>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-foreground">
                {showFallbackOptions ? "Redirect Blocked" : "Connection Issue"}
              </h3>
              <p className="text-muted-foreground">
                {showFallbackOptions 
                  ? "Your browser blocked the redirect. Use the options below to complete checkout."
                  : error
                }
              </p>
            </div>
            
            {/* Fallback options when we have the URL */}
            {showFallbackOptions && (
              <div className="space-y-3 pt-2">
                <Button onClick={handleOpenLink} variant="default" className="w-full">
                  <ExternalLinkIcon className="h-4 w-4 mr-2" />
                  Open Checkout in New Tab
                </Button>
                <Button onClick={handleCopyLink} variant="outline" className="w-full">
                  <Copy className="h-4 w-4 mr-2" />
                  {copied ? "Copied!" : "Copy Checkout Link"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Paste the link in a new browser tab to complete payment
                </p>
              </div>
            )}
            
            {/* Retry and close buttons */}
            <div className="flex gap-3 justify-center pt-2">
              {onRetry && !showFallbackOptions && (
                <Button onClick={onRetry} variant="default">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              )}
              {onClose && (
                <Button onClick={onClose} variant="outline">
                  Close
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-foreground">
                Preparing Secure Checkout
              </h3>
              <p className="text-muted-foreground text-sm">
                You'll be redirected to Stripe's secure payment page
              </p>
            </div>
            
            {/* Progress steps */}
            <div className="space-y-3 pt-4">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const isComplete = index < currentStepIndex;
                const isCurrent = index === currentStepIndex;
                const isPending = index > currentStepIndex;
                
                return (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-3 text-sm transition-all duration-300",
                      isComplete && "text-primary",
                      isCurrent && "text-foreground",
                      isPending && "text-muted-foreground/50"
                    )}
                  >
                    <div className={cn(
                      "h-6 w-6 rounded-full flex items-center justify-center transition-all duration-300",
                      isComplete && "bg-primary/20",
                      isCurrent && "bg-primary/10 ring-2 ring-primary/30",
                      isPending && "bg-muted"
                    )}>
                      {isComplete ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : isCurrent ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <span className={cn(
                      "transition-all duration-300",
                      isCurrent && "font-medium"
                    )}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
            
            {/* Security badges */}
            <div className="flex items-center justify-center gap-4 pt-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
                </svg>
                256-bit SSL
              </span>
              <span className="flex items-center gap-1">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                </svg>
                Secure payment
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
