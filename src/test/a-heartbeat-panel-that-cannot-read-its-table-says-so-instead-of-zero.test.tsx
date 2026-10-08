/**
 * A HEARTBEAT PANEL THAT CANNOT READ ITS TABLE SAYS SO INSTEAD OF ZERO (wave 2
 * email-ops, the rest of register L3-08).
 *
 * WHAT WAS WRONG. The /health-check card was moved to admin-ops, but the two
 * other panels the register names still read heartbeat_results with the
 * publishable key, which 20260627121655 revoked: HealthHistoryChart (on the
 * same page) threw, kept its zero state and printed "0%" uptime in red and
 * "0ms" latency, under a card that already said "unavailable"; /scan-metrics'
 * Recent Heartbeat Results said "No heartbeat results yet". And an empty but
 * readable history read as 100% uptime.
 *
 * WHAT HOLDS NOW, by rendering both with the network faked: both ask admin-ops
 * for get_heartbeat_history (20261008127000); a refusal reads "unavailable"
 * and prints no percentage; an empty history prints no percentage either; real
 * rows give a real figure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const adminRpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    rpc: async () => ({ data: [], error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
vi.mock("@/lib/admin-auth", () => ({
  adminRpc: (...a: unknown[]) => adminRpc(...a),
  adminAuthHeaders: () => ({}),
  getStoredAdminKey: () => "k",
}));
vi.mock("@/components/dashboard/AdminAuthGate", () => ({ AdminAuthGate: ({ children }: { children: React.ReactNode }) => children }));

import { HealthHistoryChart } from "@/components/dashboard/HealthHistoryChart";
import ScanMetrics from "../pages/ScanMetrics";

// recharts measures its container; jsdom has none.
class RO { observe() {} unobserve() {} disconnect() {} }

beforeEach(() => {
  adminRpc.mockReset();
  from.mockReset();
  from.mockImplementation(() => { throw new Error("read heartbeat_results directly with the publishable key"); });
  (globalThis as Record<string, unknown>).ResizeObserver = RO;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const refused = async () => ({ data: null, error: { message: "Unauthorized" } });
const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const ROWS = [
  { id: "b", created_at: at(5), function_name: "free-keyword-scan", status: "down", test_passed: false, response_time_ms: 3000, error_message: "E2E scan: HTTP 500", checks_passed: { e2e_scan: { passed: false, time_ms: 3000 } }, probes: null },
  { id: "a", created_at: at(15), function_name: "free-keyword-scan", status: "healthy", test_passed: true, response_time_ms: 1000, error_message: null, checks_passed: { e2e_scan: { passed: true, time_ms: 1000 } }, probes: null },
];

describe("the Health History card", () => {
  it("asks admin-ops, and a refusal reads unavailable with no uptime figure", async () => {
    adminRpc.mockImplementation(refused);
    render(<HealthHistoryChart />);
    await waitFor(() => expect(screen.getByText(/Health history unavailable/)).toBeTruthy());
    expect(adminRpc).toHaveBeenCalledWith("get_heartbeat_history", { p_hours: 24, p_limit: 5000 });
    expect(from, "the card read the closed table with the publishable key").not.toHaveBeenCalled();
    expect(screen.queryByText("0%"), "an unreadable history printed 0% uptime").toBeNull();
    expect(screen.queryByText("0ms")).toBeNull();
  });

  it("an empty history prints no percentage, and real rows give a real one", async () => {
    adminRpc.mockImplementation(async () => ({ data: [], error: null }));
    render(<HealthHistoryChart />);
    await waitFor(() => expect(screen.getByText("Health History (24h)")).toBeTruthy());
    expect(screen.queryByText("100%"), "no rows read as perfect uptime").toBeNull();
    cleanup();
    adminRpc.mockImplementation(async () => ({ data: ROWS, error: null }));
    render(<HealthHistoryChart />);
    await waitFor(() => expect(screen.getByText("50%")).toBeTruthy());
    expect(screen.getByText("2000ms")).toBeTruthy();
  });
});

describe("/scan-metrics' heartbeat list", () => {
  const openTab = async () => {
    const tab = await screen.findByRole("tab", { name: "Heartbeats" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
  };

  it("asks admin-ops for the scan's heartbeats, and a refusal reads unavailable, not 'none yet'", async () => {
    adminRpc.mockImplementation(async (fn: string) => (fn === "get_heartbeat_history" ? refused() : { data: [], error: null }));
    render(<MemoryRouter><ScanMetrics /></MemoryRouter>);
    await openTab();
    await waitFor(() => expect(screen.getByText(/Heartbeat results unavailable/)).toBeTruthy());
    expect(adminRpc).toHaveBeenCalledWith("get_heartbeat_history", { p_hours: 168, p_function: "free-keyword-scan", p_limit: 10 });
    expect(from).not.toHaveBeenCalled();
    expect(screen.queryByText(/No heartbeat results yet/)).toBeNull();
  });

  it("lists the rows it was given, with their checks and error", async () => {
    adminRpc.mockImplementation(async (fn: string) => (fn === "get_heartbeat_history" ? { data: ROWS, error: null } : { data: [], error: null }));
    render(<MemoryRouter><ScanMetrics /></MemoryRouter>);
    await openTab();
    await waitFor(() => expect(screen.getByText("E2E scan: HTTP 500")).toBeTruthy());
    expect(screen.getByText("3000ms")).toBeTruthy();
  });
});
