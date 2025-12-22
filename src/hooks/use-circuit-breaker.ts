import { useState, useCallback, useRef } from "react";

interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenMaxAttempts?: number;
}

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureTime: number | null;
  successesInHalfOpen: number;
}

/**
 * Circuit breaker hook for handling service failures gracefully
 * - Closed: Normal operation, requests go through
 * - Open: Service is down, immediately return fallback
 * - Half-Open: Testing if service is back, allow limited requests
 */
export function useCircuitBreaker(options: CircuitBreakerOptions = {}) {
  const {
    failureThreshold = 3,
    resetTimeout = 30000, // 30 seconds
    halfOpenMaxAttempts = 2,
  } = options;

  const [circuit, setCircuit] = useState<CircuitBreakerState>({
    state: "closed",
    failures: 0,
    lastFailureTime: null,
    successesInHalfOpen: 0,
  });

  const recordSuccess = useCallback(() => {
    setCircuit((prev) => {
      if (prev.state === "half-open") {
        const newSuccesses = prev.successesInHalfOpen + 1;
        if (newSuccesses >= halfOpenMaxAttempts) {
          // Fully recovered
          return {
            state: "closed",
            failures: 0,
            lastFailureTime: null,
            successesInHalfOpen: 0,
          };
        }
        return { ...prev, successesInHalfOpen: newSuccesses };
      }
      return { ...prev, failures: Math.max(0, prev.failures - 1) };
    });
  }, [halfOpenMaxAttempts]);

  const recordFailure = useCallback(() => {
    setCircuit((prev) => {
      const newFailures = prev.failures + 1;
      if (newFailures >= failureThreshold) {
        // Open the circuit
        return {
          state: "open",
          failures: newFailures,
          lastFailureTime: Date.now(),
          successesInHalfOpen: 0,
        };
      }
      return { ...prev, failures: newFailures, lastFailureTime: Date.now() };
    });
  }, [failureThreshold]);

  const canAttempt = useCallback((): boolean => {
    if (circuit.state === "closed") return true;

    if (circuit.state === "open") {
      // Check if we should move to half-open
      const timeSinceFailure = Date.now() - (circuit.lastFailureTime || 0);
      if (timeSinceFailure >= resetTimeout) {
        setCircuit((prev) => ({
          ...prev,
          state: "half-open",
          successesInHalfOpen: 0,
        }));
        return true;
      }
      return false;
    }

    // Half-open: allow limited attempts
    return true;
  }, [circuit.state, circuit.lastFailureTime, resetTimeout]);

  const reset = useCallback(() => {
    setCircuit({
      state: "closed",
      failures: 0,
      lastFailureTime: null,
      successesInHalfOpen: 0,
    });
  }, []);

  return {
    state: circuit.state,
    failures: circuit.failures,
    canAttempt,
    recordSuccess,
    recordFailure,
    reset,
    isOpen: circuit.state === "open",
  };
}

/**
 * Global circuit breakers for different services
 */
const serviceStates: Record<string, CircuitBreakerState> = {};

export function getServiceCircuitState(serviceName: string): CircuitBreakerState {
  if (!serviceStates[serviceName]) {
    serviceStates[serviceName] = {
      state: "closed",
      failures: 0,
      lastFailureTime: null,
      successesInHalfOpen: 0,
    };
  }
  return serviceStates[serviceName];
}

export function recordServiceSuccess(serviceName: string): void {
  const state = getServiceCircuitState(serviceName);
  if (state.state === "half-open") {
    state.successesInHalfOpen++;
    if (state.successesInHalfOpen >= 2) {
      state.state = "closed";
      state.failures = 0;
      state.lastFailureTime = null;
      state.successesInHalfOpen = 0;
    }
  } else {
    state.failures = Math.max(0, state.failures - 1);
  }
}

export function recordServiceFailure(serviceName: string, threshold = 3): void {
  const state = getServiceCircuitState(serviceName);
  state.failures++;
  state.lastFailureTime = Date.now();
  if (state.failures >= threshold) {
    state.state = "open";
  }
}

export function canAttemptService(serviceName: string, resetTimeout = 30000): boolean {
  const state = getServiceCircuitState(serviceName);
  
  if (state.state === "closed") return true;
  
  if (state.state === "open") {
    const timeSinceFailure = Date.now() - (state.lastFailureTime || 0);
    if (timeSinceFailure >= resetTimeout) {
      state.state = "half-open";
      state.successesInHalfOpen = 0;
      return true;
    }
    return false;
  }
  
  return true; // half-open allows attempts
}
