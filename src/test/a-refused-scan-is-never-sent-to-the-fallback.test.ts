/**
 * A REFUSED SCAN IS NEVER SENT TO THE FALLBACK, AND A REACHED LIMIT IS NOT AN OUTAGE.
 *
 * Defect sweep 2.05 / register L13-46: the page sent a failed primary scan to
 * the limit upsell only for errorCode 'RATE_LIMITED', which the parser never
 * produces, so a region refusal (403), a too-short résumé (400) and the daily
 * limit (429) were all re-sent to the streaming fork, which had none of those
 * checks; and every 429 counted toward the scanner's circuit, so a user's
 * second over-limit click showed everyone "Resume Scanner Unavailable".
 * Register L5-11: the caller's timeout was created and never handed to
 * invoke, and a 504 was retried twice more, each retry a fresh daily scan.
 *
 * Run against the shipped caller with supabase.functions.invoke faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, rpc: vi.fn(async () => ({ data: null, error: null })) },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import {
  callEdgeFunctionWithRetry,
  resilientCallers,
  scanFailureKind,
  shouldRetryScan,
} from "@/lib/resilient-edge-function";
import { countsAsServiceFailure, getServiceCircuitState, resetServiceCircuit } from "@/hooks/use-circuit-breaker";

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  invoke.mockReset();
  resetServiceCircuit("free-keyword-scan");
});

describe("what a failed scan means", () => {
  it("the daily allowance is the limit; the hourly budget, a region or a short résumé is a refusal; only 5xx or silence is an outage", () => {
    expect(scanFailureKind({ httpStatus: 429, errorBody: { rateLimited: true, scansLimit: 7 }, error: null })).toBe("daily_limit");
    expect(scanFailureKind({ httpStatus: 429, errorBody: { rateLimited: true, code: "rate_limited_budget" }, error: null })).toBe("refused");
    expect(scanFailureKind({ httpStatus: 429, errorBody: { error: "Service busy. Please try again in a moment." }, error: null })).toBe("refused");
    expect(scanFailureKind({ httpStatus: 403, errorBody: { error: "Service not available in your region." }, error: null })).toBe("refused");
    expect(scanFailureKind({ httpStatus: 400, errorBody: null, error: null })).toBe("refused");
    expect(scanFailureKind({ httpStatus: 500, errorBody: null, error: null })).toBe("outage");
    expect(scanFailureKind({ httpStatus: 504, errorBody: null, error: null })).toBe("outage");
    expect(scanFailureKind({ httpStatus: undefined, errorBody: null, error: { title: "", description: "", isRetryable: true, errorCode: "CIRCUIT_OPEN" } })).toBe("outage");
  });

  it("a 4xx says nothing about the service's health", () => {
    for (const s of [400, 402, 403, 404, 429]) expect(countsAsServiceFailure(s), String(s)).toBe(false);
    for (const s of [undefined, 408, 500, 502, 503, 504]) expect(countsAsServiceFailure(s), String(s)).toBe(true);
  });

  it("the scanner retries only a request that never got an answer", () => {
    expect(shouldRetryScan(new FunctionsFetchError(new Error("Failed to fetch")))).toBe(true);
    expect(shouldRetryScan(httpError(504, {}))).toBe(false);
    expect(shouldRetryScan(httpError(500, {}))).toBe(false);
    expect(shouldRetryScan(httpError(429, { rateLimited: true }))).toBe(false);
  });
});

describe("the caller, run", () => {
  it("hands its timeout to invoke, and a timed-out attempt is reported as a timeout", async () => {
    let seen: AbortSignal | undefined;
    invoke.mockImplementation((_fn: string, opts: { signal?: AbortSignal }) => {
      seen = opts.signal;
      return new Promise((_ok, no) => opts.signal?.addEventListener("abort", () => no(new FunctionsFetchError(new Error("aborted")))));
    });
    const r = await callEdgeFunctionWithRetry("free-keyword-scan", { resumeText: "x" }, { timeout: 20, maxRetries: 0, enableTelemetry: false });
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(true);
    expect(r.error?.errorCode).toBe("CLIENT_TIMEOUT");
  });

  it("an over-limit scan is answered once, with its body, and never opens the circuit", async () => {
    invoke.mockImplementation(async () => ({ data: null, error: httpError(429, { rateLimited: true, scansUsed: 7, scansLimit: 7, error: "You've used all 7 free scans for today." }) }));
    for (let click = 0; click < 3; click++) {
      const r = await resilientCallers.freeKeywordScan({ resumeText: "x" }, { enableTelemetry: false });
      expect(r.httpStatus).toBe(429);
      expect(r.errorBody?.rateLimited).toBe(true);
      expect(scanFailureKind(r)).toBe("daily_limit");
    }
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(getServiceCircuitState("free-keyword-scan").state).toBe("closed");
  });

  it("a 504 is not retried: one click is one scan", async () => {
    invoke.mockImplementation(async () => ({ data: null, error: httpError(504, {}) }));
    const r = await resilientCallers.freeKeywordScan({ resumeText: "x" }, { enableTelemetry: false, initialDelay: 1 });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(scanFailureKind(r)).toBe("outage");
  });
});
