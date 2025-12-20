import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PRODUCTS, ProductId } from '@/config/products';

export interface CheckoutOptions {
  sessionId?: string;
  jobTitle?: string;
  jobCompany?: string;
}

export function useProductCheckout() {
  const [isLoading, setIsLoading] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<ProductId | null>(null);
  const { toast } = useToast();

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

    try {
      const { data, error } = await supabase.functions.invoke('create-product-checkout', {
        body: { 
          productId: productId,
          sessionId: opts.sessionId,
          jobTitle: opts.jobTitle,
          jobCompany: opts.jobCompany
        }
      });

      if (error) {
        console.error('Checkout error:', error);
        toast({
          title: "Checkout Error",
          description: error.message || "Failed to create checkout session. Please try again.",
          variant: "destructive"
        });
        return null;
      }

      if (data?.url) {
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
    products: PRODUCTS
  };
}
