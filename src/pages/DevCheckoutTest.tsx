import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Loader2, AlertTriangle, CreditCard } from "lucide-react";
import { PRODUCTS, ProductId } from "@/config/products";
import { useProductCheckout } from "@/hooks/use-product-checkout";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

export default function DevCheckoutTest() {
  const { purchaseProduct, isLoading, currentProduct } = useProductCheckout();
  const [testingFullAnalysis, setTestingFullAnalysis] = useState(false);

  const handleTestCheckout = async (productId: ProductId) => {
    const product = PRODUCTS[productId];
    
    // Full analysis uses the main checkout flow
    if ('useMainCheckout' in product && product.useMainCheckout) {
      setTestingFullAnalysis(true);
      try {
        const { data, error } = await supabase.functions.invoke('create-checkout', {
          body: { currency: 'usd' }
        });
        
        if (error) {
          console.error('Checkout error:', error);
          alert(`Error: ${error.message}`);
          return;
        }
        
        if (data?.url) {
          window.location.assign(data.url);
        }
      } catch (err) {
        console.error('Error:', err);
        alert('Failed to create checkout');
      } finally {
        setTestingFullAnalysis(false);
      }
      return;
    }

    await purchaseProduct(productId);
  };

  const productEntries = Object.entries(PRODUCTS) as [ProductId, typeof PRODUCTS[ProductId]][];

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        {/* Warning Banner */}
        <div className="mb-8 p-4 bg-warning/10 border border-warning/30 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold text-warning">Development Testing Page</h2>
            <p className="text-sm text-muted-foreground">
              This page is for testing checkout flows. Use Stripe test card: <code className="bg-muted px-1 rounded">4242 4242 4242 4242</code> with any future expiry and any CVC.
            </p>
          </div>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Checkout Flow Tester</h1>
          <p className="text-muted-foreground">
            Click any product to test its checkout flow. All {productEntries.length} products are shown below.
          </p>
        </div>

        {/* Products Grid */}
        <div className="grid md:grid-cols-2 gap-4">
          {productEntries.map(([key, product]) => {
            const isLoadingThis = (isLoading && currentProduct === key) || (key === 'fullAnalysis' && testingFullAnalysis);
            const usesMainCheckout = 'useMainCheckout' in product && product.useMainCheckout;
            
            return (
              <Card key={key} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{product.name}</CardTitle>
                      <CardDescription>{product.description}</CardDescription>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      ${product.priceUsd}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Product details */}
                  <div className="space-y-2 mb-4">
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">Product Key:</span> <code className="bg-muted px-1 rounded">{key}</code>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">Checkout:</span> {usesMainCheckout ? 'create-checkout (main)' : 'create-product-checkout'}
                    </div>
                    {'priceId' in product && product.priceId && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">Price ID:</span> <code className="bg-muted px-1 rounded text-[10px]">{product.priceId}</code>
                      </div>
                    )}
                    {'credits' in product && product.credits && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">Credits:</span> {product.credits}
                      </div>
                    )}
                  </div>

                  {/* Features preview */}
                  <ul className="space-y-1 mb-4">
                    {product.features.slice(0, 2).map((feature, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Check className="w-3 h-3 text-primary" />
                        {feature}
                      </li>
                    ))}
                    {product.features.length > 2 && (
                      <li className="text-xs text-muted-foreground">
                        +{product.features.length - 2} more features
                      </li>
                    )}
                  </ul>

                  {/* Test button */}
                  <Button
                    onClick={() => handleTestCheckout(key)}
                    disabled={isLoading || testingFullAnalysis}
                    className="w-full"
                    variant="default"
                  >
                    {isLoadingThis ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating checkout...
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4 mr-2" />
                        Test Checkout
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Test Card Info */}
        <div className="mt-8 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-semibold mb-2">Stripe Test Cards</h3>
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Success:</span>
              <code className="bg-background px-2 rounded">4242 4242 4242 4242</code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Decline:</span>
              <code className="bg-background px-2 rounded">4000 0000 0000 0002</code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">3D Secure:</span>
              <code className="bg-background px-2 rounded">4000 0027 6000 3184</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
