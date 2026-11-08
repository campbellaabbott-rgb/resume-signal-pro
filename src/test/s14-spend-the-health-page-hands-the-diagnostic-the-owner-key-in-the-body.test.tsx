/**
 * THE HEALTH PAGE HANDS THE AI DIAGNOSTIC THE OWNER'S KEY, IN THE BODY
 * (S14 hotfix, lane spend, M-S14-056).
 *
 * test-ai-fallback now answers only the owner's admin key or our own
 * servers, because every call is up to four paid model calls. The panel on
 * /health-check is its one browser caller, so it must send the stored owner
 * key, and in the body: this page publishes before the function, and the
 * build serving until then lists no x-admin-key in its preflight, so a
 * browser sending that header would be stopped before the request left.
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

beforeEach(() => {
  sessionStorage.clear();
  invoke.mockReset();
  vi.spyOn(window, "setInterval").mockImplementation((() => 1) as unknown as typeof setInterval);
  invoke.mockImplementation(async (fn: string) => {
    if (fn === "test-ai-fallback") return { data: { success: true, mode: "quick", chains: [], fallbackConfig: [] }, error: null };
    if (fn === "admin-ops") return { data: { data: null }, error: null };
    return { data: null, error: Object.assign(new Error("HTTP 500"), { context: { status: 500 } }) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const diagnosticCalls = () => invoke.mock.calls.filter(([fn]) => fn === "test-ai-fallback");

describe("the AI diagnostic panel", () => {
  for (const [button, mode] of [["Quick test", "quick"], ["Test All Models", "all"]] as const) {
    it(`${button} sends the stored owner key as the body's adminKey, and no header the live build's preflight refuses`, async () => {
      sessionStorage.setItem("admin_dashboard_key", OWNER_KEY);
      render(<MemoryRouter><HealthCheck /></MemoryRouter>);
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(button, "i") }, SLOW));
      await waitFor(() => expect(diagnosticCalls().length).toBe(1), SLOW);
      const opts = diagnosticCalls()[0][1] as { body?: Record<string, unknown>; headers?: Record<string, string> };
      expect(opts.body).toEqual({ mode, adminKey: OWNER_KEY });
      expect(opts.headers?.["x-admin-key"], "a header the serving build's preflight does not allow").toBeUndefined();
    });
  }

  it("without a stored key it sends no adminKey at all, never an empty one", async () => {
    render(<MemoryRouter><HealthCheck /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /quick test/i }, SLOW));
    await waitFor(() => expect(diagnosticCalls().length).toBe(1), SLOW);
    expect((diagnosticCalls()[0][1] as { body?: Record<string, unknown> }).body).toEqual({ mode: "quick" });
  });
});
