/**
 * AN AFFILIATE IS PROMISED WHAT THE SERVER PAYS, A PAYOUT IS REQUESTED ONLY
 * WHEN THE SERVER RECORDED IT, AND "LIVE" MEANS SOMETHING ARRIVES (wave 2
 * email-ops, register L13-63 and L3-10).
 *
 * WHAT WAS WRONG.
 *   L13-63  /affiliates promised "20% of every sale" in four places while
 *           stripe-webhook and verify-product-purchase credit a FLAT $1 (the
 *           smaller tools) or $5 (everything else): a $59 referral earned $5.
 *           Request Payout was rendered with no handler and toasted "submitted,
 *           payment within 5-7 business days" whatever happened.
 *   L3-10   the affiliate page's "Real-time notifications" and the error
 *           dashboard's "Live" badge subscribed to tables RLS denies the
 *           browser, so nothing ever arrived; the affiliate channel was also
 *           torn down and re-opened on every render.
 *
 *   review  the new copy still said "Earn $5 for each sale you refer", but only
 *           create-product-checkout puts the referral code on the Stripe
 *           session: the Full Resume Analysis, scan credit top-ups, Pro,
 *           Morning Queue and the Agent Pass record no conversion at all.
 *
 * WHAT HOLDS NOW: the copy's amounts are the config the server lists are held
 * equal to (parsed from both server files here), the page renders those
 * amounts and no percentage, the payout button says "received" only when its
 * handler resolved, and the affiliate updates come from polling the
 * affiliate's own dashboard -- no Realtime channel anywhere on either page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import { AFFILIATE_COMMISSION_CENTS, COMMISSIONED_PRODUCT_TYPES, REFERRAL_CHECKOUTS, SMALL_TOOL_PRODUCT_TYPES } from "@/config/affiliate-commission";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a), info: (...a: unknown[]) => toast.info(...a) } }));
const channel = vi.fn();
const invoke = vi.fn(async (..._args: unknown[]) => ({ data: { data: [] as unknown[] }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel: (...a: unknown[]) => channel(...a), rpc: async () => ({ data: [], error: null }), functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/dashboard/AdminAuthGate", () => ({ AdminAuthGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/dashboard/ErrorTrendChart", () => ({ ErrorTrendChart: () => null }));
vi.mock("@/components/dashboard/LegacyUserHealthTable", () => ({ LegacyUserHealthTable: () => null }));
vi.mock("@/components/dashboard/ErrorDiagnostics", () => ({ ErrorDiagnostics: () => null }));
vi.mock("@/components/dashboard/ErrorStatsCards", () => ({ ErrorStatsCards: () => null }));

import Affiliates from "../pages/Affiliates";
import { PayoutRequest } from "@/components/affiliate/PayoutRequest";
import { useAffiliateUpdates } from "@/hooks/use-affiliate-realtime";
import ErrorDashboard from "../pages/ErrorDashboard";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => readFileSync(resolve(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

beforeEach(() => { toast.success.mockReset(); toast.error.mockReset(); toast.info.mockReset(); channel.mockReset(); invoke.mockClear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the promise is the payout", () => {
  for (const file of ["supabase/functions/stripe-webhook/index.ts", "supabase/functions/verify-product-purchase/index.ts"]) {
    it(`${file} pays exactly the amounts and the small-tool list the page quotes`, () => {
      const src = code(file);
      const list = /const (?:lowCommission|lowCommissionProducts) = \[([^\]]*)\];/.exec(src);
      expect(list, "the server's small-tool list moved; re-check the copy").toBeTruthy();
      expect([...list![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...SMALL_TOOL_PRODUCT_TYPES].sort());
      const amounts = /\.includes\(productType \|\| ''\) \? (\d+) : (\d+);/.exec(src);
      expect(amounts).toBeTruthy();
      expect([Number(amounts![1]), Number(amounts![2])]).toEqual([AFFILIATE_COMMISSION_CENTS.smallTool, AFFILIATE_COMMISSION_CENTS.other]);
    });
  }

  it("the sign-up card quotes the flat amounts and no percentage", () => {
    render(<MemoryRouter><Affiliates /></MemoryRouter>);
    expect(screen.getByText("$5 per tool sale ($1 on smaller tools)")).toBeTruthy();
    expect(document.body.textContent, "the page promised a percentage the server does not pay").not.toMatch(/20%/);
  });
});

describe("only a sale whose checkout carries the referral code earns, and the copy says which", () => {
  const FN = resolve(ROOT, "supabase/functions");
  it("the checkouts that put referral_code on the Stripe session are exactly the ones the copy credits", () => {
    const carrying = readdirSync(FN)
      .filter((d) => /^create-.*checkout$/.test(d))
      .filter((d) => { try { return /\breferral_code\s*:/.test(code(`supabase/functions/${d}/index.ts`)); } catch { return false; } })
      .sort();
    expect(carrying, "a checkout started or stopped carrying the referral code; re-check the copy").toEqual([...REFERRAL_CHECKOUTS].sort());
  });

  it("the products the copy credits are that checkout's catalogue, each at the rate the server pays it", () => {
    const src = code("supabase/functions/create-product-checkout/index.ts");
    const sold = [...src.matchAll(/productType:\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(sold).toEqual([...COMMISSIONED_PRODUCT_TYPES.other, ...COMMISSIONED_PRODUCT_TYPES.smallTool].sort());
    for (const t of COMMISSIONED_PRODUCT_TYPES.smallTool) expect(SMALL_TOOL_PRODUCT_TYPES as readonly string[], t).toContain(t);
    for (const t of COMMISSIONED_PRODUCT_TYPES.other) expect(SMALL_TOOL_PRODUCT_TYPES as readonly string[], t).not.toContain(t);
  });

  it("the page names the products that earn the higher rate and the ones that earn nothing, and promises nothing for every sale", () => {
    render(<MemoryRouter><Affiliates /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    expect(text, "the page promised a commission on every referred sale").not.toMatch(/(each|every) sale you refer/i);
    for (const name of ["Premium Resume Package", "ATS Defense", "Career Snapshot", "Graduate Game Plan", "Freelance Boost"]) expect(text).toContain(name);
    expect(screen.getByText("The Full Resume Analysis, scan credit top-ups, Pro, Morning Queue and the Agent Pass earn no commission.")).toBeTruthy();
  });
});

describe("Request Payout", () => {
  const button = () => screen.getByRole("button", { name: /Request Payout/ });

  it("with no server handler it claims nothing", async () => {
    render(<PayoutRequest pendingPayout={3000} totalPaidOut={0} />);
    fireEvent.click(button());
    await new Promise((r) => setTimeout(r, 10));
    expect(toast.success, "a request nobody recorded was called submitted").not.toHaveBeenCalled();
    expect(screen.queryByText("Payout requested")).toBeNull();
  });

  it("a refused request shows the server's reason and stays requestable", async () => {
    const onRequestPayout = vi.fn(async () => { throw new Error("The minimum payout is $25.00."); });
    render(<PayoutRequest pendingPayout={3000} totalPaidOut={0} onRequestPayout={onRequestPayout} />);
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The minimum payout is $25.00."));
    expect(toast.success).not.toHaveBeenCalled();
    expect(button()).toBeTruthy();
  });

  it("a recorded request says received, and promises no payment date", async () => {
    render(<PayoutRequest pendingPayout={3000} totalPaidOut={0} onRequestPayout={async () => "requested"} />);
    fireEvent.click(button());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payout request received. We will email you to arrange payment."));
    expect(screen.getByText("Payout requested")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Processing within 5-7 business days/);
  });
});

describe("the affiliate's updates", () => {
  it("are read from the affiliate's own dashboard on a timer set once, never from a Realtime channel", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {});
    const { rerender } = renderHook(({ stats }) => useAffiliateUpdates({ enabled: true, stats, refresh, intervalMs: 1000 }), {
      initialProps: { stats: { total_clicks: 1, total_conversions: 0, pending_payout: 0 } },
    });
    for (let i = 0; i < 3; i++) rerender({ stats: { total_clicks: 1, total_conversions: 0, pending_payout: 0 } });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(refresh).toHaveBeenCalledTimes(3);
    rerender({ stats: { total_clicks: 2, total_conversions: 1, pending_payout: 500 } });
    expect(toast.success).toHaveBeenCalledWith("New click on your affiliate link!", expect.anything());
    expect(toast.success).toHaveBeenCalledWith("You earned $5.00!", expect.anything());
    expect(channel, "a Realtime channel RLS can never feed").not.toHaveBeenCalled();
  });

  it("the error dashboard opens no Realtime channel either, and re-reads on its timer", async () => {
    const ticks: Array<() => void> = [];
    const spy = vi.spyOn(window, "setInterval").mockImplementation(((fn: () => void) => { ticks.push(fn); return 1 as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval);
    try {
      render(<MemoryRouter><ErrorDashboard /></MemoryRouter>);
      const reads = () => invoke.mock.calls.filter(([fn]) => fn === "get-error-telemetry").length;
      await waitFor(() => expect(reads()).toBe(1));
      expect(channel, "a Realtime channel RLS can never feed").not.toHaveBeenCalled();
      expect(ticks.length, "nothing re-reads the telemetry").toBeGreaterThan(0);
      await act(async () => { for (const t of ticks) t(); });
      await waitFor(() => expect(reads()).toBeGreaterThan(1));
    } finally { spy.mockRestore(); }
  });
});
