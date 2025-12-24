/**
 * React hook for resilient edge function calls
 * Provides loading state, error state, and automatic retry with UI feedback
 */

import { useState, useCallback, useRef } from 'react';
import { 
  callEdgeFunctionWithRetry, 
  ResilientCallOptions, 
  ResilientCallResult 
} from '@/lib/resilient-edge-function';
import { ParsedEdgeFunctionError } from '@/lib/edge-function-errors';
import { useToast } from '@/hooks/use-toast';

export interface UseResilientEdgeFunctionOptions extends ResilientCallOptions {
  /** Show toast on retry attempts (default: true) */
  showRetryToast?: boolean;
  /** Show toast on final error (default: true) */
  showErrorToast?: boolean;
  /** Custom retry toast message */
  retryToastMessage?: string;
}

export interface UseResilientEdgeFunctionState<T> {
  data: T | null;
  error: ParsedEdgeFunctionError | null;
  isLoading: boolean;
  isRetrying: boolean;
  attempt: number;
  totalAttempts: number;
}

export interface UseResilientEdgeFunctionReturn<T> {
  /** Current state */
  state: UseResilientEdgeFunctionState<T>;
  /** Execute the function call */
  execute: (payload?: Record<string, unknown>) => Promise<ResilientCallResult<T>>;
  /** Reset state to initial */
  reset: () => void;
  /** Retry the last call */
  retry: () => Promise<ResilientCallResult<T> | null>;
}

/**
 * Hook for calling edge functions with built-in retry logic and UI feedback
 */
export function useResilientEdgeFunction<T = unknown>(
  functionName: string,
  options: UseResilientEdgeFunctionOptions = {}
): UseResilientEdgeFunctionReturn<T> {
  const {
    showRetryToast = true,
    showErrorToast = true,
    retryToastMessage,
    ...callOptions
  } = options;

  const { toast } = useToast();
  const lastPayloadRef = useRef<Record<string, unknown>>({});

  const [state, setState] = useState<UseResilientEdgeFunctionState<T>>({
    data: null,
    error: null,
    isLoading: false,
    isRetrying: false,
    attempt: 0,
    totalAttempts: 0,
  });

  const execute = useCallback(async (
    payload: Record<string, unknown> = {}
  ): Promise<ResilientCallResult<T>> => {
    lastPayloadRef.current = payload;

    setState(prev => ({
      ...prev,
      isLoading: true,
      isRetrying: false,
      error: null,
      attempt: 0,
    }));

    const result = await callEdgeFunctionWithRetry<T>(functionName, payload, {
      ...callOptions,
      onStart: () => {
        setState(prev => ({ ...prev, attempt: 1 }));
      },
      onRetry: (attempt, error, delay) => {
        setState(prev => ({
          ...prev,
          isRetrying: true,
          attempt,
        }));

        if (showRetryToast) {
          toast({
            title: retryToastMessage || 'Retrying...',
            description: `Attempt ${attempt + 1}. Please wait...`,
            duration: Math.min(delay, 3000),
          });
        }

        callOptions.onRetry?.(attempt, error, delay);
      },
    });

    setState(prev => ({
      ...prev,
      data: result.data,
      error: result.error,
      isLoading: false,
      isRetrying: false,
      totalAttempts: result.attempts,
    }));

    // Show error toast if failed
    if (result.error && showErrorToast) {
      toast({
        title: result.error.title,
        description: result.error.description,
        variant: 'destructive',
        duration: 5000,
      });
    }

    return result;
  }, [functionName, callOptions, showRetryToast, showErrorToast, retryToastMessage, toast]);

  const reset = useCallback(() => {
    setState({
      data: null,
      error: null,
      isLoading: false,
      isRetrying: false,
      attempt: 0,
      totalAttempts: 0,
    });
  }, []);

  const retry = useCallback(async (): Promise<ResilientCallResult<T> | null> => {
    if (Object.keys(lastPayloadRef.current).length === 0 && !state.error) {
      console.warn('[useResilientEdgeFunction] No previous call to retry');
      return null;
    }
    return execute(lastPayloadRef.current);
  }, [execute, state.error]);

  return {
    state,
    execute,
    reset,
    retry,
  };
}

/**
 * Pre-configured hooks for common edge functions
 */
export function useFreeKeywordScan(options?: UseResilientEdgeFunctionOptions) {
  return useResilientEdgeFunction('free-keyword-scan', {
    maxRetries: 2,
    timeout: 90000,
    initialDelay: 2000,
    retryToastMessage: 'AI is taking a moment...',
    ...options,
  });
}

export function useAnalyzeResume(options?: UseResilientEdgeFunctionOptions) {
  return useResilientEdgeFunction('analyze-resume', {
    maxRetries: 2,
    timeout: 90000,
    initialDelay: 2000,
    retryToastMessage: 'Analyzing your resume...',
    ...options,
  });
}

export function useHealthCheck(options?: UseResilientEdgeFunctionOptions) {
  return useResilientEdgeFunction('health-check', {
    maxRetries: 2,
    timeout: 10000,
    initialDelay: 500,
    showRetryToast: false,
    showErrorToast: false,
    ...options,
  });
}
