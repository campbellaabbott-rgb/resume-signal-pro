/**
 * /pricing OFFERS PRO, AND NO RETIRED PRODUCT (the apply pivot, owner decision
 * 2026-10-11).
 *
 * The Agent plan ($99 a month), the Agent Pass ($29) and the $7 Apply
 * Assistant are retired: none of them may be offered on the page that sells,
 * and the structured data a search engine reads may quote none of their
 * prices. Pro is presented by what it does today (the perks in
 * src/config/pro-perks.ts, each a shipped capability), and nothing promises
 * AI tools that do not exist yet.
 *
 * Since the homepage switch-over (docs/homepage-pricing/README.md, step 4)
 * /pricing is src/pages/pricing/PricingPage.tsx: the old page's ladder and its
 * connect-your-AI line went with src/pages/Pricing.tsx, and the new page's
 * own decisions are held in hp-pricing-decisions. Mounted for real with only
 * the backend, auth and the Pro account check faked; the gates are passed as
 * the page's test input (a TEST seller, never one in src).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const invoke = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  PRO_CONFIRM_INTERVAL_MS: 3000,
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn(), justSubscribed: false, notConfirmedYet: false }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import PricingPage from "../pages/pricing/PricingPage";
import type { SaleGateInput } from "@/components/pricing/sale-gates";
import { PRODUCTS, SUBSCRIPTIONS, PASS } from "@/config/products";
import { offersAPrice } from "@/lib/pricing-offer";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => cleanup());

const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
const OPEN: SaleGateInput = { seller: TEST_SELLER, fullAnalysisDelivered: true, proWatched: true };

const mount = (gateInput?: SaleGateInput) =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/pricing"]}>
        <PricingPage gateInput={gateInput} />
      </MemoryRouter>
    </HelmetProvider>,
  );
const ld = () => JSON.parse(document.querySelector('script[type="application/ld+json"]')!.innerHTML) as {
  offers: Array<{ name: string; price: string }>;
};

describe("/pricing after the apply pivot", () => {
  it("renders the Pro card and no Agent plan card", () => {
    mount(OPEN);
    expect(document.querySelector("[data-plan='pro'] h2")?.textContent).toBe("Pro");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain(`$${SUBSCRIPTIONS.agent.priceUsd}`);
    expect(text).not.toMatch(/Morning Queue|Apply Agent|Agent plan|Start the agent/);
  });

  it("offers no pass and prices no pass", () => {
    for (const input of [undefined, OPEN]) {
      mount(input);
      const text = document.body.textContent ?? "";
      expect(text).not.toContain(`$${PASS.priceUsd} for`);
      expect(text).not.toMatch(/one-off pass|Agent Pass/);
      cleanup();
    }
  });

  it("does not offer the Apply Assistant, and the Full Analysis card is there", () => {
    mount(OPEN);
    expect(screen.queryByText(PRODUCTS.applyAssistant.name)).toBeNull();
    expect(document.querySelector("[data-plan='full-analysis'] h2")?.textContent).toBe("Full Analysis");
  });

  it("while no seller is named (as shipped) the structured data offers nothing at a price", () => {
    mount();
    const data = ld();
    expect(offersAPrice(data)).toBe(false);
    expect(data.offers).toEqual([expect.objectContaining({ "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" })]);
  });

  it("once purchases open, the structured data quotes only what is sold and no retired price", () => {
    mount(OPEN);
    const prices = ld().offers.map((o) => Number(o.price));
    expect(prices.sort((a, b) => a - b)).toEqual([0, PRODUCTS.fullAnalysis.priceUsd, SUBSCRIPTIONS.pro.priceUsd]);
    for (const retired of [SUBSCRIPTIONS.agent.priceUsd, PASS.priceUsd, PRODUCTS.applyAssistant.priceUsd]) expect(prices).not.toContain(retired);
  });

  it("starts no checkout on load", () => {
    for (const input of [undefined, OPEN]) {
      mount(input);
      cleanup();
    }
    const fns = invoke.mock.calls.map((c) => (c as unknown[])[0]);
    expect(fns).not.toContain("create-agent-checkout");
    expect(fns).not.toContain("create-pass-checkout");
    expect(fns).not.toContain("create-checkout");
    expect(fns).not.toContain("create-subscription-checkout");
  });
});
