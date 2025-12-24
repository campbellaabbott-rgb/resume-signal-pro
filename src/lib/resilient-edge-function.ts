/**
 * Resilient Edge Function Caller
 * Provides automatic retry logic, circuit breaking, and error handling
 * for Supabase edge function calls
 */

import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError, FunctionsFetchError, FunctionsRelayError } from '@supabase/supabase-js';
import { parseEdgeFunctionError, ParsedEdgeFunctionError } from './edge-function-errors';

export interface ResilientCallOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in ms between retries (default: 10000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Timeout in ms for each attempt (default: 60000) */
  timeout?: number;
  /** Custom function to determine if error should be retried */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback when a retry is attempted */
  onRetry?: (attempt: number, error: unknown, nextDelay: number) => void;
  /** Callback when request starts */
  onStart?: () => void;
  /** Enable telemetry tracking (default: true) */
  enableTelemetry?: boolean;
}

export interface ResilientCallResult<T> {
  data: T | null;
  error: ParsedEdgeFunctionError | null;
  attempts: number;
  totalDuration: number;
}

/**
 * Check if an error is retryable based on error type and status code
 */
export function isNetworkRetryable(error: unknown): boolean {
  // Network/fetch errors are always retryable
  if (error instanceof FunctionsFetchError) {
    return true;
  }

  // Relay errors are retryable
  if (error instanceof FunctionsRelayError) {
    return true;
  }

  // HTTP errors - check status code
  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status;
    // Retryable status codes: 408 (timeout), 429 (rate limit), 500+
    if (status && (status === 408 || status === 429 || status >= 500)) {
      return true;
    }
    return false;
  }

  // Check for TypeError from fetch (network issues)
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    if (
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('failed to fetch')
    ) {
      return true;
    }
  }

  // Check generic Error for retryable patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const retryablePatterns = [
      'timeout',
      'econnreset',
      'econnrefused',
      'etimedout',
      'socket hang up',
      'network',
      'temporarily unavailable',
      'service unavailable',
      'too many requests',
      'rate limit',
      'aborted',
    ];
    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number
): number {
  const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Sleep for specified milliseconds
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Log error to telemetry (fire-and-forget)
 */
async function logToTelemetry(
  functionName: string,
  errorCode: string,
  errorType: string,
  errorMessage: string,
  httpStatus?: number,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.rpc('log_error_telemetry', {
      p_error_code: errorCode,
      p_error_type: errorType,
      p_error_message: errorMessage,
      p_http_status: httpStatus || null,
      p_function_name: functionName,
      p_context: context ? JSON.parse(JSON.stringify(context)) : null,
    });
  } catch {
    // Silently fail - don't let telemetry affect the main flow
    console.debug('[Telemetry] Failed to log error (non-critical)');
  }
}

/**
 * Call a Supabase edge function with automatic retry and error handling
 */
