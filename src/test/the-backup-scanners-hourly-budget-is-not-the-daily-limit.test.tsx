/**
 * THE BACKUP SCANNER'S HOURLY BUDGET IS NOT THE DAILY LIMIT (S14X-182), AND
 * THE BACKUP IS HANDED WHAT THE VISITOR TOLD THE PRIMARY (S14X-118).
 *
 * When the primary scanner was down, the page fell back to the streaming
 * fork. The fork answers the shared hourly request budget
 * (code rate_limited_budget) and a busy analyser with rateLimited: true, and
 * the page read every rateLimited answer as a spent day: "Daily Scan Limit
 * Reached" and the upgrade dialog, for a visitor who had scanned once. Only a
 * spent day (code daily_scan_limit, or no code from an older fork) opens the
 * upsell now; the hourly budget says to try again in about the minutes the
 * fork named, and a busy analyser says to try again in a minute.
 *
 * The page also sent the primary the visitor's situation and target role and
 * sent the fork none of it; the fork is now handed the same userContext.
 *
 * The real page, with the uploader and the report reduced to the props the
 * page hands them, the primary answering 503 and the fork faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, freeKeywordScan: freeScan } };
});
const fork = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-streaming-scan", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useStreamingScan: () => ({ isStreaming: false, progress: null, startStreamingScan: fork, cancelScan: () => {} }),
}));
vi.mock("@/components/RateLimitUpsell", () => ({ RateLimitUpsell: () => <div data-testid="upsell" /> }));
vi.mock("@/components/FreeKeywordResults", () => ({ FreeKeywordResults: () => <div data-testid="report" /> }));

const RESUME = "Jane Doe\nData Engineer, Acme Corp, Jan 2020 - Present\n- Built pipelines that moved two billion rows a day\n- Led a team of five engineers across three regions";
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: (p: { onResumeDraftChange?: (t: string) => void; onFreeScan?: (t?: string) => void }) => (
    <div>
      <button type="button" onClick={() => p.onResumeDraftChange?.(RESUME)}>draft</button>
      <button type="button" onClick={() => p.onFreeScan?.(RESUME)}>scan</button>
    </div>
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

const DOWN = { data: null, error: { title: "Analysis Failed", description: "Service unavailable", isRetryable: true }, httpStatus: 503, errorBody: null, attempts: 1, totalDuration: 1 };

beforeEach(() => {
  freeScan.mockReset(); fork.mockReset(); toast.mockReset();
  freeScan.mockResolvedValue(DOWN);
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});
afterEach(() => { cleanup(); });

async function scanWith(forkAnswer: unknown) {
  fork.mockResolvedValue(forkAnswer);
  render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
  fireEvent.click(screen.getByRole("button", { name: "scan" }));
  await waitFor(() => expect(fork).toHaveBeenCalledTimes(1), SLOW);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await waitFor(() => expect(toast).toHaveBeenCalled(), SLOW);
}
const titles = () => toast.mock.calls.map(([a]) => String((a as { title?: unknown }).title));

describe("a rateLimited answer from the backup scanner", () => {
  it("for the hourly request budget says to try again soon, names no daily limit and opens no upsell", async () => {
    await scanWith({ success: false, rateLimited: true, code: "rate_limited_budget", retryAfterSeconds: 1800, error: "Too many requests" });
    expect(titles()).toContain(i18n.t("freeScanPage.toast.budgetTitle"));
    expect(titles()).not.toContain(i18n.t("homepage.toast.dailyScanLimitReached"));
    const said = JSON.stringify(toast.mock.calls);
    expect(said, "the fork's 30 minutes").toContain("30");
    expect(screen.queryByTestId("upsell"), "the upgrade dialog opened for an hourly budget").toBeNull();
  });

  it("for a busy analyser says to try again in a minute and opens no upsell", async () => {
    await scanWith({ success: false, rateLimited: true, code: "busy", error: "busy" });
    expect(titles()).toContain(i18n.t("freeScanPage.toast.busyTitle"));
    expect(titles()).not.toContain(i18n.t("homepage.toast.dailyScanLimitReached"));
    expect(screen.queryByTestId("upsell")).toBeNull();
  });

  it("for a spent day still says the daily limit and opens the upsell", async () => {
    await scanWith({ success: false, rateLimited: true, code: "daily_scan_limit", scansUsed: 7, scansLimit: 7, hoursUntilReset: 5, error: "You've used all 7 free scans." });
    expect(titles()).toContain(i18n.t("homepage.toast.dailyScanLimitReached"));
    expect(await screen.findByTestId("upsell", {}, SLOW)).toBeTruthy();
  });
});

describe("the backup scanner is handed what the visitor told the primary (S14X-118)", () => {
  it("the fork's options carry the same userContext as the primary's request", async () => {
    fork.mockResolvedValue(null);
    render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
    const role = await screen.findByPlaceholderText(/Senior Data Engineer/, {}, SLOW);
    fireEvent.change(role, { target: { value: "Staff Data Engineer" } });
    fireEvent.click(screen.getByRole("button", { name: "scan" }));
    await waitFor(() => expect(fork).toHaveBeenCalledTimes(1), SLOW);
    const primary = (freeScan.mock.calls[0][0] as { userContext?: Record<string, unknown> }).userContext;
    const backup = (fork.mock.calls[0][1] as { userContext?: Record<string, unknown> }).userContext;
    expect(primary?.targetRole).toBe("Staff Data Engineer");
    expect(backup, "the fork was sent no userContext").toEqual(primary);
  });
});
