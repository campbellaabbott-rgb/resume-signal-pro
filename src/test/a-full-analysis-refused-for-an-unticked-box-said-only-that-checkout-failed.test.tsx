/**
 * A FULL ANALYSIS REFUSED FOR AN UNTICKED BOX SAID ONLY THAT CHECKOUT FAILED
 * (wave 3 review of payments-account, item 12 with owner decision 3).
 *
 * WHAT WAS WRONG. With the EU/UK switch on, create-checkout answers 400
 * { consentRequired } when the waiver box above the button is not ticked.
 * Every other checkout caller reads that and asks for the box; the homepage's
 * Full Analysis checkout (Index.handleCheckout) threw it into the generic
 * failure path, so the buyer read "checkout failed" with an error overlay and
 * a retry that could never succeed, and was never told about the box.
 *
 * WHAT HOLDS NOW: the whole homepage is mounted, a paste starts the Full
 * Analysis checkout, create-checkout refuses for the box, and the buyer is
 * asked to tick it, with the overlay closed and no error left on it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "order", "limit", "gte", "lte", "in"]) th[k] = () => th;
    th.maybeSingle = async () => ({ data: null });
    th.single = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke: async () => ({ data: null, error: null }) },
      from: table,
      rpc: async (fn: string) => ({ data: fn === "store_temp_resume" ? "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b" : null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
vi.mock("@/hooks/use-shared-data", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkConnectionHealth: async () => true,
}));
// create-checkout's answer with the switch on and the box unticked.
const createCheckout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, createCheckout } };
});
vi.mock("@/components/CheckoutOverlay", () => ({
  CLOSE_OFFERED_AFTER_MS: 4000,
  CheckoutOverlay: ({ isVisible, error }: { isVisible: boolean; error?: string }) =>
    isVisible ? <div data-testid="checkout-overlay">{error}</div> : null,
}));
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: ({ onTextSubmit }: { onTextSubmit: (t: string) => void }) => (
    <button type="button" onClick={() => onTextSubmit("Senior financial analyst with nine years in FP&A. ".repeat(6))}>paste and analyse</button>
  ),
}));

import Index from "@/pages/Index";
import { euUkBoxShown, resetPurchaseTermsForTests } from "@/lib/purchase-terms";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => { cleanup(); resetPurchaseTermsForTests(); });

describe("the homepage's Full Analysis checkout refused for the EU/UK box", () => {
  it("asks the buyer to tick the box and leaves no failed checkout on screen", async () => {
    createCheckout.mockResolvedValue({
      data: null,
      error: { title: "Request failed", description: "Please tick the box above the button to continue.", isRetryable: false },
      attempts: 1,
      totalDuration: 5,
      httpStatus: 400,
      errorBody: { error: "Please tick the box above the button to continue.", consentRequired: "withdrawal_waiver_required" },
    });
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(screen.getByRole("button", { name: "paste and analyse" }));
    await waitFor(() => expect(createCheckout).toHaveBeenCalled());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: en.purchaseTerms.consentNeeded })));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: en.homepage.toast.checkoutFailed }));
    await waitFor(() => expect(screen.queryByTestId("checkout-overlay"), "the overlay stayed up").toBeNull());
  });

  // Review of S11-142: the refusal is the server saying its switch is on, and
  // only five callers read it that way. A page loaded before the owner flipped
  // the switch told the buyer to tick a box it never showed until a reload.
  it("the refusal shows the box beside the button, on a page loaded before the switch", async () => {
    createCheckout.mockResolvedValue({
      data: null,
      error: { title: "Request failed", description: "Please tick the box above the button to continue.", isRetryable: false },
      attempts: 1,
      totalDuration: 5,
      httpStatus: 400,
      errorBody: { error: "Please tick the box above the button to continue.", consentRequired: "withdrawal_waiver_required", consentBox: "withdrawalWaiver", consentText: "I want it delivered now." },
    });
    expect(euUkBoxShown()).toBe(false);
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(screen.getByRole("button", { name: "paste and analyse" }));
    await waitFor(() => expect(createCheckout).toHaveBeenCalled());
    await waitFor(() => expect(euUkBoxShown(), "the refusal named the box and the page still did not show it").toBe(true));
  });
});
