import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getVisitorId } from '@/lib/track-transport';

// Get or create a persistent visitor ID


interface ErrorContext {
  page?: string;
  action?: string;
  componentName?: string;
  userInput?: string;
  [key: string]: unknown;
}

export function useErrorTracking() {
  const visitorId = useRef<string>(getVisitorId());

  // Track an error event
  const trackError = useCallback(async (
    errorType: string,
    errorCode: string,
    errorMessage?: string,
    context?: ErrorContext,
    httpStatus?: number,
    functionName?: string
  ) => {
    try {
      // Use RPC to log the error (matches existing function)
      const { error } = await supabase.rpc('log_error_telemetry', {
        p_error_type: errorType,
        p_error_code: errorCode,
        p_error_message: errorMessage || null,
        p_context: context ? { ...context, visitor_id: visitorId.current } : { visitor_id: visitorId.current },
        p_http_status: httpStatus || null,
        p_function_name: functionName || null
      });

      if (error) {
        console.error('[ErrorTracking] Failed to log error:', error);
      }
    } catch (e) {
      console.error('[ErrorTracking] Exception logging error:', e);
    }
  }, []);

  // Track rate limit errors specifically
  const trackRateLimitError = useCallback((
    functionName: string,
    scansUsed?: number,
    scansLimit?: number
  ) => {
    trackError(
      'rate_limit',
      'RATE_LIMIT_EXCEEDED',
      `User hit rate limit on ${functionName}`,
      {
        page: window.location.pathname,
        functionName,
        scansUsed,
        scansLimit
      },
      429,
      functionName
    );
  }, [trackError]);

  // Track API errors
  const trackApiError = useCallback((
    functionName: string,
    httpStatus: number,
    errorMessage: string,
    context?: ErrorContext
  ) => {
    trackError(
      'api_error',
      `API_${httpStatus}`,
      errorMessage,
      { ...context, page: window.location.pathname },
      httpStatus,
      functionName
    );
  }, [trackError]);

  // Track UI/client errors
  const trackClientError = useCallback((
    errorCode: string,
    errorMessage: string,
    context?: ErrorContext
  ) => {
    trackError(
      'client_error',
      errorCode,
      errorMessage,
      { ...context, page: window.location.pathname }
    );
  }, [trackError]);

  // The four readers that used to live here -- checkErrorHistory,
  // checkUserHealth, detectErrorSpikes, getErrorDiagnostics -- called SECURITY
  // DEFINER RPCs that returned any visitor's error history (or every visitor's
  // id) to whoever held the publishable key. No component called them; the
  // operations dashboard reaches the same data through admin-ops with the
  // admin key. Migration 20261004110000 closed the RPCs to the browser, so the
  // readers went with them rather than failing quietly on every call.

  return {
    visitorId: visitorId.current,
    trackError,
    trackRateLimitError,
    trackApiError,
    trackClientError,
  };
}

// Standalone function for use outside React components
export async function logError(
  errorType: string,
  errorCode: string,
  errorMessage?: string,
  context?: ErrorContext,
  httpStatus?: number,
  functionName?: string
) {
  const visitorId = getVisitorId();
  
  try {
    await supabase.rpc('log_error_telemetry', {
      p_error_type: errorType,
      p_error_code: errorCode,
      p_error_message: errorMessage || null,
      p_context: context ? { ...context, visitor_id: visitorId } : { visitor_id: visitorId },
      p_http_status: httpStatus || null,
      p_function_name: functionName || null
    });
  } catch (e) {
    console.error('[ErrorTracking] Failed to log error:', e);
  }
}
