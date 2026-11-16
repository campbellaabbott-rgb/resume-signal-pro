/**
 * THE HEALTH SERVICES TAB SAYS IT HAS NO READING INSTEAD OF DRAWING ZERO
 * (cost wave 2, 2026-11-16).
 *
 * The Services tab of the /health-check history card draws Database, AI
 * Gateway and Stripe latency from one source only: the per-service probes in
 * scheduled-health-probe's heartbeat rows (metadata.probes). scan-heartbeat's
 * rows carry none. 20261115100000 unscheduled the five-minute probe, so the
 * tab would otherwise draw three flat lines at 0 ms for every hour, which
 * reads as three instant services. An hour without a reading is now a gap,
 * and a day without any says so in words.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

const adminRpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => { throw new Error("read heartbeat_results directly with the publishable key"); },
    rpc: async () => ({ data: [], error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
vi.mock("@/lib/admin-auth", () => ({
  adminRpc: (...a: unknown[]) => adminRpc(...a),
  adminAuthHeaders: () => ({}),
  getStoredAdminKey: () => "k",
}));

import { HealthHistoryChart } from "@/components/dashboard/HealthHistoryChart";

// recharts measures its container; jsdom has none.
class RO { observe() {} unobserve() {} disconnect() {} }

beforeEach(() => {
  adminRpc.mockReset();
  (globalThis as Record<string, unknown>).ResizeObserver = RO;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
/** scan-heartbeat's shape: checks_passed {name: {passed, time_ms}}, no probes. */
const HEARTBEAT = (id: string, minAgo: number) => ({
  id, created_at: at(minAgo), function_name: "free-keyword-scan", status: "healthy", test_passed: true,
  response_time_ms: 900, error_message: null, checks_passed: { e2e_scan: { passed: true, time_ms: 900 } }, probes: null,
});
/** A keyed scheduled-health-probe row: per-service latency in probes. */
const PROBE = (id: string, minAgo: number) => ({
  id, created_at: at(minAgo), function_name: "scheduled-health-probe", status: "healthy", test_passed: true,
  response_time_ms: 300, error_message: null, checks_passed: null,
  probes: [{ service: "database", latency_ms: 42 }, { service: "ai_gateway", latency_ms: 180 }, { service: "stripe", latency_ms: 95 }],
});
const NONE = /No per-service latency recorded in the last 24 hours/;

async function openServices() {
  await waitFor(() => expect(screen.getByText("Health History (24h)")).toBeTruthy());
  const tab = await screen.findByRole("tab", { name: /Services/ });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

describe("the Services tab of the health history card", () => {
  it("says it has no per-service reading when only scan-heartbeat rows exist", async () => {
    adminRpc.mockImplementation(async () => ({ data: [HEARTBEAT("b", 5), HEARTBEAT("a", 75)], error: null }));
    render(<HealthHistoryChart />);
    await openServices();
    await waitFor(() => expect(screen.getByText(NONE)).toBeTruthy());
  });

  it("draws the chart, not the notice, once one probe row carries per-service latency", async () => {
    adminRpc.mockImplementation(async () => ({ data: [HEARTBEAT("c", 5), PROBE("b", 10), HEARTBEAT("a", 75)], error: null }));
    render(<HealthHistoryChart />);
    await openServices();
    await waitFor(() => expect(screen.getByRole("tabpanel")).toBeTruthy());
    expect(screen.queryByText(NONE)).toBeNull();
  });
});
