/**
 * A DASHBOARD PANEL THAT COULD NOT READ SAYS SO (S12-158).
 *
 * WHAT WAS WRONG. /health-check's nine operations panels read through
 * admin-ops, and the product tiles read two anon readers; every fetcher dropped
 * its error. With a wrong admin key, or admin-ops answering 502, each panel
 * printed its quiet state -- "No orders in last 24h", "No function errors",
 * "0 blocked" -- so a broken dashboard read as a calm day.
 *
 * WHAT HOLDS NOW, by rendering the real page with its network faked: a reader
 * that refuses or fails puts "Unavailable" and its reason in that panel, never
 * the empty state, and the badges that printed a zero say unavailable; a
 * reader that answers an empty window still prints the quiet state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
const adminRpc = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
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

const READERS = ["get_email_health", "get_function_error_rates", "get_rate_limit_stats", "get_payment_health", "get_delivery_health", "get_ai_quality_stats", "get_checkout_funnel", "get_webhook_health", "get_parse_failure_stats"];
const QUIET = [/No emails sent in last 24h/, /No function errors/, /No rate limits triggered/, /No checkout attempts in last 24h/, /No orders in last 24h/, /No AI generations in last 24h/, /No checkouts in last 24h/, /No webhooks received in last 24h/, /No parse failures/];
const EMPTY_ROW: Record<string, unknown> = {
  get_email_health: [{ total_emails: 0, successful_emails: 0, failed_emails: 0, success_rate: 0, recent_emails: [] }],
  get_function_error_rates: [],
  get_rate_limit_stats: [{ total_limited: 0, unique_ips: 0, by_function: [], recent_limits: [] }],
  get_payment_health: [{ total_attempts: 0, successful: 0, failed: 0, success_rate: 0, recent_failures: [] }],
  get_delivery_health: [{ total_orders: 0, fully_delivered: 0, pending: 0, generation_failed: 0, email_failed: 0, delivery_rate: 0, avg_generation_time_ms: 0, recent_failures: [] }],
  get_ai_quality_stats: [{ total_generations: 0, successful: 0, parse_failures: 0, success_rate: 0, recent_errors: [] }],
  get_checkout_funnel: [{ checkouts_started: 0, payments_completed: 0, content_generated: 0, fully_delivered: 0, checkout_to_payment_rate: 0, end_to_end_rate: 0 }],
  get_webhook_health: [{ total_received: 0, processed_successfully: 0, processing_failed: 0, success_rate: 0, events_by_type: {}, recent_failures: [] }],
  get_parse_failure_stats: [{ total_failures: 0, pdf_failures: 0, docx_failures: 0, spreadsheet_failures: 0, common_errors: [], recent_failures: [] }],
};

beforeEach(() => {
  invoke.mockReset(); adminRpc.mockReset(); rpc.mockReset();
  vi.spyOn(window, "setInterval").mockImplementation((() => 1) as unknown as typeof setInterval);
  invoke.mockResolvedValue({ data: null, error: null });
  rpc.mockImplementation(async (fn: string) => ({ data: fn === "get_today_scan_count" ? 3 : [{ success_rate: 100, avg_duration_ms: 900, failed_scans: 0, cache_hit_rate: 10 }], error: null }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const page = () => render(<MemoryRouter><HealthCheck /></MemoryRouter>);

describe("an operations panel whose reader failed", () => {
  it("says Unavailable with the reason in every panel, never its quiet state, and its badges say so", async () => {
    adminRpc.mockImplementation(async () => ({ data: null, error: { message: "Unauthorized" } }));
    page();
    await waitFor(() => expect(document.querySelectorAll('[data-panel-unavailable="true"]').length).toBe(READERS.length));
    for (const fn of READERS) expect(adminRpc).toHaveBeenCalledWith(fn, { p_hours_back: 24 });
    expect(screen.getAllByText(/Unavailable: this panel's reader did not answer \(Unauthorized\)/)).toHaveLength(READERS.length);
    for (const re of QUIET) expect(screen.queryByText(re), `a refused reader printed ${re}`).toBeNull();
    expect(screen.queryByText(/^0 total$/)).toBeNull();
    expect(screen.queryByText(/^0 blocked$/)).toBeNull();
    expect(screen.queryByText(/^0 failures$/)).toBeNull();
    expect(screen.getAllByText("unavailable").length).toBeGreaterThanOrEqual(3);
  });

  it("a reader that throws (admin-ops 502) is unavailable too, and one panel's failure leaves the others alone", async () => {
    adminRpc.mockImplementation(async (fn: string) => {
      if (fn === "get_delivery_health") throw new Error("Edge Function returned a non-2xx status code");
      return { data: EMPTY_ROW[fn] ?? null, error: null };
    });
    page();
    await waitFor(() => expect(screen.getByText(/Unavailable: this panel's reader did not answer \(Edge Function returned a non-2xx status code\)/)).toBeTruthy());
    expect(screen.queryByText(/No orders in last 24h/)).toBeNull();
    expect(screen.getByText(/No checkout attempts in last 24h/)).toBeTruthy();
    expect(document.querySelectorAll('[data-panel-unavailable="true"]').length).toBe(1);
  });

  it("the product tiles say Unavailable when their anon readers fail, not 0 scans at 0%", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: "permission denied for function get_scan_success_rate" } }));
    adminRpc.mockImplementation(async (fn: string) => ({ data: EMPTY_ROW[fn] ?? null, error: null }));
    page();
    await waitFor(() => expect(screen.getByText(/Unavailable: this panel's reader did not answer \(permission denied for function get_scan_success_rate\)/)).toBeTruthy());
    expect(screen.queryByText("Scans Today")).toBeNull();
  });

  it("positive control: readers that answer an empty window print the quiet states and no Unavailable", async () => {
    adminRpc.mockImplementation(async (fn: string) => ({ data: EMPTY_ROW[fn] ?? null, error: null }));
    page();
    await waitFor(() => expect(screen.getByText(/No orders in last 24h/)).toBeTruthy());
    for (const re of QUIET) expect(screen.getByText(re)).toBeTruthy();
    expect(document.querySelectorAll('[data-panel-unavailable="true"]').length).toBe(0);
    expect(screen.getByText("Scans Today")).toBeTruthy();
  });
});