export async function callEdgeFunctionWithRetry<T = unknown>(
  functionName: string,
  payload: Record<string, unknown> = {},
  options: ResilientCallOptions = {}
): Promise<ResilientCallResult<T>> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    timeout = 60000,
    shouldRetry = isNetworkRetryable,
    onRetry,
    onStart,
    enableTelemetry = true,
  } = options;

  const startTime = Date.now();
  let attempts = 0;
  let lastError: unknown = null;

  onStart?.();

  while (attempts <= maxRetries) {
    attempts++;

    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      console.log(`[EdgeFunction] ${functionName} attempt ${attempts}/${maxRetries + 1}`);

      const { data, error } = await supabase.functions.invoke<T>(functionName, {
        body: payload,
      });

      clearTimeout(timeoutId);

      if (error) {
        throw error;
      }

      // Success
      const totalDuration = Date.now() - startTime;
      console.log(`[EdgeFunction] ${functionName} succeeded after ${attempts} attempt(s) in ${totalDuration}ms`);

      return {
        data,
        error: null,
        attempts,
        totalDuration,
      };
    } catch (error) {
      lastError = error;
      const totalDuration = Date.now() - startTime;

      // Check if we should retry
      const canRetry = attempts <= maxRetries && shouldRetry(error, attempts);

      if (!canRetry) {
        // No more retries, parse and return the error
        console.error(`[EdgeFunction] ${functionName} failed after ${attempts} attempt(s):`, error);

        const parsedError = await parseEdgeFunctionError(error, functionName, enableTelemetry);

        // Log final failure to telemetry
        if (enableTelemetry) {
          const httpStatus = error instanceof FunctionsHttpError ? error.context?.status : undefined;
          logToTelemetry(
            functionName,
            parsedError.errorCode || 'UNKNOWN',
            error instanceof FunctionsFetchError ? 'network' :
              error instanceof FunctionsRelayError ? 'relay' :
              error instanceof FunctionsHttpError ? 'http' : 'unknown',
            error instanceof Error ? error.message : String(error),
            httpStatus,
            { attempts, totalDuration, retriesExhausted: attempts > maxRetries }
          );
        }

        return {
          data: null,
          error: parsedError,
          attempts,
          totalDuration,
        };
      }

      // Calculate delay before retry
      const delay = calculateDelay(attempts, initialDelay, maxDelay, backoffMultiplier);

      console.log(`[EdgeFunction] ${functionName} failed, retrying in ${Math.round(delay)}ms (attempt ${attempts}/${maxRetries + 1})`);

      onRetry?.(attempts, error, delay);

      await sleep(delay);
    }
  }

  // This shouldn't be reached, but just in case
  const parsedError = await parseEdgeFunctionError(lastError, functionName, enableTelemetry);
  return {
    data: null,
    error: parsedError,
    attempts,
    totalDuration: Date.now() - startTime,
  };
}

/**
 * Create a resilient edge function caller with preset options
 */
export function createResilientCaller<T = unknown>(
  functionName: string,
  defaultOptions: ResilientCallOptions = {}
) {
  return async (
    payload: Record<string, unknown> = {},
    overrideOptions: ResilientCallOptions = {}
  ): Promise<ResilientCallResult<T>> => {
    return callEdgeFunctionWithRetry<T>(functionName, payload, {
      ...defaultOptions,
      ...overrideOptions,
    });
  };
}

/**
 * Pre-configured callers for specific functions with appropriate defaults
 */
export const resilientCallers = {
  /** Free keyword scan - longer timeout due to AI processing */
  freeKeywordScan: createResilientCaller('free-keyword-scan', {
    maxRetries: 2,
    timeout: 90000, // 90 seconds for AI
    initialDelay: 2000,
  }),

  /** Analyze resume - similar to keyword scan */
  analyzeResume: createResilientCaller('analyze-resume', {
    maxRetries: 2,
    timeout: 90000,
    initialDelay: 2000,
  }),

  /** Health check - quick with fast retries */
  healthCheck: createResilientCaller('health-check', {
    maxRetries: 2,
    timeout: 10000,
    initialDelay: 500,
    maxDelay: 2000,
  }),

  /** Create checkout - moderate settings */
  createCheckout: createResilientCaller('create-checkout', {
    maxRetries: 2,
    timeout: 30000,
    initialDelay: 1000,
  }),

  /** Parse PDF - file processing needs time */
  parsePdf: createResilientCaller('parse-pdf', {
    maxRetries: 2,
    timeout: 60000,
    initialDelay: 1000,
  }),

  /** Parse DOCX */
  parseDocx: createResilientCaller('parse-docx', {
    maxRetries: 2,
    timeout: 60000,
    initialDelay: 1000,
  }),

  /** Parse Spreadsheet (Excel/CSV/Google Sheets) */
  parseSpreadsheet: createResilientCaller('parse-spreadsheet', {
    maxRetries: 2,
    timeout: 60000,
    initialDelay: 1000,
  }),
};
