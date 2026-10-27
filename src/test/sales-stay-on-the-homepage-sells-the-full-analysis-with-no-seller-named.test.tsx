/**
 * THE HOMEPAGE SELLS THE FULL ANALYSIS WITH NO SELLER NAMED (owner,
 * 2026-10-27: "there is no sales pause ... no one told you to do that").
 *
 * Wave 4 hid every buy control while src/config/seller.ts was empty, which is
 * how it ships. Mounted for real with the shipped identity (nothing mocks the
 * seller):
 *   - the homepage's Full Analysis press opens the checkout overlay and asks
 *     create-checkout, carrying the page's language;
 *   - the closing call to action prices the analysis;
 *   - the sticky bar that prices the analysis shows once the page scrolls.
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
      rpc: async (fn: string) => ({ data: fn === "store_temp_resume" ? "00000000-0000-4000-8000-0000000c0003" : null, error: null }),
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
import { SELLER } from "@/config/seller";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeEach(() => { checkoutCalls.length = 0; toasts.length = 0; });
afterEach(cleanup);

describe("the premise", () => {
  it("the page's seller ships empty", () => {
    expect({ ...SELLER }).toEqual({ legalName: "", postalAddress: "" });
  });
});

describe("the homepage's Full Analysis press, with no seller named", () => {
  it("opens the checkout overlay and asks create-checkout, in the page's language", async () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(screen.getByRole("button", { name: "paste and analyse" }));
    expect(await screen.findByTestId("checkout-overlay")).toBeTruthy();
    await waitFor(() => expect(checkoutCalls.length).toBe(1));
    expect((checkoutCalls[0] as Array<Record<string, unknown>>)[0].language).toBe("en");
    expect(toasts.some((t) => /open soon/i.test(`${t.title ?? ""} ${t.description ?? ""}`))).toBe(false);
  });
});

describe("the homepage's other offers of the analysis, with no seller named", () => {
  it("the closing call to action prices the analysis", () => {
    render(<FinalCTA onGetStarted={() => {}} />);
    expect(document.querySelector("[data-purchases-open-soon]")).toBeNull();
    expect(document.body.textContent).toContain(`$${PRODUCTS.fullAnalysis.priceUsd}`);
  });

  it("the sticky bar that prices the analysis shows once the page scrolls", async () => {
    const scrollTo = window.scrollY;
    render(<MemoryRouter><StickyBottomCTA /></MemoryRouter>);
    await act(async () => { Object.defineProperty(window, "scrollY", { configurable: true, value: 900 }); fireEvent.scroll(window); });
    expect(document.body.textContent).toContain(`$${PRODUCTS.fullAnalysis.priceUsd}`);
    Object.defineProperty(window, "scrollY", { configurable: true, value: scrollTo });
  });
});
