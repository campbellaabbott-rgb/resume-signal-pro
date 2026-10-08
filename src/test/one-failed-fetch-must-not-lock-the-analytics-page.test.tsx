/**
 * ONE FAILED FETCH MUST NOT LOCK THE ANALYTICS PAGE (wave 2 email-ops,
 * register L3-19).
 *
 * WHAT WAS WRONG. AnalyticsDashboard set its error on a failed fetch and
 * never cleared it, and the error screen replaced the whole page -- the date
 * presets included. A long range that timed out once left the internal
 * dashboard on "Failed to load analytics data" until a reload.
 *
 * WHAT HOLDS NOW, by rendering the real page with the network faked: the
 * error screen keeps the ranges and a retry, and the next successful fetch
 * shows the dashboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/lib/admin-auth", () => ({ adminAuthHeaders: () => ({ "x-admin-key": "k" }), getStoredAdminKey: () => "k" }));
vi.mock("@/components/dashboard/AdminAuthGate", () => ({ AdminAuthGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import AnalyticsDashboard from "../pages/AnalyticsDashboard";

const DATA = { scrollDepth: [], timeOnPage: [], conversions: [], abTests: {}, pageMetrics: {} };

beforeEach(() => { invoke.mockReset(); });
afterEach(() => { cleanup(); });

describe("the analytics page after a failed fetch", () => {
  it("keeps its ranges on the error screen, and the next good fetch shows the dashboard", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error("timeout") });
    render(<MemoryRouter><AnalyticsDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Failed to load analytics data")).toBeTruthy());
    invoke.mockResolvedValue({ data: DATA, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    await waitFor(() => expect(screen.getByText("Engagement Analytics")).toBeTruthy());
    expect(screen.queryByText("Failed to load analytics data"), "the old error outlived a good fetch").toBeNull();
  });

  it("a retry on the error screen fetches again", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error("timeout") });
    render(<MemoryRouter><AnalyticsDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Failed to load analytics data")).toBeTruthy());
    invoke.mockResolvedValue({ data: DATA, error: null });
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(screen.getByText("Engagement Analytics")).toBeTruthy());
  });
});
