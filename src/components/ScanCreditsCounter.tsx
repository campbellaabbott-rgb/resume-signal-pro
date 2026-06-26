import { useState, useEffect } from "react";
import { Coins, Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useScanCredits } from "@/hooks/use-scan-credits";
import { ScanPackPurchase } from "@/components/ScanPackPurchase";
import { useCurrency } from "@/hooks/use-currency";

export function ScanCreditsCounter() {
  const [email, setEmail] = useState("");
  const [checkedEmail, setCheckedEmail] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const { credits, checkCredits, isLoading, pricePerCredit } = useScanCredits();
  const { formatPrice, isLocalCurrency } = useCurrency();
  
  const formatLocalPrice = (usd: number) => {
    if (isLocalCurrency) {
      return `$${usd.toFixed(2)} (${formatPrice(usd)})`;
    }
    return `$${usd.toFixed(2)}`;
  };

  // Try to load email from localStorage on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem("scanCreditsEmail");
    if (savedEmail) {
      setEmail(savedEmail);
      setCheckedEmail(savedEmail);
      checkCredits(savedEmail);
    }
  }, [checkCredits]);

  // Pick up credits immediately after a same-tab purchase (e.g. scan pack checkout
  // success), without requiring the user to manually find this widget and re-enter
  // their email — see ProductSuccess.tsx where this event is dispatched.
  useEffect(() => {
    const handleCreditsUpdated = (e: Event) => {
      const updatedEmail = (e as CustomEvent<{ email: string }>).detail?.email;
      if (updatedEmail) {
        setEmail(updatedEmail);
        setCheckedEmail(updatedEmail);
        checkCredits(updatedEmail);
      }
    };
    window.addEventListener("scanCreditsEmailUpdated", handleCreditsUpdated);
    return () => window.removeEventListener("scanCreditsEmailUpdated", handleCreditsUpdated);
  }, [checkCredits]);

  const handleCheckCredits = async () => {
    if (!email || !email.includes("@")) return;
    
    const normalizedEmail = email.toLowerCase().trim();
    await checkCredits(normalizedEmail);
    setCheckedEmail(normalizedEmail);
    localStorage.setItem("scanCreditsEmail", normalizedEmail);
  };

  const isValidEmail = email.includes("@") && email.includes(".");

  // If user has checked and has credits, show counter badge
  if (checkedEmail && credits > 0) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 min-h-[44px] touch-manipulation bg-success/10 border-success/30 hover:bg-success/20"
          >
            <Coins className="w-4 h-4 text-success" />
            <span className="font-semibold text-success">{credits}</span>
            <span className="text-muted-foreground hidden sm:inline">credits</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-4" align="end">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-success/10">
                <Coins className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="font-semibold">Your Scan Credits</p>
                <p className="text-sm text-muted-foreground">{checkedEmail}</p>
              </div>
            </div>
            
            <div className="p-3 rounded-lg bg-secondary/50 text-center">
              <p className="text-3xl font-bold text-success">{credits}</p>
              <p className="text-sm text-muted-foreground">credits remaining</p>
            </div>
            
            <p className="text-xs text-muted-foreground text-center">
              Credits never expire • {formatLocalPrice(pricePerCredit)} per credit
            </p>
            
            <Button
              onClick={() => {
                setShowPurchase(true);
                setIsOpen(false);
              }}
              size="sm"
              className="w-full gap-2"
            >
              <Plus className="w-4 h-4" />
              Top Up Credits
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                setCheckedEmail(null);
                localStorage.removeItem("scanCreditsEmail");
                setIsOpen(false);
              }}
            >
              Use different email
            </Button>
          </div>
          
          <ScanPackPurchase 
            open={showPurchase} 
            onOpenChange={setShowPurchase} 
          />
        </PopoverContent>
      </Popover>
    );
  }

  // Show "Check Credits" button that opens email input
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 min-h-[44px] touch-manipulation text-muted-foreground hover:text-foreground"
        >
          <Coins className="w-4 h-4" />
          <span className="hidden sm:inline">My Credits</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-1">Check Your Scan Credits</h4>
            <p className="text-sm text-muted-foreground">
              Enter the email you used to purchase scans.
            </p>
          </div>
          
          <div className="space-y-2">
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCheckCredits()}
              className="h-10"
            />
            <Button
              onClick={handleCheckCredits}
              disabled={!isValidEmail || isLoading}
              className="w-full"
              size="sm"
            >
              {isLoading ? "Checking..." : "Check Credits"}
            </Button>
          </div>
          
          {checkedEmail && credits === 0 && (
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-sm text-muted-foreground">
                No credits found for this email.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatLocalPrice(pricePerCredit)} per credit • Buy any amount
              </p>
            </div>
          )}
          
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-xs text-muted-foreground">
              <strong>Free tier:</strong> Up to 7 scans per day, free forever.
            </p>
            <Button
              onClick={() => {
                setShowPurchase(true);
                setIsOpen(false);
              }}
              variant="outline"
              size="sm"
              className="w-full gap-2"
            >
              <Plus className="w-4 h-4" />
              Buy Credits — {formatLocalPrice(pricePerCredit)} each
            </Button>
          </div>
        </div>
        
        <ScanPackPurchase 
          open={showPurchase} 
          onOpenChange={setShowPurchase} 
        />
      </PopoverContent>
    </Popover>
  );
}
