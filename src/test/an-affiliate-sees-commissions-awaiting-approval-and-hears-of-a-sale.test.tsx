/**
 * AN AFFILIATE SEES COMMISSIONS AWAITING APPROVAL AND HEARS OF A SALE
 * (S14X-085, the display half).
 *
 * WHAT WAS WRONG. A referred sale is recorded as a pending conversion, and
 * the dashboard's Pending Payout counts approved conversions only (what a
 * payout request can cover). The page's sale toast fired only when Pending
 * Payout grew, so a new $10 commission raised no toast, and no tile showed
 * it anywhere: the money sat out of sight until something approved it. The
 * copy promised "Paid monthly" and an email "for each commission earned"
 * without naming the approval step a commission waits for.
 *
 * WHAT HOLDS NOW:
 *   - a sale (total_conversions grows) toasts the commission it added, read
 *     from what awaits approval plus what is payable, so a pending row counts;
 *   - a commission moving from awaiting approval to payable is not a new sale;
 *   - before the round's dashboard answers awaiting_approval, a sale still
 *     toasts from Pending Payout's growth, as it did;
 *   - the page shows an Awaiting approval tile, and its copy names the step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a), info: (...a: unknown[]) => toast.info(...a) } }));

let dashboard: Record<string, unknown> = {};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(),
    rpc: async (name: string) => (name === "get_affiliate_dashboard" ? { data: dashboard, error: null } : { data: [], error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

import { useAffiliateUpdates } from "@/hooks/use-affiliate-realtime";
import Affiliates from "../pages/Affiliates";

class NoResize { observe() {} unobserve() {} disconnect() {} }

beforeEach(() => {
  toast.success.mockReset(); toast.error.mockReset(); toast.info.mockReset();
  localStorage.clear();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoResize;
});
afterEach(() => cleanup());

const hook = (stats: Record<string, number>) =>
  renderHook(({ s }) => useAffiliateUpdates({ enabled: false, stats: s, refresh: async () => {} }), { initialProps: { s: stats } });

describe("the sale toast", () => {
  it("a new pending $10 commission toasts what it earned", () => {
    const { rerender } = hook({ total_clicks: 0, total_conversions: 0, pending_payout: 0, awaiting_approval: 0 });
    rerender({ s: { total_clicks: 0, total_conversions: 1, pending_payout: 0, awaiting_approval: 1000 } });
    expect(toast.success).toHaveBeenCalledWith("You earned $10.00!", expect.anything());
  });

  it("a commission moving from awaiting approval to payable is not a new sale", () => {
    const { rerender } = hook({ total_clicks: 0, total_conversions: 1, pending_payout: 0, awaiting_approval: 1000 });
    rerender({ s: { total_clicks: 0, total_conversions: 1, pending_payout: 1000, awaiting_approval: 0 } });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("before the dashboard answers awaiting_approval, a sale still toasts from Pending Payout", () => {
    const { rerender } = hook({ total_clicks: 0, total_conversions: 0, pending_payout: 0 });
    rerender({ s: { total_clicks: 0, total_conversions: 1, pending_payout: 500 } });
    expect(toast.success).toHaveBeenCalledWith("You earned $5.00!", expect.anything());
  });

  it("a sale that earned nothing toasts no amount", () => {
    const { rerender } = hook({ total_clicks: 0, total_conversions: 0, pending_payout: 0, awaiting_approval: 0 });
    rerender({ s: { total_clicks: 0, total_conversions: 1, pending_payout: 0, awaiting_approval: 0 } });
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/You earned/), expect.anything());
  });
});

describe("the dashboard", () => {
  const signIn = () => localStorage.setItem("affiliate_session", JSON.stringify({ affiliateId: "a1", email: "aff@example.com", referralCode: "ab12cd34", sessionToken: "f".repeat(64) }));

  it("shows the commission awaiting approval beside what is payable, and its copy names the approval step", async () => {
    signIn();
    dashboard = {
      affiliate: { id: "a1", email: "aff@example.com", referral_code: "ab12cd34", commission_amount: 1000, status: "active", created_at: "2026-11-01T00:00:00Z", email_confirmed: true },
      stats: { total_clicks: 0, total_conversions: 1, total_revenue: 4500, pending_payout: 0, paid_out: 0, conversion_rate: 0, awaiting_approval: 1000, awaiting_approval_count: 1 },
      recent_conversions: [],
    };
    await act(async () => { render(<MemoryRouter><Affiliates /></MemoryRouter>); });
    await waitFor(() => expect(screen.getByText("Awaiting approval")).toBeTruthy());
    const tile = screen.getByText("Awaiting approval").closest("div")!.parentElement!;
    expect(tile.textContent).toContain("$10.00");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Paid monthly/);
    expect(text).not.toMatch(/email notification for each commission earned/);
    expect(text).toMatch(/waits for approval/);
  });

  it("the sign-up card promises payment after approval, not monthly", async () => {
    await act(async () => { render(<MemoryRouter><Affiliates /></MemoryRouter>); });
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/30-day cookie/);
    expect(text).not.toMatch(/Paid monthly/);
    expect(text).toMatch(/once approved/);
  });
});
