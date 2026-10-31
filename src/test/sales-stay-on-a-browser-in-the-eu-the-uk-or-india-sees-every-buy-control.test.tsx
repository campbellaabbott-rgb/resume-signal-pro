/**
 * A BROWSER IN THE EU, THE EEA, THE UK OR INDIA SEES EVERY BUY CONTROL (owner,
 * 2026-10-27, on those sales: "Keep selling as today").
 *
 * Wave 4 replaced Pro's "Go Pro" button with a "we don't sell here yet" note,
 * and put the same note beside the Full Analysis's price, for every browser
 * whose time zone was in the EU, the EEA, the UK or India
 * (checkout/RegionNotice.tsx over lib/checkout-territory.ts), so the
 * sales-stay-on page test passed only on a machine set to an American zone.
 * main has no such note. Mounted for real with the browser's zone set to each
 * of those places:
 *   - /pricing (the switch-over's page, src/pages/pricing/PricingPage.tsx)
 *     links to the Full Analysis and offers "Go Pro", with their terms and no
 *     region note, line or question;
 *   - the terms beside a payment and beside a plan carry no region note;
 *   - no page module reads the zone list or sends the browser's zone with a
 *     checkout (main's bodies carry none).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { codeOf } from "./helpers/strip-comments";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q, is: q, not: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: (...a: unknown[]) => invoke(...a) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false, planTier: null, cancelAtPeriodEnd: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import PricingPage from "@/pages/pricing/PricingPage";
import { PurchaseTerms } from "@/components/PurchaseTerms";

const ROOT = resolve(__dirname, "../..");
const ZONES = ["Europe/Berlin", "Europe/London", "Europe/Paris", "Asia/Kolkata"];

vi.setConfig(MOUNT_TEST_BUDGET);
const realOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
const inZone = (zone: string) => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...realOptions.call(this), timeZone: zone };
  });
};
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async () => ({ data: { euUkSales: false }, error: null }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noRegionNote = (where: string) => {
  expect(document.querySelector("[data-region-notice]"), where).toBeNull();
  expect(document.querySelector("[data-region-line], [data-notice=region], [data-faq=region]"), where).toBeNull();
  expect(document.body.textContent ?? "", where).not.toMatch(/don.t sell|tax registration|not yet sold|not sold in|EU, the EEA, the UK or India/i);
};

describe("/pricing, from a browser in each of those places", () => {
  for (const zone of ZONES) {
    it(`${zone}: links to the Full Analysis and offers Go Pro, with their terms and no region note`, () => {
      inZone(zone);
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
      render(<HelmetProvider><MemoryRouter initialEntries={["/pricing"]}><PricingPage /></MemoryRouter></HelmetProvider>);
      expect(document.querySelector("a[data-buy='full-analysis'][href='/resume-checker#upload']")).not.toBeNull();
      expect(screen.getByRole("button", { name: /Go Pro/ })).toBeInTheDocument();
      expect(document.querySelector("[data-testid='purchase-terms']")).not.toBeNull();
      noRegionNote(zone);
    });
  }
});

describe("the terms beside a payment and a plan", () => {
  it("carry no region note from Berlin or Kolkata", () => {
    for (const zone of ["Europe/Berlin", "Asia/Kolkata"]) {
      inZone(zone);
      for (const kind of ["payment", "subscription"] as const) {
        render(<MemoryRouter><PurchaseTerms kind={kind} /></MemoryRouter>);
        noRegionNote(`${zone} ${kind}`);
        cleanup();
      }
      vi.restoreAllMocks();
    }
  });
});

describe("no page module reads the zone list or sends the browser's zone", () => {
  it("the note and the zone reader are gone, and no checkout caller adds a time zone", () => {
    expect(existsSync(resolve(ROOT, "src/components/checkout/RegionNotice.tsx"))).toBe(false);
    expect(existsSync(resolve(ROOT, "src/lib/checkout-territory.ts"))).toBe(false);
    for (const f of [
      "src/components/ProSubscriptionCard.tsx", "src/components/PurchaseTerms.tsx", "src/hooks/use-pro-subscription.ts",
      "src/hooks/use-product-checkout.ts", "src/pages/Index.tsx", "src/lib/checkout-refusal.ts",
      "src/components/pricing/BuyBlock.tsx", "src/components/pricing/BeforeYouBuy.tsx", "src/components/pricing/PricingFaq.tsx",
      "src/components/home/HomePlanStrip.tsx",
    ]) {
      expect(codeOf(readFileSync(resolve(ROOT, f), "utf8")), f).not.toMatch(/RegionNotice|useRegionRefused|inSalesTerritory|territoryHint|checkout-territory|sales-territory|territoryRefused/);
    }
  });
});
