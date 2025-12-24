/**
 * Database Resilience Layer
 * Provides retry logic, timeouts, and connection monitoring for Supabase queries
 */

import { supabase } from "@/integrations/supabase/client";

// Configuration
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const INITIAL_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 5000;
const BACKOFF_MULTIPLIER = 2;

// Connection health state
let connectionHealthy = true;
let lastHealthCheck = Date.now();
let consecutiveFailures = 0;

interface RetryOptions {
  maxRetries?: number;
  timeoutMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

interface QueryResult<T> {
  data: T | null;
  error: Error | null;
  attempts: number;
  durationMs: number;
}

/**
 * Sleep utility with exponential backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate backoff delay with jitter
 */
function getBackoffDelay(attempt: number): number {
  const baseDelay = Math.min(
    INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
    MAX_BACKOFF_MS
  );
  // Add jitter (±25%)
  const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(baseDelay + jitter);
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: any): boolean {
  const retryableCodes = [
    'PGRST301', // Connection error
    'PGRST502', // Bad gateway
    'PGRST503', // Service unavailable
    'PGRST504', // Gateway timeout
    '08000',    // Connection exception
    '08003',    // Connection does not exist
    '08006',    // Connection failure
    '57P01',    // Admin shutdown
    '57P02',    // Crash shutdown
    '57P03',    // Cannot connect now
    '40001',    // Serialization failure
    '40P01',    // Deadlock detected
  ];

  const errorCode = error?.code || error?.message || '';
  const errorMessage = String(error?.message || '').toLowerCase();

  // Check for retryable error codes
  if (retryableCodes.some(code => errorCode.includes(code))) {
    return true;
  }

  // Check for retryable error messages
  const retryableMessages = [
    'connection',
    'timeout',
    'network',
    'econnreset',
    'socket hang up',
    'too many connections',
    'connection pool',
    'deadlock',
  ];

  return retryableMessages.some(msg => errorMessage.includes(msg));
}

/**
 * Execute a query with timeout
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string = 'Query'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Execute a Supabase query with retry logic and timeout
 */
export async function executeWithRetry<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  options: RetryOptions = {}
): Promise<QueryResult<T>> {
  const {
    maxRetries = DEFAULT_RETRY_COUNT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onRetry,
  } = options;

  const startTime = Date.now();
  let lastError: Error | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;

    try {
      const result = await withTimeout(queryFn(), timeoutMs, 'Database query');

      if (result.error) {
        throw result.error;
      }

      // Success - reset failure tracking
      consecutiveFailures = 0;
      connectionHealthy = true;
      lastHealthCheck = Date.now();

      return {
        data: result.data,
        error: null,
        attempts,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      lastError = error;
      consecutiveFailures++;

      // Check if we should retry
      if (attempt < maxRetries && isRetryableError(error)) {
        const delay = getBackoffDelay(attempt);
        
        if (onRetry) {
          onRetry(attempt + 1, error);
        }

        console.warn(
          `[DB Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed: ${error.message}. Retrying in ${delay}ms...`
        );

        await sleep(delay);
      } else {
        // Non-retryable error or max retries reached
        break;
      }
    }
  }

  // Update connection health status
  if (consecutiveFailures >= 3) {
    connectionHealthy = false;
    console.error('[DB Health] Connection marked as unhealthy after consecutive failures');
  }

  return {
    data: null,
    error: lastError,
    attempts,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Execute an RPC call with retry logic
 */
export async function rpcWithRetry<T>(
  functionName: Parameters<typeof supabase.rpc>[0],
  params: Record<string, any> = {},
  options: RetryOptions = {}
): Promise<QueryResult<T>> {
  return executeWithRetry<T>(
    async () => {
      const result = await supabase.rpc(functionName, params as any);
      return { data: result.data as T | null, error: result.error };
    },
    options
  );
}

/**
 * Get current connection health status
 */
export function getConnectionHealth(): {
  healthy: boolean;
  lastCheck: number;
  consecutiveFailures: number;
} {
  return {
    healthy: connectionHealthy,
    lastCheck: lastHealthCheck,
    consecutiveFailures,
  };
}

/**
 * Perform a connection health check
 */
export async function checkConnectionHealth(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    const queryPromise = async () => {
      return await supabase.from('daily_scan_stats').select('date').limit(1);
    };
    
    const result = await withTimeout(queryPromise(), 5000, 'Health check');

    const latencyMs = Date.now() - startTime;
    const healthy = !result.error && latencyMs < 2000;

    connectionHealthy = healthy;
    lastHealthCheck = Date.now();
    if (healthy) consecutiveFailures = 0;

    return {
      healthy,
      latencyMs,
      error: result.error?.message,
    };
  } catch (error: any) {
    consecutiveFailures++;
    connectionHealthy = false;

    return {
      healthy: false,
      latencyMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Connection pool monitoring - tracks query patterns
 */
const queryMetrics = {
  totalQueries: 0,
  successfulQueries: 0,
  failedQueries: 0,
  totalRetries: 0,
  avgLatencyMs: 0,
  lastReset: Date.now(),
};

export function trackQueryMetrics(result: QueryResult<any>): void {
  queryMetrics.totalQueries++;
  
  if (result.error) {
    queryMetrics.failedQueries++;
  } else {
    queryMetrics.successfulQueries++;
  }

  queryMetrics.totalRetries += result.attempts - 1;
  
  // Update rolling average latency
  queryMetrics.avgLatencyMs = 
    (queryMetrics.avgLatencyMs * (queryMetrics.totalQueries - 1) + result.durationMs) / 
    queryMetrics.totalQueries;
}

export function getQueryMetrics(): typeof queryMetrics & { successRate: number } {
  return {
    ...queryMetrics,
    successRate: queryMetrics.totalQueries > 0
      ? (queryMetrics.successfulQueries / queryMetrics.totalQueries) * 100
      : 100,
  };
}

export function resetQueryMetrics(): void {
  queryMetrics.totalQueries = 0;
  queryMetrics.successfulQueries = 0;
  queryMetrics.failedQueries = 0;
  queryMetrics.totalRetries = 0;
  queryMetrics.avgLatencyMs = 0;
  queryMetrics.lastReset = Date.now();
}

/**
 * Batch query executor - reduces connection overhead for multiple queries
 */
export async function executeBatch<T>(
  queries: Array<() => Promise<{ data: T | null; error: any }>>,
  options: RetryOptions = {}
): Promise<Array<QueryResult<T>>> {
  return Promise.all(
    queries.map(query => executeWithRetry(query, options))
  );
}

/**
 * Execute a simple table query with retry logic
 */
export async function queryWithRetry<T>(
  tableName: string,
  queryBuilder: (table: ReturnType<typeof supabase.from>) => Promise<{ data: any; error: any }>,
  options: RetryOptions = {}
): Promise<QueryResult<T>> {
  const result = await executeWithRetry<T>(async () => {
    const table = supabase.from(tableName as any);
    return queryBuilder(table);
  }, options);

  trackQueryMetrics(result);
  return result;
}
