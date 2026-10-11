/**
 * AN EU BUYER HAD NO WAY TO WITHDRAW FROM A PLAN: THE ACCOUNT PAGE'S PANEL
 * (owner decision 3; the function is in
 * an-eu-buyer-had-no-way-to-withdraw-from-a-plan.test.ts).
 *
 * Off by default, the panel renders nothing. With the switch on it asks the
 * function for a preview and shows only to a buyer a plan qualifies for (wave
 * 3 review: a US subscriber was offered the EU/UK refund); then it offers one
 * button, asks first, and says what the server did: the refund it reported,
 * or that no plan began inside the period, or that a plan is not linked, or
 * that the plan was billed outside the EU, the EEA and the UK.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** The function as the panel meets it: the preview's answer, then the withdrawal's. */
const serve = (preview: Record<string, unknown>, withdrawal?: Record<string, unknown>) =>
  invoke.mockImplementation(async (_fn: string, o: { body?: { preview?: boolean } }) =>
    ({ data: o?.body?.preview ? preview : withdrawal ?? null, error: null }));
const button = () => screen.findByRole("button", { name: en.accountPage.withdraw.button });

describe("the withdrawal panel", () => {
  it("renders nothing while the switch is off", () => {
    render(<WithdrawalPanel />);
    expect(screen.queryByTestId("withdrawal-panel")).toBeNull();
  });

  it("asks first, calls the function, and states the refund it reported", async () => {
    sw.on = true;
    serve({ eligible: 1 }, { withdrawn: [{ subscription: "sub_a", refunded: 4050, currency: "eur" }] });
    render(<WithdrawalPanel />);
    fireEvent.click(await button());
    expect(confirm).toHaveBeenCalledWith(en.accountPage.withdraw.confirm);
    const status = await screen.findByRole("status");
    expect(invoke).toHaveBeenCalledWith("withdraw-subscription", { body: {} });
    expect(status.textContent).toMatch(/40\.50/);
    expect(status.textContent).toMatch(/^Withdrawn\./);
  });

  it("says when no plan began inside the period, and does nothing on Cancel", async () => {
    sw.on = true;
    confirm.mockReturnValueOnce(false);
    serve({ eligible: 1 }, { withdrawn: [], reason: "none_eligible" });
    render(<WithdrawalPanel />);
    fireEvent.click(await button());
    expect(invoke.mock.calls.filter(([, o]) => !o?.body?.preview)).toEqual([]);
    fireEvent.click(await button());
    expect((await screen.findByRole("status")).textContent).toBe(fill(en.accountPage.withdraw.none, { days: 14 }));
  });

  it("shows nothing to a buyer whose plan was billed outside the EU, the EEA and the UK", async () => {
    sw.on = true;
    serve({ eligible: 0, reason: "outside_territory" });
    render(<WithdrawalPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("withdraw-subscription", { body: { preview: true } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("withdrawal-panel")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says a plan on the address is not linked, from the preview, with no button", async () => {
    sw.on = true;
    serve({ eligible: 0, reason: "plan_not_linked" });
    render(<WithdrawalPanel />);
    expect((await screen.findByRole("status")).textContent).toBe(en.accountPage.withdraw.notLinked);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a withdrawal the server refuses for the billing country says so", async () => {
    sw.on = true;
    serve({ eligible: 1 }, { withdrawn: [], reason: "outside_territory" });
    render(<WithdrawalPanel />);
    fireEvent.click(await button());
    expect((await screen.findByRole("status")).textContent).toBe(fill(en.accountPage.withdraw.outsideTerritory, { days: 14 }));
  });
});
