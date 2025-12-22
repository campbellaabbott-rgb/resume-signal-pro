import { useState, useCallback, useRef } from "react";

interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (attempt: number, error: unknown, nextDelay: number) => void;
}

interface RetryState {
  isRetrying: boolean;
  attempt: number;
  lastError: unknown | null;
}

/**
 * Hook for implementing retry logic with exponential backoff
 */
export function useRetry<T>(
  asyncFn: () => Promise<T>,
  options: RetryOptions = {}
): {
  execute: () => Promise<T>;
  state: RetryState;
  reset: () => void;
} {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    shouldRetry = (error, attempt) => attempt < maxRetries,
    onRetry,
  } = options;

  const [state, setState] = useState<RetryState>({
    isRetrying: false,
    attempt: 0,
    lastError: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const execute = useCallback(async (): Promise<T> => {
    abortControllerRef.current = new AbortController();
    let currentAttempt = 0;
    let delay = initialDelay;

    while (true) {
      try {
        setState((prev) => ({
          ...prev,
          isRetrying: currentAttempt > 0,
          attempt: currentAttempt,
        }));

        const result = await asyncFn();
        
        setState((prev) => ({
          ...prev,
          isRetrying: false,
          lastError: null,
        }));

        return result;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          lastError: error,
        }));

        currentAttempt++;

        if (!shouldRetry(error, currentAttempt)) {
          setState((prev) => ({
            ...prev,
            isRetrying: false,
          }));
          throw error;
        }

        // Calculate next delay with exponential backoff
        const jitter = Math.random() * 0.3 * delay; // Add up to 30% jitter
        const nextDelay = Math.min(delay + jitter, maxDelay);

        onRetry?.(currentAttempt, error, nextDelay);

        await sleep(nextDelay);

        delay = Math.min(delay * backoffMultiplier, maxDelay);
      }
    }
  }, [asyncFn, maxRetries, initialDelay, maxDelay, backoffMultiplier, shouldRetry, onRetry]);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    setState({
      isRetrying: false,
      attempt: 0,
      lastError: null,
    });
  }, []);

  return { execute, state, reset };
}

/**
 * Standalone retry function for use outside of React components
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    shouldRetry = (error, attempt) => attempt < maxRetries,
    onRetry,
  } = options;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;

      if (!shouldRetry(error, attempt)) {
        throw error;
      }

      const jitter = Math.random() * 0.3 * delay;
      const nextDelay = Math.min(delay + jitter, maxDelay);

      onRetry?.(attempt, error, nextDelay);

      await new Promise((resolve) => setTimeout(resolve, nextDelay));

      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }
}

/**
 * Determine if an error is retryable based on common patterns
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Network errors are generally retryable
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }

  // Check for common retryable HTTP status codes
  if (typeof error === "object" && error !== null) {
    const status = (error as any).status || (error as any).statusCode;
    if (status) {
      // Retryable status codes: 408, 429, 500, 502, 503, 504
      return [408, 429, 500, 502, 503, 504].includes(status);
    }
  }

  // Check error messages for retryable patterns
  if (error instanceof Error) {
    const retryableMessages = [
      "timeout",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "socket hang up",
      "network",
      "temporarily unavailable",
      "service unavailable",
      "rate limit",
    ];

    return retryableMessages.some((msg) =>
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  return false;
}
