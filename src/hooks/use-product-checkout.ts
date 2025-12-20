import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PRODUCTS, ProductId } from '@/config/products';

export function useProductCheckout() {
  const [isLoading, setIsLoading] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<ProductId | null>(null);
  const { toast } = useToast();

  const purchaseProduct = async (productId: ProductId, sessionId?: string): Promise<string | null> => {
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
          productId: productId, // Use the key (e.g., 'basicKeywordFix') not product.id
          sessionId
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
        // Open checkout in new tab
        window.open(data.url, '_blank');
        toast({
          title: "Checkout Opened",
          description: "Complete your purchase in the new tab.",
        });
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
