/**
 * THE HEALTH PAGE'S WARM UP BUTTON HANDS THE OWNER'S KEY, IN THE BODY (cost
 * audit 2026-11-08, Do first #13, the frontend half of the ai lane's warm-up).
 *
 * From warm-up 2026-11-09.1 on, a warm-up that names no target answers only
 * the owner's admin key or our own servers: anyone else gets 401 and nothing
 * is invoked. The /health-check Warm Up button is that mode's one browser
 * caller, so it must send the stored owner key, and in the body: this page
 * publishes before the function, and the build serving until then lists no
 * x-admin-key in its preflight, so a browser sending that header would be
 * stopped before the request left. That build reads no adminKey and warms
 * everything as it does today.
 *
 * Rendering the real page with only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/components/dashboard/AdminAuthGate", () => ({ AdminAuthGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/hooks/use-circuit-breaker", () => ({ getAllCircuitStates: () => ({}), resetServiceCircuit: () => {} }));
for (const m of ["HealthTrendChart", "EmailTrendChart", "WebhookTrendChart", "AIGenerationTrendChart", "UserHealthTable", "HealthHistoryChart", "GeoPerformanceChart", "IndustryDetectionChart"]) {
  vi.doMock(`@/components/dashboard/${m}`, () => ({ [m]: () => null }));
}

import HealthCheck from "../pages/HealthCheck";

vi.setConfig(MOUNT_TEST_BUDGET);

const OWNER_KEY = "owner_admin_key_0123456789";
const WARMED = { success: true, timestamp: "2026-11-09T10:00:00.000Z", duration_ms: 812, summary: { warm: 0, cold: 0, errors: 0, avg_latency_ms: 0 }, results: [] };

beforeEach(() => {
  sessionStorage.clear();
  invoke.mockReset();
  vi.spyOn(window, "setInterval").mockImplementation((() => 1) as unknown as typeof setInterval);
  invoke.mockImplementation(async (fn: string) => {
    if (fn === "warm-up") return { data: WARMED, error: null };
    if (fn === "admin-ops") return { data: { data: null }, error: null };
    return { data: null, error: Object.assign(new Error("HTTP 500"), { context: { status: 500 } }) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const warmUpCalls = () => invoke.mock.calls.filter(([fn]) => fn === "warm-up");

describe("the health page's Warm Up button", () => {
  it("sends the stored owner key as the body's adminKey, and no header the live build's preflight refuses", async () => {
    sessionStorage.setItem("admin_dashboard_key", OWNER_KEY);
    render(<MemoryRouter><HealthCheck /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /warm up/i }, SLOW));
    await waitFor(() => expect(warmUpCalls().length).toBe(1), SLOW);
    const opts = warmUpCalls()[0][1] as { body?: Record<string, unknown>; headers?: Record<string, string> } | undefined;
    expect(opts?.body).toEqual({ adminKey: OWNER_KEY });
    expect(opts?.headers?.["x-admin-key"], "a header the serving build's preflight does not allow").toBeUndefined();
    expect(await screen.findByText(/Last warm-up:/, undefined, SLOW)).toBeTruthy();
  });

  it("without a stored key it sends no adminKey at all, never an empty one", async () => {
    render(<MemoryRouter><HealthCheck /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /warm up/i }, SLOW));
    await waitFor(() => expect(warmUpCalls().length).toBe(1), SLOW);
    const opts = warmUpCalls()[0][1] as { body?: Record<string, unknown> } | undefined;
    expect(opts?.body?.adminKey).toBeUndefined();
  });
});
