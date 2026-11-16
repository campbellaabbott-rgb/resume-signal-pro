/**
 * THE AFFILIATE TIME PERIOD CHANGES THE MONEY TILES, AND EACH CURRENCY IS
 * SHOWN IN ITS OWN (S14X-212, S14X-227).
 *
 * WHAT WAS WRONG.
 *   S14X-212  the Time Period selector (7, 30, 90, 365 days) fed only the
 *             click chart: Clicks, Conversions and Revenue stayed all-time
 *             whatever it said, with nothing on the tiles to say so.
 *   S14X-227  Revenue Generated summed sale amounts across currencies and
 *             printed the sum as dollars: an INR 42,250 (paise) sale and a
 *             USD 4,500 (cents) sale showed as "$467.50".
 *
 * WHAT HOLDS NOW: the tiles read the dashboard's stats_by_range for the
 * selected period, a card that stays all-time says "All time", and revenue
 * is listed per currency (revenue_by_currency), a sale whose currency was not
 * recorded shown as such. Before the round's dashboard answers those keys,
 * the tiles say "All time" and revenue is the old total.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

let dashboard: Record<string, unknown> = {};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(),
    rpc: async (name: string) => (name === "get_affiliate_dashboard" ? { data: dashboard, error: null } : { data: [], error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

import Affiliates from "../pages/Affiliates";

class NoResize { observe() {} unobserve() {} disconnect() {} }

const affiliate = { id: "a1", email: "aff@example.com", referral_code: "ab12cd34", commission_amount: 1000, status: "active", created_at: "2026-11-01T00:00:00Z", email_confirmed: true };
const range = (clicks: number, conversions: number, commission: number, revenue: Record<string, number>) => ({ clicks, conversions, earning_conversions: conversions, commission, revenue_by_currency: revenue });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("affiliate_session", JSON.stringify({ affiliateId: "a1", email: "aff@example.com", referralCode: "ab12cd34", sessionToken: "f".repeat(64) }));
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoResize;
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
afterEach(() => cleanup());

const tile = (label: string) => screen.getByText(label).closest("div")!.parentElement!.textContent ?? "";

async function pick(label: string) {
  const trigger = screen.getByRole("combobox");
  await act(async () => { fireEvent.keyDown(trigger, { key: "Enter" }); });
  const option = await screen.findByRole("option", { name: label });
  await act(async () => { fireEvent.click(option); });
}

describe("the time period", () => {
  it("switching Last 30 days to Last 7 days changes clicks, conversions and revenue", async () => {
    dashboard = {
      affiliate,
      stats: { total_clicks: 40, total_conversions: 9, total_revenue: 99999, pending_payout: 0, paid_out: 0, conversion_rate: 22.5, awaiting_approval: 0, awaiting_approval_count: 0, revenue_by_currency: { usd: 99999 } },
      stats_by_range: {
        "7": range(3, 1, 1000, { usd: 4500 }),
        "30": range(12, 4, 2000, { usd: 18000, inr: 42250 }),
        "90": range(30, 7, 3000, { usd: 30000 }),
        "365": range(40, 9, 4000, { usd: 99999 }),
      },
      recent_conversions: [],
    };
    await act(async () => { render(<MemoryRouter><Affiliates /></MemoryRouter>); });
    await waitFor(() => expect(tile("Clicks")).toMatch(/^Clicks12(?!\d)/));
    expect(tile("Conversions")).toMatch(/^Conversions4(?!\d)/);
    let text = document.body.textContent ?? "";
    expect(text).toContain("$180.00");
    expect(text).toContain("₹422.50");

    await pick("Last 7 days");
    await waitFor(() => expect(tile("Clicks")).toMatch(/^Clicks3(?!\d)/));
    expect(tile("Conversions")).toMatch(/^Conversions1(?!\d)/);
    text = document.body.textContent ?? "";
    expect(text).toContain("$45.00");
    expect(text, "the 30-day revenue stayed after picking 7 days").not.toContain("₹422.50");
  });

  it("each currency is its own total, and a sale with no recorded currency is shown as such", async () => {
    dashboard = {
      affiliate,
      stats: { total_clicks: 0, total_conversions: 3, total_revenue: 46850, pending_payout: 0, paid_out: 0, conversion_rate: 0, awaiting_approval: 0, awaiting_approval_count: 0, revenue_by_currency: { inr: 42250, usd: 4500, unknown: 100 } },
      stats_by_range: { "30": range(0, 3, 0, { inr: 42250, usd: 4500, unknown: 100 }) },
      recent_conversions: [],
    };
    await act(async () => { render(<MemoryRouter><Affiliates /></MemoryRouter>); });
    await waitFor(() => expect(document.body.textContent).toContain("₹422.50"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("$45.00");
    expect(text, "two currencies summed as dollars").not.toContain("$468.50");
    expect(text).toMatch(/1\.00 \(currency not recorded\)/);
  });

  it("before the round's dashboard, the tiles say they are all-time", async () => {
    dashboard = {
      affiliate,
      stats: { total_clicks: 40, total_conversions: 9, total_revenue: 4500, pending_payout: 0, paid_out: 0, conversion_rate: 22.5 },
      recent_conversions: [],
    };
    await act(async () => { render(<MemoryRouter><Affiliates /></MemoryRouter>); });
    await waitFor(() => expect(tile("Clicks")).toMatch(/^Clicks40(?!\d)/));
    expect(tile("Clicks")).toContain("All time");
    expect(tile("Conversions")).toContain("All time");
    expect(document.body.textContent).toContain("$45.00");
  });
});
