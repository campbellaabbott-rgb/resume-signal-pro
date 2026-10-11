/**
 * THE OWNER'S HEALTH PAGE GOT THE STRANGER'S ANSWER (review of
 * wave3/email-ops, 2026-10-10, on S8-061).
 *
 * WHAT WAS WRONG. health-check now answers a caller without the owner's key
 * from a result up to a minute old, with each check cut to {status,
 * latency_ms}. /health-check, behind the admin gate, still called it with no
 * key: the per-service line it renders (a refused Stripe key, say) was never
 * filled again, and Refresh never ran a live probe.
 *
 * WHAT HOLDS NOW, rendering the real page against a health-check that answers
 * as the function does: the stored owner key rides on the call, and the
 * provider's message is on the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
const REFUSED = "Stripe refused the key (HTTP 401)";
const live = {
  status: "unhealthy", timestamp: new Date().toISOString(), response_time_ms: 410, version: "2.2.0",
  checks: { database: { status: "ok", latency_ms: 40 }, ai_gateway: { status: "ok", latency_ms: 300 }, stripe: { status: "error", latency_ms: 70, message: REFUSED } },
};
/** health-check's two answers: the live probe for the owner's key, the stripped cache for anyone else. */
const answer = (opts?: { headers?: Record<string, string> }) => {
  if (opts?.headers?.["x-admin-key"] === OWNER_KEY) return live;
  return { ...live, checks: Object.fromEntries(Object.entries(live.checks).map(([k, c]) => [k, { status: c.status, latency_ms: c.latency_ms }])) };
};

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("admin_dashboard_key", OWNER_KEY);
  invoke.mockReset();
  vi.spyOn(window, "setInterval").mockImplementation((() => 1) as unknown as typeof setInterval);
  invoke.mockImplementation(async (fn: string, opts?: { headers?: Record<string, string> }) => {
    if (fn === "health-check") return { data: answer(opts), error: null };
    if (fn === "admin-ops") return { data: { data: null }, error: null };
    return { data: null, error: Object.assign(new Error("HTTP 500"), { context: { status: 500 } }) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the owner's health page", () => {
  it("sends the stored owner key to health-check and shows the provider's message", async () => {
    render(<MemoryRouter><HealthCheck /></MemoryRouter>);
    expect(await screen.findByText(REFUSED, {}, SLOW), "the owner's page got the stripped anonymous answer").toBeInTheDocument();
    const call = invoke.mock.calls.find(([fn]) => fn === "health-check");
    expect(call?.[1]?.headers?.["x-admin-key"]).toBe(OWNER_KEY);
  });
});
