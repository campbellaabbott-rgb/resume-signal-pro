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

interface UserHealthStatus {
  status: 'healthy' | 'minor_issues' | 'degraded' | 'critical';
  recentErrors: number;
  errorTrend: 'improving' | 'stable' | 'worsening';
  primaryIssue: string;
  recommendation: string;
}

interface ErrorSpike {
  visitorId: string;
  recentErrorCount: number;
  baselineHourlyRate: number;
  spikeMultiplier: number;
  recentErrorTypes: string[];
  lastErrorAt: string;
  isSpike: boolean;
}

interface ErrorDiagnostics {
  errorType: string;
  errorCode: string;
  errorCount: number;
  uniqueUsers: number;
  avgPerUser: number;
  mostRecent: string;
  sampleMessage: string;
  affectedFunctions: string[];
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

  // Check current user's health status with self-diagnosis
  const checkUserHealth = useCallback(async (): Promise<UserHealthStatus> => {
    try {
      const { data, error } = await supabase.rpc('check_user_health', {
        p_visitor_id: visitorId.current
      });

      if (error || !data || data.length === 0) {
        return {
          status: 'healthy',
          recentErrors: 0,
          errorTrend: 'stable',
          primaryIssue: 'none',
          recommendation: 'No action needed'
        };
      }

      const result = data[0];
      return {
        status: result.status as UserHealthStatus['status'],
        recentErrors: result.recent_errors || 0,
        errorTrend: result.error_trend as UserHealthStatus['errorTrend'],
        primaryIssue: result.primary_issue || 'none',
        recommendation: result.recommendation || 'No action needed'
      };
    } catch (e) {
      console.error('[ErrorTracking] Failed to check user health:', e);
      return {
        status: 'healthy',
        recentErrors: 0,
        errorTrend: 'stable',
        primaryIssue: 'none',
        recommendation: 'No action needed'
      };
    }
  }, []);

  // Detect error spikes across all users
  const detectErrorSpikes = useCallback(async (
    spikeThreshold = 5,
    recentMinutes = 15,
    baselineHours = 24
  ): Promise<ErrorSpike[]> => {
    try {
      const { data, error } = await supabase.rpc('detect_user_error_spikes', {
        p_spike_threshold: spikeThreshold,
        p_recent_minutes: recentMinutes,
        p_baseline_hours: baselineHours
      });

      if (error || !data) {
        console.error('[ErrorTracking] Failed to detect spikes:', error);
        return [];
      }

      return data.map((row: Record<string, unknown>) => ({
        visitorId: row.visitor_id as string,
        recentErrorCount: row.recent_error_count as number,
        baselineHourlyRate: row.baseline_hourly_rate as number,
        spikeMultiplier: row.spike_multiplier as number,
        recentErrorTypes: row.recent_error_types as string[],
        lastErrorAt: row.last_error_at as string,
        isSpike: row.is_spike as boolean
      }));
    } catch (e) {
      console.error('[ErrorTracking] Exception detecting spikes:', e);
      return [];
    }
  }, []);

  // Get error diagnostics summary
  const getErrorDiagnostics = useCallback(async (hoursBack = 24): Promise<ErrorDiagnostics[]> => {
    try {
      const { data, error } = await supabase.rpc('get_error_diagnostics', {
        p_hours_back: hoursBack
      });

      if (error || !data) {
        console.error('[ErrorTracking] Failed to get diagnostics:', error);
        return [];
      }

      return data.map((row: Record<string, unknown>) => ({
        errorType: row.error_type as string,
        errorCode: row.error_code as string,
        errorCount: row.error_count as number,
        uniqueUsers: row.unique_users as number,
        avgPerUser: row.avg_per_user as number,
        mostRecent: row.most_recent as string,
        sampleMessage: row.sample_message as string,
        affectedFunctions: row.affected_functions as string[] || []
      }));
    } catch (e) {
      console.error('[ErrorTracking] Exception getting diagnostics:', e);
      return [];
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
    checkUserHealth,
    detectErrorSpikes,
    getErrorDiagnostics,
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
