/**
 * A TAP DURING CHECKOUT ERASED THE TERMS ITS PRESS CARRIED (review of the
 * wave-3 integration, 2026-10-10, money-consent lens).
 *
 * WHAT WAS WRONG. purchaseTerms() reads the LAST press on the page at the
 * moment it runs, and two checkouts ran it only after awaits:
 *   - the homepage's Full Analysis (Index.handleCheckout) showed its
 *     full-screen overlay, then awaited the connection check and the résumé
 *     store, and only then built the create-checkout body;
 *   - every product checkout (use-product-checkout) awaited the résumé
 *     binding first.
 * A tap during that wait, on the overlay or anywhere, became the last press.
 * A buyer who pressed a button under its Terms line was then recorded with no
 * Terms version, and with the EU/UK switch on the ticked box was dropped, so
 * the server refused a buyer who had ticked it.
 *
 * WHAT HOLDS NOW, rendered with the résumé store held open for 100 ms and a
 * tap on the page body in that window: both checkouts send the version (and,
 * switch on, the ticked box) of the press that started them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { TERMS_VERSION } from "@/config/terms";

const eu = vi.hoisted(() => ({ on: false }));
vi.mock("@/config/eu-consumer", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  get EU_UK_SALES_ON() { return eu.on; },
}));

const STORED = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "order", "limit", "gte", "lte", "in", "insert", "upsert", "update"]) th[k] = () => th;
    th.maybeSingle = async () => ({ data: null });
    th.single = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke },
      from: table,
      // The résumé store, held open long enough for a second tap to land.
      rpc: async (fn: string) => {
        if (fn !== "store_temp_resume") return { data: null, error: null };
        await new Promise((r) => setTimeout(r, 100));
        return { data: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn(), dismiss() {}, toasts: [] }), toast: vi.fn() }));
// Purchases open, as once the owner names the seller (owner decision
// 2026-10-17); and Freelance Boost, cut that day, stands in unhidden for a
// product this hook sells: the Terms each press carries is what is tested.
vi.mock("@/lib/purchases-open", () => ({ purchasesOpen: () => true }));
vi.mock("@/config/products", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/products")>();
  return { ...real, isProductHidden: (id: string) => id !== "freelanceBoost" && real.isProductHidden(id as never) };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/hooks/use-shared-data", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkConnectionHealth: async () => true,
}));
const createCheckout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, createCheckout } };
});
vi.mock("@/components/CheckoutOverlay", () => ({
  CLOSE_OFFERED_AFTER_MS: 4000,
  CheckoutOverlay: ({ isVisible }: { isVisible: boolean }) => (isVisible ? <div data-testid="checkout-overlay" /> : null),
}));
const RESUME = "Senior financial analyst with nine years in FP&A, forecasting and the monthly close. ".repeat(3);
// The homepage's uploader, reduced to a buy button in a Terms line's block.
vi.mock("@/components/ResumeUploader", async () => {
  const { PurchaseTerms } = await import("@/components/PurchaseTerms");
  return {
    ResumeUploader: ({ onTextSubmit }: { onTextSubmit: (t: string) => void }) => (
      <div>
        <PurchaseTerms kind="payment" />
        <button type="button" onClick={() => onTextSubmit("Senior financial analyst with nine years in FP&A, forecasting and the monthly close. ".repeat(3))}>buy the full analysis</button>
      </div>
    ),
  };
});

import Index from "@/pages/Index";
import { PurchaseTerms } from "@/components/PurchaseTerms";
import { useProductCheckout } from "@/hooks/use-product-checkout";
import { resetPurchaseTermsForTests } from "@/lib/purchase-terms";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => {
  cleanup(); eu.on = false; invoke.mockReset(); createCheckout.mockReset();
  resetPurchaseTermsForTests();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});

/** Ticks the box of the Terms line that covers this button (each line holds its own, S11-141). */
function tickBoxBeside(name: string) {
  let block: HTMLElement | null = screen.getByRole("button", { name }).parentElement;
  while (block && !block.querySelector("input[type=checkbox]")) block = block.parentElement;
  fireEvent.click(block!.querySelector("input[type=checkbox]")!);
}

/** A press, then a tap on the page body while the résumé store is still open. */
async function pressThenTapElsewhere(button: HTMLElement) {
  fireEvent.click(button);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  fireEvent.click(document.body);
}

describe("a product checkout (use-product-checkout)", () => {
  function Card() {
    const { purchaseProduct } = useProductCheckout();
    return (
      <div>
        <PurchaseTerms kind="payment" />
        {/* Freelance Boost: the products made from the résumé (which stored a
            copy first) were all cut on 2026-10-12; the press still awaits the
            session read before the call, and a tap there must not replace it. */}
        <button type="button" onClick={() => { void purchaseProduct("freelanceBoost", { inputs: { resumeText: RESUME, jobDescription: null } }); }}>unlock</button>
      </div>
    );
  }
  const body = () => (invoke.mock.calls.find(([fn]) => fn === "create-product-checkout")?.[1] as { body: Record<string, unknown> } | undefined)?.body;

  it("sends the Terms version of the press that started it, though the page was tapped during the store", async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    render(<MemoryRouter><Card /></MemoryRouter>);
    await pressThenTapElsewhere(screen.getByRole("button", { name: "unlock" }));
    await waitFor(() => expect(body(), "create-product-checkout was never called").toBeTruthy());
    expect(body(), "the tap during the awaits replaced the press").toMatchObject({ termsVersion: TERMS_VERSION, productId: "freelanceBoost" });
  });

  it("with the EU/UK switch on, the box ticked beside the button reaches the checkout", async () => {
    eu.on = true;
    invoke.mockResolvedValue({ data: null, error: null });
    render(<MemoryRouter><Card /></MemoryRouter>);
    tickBoxBeside("unlock");
    await pressThenTapElsewhere(screen.getByRole("button", { name: "unlock" }));
    await waitFor(() => expect(body()).toBeTruthy());
    expect(body()).toMatchObject({ termsVersion: TERMS_VERSION, withdrawalWaiver: true });
  });
});

describe("the homepage's Full Analysis checkout (Index.handleCheckout)", () => {
  const sent = () => createCheckout.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

  it("sends the Terms version of the press that started it, though the overlay was tapped during the store", async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    createCheckout.mockResolvedValue({ data: null, error: { title: "x", description: "stopped for the test", isRetryable: false }, attempts: 1, totalDuration: 1 });
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    await pressThenTapElsewhere(screen.getByRole("button", { name: "buy the full analysis" }));
    await waitFor(() => expect(createCheckout, "create-checkout was never called").toHaveBeenCalled());
    expect(sent()!.tempSessionId, "the checkout did not wait for the store").toBe(STORED);
    expect(sent(), "the tap during the store replaced the press").toMatchObject({ termsVersion: TERMS_VERSION });
  });

  it("with the EU/UK switch on, the box ticked beside the button reaches create-checkout", async () => {
    eu.on = true;
    invoke.mockResolvedValue({ data: null, error: null });
    createCheckout.mockResolvedValue({ data: null, error: { title: "x", description: "stopped for the test", isRetryable: false }, attempts: 1, totalDuration: 1 });
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    tickBoxBeside("buy the full analysis");
    await pressThenTapElsewhere(screen.getByRole("button", { name: "buy the full analysis" }));
    await waitFor(() => expect(createCheckout).toHaveBeenCalled());
    expect(sent()).toMatchObject({ termsVersion: TERMS_VERSION, withdrawalWaiver: true });
  });
});
