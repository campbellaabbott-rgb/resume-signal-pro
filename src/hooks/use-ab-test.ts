import { useEffect, useCallback, useMemo, useRef } from 'react';
import { queueABEvent } from '@/hooks/use-shared-data';

// =============================================================================
// A/B TESTING CONFIGURATION
// =============================================================================
// 
// HOW TO USE:
// 1. Add new tests to ACTIVE_AB_TESTS below
// 2. Use useABTest('test_name') hook in components
// 3. Check results at /analytics
// 4. When a winner is found, move the test to CONCLUDED_TESTS and update components
//
// =============================================================================

// CONCLUDED TESTS - Winners declared, kept for reference
// These are no longer active but documented for historical tracking
export const CONCLUDED_TESTS = {
  hero_cta: { winner: 'control', concludedAt: '2025-12-22' },
  pricing_display: { winner: 'control', concludedAt: '2025-12-22' },
  free_scan_cta: { winner: 'control', concludedAt: '2025-12-22' },
  free_scan_upgrade: { winner: 'control', concludedAt: '2025-12-22' },
  product_ctas: { winner: 'control', concludedAt: '2025-12-22' },
} as const;

// ACTIVE A/B TESTS - Add new tests here
// When you want to run a new test, add it here with variants
export const AB_TESTS = {
  // Test social proof placement: above fold vs below fold
  social_proof_placement: {
    name: 'social_proof_placement',
    variants: ['control', 'above_fold', 'inline_hero'] as const,
  },
  // Test hero layout variants:
  // - compact: CTA visible immediately with reduced content on mobile
  // - original: Full layout with all benefits and content
  // - ultra_compact: Just headline + CTA above fold, minimal content
  // - social_first: Lead with prominent social proof stats, then headline + CTA
  // - benefit_led: Lead with pain point, then solution headline + CTA
  hero_layout: {
    name: 'hero_layout',
    variants: ['compact', 'original', 'ultra_compact', 'social_first', 'benefit_led'] as const,
  },
} as const;

type TestName = keyof typeof AB_TESTS;
type VariantOf<T extends TestName> = typeof AB_TESTS[T]['variants'][number];

// Get or create visitor ID
const getVisitorId = (): string => {
  const key = 'ab_visitor_id';
  let visitorId = localStorage.getItem(key);
  
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(key, visitorId);
  }
  
  return visitorId;
};

// Get stored variant or assign new one
const getVariant = <T extends TestName>(testName: T): VariantOf<T> => {
  const key = `ab_${testName}`;
  const stored = localStorage.getItem(key);
  const variants = AB_TESTS[testName].variants as readonly string[];
  
  if (stored && variants.includes(stored)) {
    return stored as VariantOf<T>;
  }
  
  // Randomly assign variant
  const variant = variants[Math.floor(Math.random() * variants.length)];
  localStorage.setItem(key, variant);

  return variant as VariantOf<T>;
};

// Track event via batched queue (reduces network calls)
const trackEvent = (
  testName: string,
  variant: string,
  eventType: 'view' | 'conversion',
  metadata?: Record<string, unknown>
) => {
  const visitorId = getVisitorId();
  
  // Queue the event for batched sending
  queueABEvent({
    testName,
    variant,
    eventType,
    visitorId,
    metadata
  });
};

export function useABTest<T extends TestName>(testName: T) {
  const variant = useMemo(() => getVariant(testName), [testName]);
  const hasTrackedView = useRef(false);

  // Track view on mount (only once)
  useEffect(() => {
    if (!hasTrackedView.current) {
      hasTrackedView.current = true;
      trackEvent(testName, variant, 'view');
    }
  }, [testName, variant]);

  // Track conversion
  const trackConversion = useCallback((metadata?: Record<string, unknown>) => {
    trackEvent(testName, variant, 'conversion', metadata);
  }, [testName, variant]);

  return {
    variant,
    trackConversion,
    isVariant: (v: VariantOf<T>) => variant === v,
  };
}

// Hook to track conversion from anywhere (e.g., success page)
export function useABConversion() {
  const trackAllConversions = useCallback((metadata?: Record<string, unknown>) => {
    // Track conversion for all active tests
    Object.keys(AB_TESTS).forEach((testName) => {
      const variant = localStorage.getItem(`ab_${testName}`);
      if (variant) {
        trackEvent(testName, variant, 'conversion', metadata);
      }
    });
  }, []);

  return { trackAllConversions };
}
