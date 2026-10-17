/**
 * CLOSING THE CHECKOUT OVERLAY STOPS THE HAND-OFF (S12-108, critical-path
 * CP-035), AND A REFUSAL IS SAID, NOT RETRIED (S12-059).
 *
 * WHAT WAS WRONG. The $5 Full Analysis overlay offers Close after a few
 * seconds, and Close only hid it: the checkout request already in flight
 * went on, and seconds later the page navigated to Stripe anyway, for a
 * buyer who had just said no.
 *
 * WHAT HOLDS NOW, on the mounted homepage: a press takes a number, Close
 * moves the number on, and every step after an await checks it is still the
 * wanted press, so a Close at any point means nothing navigates. The control
 * (no Close) still hands off. A territory refusal from create-checkout is
 * shown with its own sentence and nothing navigates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

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
      rpc: async (fn: string) => ({ data: fn === "store_temp_resume" ? "00000000-0000-4000-8000-0000000c0001" : null, error: null }),
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
const redirects: unknown[] = [];
vi.mock("@/hooks/use-resume-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setCheckoutRedirect: (v: unknown) => { redirects.push(v); },
}));
let answerCheckout: (v: unknown) => void = () => {};
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return {
    ...real,
    resilientCallers: {
      ...real.resilientCallers,
      freeKeywordScan: () => new Promise(() => {}),
      createCheckout: () => new Promise((resolve) => { answerCheckout = resolve; }),
    },
  };
});
vi.mock("@/components/CheckoutOverlay", () => ({
  CLOSE_OFFERED_AFTER_MS: 4000,
  CheckoutOverlay: ({ isVisible, onClose, error }: { isVisible: boolean; onClose?: () => void; error?: string }) =>
    isVisible ? (
      <div data-testid="checkout-overlay">
        {error ? <p data-testid="overlay-error">{error}</p> : null}
        <button type="button" onClick={onClose}>close overlay</button>
      </div>
    ) : null,
}));
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: ({ onTextSubmit }: { onTextSubmit: (t: string) => void }) => (
    <button type="button" onClick={() => onTextSubmit("Senior financial analyst with nine years in FP&A. ".repeat(6))}>paste and analyse</button>
  ),
}));
const toasts: Array<{ title?: string; description?: string }> = [];
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string; description?: string }) => { toasts.push(t); } }), toast: () => {} }));

import Index from "@/pages/Index";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeEach(() => { redirects.length = 0; toasts.length = 0; });
afterEach(cleanup);

const start = async () => {
  render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
  fireEvent.click(screen.getByRole("button", { name: "paste and analyse" }));
  expect(await screen.findByTestId("checkout-overlay")).toBeTruthy();
  // Let the press reach the checkout call.
  await waitFor(() => expect(typeof answerCheckout).toBe("function"));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const answer = async (v: unknown) => {
  await act(async () => { answerCheckout(v); await new Promise((r) => setTimeout(r, 450)); });
};

describe("Close on the Full Analysis overlay", () => {
  it("while the checkout is in flight: nothing navigates when the answer arrives", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "close overlay" }));
    expect(screen.queryByTestId("checkout-overlay")).toBeNull();
    await answer({ data: { url: "https://checkout.stripe.com/c/cs_test_late", sessionId: "cs_test_late" }, error: null });
    expect(redirects, "the closed checkout still handed the buyer to Stripe").not.toContain(true);
    expect(screen.queryByTestId("checkout-overlay")).toBeNull();
  });

  it("control: without Close the hand-off happens", async () => {
    await start();
    await answer({ data: { url: "https://checkout.stripe.com/c/cs_test_go", sessionId: "cs_test_go" }, error: null });
    expect(redirects).toContain(true);
  });
});

describe("a refusal written for the buyer", () => {
  it("the territory's 451 is said in its own words, and nothing navigates", async () => {
    await start();
    const sentence = "We can't sell to buyers in the EU, the EEA or the UK yet: sales there wait until we are registered for VAT. Nothing was charged.";
    await answer({ data: null, error: { title: "x", description: "x", isRetryable: false }, httpStatus: 451, errorBody: { error: sentence, territoryRefused: true } });
    expect(toasts.some((t) => t.description === sentence)).toBe(true);
    expect(redirects).not.toContain(true);
  });
});
