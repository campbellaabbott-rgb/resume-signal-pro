/**
 * A PURCHASE EMAIL OPENED ON ANOTHER DEVICE COUNTED A SECOND SALE (review of
 * wave3/email-ops, 2026-10-10).
 *
 * WHAT WAS WRONG. ProductSuccess's saved-copy branch (the purchase opened
 * from its email, or the webhook finished first) recorded purchase_completed
 * on the conversion and funnel trackers. Neither dedupes by session across
 * devices: the conversion tracker keys sessionStorage (one tab), the server
 * keys the visitor id, and the funnel counts distinct visitors. So every
 * revisit from the email on a new device or browser added a purchase with no
 * checkout behind it, inflating the purchases and the conversion rate the
 * owner reads.
 *
 * WHAT HOLDS NOW, with the real page mounted and only the backend faked: the
 * saved copy is shown either way; it is counted as a sale only in the tab
 * that started the checkout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const invoke = vi.fn();
const conversionPurchase = vi.fn();
const funnelPurchase = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: conversionPurchase, trackButtonClick: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()),
  useFunnelTracking: () => ({ trackPurchaseCompleted: funnelPurchase, trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));
vi.mock("@/hooks/use-product-checkout", () => ({ useProductCheckout: () => ({ purchaseProduct: vi.fn(), isLoading: false, currentProduct: null }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

import ProductSuccess from "../pages/ProductSuccess";

vi.setConfig(MOUNT_TEST_BUDGET);

const LETTER = "Dear hiring team, the letter you bought last night is still here.";
const SESSION = "cs_live_boughtlastnight0001";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  invoke.mockReset();
  conversionPurchase.mockReset();
  funnelPurchase.mockReset();
  invoke.mockImplementation(async (fn: string) => {
    if (fn === "verify-product-purchase") return { data: { success: true, verified: true, isFirstUse: false, productType: "cover_letter", customerEmail: "b@example.com", generatedContent: null }, error: null };
    if (fn === "recover-purchase") return { data: { success: true, found: true, purchases: [{ id: "p", productType: "cover_letter", productName: "Cover Letter", generatedContent: { coverLetter: LETTER, keySkillsHighlighted: [] } }] }, error: null };
    return { data: {}, error: null };
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = () => render(<MemoryRouter initialEntries={[`/product-success?session_id=${SESSION}&product=coverLetter`]}><ProductSuccess /></MemoryRouter>);

describe("the saved copy of a purchase", () => {
  it("opened from the email on a device that never started the checkout: shown, and not counted as a sale", async () => {
    open();
    expect(await screen.findByText(LETTER, {}, SLOW)).toBeInTheDocument();
    expect(conversionPurchase, "a revisit from the email was recorded as a purchase").not.toHaveBeenCalled();
    expect(funnelPurchase, "a revisit from the email was recorded as a funnel purchase").not.toHaveBeenCalled();
  });

  // WAVE 3 INTEGRATION. payments-account made verify-product-purchase answer the
  // webhook's saved copy whatever the page asked (S8-009), so a revisit from the
  // email reaches the page with the copy in verify's own answer, not through
  // recover-purchase. That path must keep the same rule.
  const savedInVerify = (isFirstUse: boolean) => invoke.mockImplementation(async (fn: string) => {
    if (fn === "verify-product-purchase") return { data: { success: true, verified: true, isFirstUse, productType: "cover_letter", customerEmail: "b@example.com", generatedContent: { coverLetter: LETTER, keySkillsHighlighted: [] } }, error: null };
    return { data: {}, error: null };
  });

  it("answered by verify-product-purchase itself, on a device that never started the checkout: shown, and not counted", async () => {
    savedInVerify(false);
    open();
    expect(await screen.findByText(LETTER, {}, SLOW)).toBeInTheDocument();
    expect(conversionPurchase, "a revisit from the email was recorded as a purchase").not.toHaveBeenCalled();
    expect(funnelPurchase).not.toHaveBeenCalled();
  });

  it("answered by verify-product-purchase on the purchase's first use, or in the tab that started the checkout: counted once", async () => {
    savedInVerify(true);
    open();
    expect(await screen.findByText(LETTER, {}, SLOW)).toBeInTheDocument();
    expect(conversionPurchase).toHaveBeenCalledTimes(1);
    cleanup();
    conversionPurchase.mockReset();
    savedInVerify(false);
    sessionStorage.setItem("funnel_progress", JSON.stringify(["landing_view", "product_clicked", "checkout_started"]));
    open();
    expect(await screen.findByText(LETTER, {}, SLOW)).toBeInTheDocument();
    expect(conversionPurchase).toHaveBeenCalledTimes(1);
  });

  it("in the tab that started the checkout (the webhook finished first): shown, and counted once", async () => {
    sessionStorage.setItem("funnel_progress", JSON.stringify(["landing_view", "product_clicked", "checkout_started"]));
    open();
    expect(await screen.findByText(LETTER, {}, SLOW)).toBeInTheDocument();
    expect(conversionPurchase).toHaveBeenCalledTimes(1);
    expect(conversionPurchase.mock.calls[0][2]).toBe(SESSION);
    expect(funnelPurchase).toHaveBeenCalledTimes(1);
  });
});
