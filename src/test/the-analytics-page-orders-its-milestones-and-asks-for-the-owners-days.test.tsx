/**
 * THE ANALYTICS PAGE ORDERS ITS MILESTONES BY TIME AND ASKS FOR THE OWNER'S
 * DAYS (S14X-189, S14X-190).
 *
 * WHAT WAS WRONG.
 *   - get-analytics sorted the time milestones by their digits, so the Time
 *     on Page funnel read 0s, 1m, 2m, 5m, 10m, 30s and measured each drop-off
 *     between the wrong steps; the funnel called its counts "users", though
 *     each is one event per page per session-day.
 *   - "Last 7 days" started at local midnight seven days back, so it covered
 *     eight days; and the page never said which zone its days were in, while
 *     the function bucketed by UTC date.
 *
 * WHAT HOLDS NOW, by rendering the real page with the network faked:
 *   - the page orders the milestones itself, so it is right against the build
 *     serving today, which still sorts by digits;
 *   - "Last 7 days" asks from local midnight six days back, and every request
 *     carries the browser's time zone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { startOfDay, subDays } from "date-fns";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/lib/admin-auth", () => ({ adminAuthHeaders: () => ({ "x-admin-key": "k" }), getStoredAdminKey: () => "k" }));
vi.mock("@/components/dashboard/AdminAuthGate", () => ({ AdminAuthGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import AnalyticsDashboard from "../pages/AnalyticsDashboard";

const m = (variant: string, views: number) => ({ variant, views, conversions: 0, conversionRate: 0 });
/** What the build serving today answers: time milestones in digit order. */
const DIGIT_ORDER = ["0s", "1m", "2m", "5m", "10m", "30s"];
const DATA = {
  scrollDepth: [m("25%", 100), m("50%", 60)],
  timeOnPage: DIGIT_ORDER.map((v, i) => m(v, 100 - i * 10)),
  conversions: [], abTests: {}, pageMetrics: {},
};

beforeEach(() => { invoke.mockReset(); invoke.mockResolvedValue({ data: DATA, error: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const lastBody = () => (invoke.mock.calls.at(-1)?.[1] as { body: Record<string, unknown> }).body;

describe("the Time on Page funnel (S14X-189)", () => {
  it("lists the milestones in the order a visitor reaches them, from a build that sorts by digits", async () => {
    render(<MemoryRouter><AnalyticsDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Engagement Analytics")).toBeTruthy());
    const shown = [...document.querySelectorAll("span")].map((e) => e.textContent ?? "").filter((t) => /^\d+(s|m)$/.test(t));
    expect(shown).toEqual(["0s", "30s", "1m", "2m", "5m", "10m"]);
  });

  it("calls its counts events, not users", async () => {
    render(<MemoryRouter><AnalyticsDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Engagement Analytics")).toBeTruthy());
    expect(screen.queryByText(/^\d+ users$/)).toBeNull();
    expect(screen.getAllByText(/^\d+ events$/).length).toBeGreaterThan(0);
  });
});

describe("the date range (S14X-190)", () => {
  it("'Last 7 days' asks from local midnight six days back, to the end of today, in the browser's zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 10, 15, 30, 0));
    render(<MemoryRouter><AnalyticsDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Engagement Analytics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Last 14 days" }));
    await waitFor(() => expect(lastBody().startDate).toBe(startOfDay(subDays(new Date(), 13)).toISOString()));
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    await waitFor(() => expect(lastBody().startDate).toBe(startOfDay(subDays(new Date(), 6)).toISOString()));
    expect(lastBody().endDate).toBe(new Date(2026, 10, 10, 23, 59, 59, 999).toISOString());
    expect(lastBody().timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("the first read is the same seven days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 10, 15, 30, 0));
    render(<MemoryRouter><AnalyticsDashboard /></MemoryRouter>);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect((invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body.startDate).toBe(startOfDay(subDays(new Date(), 6)).toISOString());
    expect(typeof (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body.timeZone).toBe("string");
  });
});
