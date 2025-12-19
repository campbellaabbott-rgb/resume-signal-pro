import { Apple, CreditCard } from "lucide-react";

interface WalletPaymentBadgeProps {
  className?: string;
  variant?: "light" | "muted";
}

export function WalletPaymentBadge({ className = "", variant = "muted" }: WalletPaymentBadgeProps) {
  return (
    <div className={`flex items-center justify-center gap-2 text-xs ${variant === "light" ? "text-white/70" : "text-muted-foreground"} ${className}`}>
      <Apple className="w-3.5 h-3.5" />
      <span>Apple Pay</span>
      <span className="opacity-50">•</span>
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      <span>Google Pay</span>
    </div>
  );
}
