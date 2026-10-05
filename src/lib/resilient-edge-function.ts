/**
 * Resilient Edge Function Caller
 * Provides automatic retry logic, circuit breaking, and error handling
 * for Supabase edge function calls
 */

import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError, FunctionsFetchError, FunctionsRelayError } from '@supabase/supabase-js';
import { parseEdgeFunctionError, ParsedEdgeFunctionError } from './edge-function-errors';
import {
  canAttemptService,
  recordServiceSuccess,
  recordServiceFailure,
  countsAsServiceFailure,
  CircuitOpenError,
  getServiceCircuitState
} from '@/hooks/use-circuit-breaker';

/** Thrown when this caller's own clock ran out on an attempt. */
export class EdgeCallTimeoutError extends Error {
  constructor(functionName: string, timeoutMs: number) {
    super(`${functionName} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'EdgeCallTimeoutError';
  }
}

const httpStatusOf = (error: unknown): number | undefined =>
  error instanceof FunctionsHttpError ? (error.context as Response | undefined)?.status : undefined;

/**
 * The free scanner's retry rule (register L5-11, defect sweep 2.05): retry
 * only when the request never got an answer (a dropped connection, a relay
 * failure). Never a 4xx (a limit, a region, a short résumé), never a 5xx or
 * a 504 (each retry walked the server's whole model chain again and spent
 * another of the visitor's daily scans), never this caller's own timeout.
 */
export function shouldRetryScan(error: unknown): boolean {
  if (error instanceof EdgeCallTimeoutError) return false;
  return error instanceof FunctionsFetchError || error instanceof FunctionsRelayError;
}

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
  /** Enable circuit breaker (default: true) */
  enableCircuitBreaker?: boolean;
  /** Callback when circuit is open */
  onCircuitOpen?: (timeUntilRetry: number | null) => void;
}

export interface ResilientCallResult<T> {
  data: T | null;
  error: ParsedEdgeFunctionError | null;
  attempts: number;
  totalDuration: number;
  circuitOpen?: boolean;
  /** The HTTP status of a non-2xx answer (absent for network errors and timeouts). */
  httpStatus?: number;
  /** The JSON body of a non-2xx answer, when it had one (e.g. { rateLimited, code }). */
  errorBody?: Record<string, unknown> | null;
}

/**
 * Check if an error is retryable based on error type and status code
 */
export function isNetworkRetryable(error: unknown): boolean {
  // Circuit open errors should not be retried
  if (error instanceof CircuitOpenError) {
    return false;
  }

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
 * Log retry telemetry for tracking success/failure rates
 */
async function logRetryTelemetry(
  functionName: string,
  eventType: 'retry_attempt' | 'retry_success' | 'retry_exhausted' | 'first_attempt_success',
  attempt: number,
  maxRetries: number,
  durationMs: number,
  errorType?: string,
  errorMessage?: string
): Promise<void> {
  try {
    await supabase.rpc('log_error_telemetry', {
      p_error_code: eventType.toUpperCase(),
      p_error_type: 'retry_telemetry',
      p_error_message: errorMessage || `${eventType} for ${functionName}`,
      p_http_status: null,
      p_function_name: functionName,
      p_context: JSON.parse(JSON.stringify({
        event_type: eventType,
        attempt_number: attempt,
        max_retries: maxRetries,
        duration_ms: durationMs,
        original_error_type: errorType,
        timestamp: new Date().toISOString(),
      })),
    });
  } catch {
    // Silently fail
    console.debug('[Telemetry] Failed to log retry telemetry (non-critical)');
  }
}

/**
 * Call a Supabase edge function with automatic retry and error handling
 */
export async function callEdgeFunctionWithRetry<T = unknown>(
  functionName: string,
  payload: Record<string, unknown> | FormData = {},
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
    enableCircuitBreaker = true,
    onCircuitOpen,
  } = options;

  // Check if payload is FormData for file uploads
  const isFormData = payload instanceof FormData;

  const startTime = Date.now();

  // Check circuit breaker before attempting
  if (enableCircuitBreaker && !canAttemptService(functionName)) {
    const state = getServiceCircuitState(functionName);
    const timeUntilRetry = state.lastFailureTime 
      ? state.resetTimeout - (Date.now() - state.lastFailureTime)
      : null;
    
    console.log(`[EdgeFunction] ${functionName} blocked by circuit breaker`);
    onCircuitOpen?.(timeUntilRetry);
    
    return {
      data: null,
      error: {
        title: 'Service temporarily unavailable',
        description: 'Please try again in a moment.',
        errorCode: 'CIRCUIT_OPEN',
        isRetryable: false,
      },
      attempts: 0,
      totalDuration: Date.now() - startTime,
      circuitOpen: true,
    };
  }

  let attempts = 0;
  let lastError: unknown = null;

  onStart?.();

  while (attempts <= maxRetries) {
    attempts++;

    try {
      // The attempt's own clock. The controller used to be created and never
      // handed to invoke, so no timeout ever fired: a hung function was
      // waited on until the platform's 504 (register L5-11).
      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);

      console.log(`[EdgeFunction] ${functionName} attempt ${attempts}/${maxRetries + 1}`);

      let invoked: { data: T | null; error: unknown };
      try {
        invoked = await supabase.functions.invoke<T>(functionName, {
          body: isFormData ? payload : payload,
          // Don't set Content-Type for FormData - browser sets it with boundary
          signal: controller.signal,
        });
      } catch (invokeError) {
        throw timedOut ? new EdgeCallTimeoutError(functionName, timeout) : invokeError;
      } finally {
        clearTimeout(timeoutId);
      }
      const { data, error } = invoked;

      if (error) {
        throw timedOut ? new EdgeCallTimeoutError(functionName, timeout) : error;
      }

      // Success - record in circuit breaker
      if (enableCircuitBreaker) {
        recordServiceSuccess(functionName);
      }

      const totalDuration = Date.now() - startTime;
      console.log(`[EdgeFunction] ${functionName} succeeded after ${attempts} attempt(s) in ${totalDuration}ms`);

      // NOTE: Don't log success telemetry to error_telemetry table
      // Success events were incorrectly being logged there and showing as "errors" in dashboard

      return {
        data,
        error: null,
        attempts,
        totalDuration,
      };
    } catch (error) {
      lastError = error;
      const totalDuration = Date.now() - startTime;

      // Record failure in circuit breaker: only an outage counts, never a 4xx
      // answer such as a reached limit (countsAsServiceFailure).
      const failedStatus = httpStatusOf(error);
      if (enableCircuitBreaker && countsAsServiceFailure(failedStatus)) {
        recordServiceFailure(functionName, error instanceof Error ? error.message : String(error));
      }

      // Check if we should retry
      const canRetry = attempts <= maxRetries && shouldRetry(error, attempts);

      // Check if circuit is now open after recording failure
      if (enableCircuitBreaker && !canAttemptService(functionName)) {
        console.log(`[EdgeFunction] ${functionName} circuit opened, stopping retries`);
        
        return {
          data: null,
          error: {
            title: 'Service experiencing issues',
            description: 'Please try again later.',
            isRetryable: false,
            errorCode: 'CIRCUIT_OPENED_DURING_RETRY',
          },
          attempts,
          totalDuration,
          circuitOpen: true,
        };
      }

      if (!canRetry) {
        // No more retries, parse and return the error
        console.error(`[EdgeFunction] ${functionName} failed after ${attempts} attempt(s):`, error);

        const parsedError = error instanceof EdgeCallTimeoutError
          ? {
              title: 'Taking too long',
              description: 'The request took too long to answer. Please try again.',
              isRetryable: true,
              errorCode: 'CLIENT_TIMEOUT',
            }
          : await parseEdgeFunctionError(error, functionName, enableTelemetry);

        // The answer's own JSON body, so a caller can tell a reached limit
        // ({ rateLimited: true }) from a busy service without parsing prose.
        let errorBody: Record<string, unknown> | null = null;
        if (error instanceof FunctionsHttpError) {
          try {
            const res = error.context as Response | undefined;
            const parsed = res && typeof res.clone === 'function' ? await res.clone().json() : null;
            errorBody = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
          } catch {
            errorBody = null;
          }
        }

        // Log final failure to telemetry
        if (enableTelemetry) {
          const httpStatus = error instanceof FunctionsHttpError ? error.context?.status : undefined;
          const errorType = error instanceof FunctionsFetchError ? 'network' :
            error instanceof FunctionsRelayError ? 'relay' :
            error instanceof FunctionsHttpError ? 'http' : 'unknown';
          
          logRetryTelemetry(
            functionName,
            'retry_exhausted',
            attempts,
            maxRetries,
            totalDuration,
            errorType,
            error instanceof Error ? error.message : String(error)
          );
          
          logToTelemetry(
            functionName,
            parsedError.errorCode || 'UNKNOWN',
            errorType,
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
          httpStatus: failedStatus,
          errorBody,
        };
      }

      // Calculate delay before retry
      const delay = calculateDelay(attempts, initialDelay, maxDelay, backoffMultiplier);

      console.log(`[EdgeFunction] ${functionName} failed, retrying in ${Math.round(delay)}ms (attempt ${attempts}/${maxRetries + 1})`);

      // Log retry attempt telemetry
      if (enableTelemetry) {
        const errorType = error instanceof FunctionsFetchError ? 'network' :
          error instanceof FunctionsRelayError ? 'relay' :
          error instanceof FunctionsHttpError ? 'http' : 'unknown';
        logRetryTelemetry(
          functionName,
          'retry_attempt',
          attempts,
          maxRetries,
          totalDuration,
          errorType,
          error instanceof Error ? error.message : String(error)
        );
      }

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
    payload: Record<string, unknown> | FormData = {},
    overrideOptions: ResilientCallOptions = {}
  ): Promise<ResilientCallResult<T>> => {
    return callEdgeFunctionWithRetry<T>(functionName, payload, {
      ...defaultOptions,
      ...overrideOptions,
    });
  };
}

/**
 * WHAT A FAILED FREE SCAN MEANS, decided by the answer's status and body,
 * never by an error code the parser does not produce (defect sweep 2.05: the
 * page compared to 'RATE_LIMITED' while the parser emits 'RATE_LIMIT', so a
 * region refusal, a too-short résumé and the daily limit were all re-sent to
 * the streaming fork, which had none of those checks).
 *   daily_limit  429 with { rateLimited: true } from the daily allowance: the
 *                limit message and the scan-pack offer;
 *   refused      any other 4xx (a region, a short résumé, the hourly request
 *                budget, a busy gateway): say so, never retry elsewhere;
 *   outage       a 5xx, no answer, a timeout or an open circuit: the only
 *                case the streaming fallback may run.
 */
export type ScanFailureKind = 'daily_limit' | 'refused' | 'outage';

export function scanFailureKind(result: Pick<ResilientCallResult<unknown>, 'httpStatus' | 'errorBody' | 'error'>): ScanFailureKind {
  const status = result.httpStatus ?? result.error?.statusCode;
  const body = result.errorBody ?? null;
  if (status === 429 && body?.rateLimited === true && body?.code !== 'rate_limited_budget') return 'daily_limit';
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408) return 'refused';
  return 'outage';
}

/**
 * Pre-configured callers for specific functions with appropriate defaults
 */
export const resilientCallers = {
  /**
   * Free keyword scan. The server serves its rule-based report once its own
   * 85-second model clock runs out, so this waits longer than that (plus the
   * work around the model calls) and retries only a request that never got an
   * answer: see shouldRetryScan (register L5-11).
   */
  freeKeywordScan: createResilientCaller('free-keyword-scan', {
    maxRetries: 1,
    timeout: 120000,
    initialDelay: 2000,
    shouldRetry: shouldRetryScan,
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
