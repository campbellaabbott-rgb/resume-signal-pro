/**
 * THE BUY LINE SAYS ALL SALES ARE FINAL, AND WHERE CHECKOUT WILL NOT SELL
 * (homepage and pricing spec of 2026-10-17: "Before you buy"; switch-over
 * README, step 8 and W5; the before-audit's finding that none of six paid
 * entry points said either).
 *
 * PurchaseTerms is the block above every buy button. It named the Terms, the
 * renewal and the seller, and told only a browser whose time zone is in the
 * territory that sales there wait (RegionNotice). It now says, above every
 * payment and every plan and never above a sign-up:
 *   - "All sales are final.", the same sentence the pricing page uses;
 *   - one region line for every buyer: not sold in the EU, the EEA, the UK or
 *     India yet, and that checkout turns buyers away by the currency and the
 *     time zone the device reports. Those are the two checks checkout always
 *     runs; the address lookup answers only with a key nobody has set, so the
 *     line never names it (owner decision W5, 2026-10-24).
 * The block carries ONE region statement, so RegionNotice no longer renders
 * inside it: the line covers every buyer, including one turned away by the
 * currency whose time zone the notice could not place. The line goes when the
 * server says EU and UK sales are on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
const state = vi.hoisted(() => ({ territory: false, euUkOn: false }));
vi.mock("@/lib/checkout-territory", () => ({ inSalesTerritory: () => state.territory, territoryHint: () => ({}), buyerTimeZone: () => "" }));
vi.mock("@/lib/purchase-terms", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, useEuUkBoxShown: () => state.euUkOn, askServerForEuUkSwitch: () => {} };
});

import { PurchaseTerms } from "@/components/PurchaseTerms";

afterEach(() => { cleanup(); state.territory = false; state.euUkOn = false; });

const ROOT = resolve(__dirname, "../..");
const LOCALES = resolve(ROOT, "src/i18n/locales");
const three = () => render(
  <MemoryRouter>
    <PurchaseTerms kind="payment" />
    <PurchaseTerms kind="subscription" plan="pro" />
    <PurchaseTerms kind="signup" />
  </MemoryRouter>,
);
const blocks = () => [...document.querySelectorAll<HTMLElement>("[data-testid='purchase-terms']")];

describe("above every payment and plan, never above a sign-up", () => {
  it("says all sales are final", () => {
    three();
    const [pay, plan, signup] = blocks();
    expect(pay.querySelector("[data-final-sale]")?.textContent).toBe("All sales are final.");
    expect(plan.querySelector("[data-final-sale]")?.textContent).toBe("All sales are final.");
    expect(signup.querySelector("[data-final-sale]")).toBeNull();
  });

  it("names the territory and the two checks to every buyer, wherever their time zone is", () => {
    three();
    const [pay, plan, signup] = blocks();
    for (const b of [pay, plan]) {
      const line = b.querySelector("[data-region-line]")?.textContent ?? "";
      expect(line).toMatch(/^Not sold in the EU, the EEA, the UK or India yet\./);
      expect(line).toMatch(/currency/);
      expect(line).toMatch(/time zone/);
    }
    expect(signup.querySelector("[data-region-line]")).toBeNull();
  });

  it("carries one region statement: in the territory the line stands alone, without the time-zone notice", () => {
    state.territory = true;
    three();
    for (const b of blocks().slice(0, 2)) {
      expect(b.querySelectorAll("[data-region-line]")).toHaveLength(1);
      expect(b.querySelector("[data-region-notice]")).toBeNull();
    }
  });

  it("says nothing about the territory once the server says EU and UK sales are on", () => {
    state.euUkOn = true;
    three();
    for (const b of blocks()) expect(b.querySelector("[data-region-line]")).toBeNull();
    // Final sale stands whatever the switch says.
    expect(blocks()[0].querySelector("[data-final-sale]")).not.toBeNull();
  });
});

describe("in every language", () => {
  const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
  const pt = (f: string) => (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).purchaseTerms ?? {}) as Record<string, string>;

  it("both sentences exist in all nine locales", () => {
    expect(files.length).toBe(9);
    for (const f of files) {
      expect(pt(f).finalSale, `${f} purchaseTerms.finalSale`).toBeTruthy();
      expect(pt(f).regionLine, `${f} purchaseTerms.regionLine`).toBeTruthy();
    }
  });

  it("the region line never names an address lookup, in any language", () => {
    const LOOKUP = /\bIP\b|ipinfo|look-?up|IP-Adresse|adresse IP|dirección IP|endereço IP|IP-adres|IP पता|IP address/i;
    for (const f of files) expect(pt(f).regionLine, f).not.toMatch(LOOKUP);
  });

  it("the final-sale sentence is the one the pricing page uses, where its strings are on this tree", () => {
    const dir = resolve(ROOT, "src/components/pricing/strings");
    let shards: string[] = [];
    try { shards = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { /* the pricing page ships with hp/integration */ }
    for (const f of shards) {
      const sale = JSON.parse(readFileSync(resolve(dir, f), "utf8")).pricingPlans?.buy?.finalSale;
      expect(pt(f).finalSale, f).toBe(sale);
    }
  });
});
