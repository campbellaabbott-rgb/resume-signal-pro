/**
 * AN AFFILIATE SEES THE PAYOUT REQUESTS THE SERVER HOLDS (S14X-116).
 *
 * WHAT WAS WRONG.
 *   - An open payout request lived only in the button's memory: after a
 *     reload the button offered the same balance again, and the server's
 *     one-open-request rule answered a second click with a 409.
 *   - The page read every 409 as "already open", so the settlement trigger's
 *     refusal (23514: the balance changed between the read and the write)
 *     told the affiliate a request was open when none had been recorded.
 *   - Payout History drew one invented "Initial Payout" row from the paid
 *     total, whatever the requests really were.
 *   - The card promised payment "5-7 business days after request", which
 *     nothing keeps, and a request whose note to the owner failed to send
 *     was reported like any other.
 *
 * WHAT HOLDS NOW: the history lists the requests the dashboard returns
 * (payout_requests), an open one replaces the button after a reload, the
 * page reads the answer's status (already_requested, balance_changed,
 * unproven_address), says so when the owner was not notified, and promises
 * no payment date. Before the round's dashboard answers payout_requests,
 * the history shows the paid total under its own name, not a made-up row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a), info: (...a: unknown[]) => toast.info(...a), warning: (...a: unknown[]) => toast.warning(...a) } }));

let dashboard: Record<string, unknown> = {};
const invoke = vi.fn(async (..._a: unknown[]): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(),
    rpc: async (name: string) => (name === "get_affiliate_dashboard" ? { data: dashboard, error: null } : { data: [], error: null }),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

import Affiliates from "../pages/Affiliates";
import { PayoutRequest } from "@/components/affiliate/PayoutRequest";

class NoResize { observe() {} unobserve() {} disconnect() {} }

const affiliate = { id: "a1", email: "aff@example.com", referral_code: "ab12cd34", commission_amount: 1000, status: "active", created_at: "2026-11-01T00:00:00Z", email_confirmed: true };
const stats = (o: Record<string, number> = {}) => ({ total_clicks: 0, total_conversions: 3, total_revenue: 13500, pending_payout: 3000, paid_out: 4000, conversion_rate: 0, awaiting_approval: 0, awaiting_approval_count: 0, ...o });

beforeEach(() => {
  for (const f of Object.values(toast)) f.mockReset();
  invoke.mockReset();
  invoke.mockImplementation(async () => ({ data: null, error: null }));
  localStorage.clear();
  localStorage.setItem("affiliate_session", JSON.stringify({ affiliateId: "a1", email: "aff@example.com", referralCode: "ab12cd34", sessionToken: "f".repeat(64) }));
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoResize;
});
afterEach(() => cleanup());

async function openPayouts() {
  await act(async () => { render(<MemoryRouter><Affiliates /></MemoryRouter>); });
  const tab = await screen.findByRole("tab", { name: /Payouts/ });
  await act(async () => { fireEvent.mouseDown(tab, { button: 0 }); fireEvent.click(tab); });
  await screen.findByText("Payout History");
}

/** A FunctionsHttpError as supabase-js hands it over: the response in context. */
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) }),
});

describe("the payout history", () => {
  it("lists the requests the server holds, and an open one replaces the button after a reload", async () => {
    dashboard = {
      affiliate, stats: stats(), recent_conversions: [],
      payout_requests: [
        { id: "r2", status: "requested", amount_cents: 3000, requested_at: "2026-11-14T10:00:00Z", resolved_at: null },
        { id: "r1", status: "paid", amount_cents: 4000, requested_at: "2026-10-02T10:00:00Z", resolved_at: "2026-10-05T10:00:00Z" },
      ],
    };
    await openPayouts();
    const text = document.body.textContent ?? "";
    expect(text, "a payout row the server never held").not.toContain("Initial Payout");
    expect(text).toContain("$40.00");
    expect(screen.getAllByText("Payout requested").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Request Payout/ }), "the open request vanished on reload").toBeNull();
  });

  it("before the dashboard answers payout_requests, the paid total is shown under its own name", async () => {
    dashboard = { affiliate, stats: stats(), recent_conversions: [] };
    await openPayouts();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Initial Payout");
    expect(text).toContain("Paid to date");
    expect(text).toContain("$40.00");
  });
});

describe("Request Payout reads the answer's status", () => {
  const click = async () => {
    await openPayouts();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Request Payout/ })); });
  };

  it("a balance that changed is said as such, never as an open request", async () => {
    dashboard = { affiliate, stats: stats(), recent_conversions: [], payout_requests: [] };
    invoke.mockImplementation(async () => httpError(409, { status: "balance_changed", error: "Your balance changed while we recorded the request. Please try again." }));
    await click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your balance changed while we recorded the request. Please try again."));
    expect(toast.info).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Request Payout/ })).toBeTruthy();
  });

  it("the deployed function's 23514 answer (a 409 with an error and no status) is not read as open either", async () => {
    dashboard = { affiliate, stats: stats(), recent_conversions: [], payout_requests: [] };
    invoke.mockImplementation(async () => httpError(409, { error: "Your balance changed while we recorded the request. Please try again." }));
    await click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your balance changed while we recorded the request. Please try again."));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("an open request is said as such", async () => {
    dashboard = { affiliate, stats: stats(), recent_conversions: [], payout_requests: [] };
    invoke.mockImplementation(async () => httpError(409, { status: "already_requested" }));
    await click();
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("A payout request is already open. We will email you about it."));
  });

  it("an unproven address is told to confirm it", async () => {
    dashboard = { affiliate, stats: stats(), recent_conversions: [], payout_requests: [] };
    invoke.mockImplementation(async () => httpError(403, { status: "unproven_address", error: "Confirm your email address first: the dashboard mails you a link." }));
    await click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Confirm your email address first: the dashboard mails you a link."));
  });

  it("a request whose note to the owner failed is recorded, and says so", async () => {
    dashboard = { affiliate, stats: stats(), recent_conversions: [], payout_requests: [] };
    invoke.mockImplementation(async () => ({ data: { status: "requested", id: "r3", amountCents: 3000, ownerNotified: false }, error: null }));
    await click();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payout request received. We will email you to arrange payment."));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/did not send/));
  });
});

describe("the payout card", () => {
  it("promises no payment date", () => {
    render(<PayoutRequest pendingPayout={3000} totalPaidOut={0} />);
    expect(document.body.textContent).not.toMatch(/business days/);
  });

  it("an open request from the server shows as requested", () => {
    render(<PayoutRequest pendingPayout={3000} totalPaidOut={0} openRequest={{ amount_cents: 3000, requested_at: "2026-11-14T10:00:00Z" }} onRequestPayout={async () => "requested"} />);
    expect(screen.getByText("Payout requested")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Request Payout/ })).toBeNull();
  });
});
