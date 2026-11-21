/**
 * THE ERROR PAGE COUNTS ITS WHOLE RANGE AND SAYS WHEN IT SHOWS A SAMPLE
 * (S14X-157).
 *
 * WHAT WAS WRONG. /errors asked get-error-telemetry for at most 1,000 rows on
 * every range and printed their length as "Total Errors", under a label that
 * read "Last 24 hours" whatever range was picked. The 5xx and last-hour cards
 * counted the same sample, and "Last Hour" showed +100% whenever the hour
 * before had no errors, a change from nothing that is no percentage at all.
 *
 * WHAT HOLDS NOW, by rendering the real cards and the real page:
 *   - the cards print the reader's range counts when it sends them, and the
 *     range the owner picked;
 *   - a last hour after an hour with none says "new", never +100%;
 *   - a page whose reader sent counts and truncated says it shows the newest
 *     1,000 of the range's total; a reader that sent no counts (the build
 *     serving before this one) still works, from the sample, and says a full
 *     sample may hold more.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/lib/admin-auth", () => ({ adminAuthHeaders: () => ({ "x-admin-key": "k" }), adminRpc: async () => ({ data: [], error: null }) }));
vi.mock("@/components/dashboard/AdminAuthGate", () => ({ AdminAuthGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/dashboard/ErrorTrendChart", () => ({ ErrorTrendChart: () => null }));
vi.mock("@/components/dashboard/LegacyUserHealthTable", () => ({ LegacyUserHealthTable: () => null }));
vi.mock("@/components/dashboard/ErrorDiagnostics", () => ({ ErrorDiagnostics: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
// The range selector as a native select: Radix's listbox needs layout jsdom lacks.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select aria-label="range" value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { ErrorStatsCards } from "@/components/dashboard/ErrorStatsCards";
import ErrorDashboard from "@/pages/ErrorDashboard";

afterEach(() => { cleanup(); invoke.mockReset(); vi.restoreAllMocks(); });

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const row = (i: number, at: string, status: number | null = 400) => ({
  id: `e${i}`, error_type: "api", error_code: "X", error_message: null, created_at: at, visitor_id: `v${i % 7}`, function_name: "fn", http_status: status, context: null,
});
/** The newest 1,000 of a week: 3 in the last hour, none in the hour before. */
const SAMPLE = Array.from({ length: 1_000 }, (_, i) => row(i, minutesAgo(i < 3 ? 5 + i : 130 + i * 9)));

describe("the overview cards", () => {
  it("print the range's counts and the range picked, not the sample's length under 'Last 24 hours'", () => {
    render(<ErrorStatsCards errors={SAMPLE} rangeLabel="Last 7 Days" counts={{ total: 2_500, lastHour: 3, previousHour: 0, serverErrors: 250 }} />);
    expect(screen.getByText("2,500")).toBeTruthy();
    expect(screen.getByText("Last 7 Days")).toBeTruthy();
    expect(screen.queryByText("Last 24 hours")).toBeNull();
    expect(screen.queryByText("1000")).toBeNull();
    expect(screen.getByText("250")).toBeTruthy();
  });

  it("a last hour after an hour with none says new, never +100%", () => {
    render(<ErrorStatsCards errors={SAMPLE} rangeLabel="Last 7 Days" counts={{ total: 2_500, lastHour: 3, previousHour: 0, serverErrors: 250 }} />);
    expect(document.body.textContent).not.toMatch(/\+100%/);
    expect(screen.getByText(/new this hour/i)).toBeTruthy();
  });

  it("a real change from a previous hour with errors is still a percentage", () => {
    render(<ErrorStatsCards errors={[]} rangeLabel="Last 24 Hours" counts={{ total: 30, lastHour: 15, previousHour: 10, serverErrors: 0 }} />);
    expect(screen.getByText(/\+50% vs prev hour/)).toBeTruthy();
  });

  it("with no counts it reads the rows it was given", () => {
    render(<ErrorStatsCards errors={SAMPLE.slice(0, 12)} rangeLabel="Last Hour" />);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Last Hour", { selector: "p" })).toBeTruthy();
  });
});

describe("the page", () => {
  const open = async () => {
    vi.spyOn(window, "setInterval").mockImplementation((() => 1) as unknown as typeof setInterval);
    render(<MemoryRouter><ErrorDashboard /></MemoryRouter>);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
  };

  it("says it shows the newest 1,000 of the range's total when the reader says it is truncated", async () => {
    invoke.mockResolvedValue({ data: { data: SAMPLE, counts: { total: 2_500, lastHour: 3, previousHour: 0, serverErrors: 250 }, truncated: true }, error: null });
    await open();
    await waitFor(() => expect(screen.getAllByText(/Showing the newest 1,000 of 2,500 errors in this range/).length).toBeGreaterThan(0));
    expect(screen.getByText("2,500")).toBeTruthy();
    expect(screen.getByText("Last 24 Hours", { selector: "p" })).toBeTruthy();
  });

  it("labels the total with the range the owner picks", async () => {
    invoke.mockResolvedValue({ data: { data: SAMPLE.slice(0, 5), counts: { total: 5, lastHour: 3, previousHour: 0, serverErrors: 0 }, truncated: false }, error: null });
    await open();
    await waitFor(() => expect(screen.getByText("Last 24 Hours", { selector: "p" })).toBeTruthy());
    expect(screen.queryByText(/Showing the newest 1,000/)).toBeNull();
    fireEvent.change(screen.getByLabelText("range"), { target: { value: "7d" } });
    await waitFor(() => expect(screen.getByText("Last 7 Days", { selector: "p" })).toBeTruthy());
  });

  it("works against the reader that sends no counts: the sample's numbers, and a full sample may hold more", async () => {
    invoke.mockResolvedValue({ data: { data: SAMPLE }, error: null });
    await open();
    await waitFor(() => expect(screen.getAllByText(/Showing the newest 1,000 errors: the range may hold more/).length).toBeGreaterThan(0));
    expect(screen.getByText("1,000")).toBeTruthy();
  });
});
