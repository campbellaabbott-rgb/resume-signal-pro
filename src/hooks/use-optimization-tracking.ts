import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Optimization event types for tracking feature effectiveness
type OptimizationEvent = 
  | 'exit_intent_shown'
  | 'exit_intent_dismissed'
  | 'exit_intent_converted'
  | 'session_recovered'
  | 'session_recovery_failed'
  | 'live_activity_viewed'
  | 'lazy_section_loaded'
  | 'circuit_breaker_opened'
  | 'circuit_breaker_recovered'
  | 'retry_succeeded'
  | 'retry_exhausted'
  | 'graceful_degradation_used'
  | 'returning_user_detected';

// Get or create visitor ID for tracking
const getVisitorId = (): string => {
  const key = 'optimization_visitor_id';
  let visitorId = localStorage.getItem(key);
  
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(key, visitorId);
  }
  
  return visitorId;
};

// Track optimization event via edge function
const trackOptimizationEvent = async (
  eventType: OptimizationEvent,
  metadata?: Record<string, unknown>
) => {
  try {
    const visitorId = getVisitorId();
    
    await supabase.functions.invoke('track-ab-event', {
      body: {
        testName: 'optimization_features',
        variant: eventType,
        eventType: eventType.includes('converted') || eventType.includes('succeeded') || eventType.includes('recovered') 
          ? 'conversion' 
          : 'view',
        visitorId,
        metadata: {
          ...metadata,
          feature: eventType.split('_')[0], // e.g., 'exit', 'session', 'live'
          timestamp: new Date().toISOString(),
          page: typeof window !== 'undefined' ? window.location.pathname : '/',
          sessionDuration: getSessionDuration(),
        }
      }
    });
    
    console.log(`[Optimization] Tracked ${eventType}`, metadata);
  } catch (error) {
    // Silent fail - don't break user experience for tracking
    console.debug('Optimization tracking failed:', error);
  }
};

// Calculate session duration
const getSessionDuration = (): number => {
  const startTime = sessionStorage.getItem('session_start');
  if (!startTime) {
    sessionStorage.setItem('session_start', Date.now().toString());
    return 0;
  }
  return Math.round((Date.now() - parseInt(startTime)) / 1000);
};

// Initialize session start time
if (typeof window !== 'undefined') {
  if (!sessionStorage.getItem('session_start')) {
    sessionStorage.setItem('session_start', Date.now().toString());
  }
}

export function useOptimizationTracking() {
  const trackedEvents = useRef<Set<string>>(new Set());

  // Track once per session helper
  const trackOnce = useCallback((eventType: OptimizationEvent, metadata?: Record<string, unknown>) => {
    const eventKey = `${eventType}_${JSON.stringify(metadata || {})}`;
    if (trackedEvents.current.has(eventKey)) {
      return false;
    }
    trackedEvents.current.add(eventKey);
    trackOptimizationEvent(eventType, metadata);
    return true;
  }, []);

  // Exit intent tracking
  const trackExitIntentShown = useCallback(() => {
    trackOnce('exit_intent_shown');
  }, [trackOnce]);

  const trackExitIntentDismissed = useCallback(() => {
    trackOptimizationEvent('exit_intent_dismissed');
  }, []);

  const trackExitIntentConverted = useCallback(() => {
    trackOptimizationEvent('exit_intent_converted');
  }, []);

  // Session recovery tracking
  const trackSessionRecovered = useCallback((dataType: 'resume' | 'analysis') => {
    trackOptimizationEvent('session_recovered', { dataType });
  }, []);

  const trackSessionRecoveryFailed = useCallback((reason: string) => {
    trackOptimizationEvent('session_recovery_failed', { reason });
  }, []);

  // Live activity tracking
  const trackLiveActivityViewed = useCallback(() => {
    trackOnce('live_activity_viewed');
  }, [trackOnce]);

  // Lazy section tracking
  const trackLazySectionLoaded = useCallback((sectionName: string) => {
    trackOptimizationEvent('lazy_section_loaded', { sectionName });
  }, []);

  // Circuit breaker tracking
  const trackCircuitBreakerOpened = useCallback((serviceName: string) => {
    trackOptimizationEvent('circuit_breaker_opened', { serviceName });
  }, []);

  const trackCircuitBreakerRecovered = useCallback((serviceName: string) => {
    trackOptimizationEvent('circuit_breaker_recovered', { serviceName });
  }, []);

  // Retry tracking
  const trackRetrySucceeded = useCallback((operation: string, attemptNumber: number) => {
    trackOptimizationEvent('retry_succeeded', { operation, attemptNumber });
  }, []);

  const trackRetryExhausted = useCallback((operation: string, totalAttempts: number) => {
    trackOptimizationEvent('retry_exhausted', { operation, totalAttempts });
  }, []);

  // Graceful degradation tracking
  const trackGracefulDegradationUsed = useCallback((operation: string, fallbackType: 'cache' | 'fallback') => {
    trackOptimizationEvent('graceful_degradation_used', { operation, fallbackType });
  }, []);

  // Returning user tracking
  const trackReturningUserDetected = useCallback((scanCount: number, lastScore?: number) => {
    trackOnce('returning_user_detected', { scanCount, lastScore });
  }, [trackOnce]);

  return {
    // Exit intent
    trackExitIntentShown,
    trackExitIntentDismissed,
    trackExitIntentConverted,
    // Session recovery
    trackSessionRecovered,
    trackSessionRecoveryFailed,
    // Live activity
    trackLiveActivityViewed,
    // Lazy sections
    trackLazySectionLoaded,
    // Circuit breaker
    trackCircuitBreakerOpened,
    trackCircuitBreakerRecovered,
    // Retry
    trackRetrySucceeded,
    trackRetryExhausted,
    // Graceful degradation
    trackGracefulDegradationUsed,
    // Returning user
    trackReturningUserDetected,
  };
}

// Standalone functions for use outside React components
export const trackOptimization = trackOptimizationEvent;
export const getOptimizationVisitorId = getVisitorId;
