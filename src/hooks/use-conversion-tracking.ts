import { useCallback } from 'react';
import { postTrackEvent } from '@/lib/track-transport';
import { ProductId } from '@/config/products';
import { AB_TESTS } from '@/hooks/use-ab-test';

// The visitor id is not this hook's to decide: the transport stamps every
// event with the browser's one id (src/lib/track-transport.ts). This file
// used to keep a private copy under a private storage key for the product
// events, and read the A/B hook's private key for the A/B conversions — so a
// purchase was recorded under one visitor and the A/B conversion it implied
// under another, and if the A/B key happened to be unset the A/B conversion
// was silently skipped.
//
// TWO SUB-EVENTS UNDER ONE KEY, NOT THREE. product_conversion is read by
// get-analytics as views against conversions per product (the variant), and
// the writer refuses a repeat of (test, variant, visitor, type) for ninety
// days when the type is conversion. This hook used to send a third sub-event,
// checkout_initiated, as a conversion under the same product — so a visitor
// who reached checkout was the product's "conversion" whether or not they
// paid, and their purchase_completed row was refused for ninety days as a
// repeat of it. The intent event is retired (reviewed 2026-09-27): the funnel
// keeps checkout_started, and the server records every Stripe session it
// mints in checkout_starts, keyed on the session and carrying the product.
// The clicks stay views, the purchase stays the one conversion.

// Track A/B test conversion for all active tests
const trackABTestConversions = (metadata?: Record<string, unknown>) => {
  const testNames = Object.keys(AB_TESTS) as (keyof typeof AB_TESTS)[];

  for (const testName of testNames) {
    try {
      const variant = localStorage.getItem(`ab_${testName}`);
      if (variant) {
        postTrackEvent({
          testName,
          variant,
          eventType: 'conversion',
          metadata,
        });
      }
    } catch (error) {
      console.error(`Failed to track A/B conversion for ${testName}:`, error);
    }
  }
};

// Track conversion event
const trackConversionEvent = async (
  eventType: 'button_click' | 'purchase_completed',
  productId: ProductId | string,
  metadata?: Record<string, unknown>
) => {
  try {
    // Use existing A/B event tracking infrastructure
    postTrackEvent({
        testName: 'product_conversion',
        variant: productId,
        eventType: eventType === 'button_click' ? 'view' : 'conversion',
        metadata: {
          ...metadata,
          eventType,
          productId,
          timestamp: new Date().toISOString(),
          page: window.location.pathname,
          referrer: document.referrer || 'direct',
        }
    });

    // Also track A/B test conversions on purchase completed
    if (eventType === 'purchase_completed') {
      trackABTestConversions({ productId, ...metadata });
    }
  } catch (error) {
    console.error('Failed to track conversion event:', error);
  }
};

export function useConversionTracking() {
  // Track when a purchase button is clicked
  const trackButtonClick = useCallback((productId: ProductId | string, source?: string) => {
    trackConversionEvent('button_click', productId, { source });
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
    trackPurchaseCompleted,
  };
}

// Standalone function for use outside of React components
export const trackProductConversion = trackConversionEvent;
