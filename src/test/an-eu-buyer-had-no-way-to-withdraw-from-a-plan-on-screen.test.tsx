/**
 * AN EU BUYER HAD NO WAY TO WITHDRAW FROM A PLAN: THE ACCOUNT PAGE'S PANEL
 * (owner decision 3; the function is in
 * an-eu-buyer-had-no-way-to-withdraw-from-a-plan.test.ts).
 *
 * Off by default, the panel renders nothing. With the switch on it offers one
 * button, asks first, and says what the server did: the refund it reported,
 * or that no plan began inside the period, or that a plan is not linked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import en from "../i18n/locales/en.json";

const { invoke, sw } = vi.hoisted(() => ({ invoke: vi.fn(), sw: { on: false } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/config/eu-consumer", () => ({
  get EU_UK_SALES_ON() { return sw.on; },
  WITHDRAWAL_DAYS: 14,
  WITHDRAWAL_WAIVER_VERSION: "2026-10-09",
}));

import { WithdrawalPanel } from "@/components/account/WithdrawalPanel";

let confirm: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  invoke.mockReset();
  sw.on = false;
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); confirm.mockRestore(); });

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(v[k]));

describe("the withdrawal panel", () => {
  it("renders nothing while the switch is off", () => {
    render(<WithdrawalPanel />);
    expect(screen.queryByTestId("withdrawal-panel")).toBeNull();
  });

  it("asks first, calls the function, and states the refund it reported", async () => {
    sw.on = true;
    invoke.mockResolvedValue({ data: { withdrawn: [{ subscription: "sub_a", refunded: 4050, currency: "eur" }] }, error: null });
    render(<WithdrawalPanel />);
    fireEvent.click(screen.getByRole("button", { name: en.accountPage.withdraw.button }));
    expect(confirm).toHaveBeenCalledWith(en.accountPage.withdraw.confirm);
    const status = await screen.findByRole("status");
    expect(invoke).toHaveBeenCalledWith("withdraw-subscription", { body: {} });
    expect(status.textContent).toMatch(/40\.50/);
    expect(status.textContent).toMatch(/^Withdrawn\./);
  });

  it("says when no plan began inside the period, and does nothing on Cancel", async () => {
    sw.on = true;
    confirm.mockReturnValueOnce(false);
    render(<WithdrawalPanel />);
    fireEvent.click(screen.getByRole("button", { name: en.accountPage.withdraw.button }));
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValue({ data: { withdrawn: [], reason: "none_eligible" }, error: null });
    fireEvent.click(screen.getByRole("button", { name: en.accountPage.withdraw.button }));
    expect((await screen.findByRole("status")).textContent).toBe(fill(en.accountPage.withdraw.none, { days: 14 }));
  });
});
