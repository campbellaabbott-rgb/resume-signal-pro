import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Check, Sparkles, FileText, Crown, Package, Loader2 } from 'lucide-react';
import { PRODUCTS, ProductId } from '@/config/products';
import { useProductCheckout } from '@/hooks/use-product-checkout';
import { cn } from '@/lib/utils';

interface ProductSelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId?: string;
  preSelectedProduct?: ProductId;
  onFullAnalysisCheckout?: () => void; // Callback for full analysis (uses existing checkout)
}

const productIcons: Record<string, React.ElementType> = {
  basicKeywordFix: FileText,
  coverLetter: FileText,
  premiumPackage: Crown,
  careerBundle: Package,
  fullAnalysis: Sparkles,
};

export function ProductSelectionModal({ 
  open, 
  onOpenChange, 
  sessionId,
  preSelectedProduct,
  onFullAnalysisCheckout
}: ProductSelectionModalProps) {
  const [selectedProduct, setSelectedProduct] = useState<ProductId | null>(preSelectedProduct || null);
  const [email, setEmail] = useState('');
  const { purchaseProduct, isLoading } = useProductCheckout();

  const handlePurchase = async () => {
    if (!selectedProduct || !email || !email.includes('@')) return;
    
    const product = PRODUCTS[selectedProduct];
    
    // Special handling for fullAnalysis - uses existing checkout flow
    if ('useMainCheckout' in product && product.useMainCheckout && onFullAnalysisCheckout) {
      onFullAnalysisCheckout();
      onOpenChange(false);
      return;
    }
    
    const url = await purchaseProduct(selectedProduct, email, sessionId);
    if (url) {
      onOpenChange(false);
    }
  };

  const isValidEmail = email.includes('@') && email.includes('.');

  // Products to show (excluding scan pack which has its own flow)
  const displayProducts = [
    { key: 'basicKeywordFix' as ProductId, product: PRODUCTS.basicKeywordFix },
    { key: 'fullAnalysis' as ProductId, product: PRODUCTS.fullAnalysis },
    { key: 'premiumPackage' as ProductId, product: PRODUCTS.premiumPackage },
    { key: 'coverLetter' as ProductId, product: PRODUCTS.coverLetter },
    { key: 'careerBundle' as ProductId, product: PRODUCTS.careerBundle },
  ];

  const getSelectedProductName = () => {
    if (!selectedProduct) return 'Select a package';
    const product = PRODUCTS[selectedProduct];
    return `Purchase ${product.name} - $${product.priceUsd}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Choose Your Package</DialogTitle>
          <DialogDescription>
            Select the option that best fits your needs
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-4">
          {displayProducts.map(({ key, product }) => {
            const Icon = productIcons[key] || Sparkles;
            const isSelected = selectedProduct === key;
            const isPremium = key === 'premiumPackage';
            
            return (
              <button
                key={key}
                onClick={() => setSelectedProduct(key)}
                className={cn(
                  "relative flex items-start gap-4 p-4 rounded-lg border-2 text-left transition-all",
                  isSelected 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:border-primary/50 hover:bg-accent/50",
                  isPremium && "ring-2 ring-primary/20"
                )}
              >
                {/* Badge */}
                {'badge' in product && product.badge && (
                  <Badge className="absolute -top-2 right-4 bg-primary text-primary-foreground">
                    {product.badge}
                  </Badge>
                )}
                
                {/* Selection indicator */}
                <div className={cn(
                  "flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center",
                  isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                )}>
                  {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>

                {/* Icon */}
                <div className={cn(
                  "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
                  isPremium ? "bg-primary/20" : "bg-accent"
                )}>
                  <Icon className={cn(
                    "w-5 h-5",
                    isPremium ? "text-primary" : "text-muted-foreground"
                  )} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-foreground">{product.name}</span>
                    {'savings' in product && product.savings && (
                      <Badge variant="secondary" className="text-xs">
                        {product.savings}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{product.description}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {product.features.slice(0, 3).map((feature, i) => (
                      <span key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                        <Check className="w-3 h-3 text-primary" />
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Price */}
                <div className="flex-shrink-0 text-right">
                  <span className="text-xl font-bold text-foreground">${product.priceUsd}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Email input - not needed for fullAnalysis (uses existing checkout) */}
        {selectedProduct !== 'fullAnalysis' && (
          <div className="space-y-2 pt-2 border-t">
            <Label htmlFor="checkout-email">Email for receipt</Label>
            <Input
              id="checkout-email"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full"
            />
          </div>
        )}

        {/* Purchase button */}
        <Button 
          onClick={handlePurchase}
          disabled={!selectedProduct || (selectedProduct !== 'fullAnalysis' && !isValidEmail) || isLoading}
          className="w-full mt-4"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            getSelectedProductName()
          )}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          Secure checkout powered by Stripe. One-time payment, no subscription.
        </p>
      </DialogContent>
    </Dialog>
  );
}
