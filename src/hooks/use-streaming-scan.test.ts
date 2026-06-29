import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// The hook's transitive deps (edge-function-errors, resilient-edge-function)
// import the Supabase client, which tries to access localStorage at module
// init time and fires auth timers — both of which break in this jsdom env.
// Mocking the client here cuts that off entirely; our hook only uses `fetch`
// directly, so nothing in the test path actually needs a real Supabase client.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    auth: { getSession: vi.fn().mockResolvedValue({ data: {}, error: null }) },
  },
}));

import { useStreamingScan } from "./use-streaming-scan";

// ─── helpers ───────────────────────────────────────────────────────────────

function makeSSEStream(...events: { type: string; data: object }[]) {
  const chunks = events.map(
    (e) => `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`
  );
  let idx = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(encoder.encode(chunks[idx++]));
      } else {
        controller.close();
      }
    },
  });
  return stream;
}

// Stable fetch mock — always replaced per-test but must exist as a vi.fn()
// globally so vi.mocked(fetch) works even in tests that don't call mockFetchWith.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function mockFetchWith(stream: ReadableStream | null, status = 200) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    body: stream,
  });
}

// MIN_RESUME_LENGTH is 200 — short text is a warning only; empty triggers isValid=false.
const VALID_RESUME = "A".repeat(200);

// ─── setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  // Do NOT call vi.unstubAllGlobals() — that would remove the fetchMock stub
  // registered at module level, causing subsequent tests to hit the real network.
});

// ─── tests ──────────────────────────────────────────────────────────────────

describe("useStreamingScan", () => {
  it("returns initial idle state", () => {
    const { result } = renderHook(() => useStreamingScan());
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("transitions to streaming on start", async () => {
    mockFetchWith(
      makeSSEStream(
        { type: "progress", data: { stage: "analyzing", message: "Analyzing...", progress: 50 } },
        { type: "complete", data: { success: true, atsScoreEstimate: 80 } }
      )
    );

    const { result } = renderHook(() => useStreamingScan());
    let returnVal: unknown;

    await act(async () => {
      returnVal = await result.current.startStreamingScan(VALID_RESUME, { skipCache: true });
    });

    expect(returnVal).toMatchObject({ success: true, atsScoreEstimate: 80 });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.progress?.stage).toBe("complete");
    expect(result.current.error).toBeNull();
  });

  it("fires onProgress callbacks for each progress event", async () => {
    mockFetchWith(
      makeSSEStream(
        { type: "progress", data: { stage: "parsing", message: "Parsing...", progress: 20 } },
        { type: "progress", data: { stage: "scoring", message: "Scoring...", progress: 60 } },
        { type: "complete", data: { success: true } }
      )
    );

    const onProgress = vi.fn();
    const { result } = renderHook(() => useStreamingScan());

    await act(async () => {
      await result.current.startStreamingScan(VALID_RESUME, { skipCache: true, onProgress });
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ stage: "parsing" }));
    expect(onProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ stage: "scoring" }));
  });

  it("fires onComplete with result data", async () => {
    const completePayload = { success: true, atsScoreEstimate: 72, industry: "Tech" };
    mockFetchWith(makeSSEStream({ type: "complete", data: completePayload }));

    const onComplete = vi.fn();
    const { result } = renderHook(() => useStreamingScan());

    await act(async () => {
      await result.current.startStreamingScan(VALID_RESUME, { skipCache: true, onComplete });
    });

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining(completePayload));
  });

  it("handles server-side error event", async () => {
    mockFetchWith(
      makeSSEStream({ type: "error", data: { error: "AI service unavailable" } })
    );

    const onError = vi.fn();
    const { result } = renderHook(() => useStreamingScan());

    await act(async () => {
      await result.current.startStreamingScan(VALID_RESUME, { skipCache: true, onError });
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ description: "AI service unavailable" })
    );
    expect(result.current.error).not.toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });

  it("returns rate limit info on rateLimited error event", async () => {
    mockFetchWith(
      makeSSEStream({
        type: "error",
        data: { error: "Daily limit reached", rateLimited: true },
      })
    );

    const { result } = renderHook(() => useStreamingScan());
    let returnVal: unknown;

    await act(async () => {
      returnVal = await result.current.startStreamingScan(VALID_RESUME, { skipCache: true });
    });

    expect(returnVal).toMatchObject({ success: false, rateLimited: true });
  });

  it("rejects empty resume text with a validation error", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useStreamingScan());
    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      await result.current.startStreamingScan("", { onError });
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "VALIDATION_ERROR" })
    );
    // fetch must never be called for invalid resumes
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("returns cached result on second call without skipCache", async () => {
    const completePayload = { success: true, atsScoreEstimate: 90, industry: "Finance" };
    mockFetchWith(makeSSEStream({ type: "complete", data: completePayload }));

    const { result } = renderHook(() => useStreamingScan());

    // First call — hits network
    await act(async () => {
      await result.current.startStreamingScan(VALID_RESUME, { skipCache: true });
    });

    const fetchMock = vi.mocked(fetch);
    const callCount = fetchMock.mock.calls.length;

    // Second call — should hit cache
    let cached: unknown;
    await act(async () => {
      cached = await result.current.startStreamingScan(VALID_RESUME);
    });

    expect(cached).toMatchObject({ cached: true });
    expect(fetchMock.mock.calls.length).toBe(callCount); // no new fetch
  });

  it("cancelScan resets state and returns null", async () => {
    // Never-resolving fetch so we can cancel mid-flight
    fetchMock.mockImplementation(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("AbortError"), { name: "AbortError" }))
          );
        })
    );

    const { result } = renderHook(() => useStreamingScan());

    act(() => {
      result.current.startStreamingScan(VALID_RESUME, { skipCache: true });
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => {
      result.current.cancelScan();
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBeNull();
  });

  it("sets error state on HTTP 500 after exhausting retries", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, body: null });

    const onError = vi.fn();
    const { result } = renderHook(() => useStreamingScan());

    await act(async () => {
      await result.current.startStreamingScan(VALID_RESUME, {
        skipCache: true,
        maxRetries: 1,
        retryDelay: 0,
        onError,
      });
    });

    expect(onError).toHaveBeenCalled();
    expect(result.current.error).not.toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });
});
