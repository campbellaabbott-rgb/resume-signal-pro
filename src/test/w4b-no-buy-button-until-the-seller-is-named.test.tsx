/**
 * NO BUY BUTTON UNTIL THE SELLER IS NAMED (owner decision 2026-10-17;
 * California Business and Professions Code 17538(d)).
 *
 * The buy buttons for the $5 Full Analysis and Pro render only while
 * src/config/seller.ts carries the seller's legal name and postal address;
 * until then the pages say purchases open soon. Mounted for real, with the
 * shipped (empty) identity, unless a test names one:
 *   - the homepage's Full Analysis press (the paste-and-analyse path, the
 *     report's "Get Full Analysis", the uploader's buy link all call it)
 *     opens no checkout overlay and asks create-checkout nothing; it says
 *     purchases open soon;
 *   - the closing call to action offers the free scan, not the $5 price;
 *   - the sticky bar that prices the analysis does not show;
 *   - control: with a seller named, the press starts the checkout and the
 *     price and the bar are back.
 * (The Pricing page and the Pro card are mounted the same way in
 * w4b-the-pricing-page-sells-what-is-sold.test.tsx.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

// The seller, as shipped (empty) or named by a test.
const seller = vi.hoisted(() => ({ legalName: "", postalAddress: "" }));
vi.mock("@/config/seller", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/seller")>();
  return { ...real, SELLER: seller, sellerIdentity: (s = seller) => real.sellerIdentity(s) };
});
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
      rpc: async (fn: string) => ({ data: fn === "store_temp_resume" ? "00000000-0000-4000-8000-0000000c0002" : null, error: null }),
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
const checkoutCalls: unknown[] = [];
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return {
    ...real,
    resilientCallers: {
      ...real.resilientCallers,
      freeKeywordScan: () => new Promise(() => {}),
      createCheckout: (...a: unknown[]) => { checkoutCalls.push(a); return new Promise(() => {}); },
    },
  };
});
vi.mock("@/components/CheckoutOverlay", () => ({
  CLOSE_OFFERED_AFTER_MS: 4000,
  CheckoutOverlay: ({ isVisible }: { isVisible: boolean }) => (isVisible ? <div data-testid="checkout-overlay" /> : null),
}));
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: ({ onTextSubmit }: { onTextSubmit: (t: string) => void }) => (
    <button type="button" onClick={() => onTextSubmit("Senior financial analyst with nine years in FP&A. ".repeat(6))}>paste and analyse</button>
  ),
}));
const toasts: Array<{ title?: string; description?: string }> = [];
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string; description?: string }) => { toasts.push(t); } }), toast: () => {} }));

import Index from "@/pages/Index";
import { FinalCTA } from "@/components/FinalCTA";
import { StickyBottomCTA } from "@/components/StickyBottomCTA";
import { PRODUCTS } from "@/config/products";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeEach(() => { checkoutCalls.length = 0; toasts.length = 0; seller.legalName = ""; seller.postalAddress = ""; });
afterEach(cleanup);

const nameSeller = () => { seller.legalName = "Example Seller LLC"; seller.postalAddress = "1 Example Street, Springfield"; };
const press = async () => {
  render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
  fireEvent.click(screen.getByRole("button", { name: "paste and analyse" }));
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
};

describe("the homepage's Full Analysis press", () => {
  it("with no seller named: no overlay, no call to create-checkout, and it says purchases open soon", async () => {
    await press();
    expect(screen.queryByTestId("checkout-overlay")).toBeNull();
    expect(checkoutCalls).toEqual([]);
    expect(toasts.some((t) => t.title === "Purchases open soon")).toBe(true);
  });

  it("control: with a seller named, the press starts the checkout", async () => {
    nameSeller();
    await press();
    expect(await screen.findByTestId("checkout-overlay")).toBeTruthy();
    await waitFor(() => expect(checkoutCalls.length).toBe(1));
  });
});

describe("the homepage's other offers of the analysis", () => {
  it("the closing call to action offers the free scan, not the $5 price, while no seller is named", () => {
    render(<FinalCTA onGetStarted={() => {}} />);
    expect(document.querySelector("[data-final-cta-closed] [data-purchases-open-soon]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Scan my résumé free/ })).toBeTruthy();
    expect(document.body.textContent).not.toContain(`$${PRODUCTS.fullAnalysis.priceUsd}one-time`);
  });

  it("control: with a seller named, the closing call to action prices the analysis again", () => {
    nameSeller();
    render(<FinalCTA onGetStarted={() => {}} />);
    expect(document.querySelector("[data-final-cta-closed]")).toBeNull();
    expect(document.body.textContent).toContain(`$${PRODUCTS.fullAnalysis.priceUsd}`);
  });

  it("the sticky bar that prices the analysis does not show while no seller is named, and does once one is", async () => {
    const scrollTo = window.scrollY;
    const at = (y: number) => { Object.defineProperty(window, "scrollY", { configurable: true, value: y }); fireEvent.scroll(window); };
    render(<MemoryRouter><StickyBottomCTA /></MemoryRouter>);
    await act(async () => { at(900); });
    expect(document.body.textContent).not.toContain(`· $${PRODUCTS.fullAnalysis.priceUsd}`);
    cleanup();
    nameSeller();
    render(<MemoryRouter><StickyBottomCTA /></MemoryRouter>);
    await act(async () => { at(901); });
    expect(document.body.textContent).toContain(`$${PRODUCTS.fullAnalysis.priceUsd}`);
    Object.defineProperty(window, "scrollY", { configurable: true, value: scrollTo });
  });
});
