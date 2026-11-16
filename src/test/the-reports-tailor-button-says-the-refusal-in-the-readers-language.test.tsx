/**
 * THE REPORT'S TAILOR BUTTON SENDS ONE REQUEST AND SAYS ITS REFUSAL IN THE
 * READER'S LANGUAGE (S14X-058).
 *
 * The scanner page's "Generate tailored résumé" called the writer through a
 * caller that retried a 401, 402, 429 or 5xx up to twice more, each after the
 * server had counted the day's use, and toasted the caller's English
 * ("Failed to generate tailored resume", "Edge Function returned a non-2xx
 * status code"). The job board's buttons word the same refusals through
 * writingToolToast. Now the page's call retries only a request that never
 * got an answer (shouldRetryScan), with no circuit breaker, and its toast is
 * writingToolToast's for the answer the writer gave.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "gte", "lte", "insert", "upsert", "update", "delete"]) chain[k] = () => chain;
  Object.assign(chain, {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));

const freeScan = vi.hoisted(() => vi.fn());
const writer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, callEdgeFunctionWithRetry: writer, resilientCallers: { ...actual.resilientCallers, freeKeywordScan: freeScan } };
});

const RESUME = "Jane Doe\nData Engineer, Acme Corp, Jan 2020 - Present\n- Built pipelines that moved two billion rows a day\n- Led a team of five engineers across three regions";
const POSTING = "Senior Data Engineer at Northwind. Own the batch and streaming pipelines, mentor four engineers and run the on-call rota.";
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: (p: { onResumeDraftChange?: (t: string) => void; onFreeScan?: (t?: string) => void; onJobDescriptionTextChange?: (t: string) => void }) => (
    <div>
      <button type="button" onClick={() => { p.onResumeDraftChange?.(RESUME); p.onJobDescriptionTextChange?.(POSTING); }}>draft</button>
      <button type="button" onClick={() => p.onFreeScan?.(RESUME)}>scan</button>
    </div>
  ),
}));
vi.mock("@/components/FreeKeywordResults", () => ({
  FreeKeywordResults: (p: { onGenerateTailoredResume?: () => void }) => (
    <div data-testid="report"><button type="button" onClick={() => p.onGenerateTailoredResume?.()}>tailor</button></div>
  ),
}));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import Index from "@/pages/Index";
import i18n from "@/i18n";
import { shouldRetryScan } from "@/lib/resilient-edge-function";
import { writingToolToast } from "@/lib/writing-refusal";

const REPORT = { success: true, industry: "data_engineering", atsScoreEstimate: 71, formatGrade: "B", experienceLevel: "mid", keywords: [], redFlags: [], quickWins: [], matchingSkills: ["spark"], missingSkills: ["dbt"] };

beforeEach(() => {
  freeScan.mockReset(); writer.mockReset(); toast.mockReset();
  freeScan.mockResolvedValue({ data: REPORT, error: null, attempts: 1, totalDuration: 1 });
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});
afterEach(() => { cleanup(); });

/** The writer answers `status` with `body`, as the caller hands an answered refusal back. */
async function pressTailorAnswered(status: number, body: Record<string, unknown>) {
  writer.mockResolvedValue({
    data: null,
    error: { title: "Request failed", description: "Edge Function returned a non-2xx status code", isRetryable: status >= 500, statusCode: status },
    httpStatus: status, errorBody: body, attempts: 1, totalDuration: 1,
  });
  render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
  fireEvent.click(screen.getByRole("button", { name: "scan" }));
  fireEvent.click(await screen.findByRole("button", { name: "tailor" }, SLOW));
  await waitFor(() => expect(toast.mock.calls.some(([a]) => (a as { variant?: string }).variant === "destructive")).toBe(true), SLOW);
  return toast.mock.calls.map(([a]) => a as { title?: string; description?: string }).find((a) => (a as { variant?: string }).variant === "destructive")!;
}
const say = (k: string, f: string, v?: Record<string, unknown>) => i18n.t(k, f, v) as string;
const expected = (status: number, body: Record<string, unknown>) =>
  writingToolToast("tailor", { context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) }, say, i18n.language);

describe("one press is one request", () => {
  it("the writer's call retries only a request that never got an answer, with no breaker", async () => {
    await pressTailorAnswered(503, { error: "busy" });
    const calls = writer.mock.calls.filter(([fn]) => fn === "generate-tailored-resume");
    expect(calls).toHaveLength(1);
    const options = calls[0][2] as { shouldRetry?: unknown; enableCircuitBreaker?: unknown };
    expect(options.shouldRetry, "an answered 429 or 5xx is sent again").toBe(shouldRetryScan);
    expect(options.enableCircuitBreaker).toBe(false);
  });
});

describe("the refusal is worded as the writing tools word it", () => {
  it("a spent day says the daily-limit sentence", async () => {
    const body = { error: "daily_limit", resetsAt: new Date(Date.now() + 5 * 3600_000).toISOString() };
    const shown = await pressTailorAnswered(429, body);
    const want = await expected(429, body);
    expect(shown.description).toBe(want.description);
    expect(shown.description).not.toMatch(/daily_limit|non-2xx/);
  });

  it("a signed-out reader is told to sign in", async () => {
    const body = { error: "sign_in_required" };
    const shown = await pressTailorAnswered(401, body);
    expect(shown.description).toBe((await expected(401, body)).description);
  });

  it("an outage says the tool's own error, never the raw status", async () => {
    const shown = await pressTailorAnswered(503, { error: "upstream" });
    expect(shown.description).toBe((await expected(503, { error: "upstream" })).description);
    expect(`${shown.title} ${shown.description}`).not.toMatch(/non-2xx|Failed to generate tailored resume/);
  });
});
