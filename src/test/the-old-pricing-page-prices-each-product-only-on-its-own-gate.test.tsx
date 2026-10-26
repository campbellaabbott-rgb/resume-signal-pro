/**
 * THE OLD /pricing PAGE PRICES EACH PRODUCT ONLY ON ITS OWN GATE (hp/scanner
 * on wave 4's recheck 3, 2026-10-26).
 *
 * Wave 4's recheck 3 gave the page structured data and a description tail
 * that follow one switch: once purchases open, an AggregateOffer up to Pro's
 * price; until then a free Offer and "Purchases open soon" (src/lib/
 * pricing-offer.ts). On hp/scanner each product opens on its own gate
 * (src/lib/purchases-open.ts: the Full Analysis on G1 and G2, Pro on G1 and
 * G2b), so one switch could price a product the page does not sell, or say
 * purchases open soon beside one it does. Each case here mounts the page in
 * one of the four gate states and reads what a search engine reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: true, checked: true }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: ({ description }: { description: string }) => <meta data-seo-description={description} /> }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));
const gate = vi.hoisted(() => ({ fa: false, pro: false }));
vi.mock("@/lib/purchases-open", () => ({
  purchasesOpen: () => gate.fa || gate.pro,
  fullAnalysisOnSale: () => gate.fa,
  proOnSale: () => gate.pro,
}));

import Pricing from "../pages/Pricing";
import { PRODUCTS, SUBSCRIPTIONS } from "@/config/products";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => { cleanup(); gate.fa = false; gate.pro = false; });

type Offer = { "@type": string; price?: string; lowPrice?: string; highPrice?: string; offerCount?: number };
const mount = (fa: boolean, pro: boolean) => {
  gate.fa = fa; gate.pro = pro;
  render(<MemoryRouter initialEntries={["/pricing"]}><Pricing /></MemoryRouter>);
  const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]')!.innerHTML) as { offers: Offer };
  const description = document.querySelector("meta[data-seo-description]")!.getAttribute("data-seo-description") ?? "";
  return { offers: ld.offers, description };
};
const SOON = "Purchases open soon.";

describe("the old /pricing page's structured data and description, by gate", () => {
  it("neither on sale: the free Offer alone, and the description says purchases open soon", () => {
    const { offers, description } = mount(false, false);
    expect(offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(description.endsWith(SOON)).toBe(true);
  });

  it("only the Full Analysis on sale (G2 open, G2b closed): the range ends at its price, and Pro's is not offered", () => {
    const { offers, description } = mount(true, false);
    expect(offers["@type"]).toBe("AggregateOffer");
    expect(Number(offers.highPrice)).toBe(PRODUCTS.fullAnalysis.priceUsd);
    expect(Number(offers.highPrice)).not.toBe(SUBSCRIPTIONS.pro.priceUsd);
    expect(offers.offerCount).toBe(2);
    expect(description).not.toContain(SOON);
  });

  it("only Pro on sale (G2b open, G2 closed): Pro's price is offered, the description does not say purchases open soon, and the Full Analysis card still does", () => {
    const { offers, description } = mount(false, true);
    expect(offers["@type"]).toBe("AggregateOffer");
    expect(Number(offers.highPrice)).toBe(SUBSCRIPTIONS.pro.priceUsd);
    expect(offers.offerCount).toBe(2);
    expect(description).not.toContain(SOON);
    expect(document.querySelector('[data-ladder="fullAnalysis"] [data-purchases-open-soon]')).not.toBeNull();
  });

  it("both on sale: the range runs to Pro and counts the free offer, the Full Analysis and Pro", () => {
    const { offers, description } = mount(true, true);
    expect(offers["@type"]).toBe("AggregateOffer");
    expect(Number(offers.highPrice)).toBe(Math.max(PRODUCTS.fullAnalysis.priceUsd, SUBSCRIPTIONS.pro.priceUsd));
    expect(offers.offerCount).toBe(3);
    expect(description).not.toContain(SOON);
  });
});
