import { useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Define all A/B tests in one place
export const AB_TESTS = {
  hero_cta: {
    name: 'hero_cta',
    variants: ['control', 'urgent', 'benefit'] as const,
    // control: "Get Your Analysis - $25"
    // urgent: "Analyze Now - Limited Time"
    // benefit: "Land More Interviews - $25"
  },
  pricing_display: {
    name: 'pricing_display',
    variants: ['control', 'starting_at', 'roi_focused'] as const,
    // control: "$25"
    // starting_at: "Starting at $25"
    // roi_focused: "1 Interview = ROI"
  },
  free_scan_cta: {
    name: 'free_scan_cta',
    variants: ['control', 'instant', 'free_badge'] as const,
    // control: "Try Free Scan"
    // instant: "Get Instant Results"
    // free_badge: "FREE Scan Available"
  },
  free_scan_upgrade: {
    name: 'free_scan_upgrade',
    variants: ['control', 'urgency', 'value'] as const,
    // control: "Fix These Issues - $25" / "Get Full Analysis - $25"
    // urgency: "Fix Now Before It's Too Late" / "Don't Miss Out - $25"
    // value: "Get Recruiter-Ready - $25" / "Unlock All Fixes - $25"
  },
  upload_flow: {
    name: 'upload_flow',
    variants: ['control', 'paste_first', 'simplified'] as const,
    // control: current design
    // paste_first: paste option more prominent
    // simplified: minimal UI
  },
  product_ctas: {
    name: 'product_ctas',
    variants: ['control', 'benefit_focused', 'scarcity'] as const,
    // control: Standard pricing-focused copy
    // benefit_focused: Outcome-focused copy emphasizing results
    // scarcity: Urgency and limited-time messaging
  },
  sticky_pricing_banner: {
    name: 'sticky_pricing_banner',
    variants: ['show', 'hide'] as const,
    // show: Display the sticky pricing banner
    // hide: No sticky pricing banner (control)
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

// Track event via edge function
const trackEvent = async (
  testName: string,
  variant: string,
  eventType: 'view' | 'conversion',
  metadata?: Record<string, unknown>
) => {
  try {
    const visitorId = getVisitorId();
    
    await supabase.functions.invoke('track-ab-event', {
      body: {
        testName,
        variant,
        eventType,
        visitorId,
        metadata
      }
    });
  } catch (error) {
    console.error('Failed to track A/B event:', error);
  }
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
