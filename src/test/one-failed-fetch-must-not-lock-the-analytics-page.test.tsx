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
 *
 * S14X-191. Since the consent banner of 12 October 2026 an event is posted
 * only after a visitor allows analytics, but the Audience card still said it
 * counted "distinct browsers" and that an empty range meant "nobody arrived"
 * because "the pipeline is verified working". An empty range now says only
 * visitors who allowed analytics are counted and where all traffic is seen.
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

describe("the Audience card counts only visitors who allowed analytics (S14X-191)", () => {
  const audience = (uniqueVisitors: number) => ({
    ...DATA,
    audience: { uniqueVisitors, totalEvents: uniqueVisitors * 3, returningVisitors: 0, eventsPerVisitor: 3, daily: [], bySurface: [], truncated: false },
  });

  it("an empty range is no proof that nobody came, and says where all traffic is counted", async () => {
    invoke.mockResolvedValue({ data: audience(0), error: null });
    render(<MemoryRouter><AnalyticsDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Engagement Analytics")).toBeTruthy());
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/nobody arrived/);
    expect(text).not.toMatch(/pipeline is verified working/);
    expect(text).toMatch(/allowed analytics/);
    expect(text).toMatch(/12 October 2026/);
    expect(text).toMatch(/Search Console/);
  });

  it("labels its counts as visitors who allowed analytics, not distinct browsers", async () => {
    invoke.mockResolvedValue({ data: audience(12), error: null });
    render(<MemoryRouter><AnalyticsDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Engagement Analytics")).toBeTruthy());
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/distinct browsers/);
    expect(text).toMatch(/visitors who allowed analytics/);
  });
});
