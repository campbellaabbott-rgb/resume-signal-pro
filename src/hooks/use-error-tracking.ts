import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Get or create a persistent visitor ID
const getVisitorId = (): string => {
  const storageKey = 'rb_visitor_id';
  let visitorId = localStorage.getItem(storageKey);
  
  if (!visitorId) {
    visitorId = `v_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem(storageKey, visitorId);
  }
  
  return visitorId;
};

interface ErrorContext {
  page?: string;
  action?: string;
  componentName?: string;
  userInput?: string;
  [key: string]: unknown;
}

interface ErrorHistory {
  totalErrors: number;
  recentErrors: number;
  lastErrorAt: string | null;
  errorTypes: string[];
  hasHadErrors: boolean;
}

export function useErrorTracking() {
  const visitorId = useRef<string>(getVisitorId());
  const errorHistory = useRef<ErrorHistory | null>(null);

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

  // Check if user has had errors before
  const checkErrorHistory = useCallback(async (): Promise<ErrorHistory> => {
    try {
      const { data, error } = await supabase.rpc('get_visitor_error_history', {
        p_visitor_id: visitorId.current
      });

      if (error || !data || data.length === 0) {
        return {
          totalErrors: 0,
          recentErrors: 0,
          lastErrorAt: null,
          errorTypes: [],
          hasHadErrors: false
        };
      }

      const result = data[0];
      const history: ErrorHistory = {
        totalErrors: result.total_errors || 0,
        recentErrors: result.recent_errors || 0,
        lastErrorAt: result.last_error_at || null,
        errorTypes: result.error_types || [],
        hasHadErrors: (result.total_errors || 0) > 0
      };

      errorHistory.current = history;
      return history;
    } catch (e) {
      console.error('[ErrorTracking] Failed to check error history:', e);
      return {
        totalErrors: 0,
        recentErrors: 0,
        lastErrorAt: null,
        errorTypes: [],
        hasHadErrors: false
      };
    }
  }, []);

  // Load error history on mount
  useEffect(() => {
    checkErrorHistory();
  }, [checkErrorHistory]);

  return {
    visitorId: visitorId.current,
    trackError,
    trackRateLimitError,
    trackApiError,
    trackClientError,
    checkErrorHistory,
    errorHistory: errorHistory.current
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
