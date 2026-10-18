/**
 * THE UPLOADER AND THE COMPARISON SELL NOTHING UNTIL THE SELLER IS NAMED
 * (owner decision 2026-10-17; California Business and Professions Code
 * 17538(d)).
 *
 * The buy buttons for the $5 Full Analysis render only while
 * src/config/seller.ts carries the seller's legal name and postal address.
 * checkout-catalogue gated the homepage's press, the closing call to action,
 * the sticky bar, the Pricing page and the Pro card; the integration gated
 * the rest that priced the analysis on a button:
 *   - the uploader's "Or get the complete analysis for $5" link under the
 *     free scan, and its full-width "Get Full Analysis — $5" fallback when no
 *     free scan is offered;
 *   - the homepage comparison's "Try It Now — $5" button, which now offers
 *     the free scan while purchases are not open.
 * Each says purchases open soon instead. Mounted with the shipped (empty)
 * identity, and with a named one as the control.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const seller = vi.hoisted(() => ({ legalName: "", postalAddress: "" }));
vi.mock("@/config/seller", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/seller")>();
  return { ...real, SELLER: seller, sellerIdentity: (x = seller) => real.sellerIdentity(x) };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";
import { ComparisonTable } from "@/components/ComparisonTable";
import { PRODUCTS } from "@/config/products";

afterEach(() => { cleanup(); seller.legalName = ""; seller.postalAddress = ""; });
const nameSeller = () => { seller.legalName = "Example Seller LLC"; seller.postalAddress = "1 Example Street, Springfield"; };

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts";
const PRICE = new RegExp(`\\$${PRODUCTS.fullAnalysis.priceUsd}\\b`);
const pricedButtons = () => screen.queryAllByRole("button").filter((b) => PRICE.test(b.textContent ?? "") && !b.closest('[data-scan-button="true"]'));

function uploader(withFreeScan: boolean) {
  render(
    <MemoryRouter>
      <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={withFreeScan ? vi.fn() : undefined} isLoading={false} hasContent resumeText={RESUME} />
    </MemoryRouter>,
  );
}

describe("the uploader", () => {
  it("with no seller named, under the free scan: no priced link, and purchases open soon", () => {
    uploader(true);
    expect(pricedButtons()).toEqual([]);
    expect(document.querySelector("[data-purchases-open-soon]")).not.toBeNull();
    // The free scan itself is untouched.
    expect(document.querySelector('[data-scan-button="true"] button')).not.toBeNull();
  });

  it("with no seller named and no free scan: no priced fallback button, and purchases open soon", () => {
    uploader(false);
    expect(pricedButtons()).toEqual([]);
    expect(document.querySelector("[data-purchases-open-soon]")).not.toBeNull();
  });

  it("control: with a seller named, both priced buttons are back", () => {
    nameSeller();
    uploader(true);
    expect(pricedButtons().length).toBe(1);
    expect(document.querySelector("[data-purchases-open-soon]")).toBeNull();
    cleanup();
    uploader(false);
    expect(pricedButtons().length).toBe(1);
  });
});

describe("the homepage comparison", () => {
  it("with no seller named, its call to action offers the free scan, not the price", () => {
    render(<ComparisonTable />);
    const closed = document.querySelector("[data-comparison-closed]");
    expect(closed).not.toBeNull();
    expect(closed!.querySelector("[data-purchases-open-soon]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Scan my résumé free/ })).toBeTruthy();
    expect(pricedButtons()).toEqual([]);
  });

  it("control: with a seller named, the priced call to action is back", () => {
    nameSeller();
    render(<ComparisonTable />);
    expect(document.querySelector("[data-comparison-closed]")).toBeNull();
    expect(pricedButtons().length).toBe(1);
  });
});
