/**
 * A RETRY SENDS THE BOX ITS FIRST PRESS CARRIED (review of S11-141).
 *
 * S11-141 made each Terms line's EU/UK box clear the moment a purchase read
 * it. The Full Analysis overlay's "Try again" (data-purchase-retry) continues
 * the first press's purchase, so it read the same line, now empty, and sent
 * withdrawalWaiver:false: with EU_UK_SALES on, every retry after a failed
 * first attempt (offline, a connection error, a 5xx) was refused with
 * withdrawal_waiver_required, though the buyer had ticked the box. And a
 * product checkout that read the box and then started nothing (the ATS
 * Defense roles question closed, a résumé that could not be stored) lost the
 * tick.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const eu = vi.hoisted(() => ({ on: true }));
vi.mock("@/config/eu-consumer", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  get EU_UK_SALES_ON() { return eu.on; },
}));
const invoke = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null })));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: () => ({ insert: async () => ({ error: null }) }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn(), dismiss() {}, toasts: [] }), toast: vi.fn() }));
const askForTargetRoles = vi.hoisted(() => vi.fn(async () => null as string[] | null));
vi.mock("@/lib/target-roles-request", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  askForTargetRoles,
}));

import { PurchaseTerms } from "@/components/PurchaseTerms";
import { purchaseTerms, resetPurchaseTermsForTests } from "@/lib/purchase-terms";
import { useProductCheckout } from "@/hooks/use-product-checkout";

afterEach(() => { cleanup(); resetPurchaseTermsForTests(); invoke.mockClear(); askForTargetRoles.mockClear(); });

function Page() {
  return (
    <div>
      <div data-testid="card">
        <PurchaseTerms kind="payment" />
        <button type="button">buy</button>
      </div>
      <div role="dialog"><button type="button" data-purchase-retry="">Try again</button></div>
      <button type="button">elsewhere</button>
    </div>
  );
}
const box = () => screen.getByTestId("card").querySelector("input[type=checkbox]") as HTMLInputElement;

describe("the Full Analysis retry", () => {
  it("a retry after a failed first attempt sends the box the first press carried", () => {
    render(<Page />);
    fireEvent.click(box());
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(purchaseTerms()).toMatchObject({ withdrawalWaiver: true });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(purchaseTerms(), "the retry lost the box its first press carried").toMatchObject({ withdrawalWaiver: true });
  });

  it("a fresh press is not a retry: the spent box stays spent", async () => {
    render(<Page />);
    fireEvent.click(box());
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(purchaseTerms()).toMatchObject({ withdrawalWaiver: true });
    await waitFor(() => expect(box().checked).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(purchaseTerms()).toMatchObject({ withdrawalWaiver: false });
  });
});

describe("a product checkout that starts nothing gives the box back", () => {
  it("closing the ATS Defense roles question leaves the box ticked, and the next press sends it", async () => {
    render(<Page />);
    const { result } = renderHook(() => useProductCheckout());
    fireEvent.click(box());
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    await act(async () => { await result.current.purchaseProduct("atsDefense"); });
    expect(askForTargetRoles).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(box().checked, "closing the roles question lost the tick").toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(purchaseTerms()).toMatchObject({ withdrawalWaiver: true });
  });

  it("a checkout call that fails leaves the box ticked too", async () => {
    askForTargetRoles.mockResolvedValueOnce(["Data Analyst"]);
    invoke.mockResolvedValueOnce({ data: null, error: new Error("offline") } as never);
    render(<Page />);
    const { result } = renderHook(() => useProductCheckout());
    fireEvent.click(box());
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    await act(async () => { await result.current.purchaseProduct("atsDefense"); });
    expect(invoke).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(box().checked).toBe(true));
  });
});
