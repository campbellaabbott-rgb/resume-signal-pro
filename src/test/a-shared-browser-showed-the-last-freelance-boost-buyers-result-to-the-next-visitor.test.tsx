/**
 * A SHARED BROWSER SHOWED THE LAST FREELANCE BOOST BUYER'S RESULT TO THE NEXT
 * VISITOR (wave 3 review of payments-account, S8-016 follow-up).
 *
 * WHAT WAS WRONG. The fix for S8-016 kept the purchase's Stripe session id in
 * localStorage with no expiry, and every later visit to /freelance-boost sent
 * it to recover-purchase, which returns the generated content for a session
 * id alone. In a library or work browser the next person to open the page saw
 * the previous buyer's experience section, cover letter and LinkedIn About.
 *
 * WHAT HOLDS NOW, mounted for real with only the backend faked: the browser
 * keeps only that it bought, and when, never the id; without the link from
 * the purchase email the page reads no result back; the mark lapses after a
 * week.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const invoke = vi.fn();
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
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackButtonClick: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", () => ({ useFunnelTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

import FreelanceBoost, { PURCHASE_KEY, PURCHASE_MEMORY_MS } from "../pages/FreelanceBoost";

vi.setConfig(MOUNT_TEST_BUDGET);

const PREVIOUS = "cs_test_previousbuyer01";
const calls = (fn: string) => invoke.mock.calls.filter(([f]) => f === fn);
const open = (path = "/freelance-boost") => render(<MemoryRouter initialEntries={[path]}><FreelanceBoost /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string) => fn === "recover-purchase"
    ? { data: { success: true, found: true, purchases: [{ productType: "freelance_transition_pro", generatedContent: { header: "Previous buyer's header", projects: [] } }] }, error: null }
    : { data: { success: true }, error: null });
});
afterEach(cleanup);

describe("the next visitor to /freelance-boost on a browser someone bought on", () => {
  it("is shown nothing of the earlier buyer's result", async () => {
    // What the earlier fix stored: the purchase's own id.
    localStorage.setItem(PURCHASE_KEY, PREVIOUS);
    open();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls("recover-purchase"), "the earlier buyer's result was read back for whoever opened the page").toHaveLength(0);
    expect(screen.queryByText(/Previous buyer's header/)).toBeNull();
  });

  it("the purchase leaves no id in the browser, only that it bought", async () => {
    invoke.mockResolvedValue({ data: { success: true, found: false, purchases: [] }, error: null });
    open(`/freelance-boost?session_id=${PREVIOUS}`);
    await vi.waitFor(() => expect(localStorage.getItem(PURCHASE_KEY)).not.toBeNull(), SLOW);
    expect(localStorage.getItem(PURCHASE_KEY)).not.toContain(PREVIOUS);
  });

  // Freelance Boost is no longer sold (owner decision 2026-10-17): once the
  // mark has lapsed the page sells nothing again, it says it is not sold.
  it("a week on, the mark has lapsed: the page says it is no longer sold, and sells nothing", async () => {
    localStorage.setItem(PURCHASE_KEY, JSON.stringify({ at: Date.now() - PURCHASE_MEMORY_MS - 1000 }));
    open();
    await vi.waitFor(() => expect(document.querySelector("[data-no-longer-sold]")).not.toBeNull(), SLOW);
    expect(screen.queryByRole("button", { name: /Boost my experience/ })).toBeNull();
    expect(screen.queryByText(en.freelanceBoost.openYourLink)).toBeNull();
  });
});
