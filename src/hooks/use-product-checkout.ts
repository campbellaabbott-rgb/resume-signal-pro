import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PRODUCTS, ProductId } from '@/config/products';
import { useConversionTracking } from '@/hooks/use-conversion-tracking';
import { useFunnelTracking } from '@/hooks/use-funnel-tracking';
import { parseEdgeFunctionError } from '@/lib/edge-function-errors';
import { getStoredReferralCode } from '@/hooks/use-affiliate-auth';
import { useCheckoutPrefetch } from '@/hooks/use-checkout-prefetch';

export interface CheckoutOptions {
  sessionId?: string;
  jobTitle?: string;
  jobCompany?: string;
  ctaSection?: string; // Track which section the CTA was clicked from
}

export function useProductCheckout() {
  const [isLoading, setIsLoading] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<ProductId | null>(null);
  const { toast } = useToast();
  const { trackButtonClick, trackCheckoutInitiated } = useConversionTracking();
  const { trackProductClicked, trackCheckoutStarted } = useFunnelTracking();
  const { prefetch: prefetchCheckout, prefetchProps } = useCheckoutPrefetch();

  const purchaseProduct = async (productId: ProductId, options?: CheckoutOptions | string): Promise<string | null> => {
    // Handle backwards compatibility - if options is a string, treat it as sessionId
    const opts: CheckoutOptions = typeof options === 'string' 
      ? { sessionId: options } 
      : options || {};

    const product = PRODUCTS[productId];
    if (!product) {
      toast({
        title: "Invalid Product",
        description: "The selected product is not available.",
        variant: "destructive"
      });
      return null;
    }

    setIsLoading(true);
    setCurrentProduct(productId);
    
    // Track button click for conversion analytics with section metadata
    trackButtonClick(productId, opts.ctaSection || 'product_checkout');
    
    // Track in funnel
    trackProductClicked(productId, product.name, product.priceUsd);

    try {
      const { data, error } = await supabase.functions.invoke('create-product-checkout', {
        body: {
          productId: productId,
          sessionId: opts.sessionId,
          jobTitle: opts.jobTitle,
          jobCompany: opts.jobCompany,
          referralCode: getStoredReferralCode(),
          // Generation happens server-side from the webhook, which has no
          // access to the browser's i18n state — has to be captured now.
          language: localStorage.getItem('i18nextLng') || 'en'
        }
      });

      if (error) {
        console.error('Checkout error:', error);
        const parsedError = await parseEdgeFunctionError(error);
        toast({
          title: parsedError.title,
          description: parsedError.description,
          variant: "destructive"
        });
        return null;
      }

      if (data?.url) {
        // Track checkout initiated
        trackCheckoutInitiated(productId, product.priceUsd);
        
        // Track in funnel
        trackCheckoutStarted(productId, product.priceUsd);
        
        toast({
          title: "Redirecting to Checkout",
          description: "Taking you to Stripe checkout…",
        });
        window.location.assign(data.url);
        return data.url;
      }

      return null;
    } catch (err) {
      console.error('Purchase error:', err);
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive"
      });
      return null;
    } finally {
      setIsLoading(false);
      setCurrentProduct(null);
    }
  };

  return {
    purchaseProduct,
    isLoading,
    currentProduct,
    products: PRODUCTS,
    // Prefetch utilities for checkout buttons
    prefetchCheckout,
    checkoutPrefetchProps: prefetchProps,
  };
}
