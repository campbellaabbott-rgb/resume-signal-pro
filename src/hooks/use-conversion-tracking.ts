import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ProductId } from '@/config/products';

// Get or create visitor ID for tracking
const getVisitorId = (): string => {
  const key = 'conversion_visitor_id';
  let visitorId = localStorage.getItem(key);
  
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(key, visitorId);
  }
  
  return visitorId;
};

// Track conversion event
const trackConversionEvent = async (
  eventType: 'button_click' | 'checkout_initiated' | 'purchase_completed',
  productId: ProductId | string,
  metadata?: Record<string, unknown>
) => {
  try {
    const visitorId = getVisitorId();
    
    // Use existing A/B event tracking infrastructure
    await supabase.functions.invoke('track-ab-event', {
      body: {
        testName: 'product_conversion',
        variant: productId,
        eventType: eventType === 'button_click' ? 'view' : 'conversion',
        visitorId,
        metadata: {
          ...metadata,
          eventType,
          productId,
          timestamp: new Date().toISOString(),
          page: window.location.pathname,
          referrer: document.referrer || 'direct',
        }
      }
    });
    
    console.log(`[Conversion] Tracked ${eventType} for ${productId}`);
  } catch (error) {
    console.error('Failed to track conversion event:', error);
  }
};

export function useConversionTracking() {
  // Track when a purchase button is clicked
  const trackButtonClick = useCallback((productId: ProductId | string, source?: string) => {
    trackConversionEvent('button_click', productId, { source });
  }, []);

  // Track when checkout is initiated (Stripe session created)
  const trackCheckoutInitiated = useCallback((productId: ProductId | string, priceUsd?: number) => {
    trackConversionEvent('checkout_initiated', productId, { priceUsd });
  }, []);

  // Track when purchase is completed (on success page)
  const trackPurchaseCompleted = useCallback((productId: ProductId | string, priceUsd?: number, sessionId?: string) => {
    // Prevent duplicate tracking using sessionStorage
    const trackingKey = `purchase_tracked_${sessionId || productId}`;
    if (sessionStorage.getItem(trackingKey)) {
      console.log('[Conversion] Purchase already tracked, skipping');
      return;
    }
    
    sessionStorage.setItem(trackingKey, 'true');
    trackConversionEvent('purchase_completed', productId, { priceUsd, sessionId });
  }, []);

  return {
    trackButtonClick,
    trackCheckoutInitiated,
    trackPurchaseCompleted,
  };
}

// Standalone function for use outside of React components
export const trackProductConversion = trackConversionEvent;
