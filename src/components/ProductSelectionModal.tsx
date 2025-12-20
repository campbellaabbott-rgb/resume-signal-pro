import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Sparkles, FileText, Crown, Package, Loader2, Briefcase, Building2, Info } from 'lucide-react';
import { PRODUCTS, ProductId } from '@/config/products';
import { useProductCheckout } from '@/hooks/use-product-checkout';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ProductSelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId?: string;
  preSelectedProduct?: ProductId;
  onFullAnalysisCheckout?: () => void;
}

const productIcons: Record<string, React.ElementType> = {
  basicKeywordFix: FileText,
  coverLetter: FileText,
  premiumPackage: Crown,
  careerBundle: Package,
  fullAnalysis: Sparkles,
};

// Products that generate content and benefit from job details
const contentGeneratingProducts: ProductId[] = ['basicKeywordFix', 'coverLetter', 'premiumPackage'];

export function ProductSelectionModal({ 
  open, 
  onOpenChange, 
  sessionId,
  preSelectedProduct,
  onFullAnalysisCheckout
}: ProductSelectionModalProps) {
  const [selectedProduct, setSelectedProduct] = useState<ProductId | null>(preSelectedProduct || null);
  const [jobTitle, setJobTitle] = useState('');
  const [jobCompany, setJobCompany] = useState('');
  const { purchaseProduct, isLoading } = useProductCheckout();

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!open) {
      setJobTitle('');
      setJobCompany('');
    }
  }, [open]);

  const needsJobDetails = selectedProduct && contentGeneratingProducts.includes(selectedProduct);

  const handlePurchase = async () => {
    if (!selectedProduct) return;
    
    const product = PRODUCTS[selectedProduct];
    
    // Special handling for fullAnalysis - uses existing checkout flow
    if ('useMainCheckout' in product && product.useMainCheckout && onFullAnalysisCheckout) {
      onFullAnalysisCheckout();
      onOpenChange(false);
      return;
    }
    
    // Pass job details for content-generating products
    const url = await purchaseProduct(selectedProduct, {
      sessionId,
      jobTitle: jobTitle.trim(),
      jobCompany: jobCompany.trim()
    });
    if (url) {
      onOpenChange(false);
    }
  };

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

        {/* Job Details Section - Only show for content-generating products */}
        {needsJobDetails && (
          <TooltipProvider>
            <div className="space-y-4 p-4 rounded-lg bg-accent/50 border border-border">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Briefcase className="w-4 h-4 text-primary" />
                <span>Target Job Details</span>
                <Badge variant="secondary" className="text-xs">Optional</Badge>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                      <Info className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-center">
                    <p className="text-sm">
                      Adding the job title and company helps our AI tailor keywords, 
                      language, and focus areas specifically for this role—improving 
                      ATS matching and hiring manager appeal.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                Helps personalize your content for better ATS matching and relevance.
              </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="jobTitle" className="text-xs flex items-center gap-1.5">
                  <Briefcase className="w-3 h-3" />
                  Job Title
                </Label>
                <Input
                  id="jobTitle"
                  placeholder="e.g., Software Engineer"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="jobCompany" className="text-xs flex items-center gap-1.5">
                  <Building2 className="w-3 h-3" />
                  Company
                </Label>
                <Input
                  id="jobCompany"
                  placeholder="e.g., Google"
                  value={jobCompany}
                  onChange={(e) => setJobCompany(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
            </div>
          </TooltipProvider>
        )}

        {/* Purchase button */}
        <Button 
          onClick={handlePurchase}
          disabled={!selectedProduct || isLoading}
          className="w-full mt-4"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Redirecting to checkout...
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
