/**
 * A HEALTH PAGE THAT CANNOT READ ITS HEARTBEATS MUST NOT SAY ALL IS WELL, AND
 * A PAID TEST IS RUN BY ITS BUTTON (wave 2 email-ops, register L3-08, L3-09).
 *
 * WHAT WAS WRONG.
 *   L3-08  /health-check read heartbeat_results straight from the browser.
 *          20260627121655 revoked that table from the client roles, the page
 *          dropped the 42501, and an empty list rendered "100%" uptime and "No
 *          recent incidents / All systems operational" -- perfect health exactly
 *          when its source was unreadable, while get_scan_health_status said
 *          'critical'.
 *   L3-09  every 30-second refresh re-ran the AI fallback test, which spends a
 *          model call and allows three an hour; the fourth refresh got a 429
 *          and the panel showed red "Degraded" for the rest of the hour.
 *
 * WHAT HOLDS NOW, by rendering the real page with its network faked: the
 * heartbeats come through admin-ops (get_recent_heartbeats), a refusal reads
 * "unavailable" and never 100% or "All systems operational", the refresh loop
 * never runs the AI test, the test runs from its buttons, and a 429 keeps the
 * last result with the reason beside it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
const adminRpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/lib/admin-auth", () => ({
  adminRpc: (...a: unknown[]) => adminRpc(...a),
  adminAuthHeaders: () => ({}),
  getStoredAdminKey: () => "k",
}));
vi.mock("@/components/dashboard/AdminAuthGate", () => ({ AdminAuthGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/hooks/use-circuit-breaker", () => ({ getAllCircuitStates: () => ({}), resetServiceCircuit: () => {} }));
for (const m of ["HealthTrendChart", "EmailTrendChart", "WebhookTrendChart", "AIGenerationTrendChart", "UserHealthTable", "HealthHistoryChart", "GeoPerformanceChart", "IndustryDetectionChart"]) {
  vi.doMock(`@/components/dashboard/${m}`, () => ({ [m]: () => null }));
}

import HealthCheck from "../pages/HealthCheck";

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { context: { status } });
const QUICK_OK = { success: true, mode: "quick", fallbackConfig: ["google/gemini-2.5-pro"], modelUsed: "google/gemini-2.5-pro", usedFallback: false, totalTime: 900 };
let intervals: Array<() => void> = [];

beforeEach(() => {
  invoke.mockReset();
  adminRpc.mockReset();
  intervals = [];
  vi.spyOn(window, "setInterval").mockImplementation(((fn: () => void) => { intervals.push(fn); return 1 as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval);
  invoke.mockImplementation(async (fn: string) => (fn === "test-ai-fallback" ? { data: QUICK_OK, error: null } : { data: null, error: httpError(500) }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const page = () => render(<MemoryRouter><HealthCheck /></MemoryRouter>);
const aiTests = () => invoke.mock.calls.filter(([fn]) => fn === "test-ai-fallback");

describe("the heartbeat history", () => {
  it("comes through admin-ops, and a refusal reads unavailable -- never 100% or all clear", async () => {
    adminRpc.mockImplementation(async (fn: string) => (fn === "get_recent_heartbeats" ? { data: null, error: { message: "Unauthorized" } } : { data: null, error: null }));
    page();
    await waitFor(() => expect(screen.getByText(/Heartbeat history unavailable/)).toBeTruthy());
    expect(adminRpc).toHaveBeenCalledWith("get_recent_heartbeats", { p_limit: 10 });
    expect(screen.getByText("unavailable")).toBeTruthy();
    expect(screen.queryByText("100%"), "an unreadable history printed perfect uptime").toBeNull();
    expect(screen.queryByText(/All systems operational/)).toBeNull();
    expect(screen.getByText(/Incidents unknown/)).toBeTruthy();
  });

  it("real rows give a real figure and their incidents", async () => {
    const at = new Date().toISOString();
    adminRpc.mockImplementation(async (fn: string) => (fn === "get_recent_heartbeats"
      ? { data: [
        { id: "a", created_at: at, status: "healthy", response_time_ms: 900, test_passed: true, function_name: "free-keyword-scan" },
        { id: "b", created_at: at, status: "down", response_time_ms: 75000, test_passed: false, function_name: "free-keyword-scan" },
      ], error: null }
      : { data: null, error: null }));
    page();
    await waitFor(() => expect(screen.getByText("50%")).toBeTruthy());
    expect(screen.getByText(/free-keyword-scan failed after 75000ms/)).toBeTruthy();
  });
});

describe("the AI fallback test", () => {
  beforeEach(() => {
    adminRpc.mockImplementation(async () => ({ data: null, error: null }));
  });

  it("is not run on load nor by the 30-second refresh; only its buttons run it", async () => {
    page();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("health-check"));
    expect(aiTests(), "the page spent a model call on load").toEqual([]);
    expect(intervals.length).toBeGreaterThan(0);
    for (const tick of intervals) tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(aiTests(), "the refresh loop spent a model call every 30 s").toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Quick test/ }));
    await waitFor(() => expect(aiTests()).toHaveLength(1));
  });

  it("a 429 keeps the last result and says it was rate-limited, instead of turning the panel red", async () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: /Quick test/ }));
    await waitFor(() => expect(screen.getByText("Healthy")).toBeTruthy());
    invoke.mockImplementation(async (fn: string) => (fn === "test-ai-fallback" ? { data: null, error: httpError(429) } : { data: null, error: httpError(500) }));
    fireEvent.click(screen.getByRole("button", { name: /Quick test/ }));
    await waitFor(() => expect(screen.getByText(/Rate-limited \(3 tests an hour\): last result shown/)).toBeTruthy());
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.queryByText("Degraded")).toBeNull();
  });
});
