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
 * each reading a dot (a lone hour between two gaps would otherwise draw
 * nothing), and a day without any says so in words.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";

const adminRpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => { throw new Error("read heartbeat_results directly with the publishable key"); },
    rpc: async () => ({ data: [], error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
// ResponsiveContainer measures a box jsdom never lays out and so draws
// nothing; a fixed size lets the chart render its lines and dots here. A Line
// leaves its dots out until its entry animation ends, which never happens in
// jsdom, so the animation is off here (the page keeps it).
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  const line = actual.Line as unknown as { defaultProps?: Record<string, unknown> };
  line.defaultProps = { ...line.defaultProps, isAnimationActive: false };
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => (
      <div style={{ width: 800, height: 200 }}>{cloneElement(children, { width: 800, height: 200 } as Record<string, unknown>)}</div>
    ),
  };
});
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

/** Opens the Services tab and returns its panel, failing unless the tab is the selected one. */
async function openServices(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByText("Health History (24h)")).toBeTruthy());
  const tab = await screen.findByRole("tab", { name: /Services/ });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
  await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
  const panel = screen.getByRole("tabpanel");
  expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
  return panel;
}
const dots = (panel: HTMLElement) => panel.querySelectorAll(".recharts-line-dots circle, circle.recharts-dot");

describe("the Services tab of the health history card", () => {
  it("says it has no per-service reading when only scan-heartbeat rows exist", async () => {
    adminRpc.mockImplementation(async () => ({ data: [HEARTBEAT("b", 5), HEARTBEAT("a", 75)], error: null }));
    render(<HealthHistoryChart />);
    const panel = await openServices();
    await waitFor(() => expect(within(panel).getByText(NONE)).toBeTruthy());
    expect(dots(panel)).toHaveLength(0);
  });

  it("draws a lone hour's readings as three visible dots, not the notice and not zeros", async () => {
    // One probe row in an hour of its own, between hours of heartbeat rows:
    // every service line has one reading with a gap on each side.
    adminRpc.mockImplementation(async () => ({ data: [HEARTBEAT("c", 5), PROBE("b", 70), HEARTBEAT("a", 135)], error: null }));
    render(<HealthHistoryChart />);
    const panel = await openServices();
    await waitFor(() => expect(dots(panel).length).toBeGreaterThan(0));
    expect(within(panel).queryByText(NONE)).toBeNull();
    expect(dots(panel), "one dot per service, none for the hours without a reading").toHaveLength(3);
  });
});
